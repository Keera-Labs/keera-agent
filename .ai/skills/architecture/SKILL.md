---
name: architecture
description: Plan and structure features in keera-agent with the domain-driven layout (application, domain, infrastructure), assigning delivery, business logic, persistence, and integrations to the correct layer and bounded context.
---

# Architecture

`app/` follows the same domain-driven layout as Salut AI: three layers, each grouped by the feature or business concept it serves.

- `app/application/`: delivery, grouped by interface and then by feature.
- `app/domain/`: business rules, independent of HTTP, one directory per bounded context.
- `app/infrastructure/`: anything that talks to an external system, such as git, the GitHub CLI, the AI CLIs, PTYs, or the filesystem.

Dependencies flow inward. Application and infrastructure may import the domain. The domain never imports either of them.

The rest of keera still uses the flat layout (`app/controllers/`, `app/actions/`, `app/models/`). Adopt the new layout incrementally, as described under "Adopt incrementally". Other skills, such as `../fastapi-startkit/fastapi/SKILL.md`, still give flat paths. Their rules still apply, but new code goes to the location this skill gives.

## Plan the feature

1. Find the user-facing feature and the bounded context it belongs to. Reuse existing concepts (projects, agents, tasks, terminals) before you add new ones.
2. Split the work into delivery (input and output), business decisions, and external operations, using the placement table below.
3. When business logic needs an external capability, declare a contract in the domain and implement it in infrastructure.
4. Create only the directories the task needs. Do not scaffold empty layers or move unrelated code.

## Bounded contexts

Each context has one directory under `app/domain/`:

| Context | Owns | Current models |
| --- | --- | --- |
| `projects` | Projects, workspaces, per-project rules, and visibility | `Project`, `Workspace` |
| `agents` | Agents, their lifecycle and status, templates, messages, questions, relays, and usage reports | `Agent`, `AgentMessage`, `AgentQuestion`, `AgentRelayMessage`, `AgentTemplate`, `AgentUsageReport` |
| `tasks` | Tasks, the task state machine, dependencies, and events | `Task`, `TaskDependency`, `TaskEvent` |
| `terminals` | Terminal sessions and their persisted output | `TerminalSession`, `TerminalOutput` |
| `commands` | Saved commands and command runs | `Command` |
| `settings` | Global, appearance, editor, and remote-control settings | `GlobalSettings` |
| `plugins` | Installed plugins | `Plugin` |

Add a context only when a new business concept fits none of these. Name it as a plural noun.

## Layers

### Application: `app/application/<interface>/<feature>/`

Group application code by interface first, then by feature:

| Interface | Serves | Route file |
| --- | --- | --- |
| `api` | JSON endpoints, including Claude Code hook endpoints | `routes/api.py` |
| `web` | Inertia pages and the WebSocket attach points (`/{project}/ws`, `shell-ws`, `command-ws`) | `routes/web.py` |
| `mcp` | The MCP server and its tools | mounted at `/mcp` |
| `console` | `artisan` commands | registered by the app provider |

Each feature directory holds only the subdirectories it needs:

```text
application/
├── api/
│   └── tasks/
│       ├── controllers/
│       │   ├── task_controller.py
│       │   └── transition_controller.py
│       ├── requests/
│       │   └── task_request.py
│       └── resources/
│           └── task_resource.py
├── web/
│   └── tasks/
│       └── controllers/
│           └── tasks_page_controller.py
├── mcp/
│   ├── server.py
│   └── tools/
│       └── task_tools.py
└── console/
    └── commands/
        └── claude_hook_command.py
```

- `controllers/` holds the entry points. A controller turns a request into one repository read or one action call.
- `requests/` holds the input models the feature's controllers validate.
- `resources/` holds the `JsonResource` classes that shape the output.
- A resource that several features share goes in `app/application/resources/`.

Requests and resources are delivery concerns. Keep them next to the controllers that use them, not in a global directory.

### Domain: `app/domain/<context>/`

```text
domain/
└── tasks/
    ├── models/
    │   ├── __init__.py
    │   ├── task.py
    │   └── task_event.py
    ├── repositories/
    │   └── task_repository.py
    ├── filters/
    │   └── task_filters.py
    ├── actions/
    │   └── task_transition_action.py
    ├── services/
    │   └── task_policy.py
    ├── data/
    │   └── task_actor.py
    ├── constants/
    │   └── task_status.py
    ├── queues/
    └── exceptions.py
```

