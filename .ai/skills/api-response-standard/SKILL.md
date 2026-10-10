---
name: api-response-standard
description: Add or change JSON response shapes and HTTP status codes for keera-agent routes and controllers.
---

# API Responses

keera-agent returns JSON directly from controllers. Do not introduce a wrapper class or a new envelope for a single endpoint. Follow the shapes that existing controllers already use, so the frontend's Pinia Colada queries keep working.

## Implementation steps

1. Return model output as a `JsonResource` (single) or `ResourceCollection` (list) from `app/resources/`, directly from the controller. The resource renders a JSON:API body, `{"data": {"id", "type", "attributes"}}`, and a collection renders a list of those. Example: `task_controller.store` returns `TaskResource(task)` and `task_controller.index` returns `TaskResource.collection(tasks)`. Both respond with 200.
2. Return a plain dictionary wrapped in `JSONResponse` only when the payload is not a model, for example `JSONResponse({"data": {...}})`. Do not wrap a resource in `{"data": ...}` yourself: the resource already provides that key.
3. Return errors as `JSONResponse({"error": "<client-safe message>"}, status_code=<status>)`. A `ModelNotFoundException` is rendered as a 404 with the same `error` key by `app/exceptions/handlers.py`.
4. Use the status that matches the failure:
   - 200 for ordinary success, including a successful create (`task_controller.store` returns 200, not 201).
   - 202 for accepted background work.
   - 400 for malformed input the request model does not cover.
   - 404 for a missing record.
   - 409 for a state conflict, such as `agent_dispatch_controller` refusing to remove a worktree with uncommitted changes.
   - 422 for validation failures. Pydantic produces 422 for request-model errors. Controllers also return 422 by hand for business-rule validation, such as `command_controller` rejecting an empty label or `agent_dispatch_controller` returning the `ValueError` from `AgentCreateAction` as a 422.
   - 500 only for unexpected failures, and never with raw exception text unless the controller already returns `str(exc)` as a deliberate message.
5. Deletes return a bodyless 204: `return Response(status_code=204)`, as `task_controller.destroy` and `command_controller.destroy` do. A JSON body on a 204 causes a server-side `Response content longer than Content-Length` error.
6. Validate request bodies with Pydantic models in `app/requests/`, and type the controller parameter with them. Do not parse raw bodies by hand in controllers.
7. Some error responses carry an extra `detail` key next to `error`. `agent_dispatch_controller` does this on its 409 and 500 worktree failures, with git output. Treat `detail` as an optional string that explains the `error`. Do not remove it while doing unrelated work, and do not send git output in new 5xx responses.
8. When a response shape changes, update the matching frontend query or store and the affected tests in the same PR.

## Shapes

Resource success (`TaskResource`):

```json
{
  "data": {
    "id": 12,
    "type": "task",
    "attributes": { "title": "Add tests", "status": "pending" }
  }
}
```

Collection success: a list of the same resource objects under `data`.

Error:

```json
{ "error": "Task not found." }
```

Error with an explanatory detail:

```json
{ "error": "The agent worktree has uncommitted changes that would be lost.", "detail": " M app/main.py" }
```

Pydantic validation error (422) keeps FastAPI's default body.

## Avoid

- Do not nest `data` inside `data`, and do not wrap a `JsonResource` in another `{"data": ...}`.
- Do not return 200 for a failure, or put an error under `data`.
- Do not expose raw exception messages in 5xx responses.
- Do not put a JSON body on a 204.

## Verify

Check the status and body for each changed path. In tests, read the resource through `response.json()["data"]["attributes"]` (see `tests/features/test_task_controller.py`), and failures through `response.json()["error"]`. Assert statuses with `assert_ok()` for 200 and `assert_status(<code>)` for others.
