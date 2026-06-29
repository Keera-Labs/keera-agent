# Plugin System — Approach & Author's Guide

This document explains **how a plugin system works in Keera Agent** and gives a
**step-by-step guide to writing your own plugin**, using a **Jira plugin** (one that
exposes an MCP the agent can call) as the worked example.

It is grounded in the current codebase: how agents are launched via the `claude`
CLI, how the relay MCP at `:4545` is served and dispatched, how providers boot, and
how config/env is read. File references point at real source so you can follow
along.

> **Scope.** This is a design + approach guide. The Jira example is a skeleton you
> can lift, not a shipped feature. No migration or feature implementation is
> required to understand it.

---

## 1. What "plugin" means here

In Keera Agent, an agent is a `claude` CLI process driven over a PTY. It does work
in the world by **calling MCP tools** over JSON-RPC against the relay server the app
hosts at `http://127.0.0.1:4545/mcp`. Today those tools are project-management
verbs: `list_tasks`, `create_task`, `send_message_to_agent`, `spawn_agent`, etc.

So a **plugin is a new capability you expose to agents as MCP tools.** "Write a Jira
plugin" means: give agents tools like `jira_create_issue` and `jira_search` that they
can call the same way they call `list_tasks` today.

There are two ways to expose those tools, and the system already supports both:

| Approach | What you add | When to use |
| --- | --- | --- |
| **A. In-process tools** (recommended) | `Tool` subclasses appended to the relay server's tool list | First-party plugins that share the app's DB/config and ship with Keera |
| **B. External MCP server** | A separate MCP process referenced from each agent's `.claude/settings.json` `mcpServers` | Third-party / language-agnostic servers you don't want in this codebase |

The bulk of this guide covers **Approach A**, because it reuses everything Keera
already does to register and surface tools. Approach B is covered in
[§6](#6-alternative-approach-b--an-external-mcp-server).

---

## 2. How the system works

### 2.1 The relay MCP server

The relay is **not** mounted by the framework's `McpProvider` (that provider is a
no-op). It is mounted explicitly when routes load, in `routes/web.py`:

```python
# routes/web.py
from app.mcp.server import KeeraServer

router = Router()
mcp_server = KeeraServer()
router.router.include_router(mcp_server.router(prefix="/mcp"))
```

`KeeraServer` (in `app/mcp/server.py`) is the whole plugin surface. It declares its
name and, crucially, the **list of tool classes** it exposes:

```python
# app/mcp/server.py
class KeeraServer(Server):
    name = "keera-agent"
    description = "Keera project management MCP server."

    def tools(self):
        return KEERA_TOOLS + BROWSER_TOOLS   # ← this list is the registry

    def resources(self):
        return [ActiveTasksResource]
```

`KEERA_TOOLS` is a plain list of classes in `app/mcp/tools.py`:

```python
# app/mcp/tools.py
KEERA_TOOLS = [
    CreateTaskTool, ListTasksTool, GetTaskTool, UpdateTaskTool,
    UpdateTaskStatusTool, DeleteTaskTool, SendMessageTool,
    GetAgentMessagesTool, ListAgentsTool, SpawnAgentTool,
    GetOrchestratedAgentsTool, DeleteAgentTool,
]
```

**Adding a plugin = adding classes to a list like this and including it in
`KeeraServer.tools()`.** There is no central `switch`/dispatch to edit.

### 2.2 How a tool call is dispatched

The HTTP + JSON-RPC plumbing lives in the framework (`fastapi_startkit/mcp/`), so you
never touch it:

- `POST /mcp` parses the body into a `JsonRpcRequest` and dispatches by method
  (`Server.router()` → `Protocol.dispatch()`). Protocol version `2024-11-05`.
- `tools/list` returns `{"tools": [t().to_json() for t in tools]}` — each tool
  serialises its JSON Schema from its Pydantic input model (`Tool.to_json()`).
- `tools/call` looks up `params["name"]`, instantiates that tool class, and
  `await tool.handle(arguments)`, returning `{"content": response.to_content()}`.

The `Tool` base class (`fastapi_startkit/mcp/tool.py`) is small — you implement three
things:

```python
class Tool(ABC):
    name: str
    description: str
    def schema(self) -> Optional[Type[BaseModel]]: ...      # input schema (Pydantic)
    @abstractmethod
    async def handle(self, arguments: dict) -> Response: ...  # the actual work
```