- `models/`: the ORM models, which also serve as domain models. Each model carries its business behavior, such as `Task.completed_at_for`. `models/__init__.py` re-exports them.
- `repositories/`: one repository per aggregate. Every read goes through a repository, and a repository never writes.
- `filters/`: named query pieces that a repository composes to narrow, eager-load, or order a query.
- `actions/`: one state-changing use case per action.
- `services/`: business logic that does not belong to a single model, such as the task transition policy.
- `data/`: frozen dataclasses (value objects) and the `Protocol` contracts the domain needs from the outside world.
- `constants/`: enums and named business values.
- `queues/`: background work the domain dispatches.
- `exceptions.py`: the context's domain errors, which subclass one base error per context, for example `TaskError` with `TaskRuleRejected` as a subclass.

Shared persistence helpers that hold domain meaning, such as JSON casts and transactions, go in `app/domain/database/`.

### Infrastructure: `app/infrastructure/`

```text
infrastructure/
├── services/
│   ├── vcs/
│   │   └── git/
│   │       ├── repository.py
│   │       └── worktrees.py
│   ├── code_host/
│   │   └── github_cli.py
│   └── usage/
│       ├── claude.py
│       ├── codex.py
│       └── gemini.py
├── ai/
│   └── providers/
│       ├── claude.py
│       ├── codex.py
│       └── gemini.py
├── terminal/
│   ├── manager.py
│   └── connection_manager.py
├── http/
│   ├── exception_handlers.py
│   └── trusted_origin_middleware.py
├── providers/
│   └── terminal_provider.py
└── support/
    └── json_utils.py
```

- `services/<capability>/<vendor>/` holds integrations, grouped by capability first and vendor second. A vendor can be a single module (`code_host/github_cli.py`). Putting the capability first keeps vendor names out of call sites, so adding a second vendor means adding a sibling, not renaming anything.
- `ai/<capability>/` holds the AI CLI providers. They implement the provider contract the agents domain declares.
- `terminal/` holds the PTY processes, the WebSocket connection registry, and the CLI supervision. It is process plumbing, not business logic.
- `http/` holds delivery-wide concerns, such as global exception handlers and middleware.
- `providers/` holds service providers that bind contracts to implementations and register commands.
- `support/` holds general helpers that know nothing about keera's business. Code here imports nothing from `application`, `domain`, or the rest of `infrastructure`.

### Outside the layers

`config/`, `routes/`, `bootstrap/`, `databases/`, `resources/js/`, and `tests/` keep their current locations and conventions. This skill covers only the layout of `app/`. Registration order in `bootstrap/application.py` still matters: Database before FastAPI, and Vite before Inertia. For the frontend, follow `../frontend/SKILL.md`.

## Dependency rules

| Layer | May import |
| --- | --- |
| `application` | `domain`, `infrastructure` (for HTTP helpers and contract implementations), and `config` |
| `domain` | Other contexts' `models`, `constants`, and `data`; `domain/database`; the ORM; and `config` |
| `infrastructure` | `domain` (models, contracts, and constants) and `config` |
| `infrastructure/support` | The standard library and third-party packages only |

The domain never imports FastAPI, `Request`, Inertia, `JsonResource`, vendor SDKs, `subprocess` wrappers, or anything under `application/` or `infrastructure/`. When an action needs git, a PTY, or an AI CLI, it receives an object that satisfies a `Protocol` from `domain/<context>/data/`, and a provider binds the concrete class.

ORM models count as domain models. This is a deliberate trade-off: the models already carry the business vocabulary, and the alternative is a mapping layer for every entity. That is why repositories and filters live in the domain.

## Read through repositories, write through actions

- A controller never queries a model (`Model.where`, `all`, `find`) and never calls `create`, `update`, `save`, or `delete`. It calls a repository for reads and an action for writes.
- A repository is read-only. Its methods return models, collections, or paginators built with the query builder, and use `find_or_fail` when a missing record should be a 404.
- An action never just reads. A use case that only loads and shapes data belongs in the controller: it calls the repository and returns the resource.
- Build every query with the ORM query builder. Never write SQL strings or use `DB.statement`, `DB.select`, or `*_raw` builder methods.
- Compute counts, sums, and groupings in the query, not in Python over loaded rows.

