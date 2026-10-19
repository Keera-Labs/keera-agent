---
name: architecture
description: Plan and place code in keera-agent: controllers, requests, resources, actions, services, models, and infrastructure modules.
---

# Architecture

## Plan the feature

1. Inspect the affected code and reuse existing concepts (agents, projects, tasks, terminals) before adding new ones.
2. Separate HTTP input and output, business decisions, and external operations using the placement rules below.
3. Create only the files the task needs. Do not scaffold empty layers or move unrelated code.

## Place code

| Responsibility | Location |
| --- | --- |
| Route registration | `routes/web.py` (API routes before the `/{project}` wildcard) |
| HTTP handlers | `app/controllers/<resource>_controller.py` |
| Input validation | `app/requests/<resource>_request.py` (Pydantic) |
| Output shaping | `app/resources/<resource>_resource.py` (`JsonResource`) |
| Persistence | `app/models/<Model>.py` (`__table__` only), schema in `databases/migrations/` |
| Business operations | `app/actions/<name>_action.py` |
| Reusable logic that spans models or touches the filesystem, git, processes, or CLIs | `app/services/` |
| Agent, MCP and plugin code | `app/mcp/`, `app/plugins/`, `app/ai/` |
| Terminal and PTY code | `app/terminal/` |
| Error mapping | `app/exceptions/handlers.py` |
| Helpers without business meaning | `app/utils/` |
| Configuration | `config/` (dataclass objects, read via `env()`) |
| Boot and wiring | `bootstrap/application.py`, `app/providers/` |

Registration order in `bootstrap/application.py` matters: Database before FastAPI, Vite before Inertia.

## Enforce boundaries

- Controllers validate input through request models, call an action or service, and return the response. Keep business rules out of controllers.
- Actions and services take values or models, not FastAPI `Request` objects, and return values or raise exceptions.
- Do not construct external clients (git, GitHub CLI, the Claude CLI) inside controllers. Call a service that wraps them.
- Keep the frontend contract in mind: a change to a response shape also changes the matching Pinia Colada query in `resources/js/queries/`.

## Example: create a task

```text
app/
  controllers/task_controller.py       # store(): validates TaskStoreRequest, calls the action, returns TaskResource
  requests/task_request.py             # TaskStoreRequest
  resources/task_resource.py           # TaskResource
  models/Task.py                       # Task (__table__ only)
  actions/task_create_action.py        # enforces the business rules, returns the Task
```

Name controllers after their resource: `task_controller.py`, not `create_task_controller.py`. Represent nested resources with their own controllers.

Wrong: a controller decides whether a task can move to `completed` and runs a git command inline. Move the rule into an action and the git call into a service.

## Related skills

- Routes and controllers: `../fastapi-startkit/fastapi/SKILL.md`
- JSON shapes and status codes: `../api-response-standard/SKILL.md`
- Exceptions and reporting: `../exception-handling/SKILL.md`