And `Response` (`fastapi_startkit/mcp/response.py`) is how you reply:

```python
Response.text("done")                 # plain text
Response.structure({"id": 42})        # JSON resource block
Response.empty()
```

That is the entire contract a plugin tool must satisfy.

### 2.3 How an agent discovers the relay

Agents are `claude` processes. They learn about the relay through a written
`.claude/settings.json` — **not** a `--mcp-config` CLI flag. The merge logic is
`app/utils/hook_setup.py::ensure_claude_settings()`:

```python
# app/utils/hook_setup.py
mcp_servers = settings.setdefault("mcpServers", {})
mcp_servers["keera-agent"] = {
    "type": "http",
    "url": f"{base_url}/mcp",                       # base_url = KEERA_APP_URL
    "headers": {"X-Project-Path": project_path or directory},
}
```

This runs at app startup for the keera-agent directory (`ensure_hooks()`, called from
`AppProvider.boot()`) and again whenever a project is created, for that project's
directory. The same file also registers the `Stop` / `UserPromptSubmit` HTTP hooks.

**Implication for plugins:** because every agent already has the `keera-agent` MCP
server wired in, an in-process tool you add to `KEERA_TOOLS` is **instantly visible to
every agent** — no per-agent config, no re-registration. That is the big advantage of
Approach A.

> **Note on project scoping.** Keera tools are scoped by an explicit `project_path`
> *argument* (resolved via `_project_by_path()`), not by the `X-Project-Path` header.
> The header is intended for `resources/read`, but the stock framework router does not
> forward it to `Resource.read()`, so `keera://tasks/active` only resolves a project
> when a path is threaded in. **When you write a plugin tool that needs project
> context, take `project_path` as an argument** — mirror the existing tools.

### 2.4 How an agent is launched (and why your tool "just works")

The `claude` command is assembled by a fluent builder, `ClaudeCommand`
(`app/terminal/command.py`):

```python
# app/terminal/command.py — ClaudeCommand.to_command()
parts = ['claude']
if self._worktree:          parts.append(f'--worktree {shlex.quote(self._worktree)}')
if self._continue:          parts.append('--continue')
if self._system_prompt_file:parts.append(f'--system-prompt "$(cat {...})"')
if self._model:             parts.append(f'--model {shlex.quote(self._model)}')
if self._allowed_tools:     parts.append(f'--allowedTools {...}')
if self._disallowed_tools:  parts.append(f'--disallowedTools {...}')
if self._permission_mode:   parts.append(f'--permission-mode {...}')
if self._skip_permissions:  parts.append('--dangerously-skip-permissions')
...
```

The mapping from a DB `Agent` row to those flags is `app/models/Agent.py::to_command()`:
worktree name `agent-{id}`, model, `--continue` when it has a session, a system-prompt
file at `/tmp/keera-agent-{id}.txt`, and a **permission policy**:

- `plan_mode` and `dangerously_skip_permissions` are mutually exclusive — **plan mode
  wins** (`--permission-mode plan`).
- The `--allowedTools` / `--disallowedTools` lists (`permissions_allow` /
  `permissions_deny` JSON columns) are applied **only when permissions are enforced**
  (i.e. plan mode, or skip-permissions OFF).

The command string is fed into a PTY by
`agent_trigger_controller._spawn_headless_agent()`, which prepends relay/identity
instructions to the agent's first message (including a curl example that hits
`POST {base_url}/mcp`).

**Why this matters for your plugin:** if agents run with
`--dangerously-skip-permissions` (the common default), tool gating is off and your new
`jira_*` tools are callable immediately. If an agent runs with enforced permissions,
its `permissions_allow` list must include your tool names (or be empty/allow-all per
the default-permissions logic). Keep this in mind when QA tests a plugin under plan
mode.

### 2.5 Boot sequence & config

- **Providers** register in `bootstrap/application.py` (order matters: Database before
  FastAPI). `AppProvider.boot()` (`providers/app_provider.py`) is where routes are
  included (mounting `/mcp`), `ensure_hooks()` runs, and startup actions fire.
