---
name: fastapi-startkit-fastapi
description: Routes, controllers, requests, and resources for keera-agent's fastapi-startkit application.
---

# FastAPI Routing and Controllers

## Routes

All routes live in `routes/web.py`. Register API routes before the `/{project}` wildcard page route. The `Router` wrapper exposes `get`, `post`, `put`, `patch` and `delete` helpers, so register every verb the same way.

```python
router.get("/api/projects/{project_id}/tasks", task_controller.index)
router.post("/api/projects/{project_id}/tasks", task_controller.store)
router.patch("/api/tasks/{task_id}", task_controller.update)
router.delete("/api/tasks/{task_id}", task_controller.destroy)
router.put("/api/projects/{project_id}/files/content", project_file_content_controller.update)
```

Page routes render Inertia responses (`Inertia.render("ComponentName", props)`); API routes return a resource or `JSONResponse`.

## Controllers

One file per resource in `app/controllers/`, named `<resource>_controller.py`. Use plain async functions, not classes.

Use resourceful verbs: `index` (list), `show` (single), `store` (create), `update` (edit), `destroy` (delete), plus `create`/`edit` for Inertia form pages. Do not invent verb-noun names such as `get_default` or `set_default` on an unrelated controller. When a resource grows its own verbs, give it its own controller.

The canonical shape is `app/controllers/task_controller.py`:

```python
from app.models.Task import Task
from app.requests.task_request import TaskStoreRequest
from app.resources.task_resource import TaskResource


async def store(body: TaskStoreRequest, project_id: int) -> TaskResource:
    task = await Task.create({**body.model_dump(), "project_id": project_id, "status": "pending"})
    return TaskResource(task)
```

Keep controllers thin: validate input through the request model, call an action or service for anything with business rules, and shape the response. Reference tests: `tests/features/test_task_controller.py`. Response shapes and status codes are covered in `../../api-response-standard/SKILL.md`.

## Requests

Input models are Pydantic `BaseModel` classes in `app/requests/<resource>_request.py`. Set `ConfigDict(str_strip_whitespace=True, use_enum_values=True)` so incoming strings are trimmed and enums are stored by value, and put the constraints on the fields. FastAPI rejects invalid input with 422.

```python
from pydantic import BaseModel, ConfigDict, Field


class TaskStoreRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, use_enum_values=True)

    title: str = Field(min_length=1)
    body: str | None = None
```

## Resources

Output shaping lives in `app/resources/<resource>_resource.py`. Subclass `JsonResource[Model]` from `fastapi_startkit.jsonapi` and implement `to_attributes()`. The base class renders the JSON:API body `{"data": {"id", "type", "attributes"}}`, so controllers return the resource itself rather than wrapping it. Normalise JSON columns in the resource, because the ORM returns them as strings after a load and as lists after a create.

## ORM

Models in `app/models/` declare `__table__` only; the schema lives in `databases/migrations/`. Await every ORM call. Use `find_or_fail()` for existence checks. Declare JSON columns as `list` on the model so the ORM casts them.

## Actions

Multi-step business logic goes in `app/actions/<name>_action.py`. Actions take plain values or models and return results or raise exceptions. They do not import `Request` or build HTTP responses.

## Verify

Add or update tests in `tests/features/` using `TestCase` from `tests/test_case.py` and factories from `databases/factories/`. Run `uv run pytest tests/features/<file>` before opening the PR.
