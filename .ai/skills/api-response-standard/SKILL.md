---
name: api-response-standard
description: Add or change JSON response shapes and HTTP status codes for keera-agent routes and controllers.
---

# API Responses

keera-agent returns JSON directly from controllers. Do not introduce a wrapper class or a new envelope for a single endpoint. Follow the shapes that existing controllers already use, so the frontend's Pinia Colada queries keep working.

## Implementation steps

1. Return success payloads as `JSONResponse({"data": <payload>})`. Use `JsonResource` (from `app/resources/`) or `ResourceCollection` for model output, and return them as the `data` value.
2. Return errors as `JSONResponse({"error": "<client-safe message>"}, status_code=<status>)`. A `ModelNotFoundException` is rendered as a 404 with the same `error` key by `app/exceptions/handlers.py`.
3. Use 200 for ordinary success, 201 for creation, and 202 for accepted background work. Use 400 for malformed input, 404 for missing records, 409 for state conflicts, 422 for validation that Pydantic rejects, and 500 only for unexpected failures.
4. Validate request bodies with Pydantic models in `app/requests/` and type the controller parameter with them. Do not parse raw bodies by hand in controllers.
5. Keep payload shapes in `app/resources/`. Do not build dictionaries of model fields inside controllers when a resource exists.
6. Preserve existing contracts during unrelated changes. When a response shape changes, update the matching frontend query or store and the affected tests in the same PR.

## Shapes

Success:

```json
{ "data": { "id": 12, "title": "Add tests" } }
```

Client or server error:

```json
{ "error": "Task not found." }
```

Validation error (422) comes from FastAPI's request validation and keeps its default body.

## Avoid

- Do not nest `data` inside `data`.
- Do not return a 200 for a failure, or put an error under `data`.
- Do not expose raw exception messages in 5xx responses.
- Do not return 204 or redirects from JSON API routes.

## Verify

Check the HTTP status and the exact body for each changed path. In tests, assert on `response.json()["data"]` for success and `response.json()["error"]` for failures.