- **Config** objects are dataclasses in `config/`, each field defaulting from `env()`:

  ```python
  # config/fastapi.py (pattern to copy)
  @dataclasses.dataclass
  class FastAPIConfig:
      app_url: str = dataclasses.field(
          default_factory=lambda: env("KEERA_APP_URL", "http://127.0.0.1:4545"))
  ```

  `env()` (`fastapi_startkit.environment`) reads `os.getenv` with auto-casting and
  loads `.env`. App vars are **`KEERA_`-prefixed**; `KEERA_APP_URL` is the single
  source for the relay base URL.

### 2.6 The picture

```
  ┌─────────────┐   claude --system-prompt ... --dangerouslySkip...   ┌──────────────┐
  │  Agent row  │ ─ to_command() ─────────────────────────────────▶  │ claude (PTY) │
  │  (DB)       │                                                     └──────┬───────┘
  └─────────────┘                                                            │ JSON-RPC
        ▲                                                                    │ tools/call
        │ spawn_agent / trigger                                             ▼
        │                          .claude/settings.json            ┌───────────────────┐
        │                          mcpServers["keera-agent"]  ─────▶ │  POST :4545/mcp   │
        │                          = http :4545/mcp                  │  KeeraServer      │
        │                                                            │  tools() registry │
        │                                                            │   ├─ KEERA_TOOLS  │
        │                                                            │   ├─ BROWSER_TOOLS│
        │                                                            │   └─ JIRA_TOOLS ◀─┼─ your plugin
        │                                                            └───────────────────┘
```

---

## 3. The plugin authoring model (Approach A)

To add an in-process plugin you write, at most, four things:

1. **Config** — a `config/<plugin>.py` dataclass reading `KEERA_<PLUGIN>_*` env vars
   (only if your plugin needs credentials/endpoints).
2. **A client** — a thin wrapper around the external service (optional but tidy).
3. **Tools** — `Tool` subclasses with a Pydantic input `schema()` and an async
   `handle()`, collected into a `<PLUGIN>_TOOLS` list.
4. **Registration** — include that list in `KeeraServer.tools()`.

No new route, no JSON-RPC code, and (for a stateless plugin) **no migration**. The
next section walks all four for Jira.

---

## 4. Worked example — a Jira plugin

**Goal:** give agents tools to create, search, and comment on Jira issues:
`jira_create_issue`, `jira_search`, `jira_add_comment`. An agent could then, after
finishing a task, file a Jira issue or link its PR to an existing one.

### Step 1 — Config (`config/jira.py`)

Follow the existing dataclass + `env()` pattern. Credentials come from `KEERA_JIRA_*`
env vars so nothing is hard-coded.

```python
# config/jira.py
import dataclasses
from fastapi_startkit.environment import env


@dataclasses.dataclass
class JiraConfig:
    base_url: str = dataclasses.field(
        default_factory=lambda: env("KEERA_JIRA_BASE_URL", ""))      # e.g. https://acme.atlassian.net
    email: str = dataclasses.field(
        default_factory=lambda: env("KEERA_JIRA_EMAIL", ""))
    api_token: str = dataclasses.field(
        default_factory=lambda: env("KEERA_JIRA_API_TOKEN", ""))
    default_project_key: str = dataclasses.field(
        default_factory=lambda: env("KEERA_JIRA_PROJECT_KEY", ""))   # e.g. ENG

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.email and self.api_token)
```

Add the matching keys to `.env.example` so operators know what to set:

```dotenv
# .env.example
KEERA_JIRA_BASE_URL=
KEERA_JIRA_EMAIL=
KEERA_JIRA_API_TOKEN=
KEERA_JIRA_PROJECT_KEY=
```

### Step 2 — A thin Jira client (`app/jira/client.py`)

Keep transport out of the tools. Jira Cloud uses Basic auth (email + API token) over
its REST v3 API. Use an async HTTP client so `handle()` stays non-blocking.