keera does not have a `Repository[Model]` or `Filter[Model]` base class yet. Until one ships, a repository is a plain class with read-only async methods, each beginning from `Model.query()`, and a filter is a named function or small class in `filters/` that takes a query builder and returns it. Do not vendor a base class as part of an unrelated change.

```python
class TaskRepository:
    async def find_or_fail(self, task_id: int) -> Task:
        return await Task.where_null("deleted_at").find_or_fail(task_id)

    async def open_for_project(self, project_id: int, since: str):
        return await recently_active(Task.where("project_id", project_id).where_null("deleted_at"), since).paginate()
```

## Naming

| Kind | File | Symbol |
| --- | --- | --- |
| Controller | `<resource>_controller.py`, named after the resource without repeating the feature directory (`transition_controller.py` inside `tasks/`, not `task_transition_controller.py`) | Plain async functions limited to `index`, `show`, `create`, `store`, `edit`, `update`, `destroy` |
| Request | `<resource>_request.py` | `<Resource><Verb>Request` (`TaskStoreRequest`) |
| Resource | `<resource>_resource.py` | `<Resource>Resource` |
| Model | `<model>.py` in snake_case | `Task`, re-exported from `models/__init__.py` |
| Repository | `<aggregate>_repository.py` | `TaskRepository` |
| Filter | `<aggregate>_filters.py` | `TaskOpenFilter`, or a function such as `open_tasks(query)` |
| Action | `<resource>_<method>_action.py` | `{Resource}{Method}Action` (`TaskTransitionAction`, `AgentDeleteAction`), with no interface prefix (not `McpTaskUpdateAction`) |
| Domain error | `exceptions.py` | `<Context>Error` base class, with subclasses named after the failure (`TaskRuleRejected`) |
| Contract | `data/<capability>.py` | A `Protocol` named after the capability (`WorktreeRemover`) |

A custom verb becomes its own resource. Pausing an agent is `agent_pause_controller.store`, not `agent_controller.pause`. The one exception is a WebSocket entry point, which has no REST verb. Give it its own controller and name the function `attach`, as `command_run_controller.attach` does.

An action takes plain values (ids, enums, and strings), never a request model or FastAPI object. It has a static `prepare(...)` that returns the action, and a `handle()` that reads as a list of steps: load, check access, check preconditions, apply side effects, write, and return a model or plain value. It fails by raising an error from its context's `exceptions.py`. The global handlers in `infrastructure/http/` map those errors to HTTP statuses, as described in `../exception-handling/SKILL.md`.

## Example: move a task to a new status

```text
app/
  application/api/tasks/
    controllers/transition_controller.py   # store(): validates TaskTransitionRequest, runs the action, returns TaskResource
    requests/task_transition_request.py     # TaskTransitionRequest
    resources/task_resource.py              # TaskResource
  application/mcp/tools/task_tools.py       # update_task_status: calls the same action
  domain/tasks/
    models/task.py                          # Task, with completed_at_for()
    repositories/task_repository.py         # TaskRepository: find_or_fail, open_for_project
    filters/task_filters.py                 # open-task and recently completed filters
    actions/task_transition_action.py       # TaskTransitionAction
    services/task_policy.py                 # transition, ownership, and dependency rules
    constants/task_status.py                # TaskStatus, TERMINAL_STATUSES
    exceptions.py                           # TaskError, TaskRuleRejected, StaleTaskWrite
  infrastructure/http/exception_handlers.py # maps TaskRuleRejected to 409
```

```python
class TaskTransitionAction:
    def __init__(self, task_id: int, status: TaskStatus, actor_agent_id: int | None) -> None:
        self.task_id: int = task_id
        self.status: TaskStatus = status
        self.actor_agent_id: int | None = actor_agent_id
        self.tasks: TaskRepository = TaskRepository()

    @staticmethod
    def prepare(task_id: int, status: TaskStatus, actor_agent_id: int | None) -> "TaskTransitionAction":
        return TaskTransitionAction(task_id, status, actor_agent_id)

    async def handle(self) -> Task:
        task = await self.tasks.find_or_fail(self.task_id)
        ensure_transition_allowed(task, self.status, self.actor_agent_id)
        await task.update({"status": self.status, "completed_at": task.completed_at_for(self.status)})
        await TaskEvent.create({"task_id": task.id, "to_status": self.status})
        return task
```

