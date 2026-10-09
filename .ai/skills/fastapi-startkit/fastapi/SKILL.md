---
name: fastapi-startkit-fastapi
description: Routes, controllers, requests, and resources for keera-agent's fastapi-startkit application.
---

# FastAPI Routing and Controllers

## Routes

All routes live in `routes/web.py`. Register API routes before the `/{project}` wildcard page route. The `Router` wrapper exposes GET and POST helpers; use `router.router.add_api_route` for PATCH and DELETE.

```python
router.get("/api/tasks/{task_id}", task_controller.show)
router.post("/api/tasks", task_controller.store)
router.router.add_api_route("/api/tasks/{task_id}", task_controller.update, methods=["PATCH"])
router.router.add_api_route("/api/tasks/{task_id}", task_controller.destroy, methods=["DELETE"])
```

Page routes render Inertia responses (`Inertia.render("ComponentName", props)`); API routes return `JSONResponse`.

## Controllers

One file per resource in `app/controllers/`, named `<resource>_controller.py`. Use plain async functions, not classes.

Use resourceful verbs: `index` (list), `show` (single), `store` (create), `update` (edit), `destroy` (delete), plus `create`/`edit` for Inertia form pages. Do not invent verb-noun names such as `get_default` or `set_default` on an unrelated controller. When a resource grows its own verbs, give it its own controller.

```python
from fastapi.responses import JSONResponse

from app.models.Task import Task
from app.requests.task_request import TaskStoreRequest
from app.resources.task_resource import TaskResource


async def index(project_id: int):
    return TaskResource.collection(await Task.where("project_id", project_id).paginate())


async def store(body: TaskStoreRequest, project_id: int):
    task = await Task.create({**body.model_dump(), "project_id": project_id})
    return JSONResponse({"data": TaskResource(task).to_attributes()}, status_code=201)
```

Keep controllers thin: validate input through the request model, call an action or service for anything with business rules, and shape the response. Reference example: `app/controllers/task_controller.py` with `tests/features/test_task_controller.py`.

## Requests

Input models are Pydantic `BaseModel` classes in `app/requests/<resource>_request.py`. Put the constraints on the fields and let FastAPI reject invalid input with 422.

```python
from pydantic import BaseModel, Field


class TaskStoreRequest(BaseModel):
    title: str = Field(min_length=1)
    body: str | None = None
```

## Resources

Output shaping lives in `app/resources/<resource>_resource.py`. Subclass `JsonResource[Model]` from `fastapi_startkit.jsonapi` and implement `to_attributes()`. Normalise JSON columns in the resource, because the ORM returns them as strings after a load and as lists after a create.

## ORM

Models in `app/models/` declare `__table__` only; the schema lives in `databases/migrations/`. Await every ORM call. Use `find_or_fail()` for existence checks. Declare JSON columns as `list` on the model so the ORM casts them.

## Actions

Multi-step business logic goes in `app/actions/<name>_action.py`. Actions take plain values or models and return results or raise typed exceptions. They do not import `Request` or build HTTP responses.

## Verify

Add or update tests in `tests/features/` using `TestCase` from `tests/test_case.py` and factories from `databases/factories/`. Run `uv run pytest tests/features/<file>` before opening the PR.