```python
# app/jira/client.py
import httpx
from config.jira import JiraConfig


class JiraClient:
    def __init__(self, cfg: JiraConfig):
        self._cfg = cfg
        self._auth = (cfg.email, cfg.api_token)

    async def create_issue(self, project_key: str, summary: str, description: str,
                           issue_type: str = "Task") -> dict:
        payload = {
            "fields": {
                "project": {"key": project_key},
                "summary": summary,
                "issuetype": {"name": issue_type},
                "description": _adf(description),   # Jira v3 wants Atlassian Doc Format
            }
        }
        async with httpx.AsyncClient(base_url=self._cfg.base_url, auth=self._auth) as c:
            r = await c.post("/rest/api/3/issue", json=payload, timeout=20)
            r.raise_for_status()
            return r.json()

    async def search(self, jql: str, max_results: int = 20) -> dict:
        async with httpx.AsyncClient(base_url=self._cfg.base_url, auth=self._auth) as c:
            r = await c.get("/rest/api/3/search",
                            params={"jql": jql, "maxResults": max_results}, timeout=20)
            r.raise_for_status()
            return r.json()

    async def add_comment(self, issue_key: str, body: str) -> dict:
        async with httpx.AsyncClient(base_url=self._cfg.base_url, auth=self._auth) as c:
            r = await c.post(f"/rest/api/3/issue/{issue_key}/comment",
                             json={"body": _adf(body)}, timeout=20)
            r.raise_for_status()
            return r.json()


def _adf(text: str) -> dict:
    """Minimal Atlassian Document Format wrapper for a plain-text paragraph."""
    return {"type": "doc", "version": 1, "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": text}]}]}
```

> `httpx` is already a transitive dependency of the stack; if you prefer, mirror
> whatever HTTP client the codebase standardises on. The point is that the client is
> the only thing that knows about Jira's wire format.

### Step 3 — Define the tools (`app/mcp/jira_tools.py`)

Each tool mirrors the shape of the existing `CreateTaskTool` in `app/mcp/tools.py`:
a Pydantic input model from `schema()`, work in `handle()`, a `Response` back. Field
descriptions matter — they become the tool's JSON Schema that the agent reads to
decide how to call it.

```python
# app/mcp/jira_tools.py
from pydantic import BaseModel, Field
from typing import Optional

from fastapi_startkit.mcp import Tool, Response

from config.jira import JiraConfig
from app.jira.client import JiraClient


def _client() -> Optional[JiraClient]:
    cfg = JiraConfig()
    return JiraClient(cfg) if cfg.configured else None


# ── jira_create_issue ─────────────────────────────────────────────────────────
class JiraCreateIssueInput(BaseModel):
    summary: str = Field(description="Short issue title, e.g. 'Export tasks as CSV'.")
    description: str = Field(description="Body of the issue. Plain text.")
    project_key: Optional[str] = Field(
        default=None, description="Jira project key (e.g. ENG). Defaults to KEERA_JIRA_PROJECT_KEY.")
    issue_type: str = Field(default="Task", description="Issue type name: Task, Bug, Story.")


class JiraCreateIssueTool(Tool):
    name = "jira_create_issue"
    description = (
        "Create a Jira issue. Use this to file follow-up work, bugs, or "
        "track a task in Jira. Returns the new issue key (e.g. ENG-123)."
    )

    def schema(self):
        return JiraCreateIssueInput

    async def handle(self, arguments: dict) -> Response:
        client = _client()
        if client is None:
            return Response.text("Error: Jira is not configured. Set KEERA_JIRA_* env vars.")

        cfg = JiraConfig()
        project_key = arguments.get("project_key") or cfg.default_project_key
        if not project_key:
            return Response.text("Error: no project_key given and KEERA_JIRA_PROJECT_KEY is empty.")

        try:
            issue = await client.create_issue(
                project_key=project_key,
                summary=arguments["summary"].strip(),
                description=arguments.get("description", "").strip(),
                issue_type=arguments.get("issue_type", "Task"),
            )
        except Exception as e:                       # surface transport errors to the agent
            return Response.text(f"Error creating Jira issue: {e}")

        key = issue.get("key", "?")
        url = f"{cfg.base_url}/browse/{key}"
        return Response.text(f"Created Jira issue {key} — {url}")


# ── jira_search ───────────────────────────────────────────────────────────────
class JiraSearchInput(BaseModel):
    jql: str = Field(description="Jira Query Language string, e.g. 'project = ENG AND status = Open'.")
    max_results: int = Field(default=20, ge=1, le=50)


class JiraSearchTool(Tool):
    name = "jira_search"
    description = "Search Jira issues with JQL. Returns matching issue keys and summaries."

    def schema(self):
        return JiraSearchInput

    async def handle(self, arguments: dict) -> Response:
        client = _client()
        if client is None:
            return Response.text("Error: Jira is not configured. Set KEERA_JIRA_* env vars.")
        try:
            data = await client.search(arguments["jql"], arguments.get("max_results", 20))
        except Exception as e:
            return Response.text(f"Error searching Jira: {e}")

        issues = data.get("issues", [])
        if not issues:
            return Response.text("No matching Jira issues.")
        lines = [f"{i['key']}: {i['fields'].get('summary', '')}" for i in issues]
        return Response.text("\n".join(lines))


# ── jira_add_comment ──────────────────────────────────────────────────────────
class JiraAddCommentInput(BaseModel):
    issue_key: str = Field(description="Issue key to comment on, e.g. ENG-123.")
    body: str = Field(description="Comment text. Plain text.")


class JiraAddCommentTool(Tool):
    name = "jira_add_comment"
    description = "Add a comment to an existing Jira issue. Useful for linking a PR or status update."

    def schema(self):
        return JiraAddCommentInput

    async def handle(self, arguments: dict) -> Response:
        client = _client()
        if client is None:
            return Response.text("Error: Jira is not configured. Set KEERA_JIRA_* env vars.")
        try:
            await client.add_comment(arguments["issue_key"], arguments.get("body", ""))
        except Exception as e:
            return Response.text(f"Error commenting on Jira issue: {e}")
        return Response.text(f"Comment added to {arguments['issue_key']}.")


JIRA_TOOLS = [
    JiraCreateIssueTool,
    JiraSearchTool,
    JiraAddCommentTool,
]
```