```python
async def store(task_id: int, body: TaskTransitionRequest) -> TaskResource:
    task = await TaskTransitionAction.prepare(task_id, body.status, body.actor_agent_id).handle()
    return TaskResource(task)
```

The HTTP controller and the MCP tool both call the same action, so the transition rules live in one place.

Wrong: a controller decides whether a task may move to `done` and runs `git worktree remove` inline. Move the rule into `domain/tasks/services/task_policy.py`, put the git call in `infrastructure/services/vcs/git/`, and have the action receive it through a `WorktreeRemover` contract.

## Adopt incrementally

Do not relocate code that your task does not touch. Put new code in the target layout. When a change substantially rewrites a legacy file, move that file to its target location in the same PR, along with the imports and tests that point at it. Keep each route's HTTP method, path, and status code unchanged, because the Vue pages call hard-coded paths.

| Current | Target |
| --- | --- |
| `app/controllers/<resource>_controller.py` (API) | `app/application/api/<feature>/controllers/` |
| `app/controllers/*_page_controller.py`, `dashboard_controller.py`, `home_controller.py`, WebSocket `attach` handlers | `app/application/web/<feature>/controllers/` |
| `app/requests/` | `app/application/<interface>/<feature>/requests/` |
| `app/resources/` | `app/application/<interface>/<feature>/resources/`, or `app/application/resources/` when shared |
| `app/mcp/server.py`, `app/mcp/tools.py`, `app/mcp/browser_tools.py` | `app/application/mcp/server.py`, `app/application/mcp/tools/<feature>_tools.py` |
| `app/console/` | `app/application/console/commands/` |
| `app/models/<Model>.py` | `app/domain/<context>/models/<model>.py` |
| `app/models/casts.py` | `app/domain/database/casts.py` |
| `app/actions/<name>_action.py` | `app/domain/<context>/actions/` (for example, `agent_create_action.py` goes to `domain/agents/actions/`) |
| Read-only helpers in `app/actions/` (for example, `agent_health_action.py`) and `app/terminal/terminal_queries.py` | `app/domain/<context>/repositories/` and `filters/` |
| `app/constant/` | `app/domain/<context>/constants/` (for example, `task_status.py` goes to `domain/tasks/constants/`) |
| `app/exceptions/<name>_error.py` | `app/domain/<context>/exceptions.py` |
| `app/exceptions/handlers.py` | `app/infrastructure/http/exception_handlers.py` |
| `app/middleware/` | `app/infrastructure/http/` |
| `app/services/task_policy.py`, `relay_identity.py`, `permissions/` | `app/domain/<context>/services/` |
| `app/services/git_*.py`, `worktree_*.py`, `pull_request_head.py` | `app/infrastructure/services/vcs/git/` |
| `app/services/github_cli.py` | `app/infrastructure/services/code_host/github_cli.py` |
| `app/services/*_usage.py`, `claude_config*.py`, `gemini_*.py`, `antigravity_agent.py` | `app/infrastructure/services/<capability>/<vendor>` |
| `app/ai/provider.py` (the `Provider` contract and `ProviderCommand`) | `app/domain/agents/data/provider.py` |
| `app/ai/providers/`, `app/ai/registry.py` | `app/infrastructure/ai/providers/` |
| `app/terminal/` | `app/infrastructure/terminal/` |
| `app/plugins/` | `app/domain/plugins/` for the plugin model and rules, and `app/infrastructure/plugins/` for the loader |
| `app/providers/` | `app/infrastructure/providers/` |
| `app/utils/` | `app/infrastructure/support/`, or the owning context when the helper has business meaning (`agent_worktree.py` goes to `domain/agents/`) |
| `app/heartbeat.py`, `checkin_scheduler.py`, `agent_health_probe.py` | `app/domain/agents/queues/` for the scheduled work and `actions/` for the state change |
| `app/prompts/`, `app/statusline/` | Keep at their current locations until a task moves them, since they are templates and a script, not Python layers |

Tests mirror the layer they exercise. HTTP tests stay in `tests/features/`. New domain unit tests go in `tests/units/`, and the existing unit tests at the root of `tests/` stay where they are until they are touched.

## Related skills

- Routes, controller signatures, request models, and resources: `../fastapi-startkit/fastapi/SKILL.md`
- JSON shapes and status codes: `../api-response-standard/SKILL.md`
- Exceptions and reporting: `../exception-handling/SKILL.md`
- Vue pages, components, queries, and stores: `../frontend/SKILL.md`