Two conventions worth copying from the existing tools:

- **Return errors as `Response.text`, not exceptions.** The agent reads the text and
  can recover (e.g. ask the user for config). An uncaught exception is a worse agent
  experience.
- **Degrade gracefully when unconfigured.** `_client()` returns `None` if env vars are
  missing, so the tool still lists in `tools/list` but tells the agent what's wrong
  when called.

### Step 4 — Register the plugin

One line in `app/mcp/server.py`:

```python
# app/mcp/server.py
from app.mcp.tools import KEERA_TOOLS
from app.mcp.browser_tools import BROWSER_TOOLS
from app.mcp.jira_tools import JIRA_TOOLS          # ← add

class KeeraServer(Server):
    def tools(self):
        return KEERA_TOOLS + BROWSER_TOOLS + JIRA_TOOLS   # ← add
```

That is the whole registration. Because every agent's `.claude/settings.json` already
points at this server (§2.3), **all agents can now call the Jira tools** with no
further wiring. Restart the app so the route/registry reloads.

### Step 5 — How an agent uses it

The agent calls it exactly like any built-in relay tool. `tools/list` now includes the
three Jira tools; a call looks like:

```bash
curl -s -X POST http://127.0.0.1:4545/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
        "name":"jira_create_issue",
        "arguments":{"summary":"Flaky test in task controller",
                     "description":"Intermittent failure on CI; see PR #170.",
                     "project_key":"ENG","issue_type":"Bug"}}}'
```

Response:

```json
{"jsonrpc":"2.0","id":1,"result":{"content":[
  {"type":"text","text":"Created Jira issue ENG-123 — https://acme.atlassian.net/browse/ENG-123"}]}}
```

You'd typically also mention the capability in the relevant agent's system prompt
(e.g. "When you finish a task, you may file a Jira issue with `jira_create_issue`")
so agents know the tool exists and when to reach for it. System prompts are seeded
from `app/utils/system_prompts.py`.

### Step 6 — Test it

Tests are async unittest hitting a real DB; the canonical example is
`tests/features/test_task_controller.py`. For a plugin, test the tool's `handle()`
directly and stub the network. A sketch:

```python
# tests/features/test_jira_tools.py
from tests.test_case import TestCase
from app.mcp.jira_tools import JiraCreateIssueTool


class TestJiraTools(TestCase):
    async def test_create_issue_unconfigured_returns_friendly_error(self):
        # With KEERA_JIRA_* unset, the tool should not raise.
        tool = JiraCreateIssueTool()
        resp = await tool.handle({"summary": "x", "description": "y"})
        text = resp.to_content()[0]["text"]
        assert "not configured" in text

    async def test_create_issue_calls_client(self):
        # Patch JiraClient.create_issue to assert the tool maps args → client call
        # and formats the issue key into the response. (Use unittest.mock.patch.)
        ...
```

Because the tool degrades gracefully when unconfigured, the unconfigured path is a
fast, network-free smoke test. For the happy path, patch `JiraClient` so no real Jira
call is made.

---

## 5. Plugin checklist (Approach A)

- [ ] `config/<plugin>.py` dataclass reading `KEERA_<PLUGIN>_*` via `env()`
- [ ] `.env.example` updated with the new keys
- [ ] (optional) `app/<plugin>/client.py` wrapping the external service
- [ ] `app/mcp/<plugin>_tools.py` with `Tool` subclasses + a `<PLUGIN>_TOOLS` list
- [ ] Each tool: Pydantic `schema()`, async `handle()`, `Response.text/structure`
- [ ] Errors returned as `Response.text`; graceful behaviour when unconfigured
- [ ] `<PLUGIN>_TOOLS` included in `KeeraServer.tools()`
- [ ] Tests in `tests/features/`, network stubbed
- [ ] Mention the capability in the relevant agent's system prompt
- [ ] No migration needed unless the plugin persists state (then follow the
      "Adding a new resource" steps in `CLAUDE.md`)

---

## 6. Alternative — Approach B: an external MCP server

If you'd rather run Jira's MCP as a separate process (e.g. an off-the-shelf Jira MCP
server, or one written in another language), you don't add tools to `KeeraServer` at
all. Instead you register a **second MCP server** in each agent's
`.claude/settings.json`, alongside the existing `keera-agent` entry.

The natural place to do that is `app/utils/hook_setup.py::ensure_claude_settings()`,
which already owns the `mcpServers` map:

```python
# app/utils/hook_setup.py (illustrative addition)
jira_cfg = JiraConfig()
if jira_cfg.configured:
    mcp_servers["jira"] = {
        "type": "stdio",                       # or "http" if the server is HTTP
        "command": "npx",
        "args": ["-y", "@some/jira-mcp-server"],
        "env": {
            "JIRA_BASE_URL": jira_cfg.base_url,
            "JIRA_EMAIL": jira_cfg.email,
            "JIRA_API_TOKEN": jira_cfg.api_token,
        },
    }
```

Because `ensure_claude_settings()` runs at startup and per project, every agent picks
up the `jira` server the next time its settings are written. The Claude CLI merges
tools from all configured MCP servers, so the agent sees `keera-agent` tools **and**
the external server's tools together.

**Trade-offs**

| | Approach A (in-process) | Approach B (external) |
| --- | --- | --- |
| Code location | This repo (`app/mcp/`) | Separate process / package |
| Shares Keera DB & config | Yes | No (its own world) |
| Language | Python | Any |
| Distribution | Ships with Keera | Installed/managed separately |
| Per-agent wiring | None (already pointed at `/mcp`) | Must be added to `mcpServers` |
| Best for | First-party features | Reusing existing community MCP servers |

For a Jira capability that Keera owns and wants to keep close to its agents and DB,
**Approach A is the recommended path**; Approach B is the escape hatch for
language-agnostic or third-party servers.

---

## 7. File-by-file reference

| Concern | File |
| --- | --- |
| Relay server + tool registry | `app/mcp/server.py` (`KeeraServer.tools()`) |
| Built-in tools | `app/mcp/tools.py` (`KEERA_TOOLS`) |
| Tool base class | `fastapi_startkit/mcp/tool.py` |
| Response wrapper | `fastapi_startkit/mcp/response.py` |
| JSON-RPC dispatch / protocol | `fastapi_startkit/mcp/server.py`, `protocol.py` |
| `/mcp` mount | `routes/web.py` |
| Agent → claude flags | `app/models/Agent.py::to_command()`, `app/terminal/command.py` |
| Agent spawn / PTY | `app/controllers/agent_trigger_controller.py` |
| MCP discovery in `.claude/settings.json` | `app/utils/hook_setup.py` |
| Provider boot | `providers/app_provider.py`, `bootstrap/application.py` |
| Config / env pattern | `config/*.py`, `KEERA_APP_URL` in `.env.example` |
| Test pattern | `tests/features/test_task_controller.py`, `tests/test_case.py` |
</content>
</invoke>
