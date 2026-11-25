# Orchestration Relay — Delivery, Health and Task State

This document proposes changes to the orchestration relay: the MCP server at
`http://127.0.0.1:4545/mcp` that carries PM ↔ agent messages, tasks, and
`spawn_agent` / `delete_agent`. It starts from failures seen in one PM session that
ran about ten agents (project 17, 2026-11-08), traces each failure to the code where
possible, and proposes API and schema changes in priority order.

> **Scope.** Design only. No code or migration ships with this document. File
> references point at the current `dev` source (`2f5add7`), which is what the
> running `dist/` build was built from.

---

## 1. How the relay works today

| Concern | Where | Behaviour |
| --- | --- | --- |
| Tools | `app/mcp/tools.py` (`KEERA_TOOLS`) | `create_task`, `list_tasks`, `get_task`, `update_task`, `update_task_status`, `delete_task`, `send_message_to_agent`, `get_agent_messages`, `list_agents`, `spawn_agent`, `get_orchestrated_agents`, `delete_agent`. Every tool returns free text through `Response.text`. |
| Transport | `app/mcp/server.py` | JSON-RPC 2.0 over `POST /mcp`, dispatched by `_dispatch_message`. |
| Messages | `AgentMessageSendAction` → `agent_relay_messages` | A row is created with `status = pending`. If the receiver's PTY is ready, `claim_relay_message` flips it to `delivered`, and then `terminal.send(relay_text(...))` types `[Message from Agent '<name>']: <content>` into the receiver's terminal. If the receiver is idle, `_spawn_headless_agent` is scheduled and the row is marked `delivered` at once. |
| Queued flush | `app/actions/relay_delivery.py` | `deliver_pending_relay_messages` sends pending rows once `is_cli_ready`. |
| Inbox | `get_agent_messages` | Reads **`agent_messages`**, a separate project-to-project table (`sender_project_id`, `receiver_project_id`), filtered by `project_path`. |
| Tasks | `tasks` table, `TaskStatus` | `pending`, `in_progress`, `in_review`, `completed`, `cancelled`. Any caller may set any status. `updated_at` is not touched by `update_task_status`. |
| Agents | `agents` table | `status` is set by hooks (`claude_hook_controller`, `agent_hook_event_controller`). Soft-deleted through `deleted_at`. The slot limit in `spawn_agent` counts every non-deleted agent (`max_agents_per_project`). |
| PTY writes | `Terminal.send`, `_handle_claude_stopped` | `Terminal.send` pastes, waits for the echo, and sends the CR under a per-terminal `_send_lock`. The Stop hook's task dispatch writes raw bytes through `terminal_manager.write` instead. |
| Caller identity | `/mcp`, `.mcp.json` (`McpSettingWriteAction`) | No authentication. Every agent in a project shares one `.mcp.json` entry with only an `X-Project-Path` header. `sender_agent_id` and `from_agent_id` are whatever the caller claims. |
| "Heartbeat" | `app/heartbeat.py`, `app/checkin_scheduler.py` | A PM-only task digest every 300 s, and an optional fixed `[CHECK-IN]` ping. Neither measures whether an agent is alive. |

The team protocol layered on top is free text: an agent must reply
`ACK task #<id>` within 60 s, or the PM deletes and respawns it.

## 2. Observed failures

Each failure below has an ID that later sections cite. "Cause" is stated only where
the code or the database confirms it. Where it doesn't, the cause is marked
**unverified**.

| ID | Failure | Cause |
| --- | --- | --- |
| F1 | Agents' ACKs never reached the PM even though the agents were working, so the PM had to inspect their worktrees. | `delivered` means "claimed by the relay", not "seen by the receiver". `claim_relay_message` flips the row before `terminal.send`, and the headless path marks it `delivered` when the spawn is *scheduled*. Text typed into a busy PTY can be dropped or merged into the agent's own input. Nothing records a read. |
| F2 | The relay returned duplicate delivery IDs. A PM message (`#38417`) was also injected into the receiver twice, and its row still read `pending` afterwards. | The second part is confirmed from the database. **Unverified:** the duplicate IDs probably come from two ID spaces. `send_message_to_agent` returns `agent_relay_messages.id`, while `get_agent_messages` lists `agent_messages.id`. Both print as `#N`. |
| F2b | The PM's re-review request to reviewer 3472 (#871@29b08f8c) came back as "Message delivered … (#38420)", but the reviewer never received it. | Confirmed from the database. Row `#38420` is a different message: reviewer 3472 → PM, the #415 verdict at 23:13:29. No row from 3344 to 3472 mentions `29b08f8c` at all. The relay reported delivery of a message it never stored, under another message's ID. **Unverified:** the cause. The SQLite insert takes its ID from the statement's own cursor (`Connection.insert_get_id`), so a mixed-up JSON-RPC response or a lost write is as likely as a wrong ID. |
| F3 | The receiver saw an ACK with the title of another task (#4022) appended. | The stored row `#38416` holds the exact ACK text, so the corruption happened at PTY injection, not in the relay table. `Terminal.send` (`app/terminal/terminal.py`) already serialises its own writes: `_send_lock` covers the bracketed paste, the echo wait and the CR. **Likely cause:** `_handle_claude_stopped` (`app/controllers/claude_hook_controller.py`) runs on every Stop hook. It takes the project's first `pending` task, sets it `in_progress`, and raw-writes its body (its title when the body is NULL, as for #4022) followed by a CR into the first agent with a live session. That write goes through `terminal_manager.write`, so it bypasses `_send_lock`, isn't a bracketed paste, and doesn't skip deleted agents. #4022 was created at 23:02:30 with a NULL body, minutes before the ACK. |
| F3b | **Correctness and safety.** #4022's bare title (`Replace where_raw in topic_id_for (admin_ecrire_actions) with builder calls`) was typed into the **PM's own terminal** as if it were a user prompt. #4022 then flipped to `in_progress` again after the PM had reset it to `pending`. | Confirmed by behaviour, consistent with the code above. The dispatch picks the first agent of *any* type with a live session, the PM included, and writes the task text unframed. The receiver can't tell the injected text from the human's own input. A task title or body becomes an instruction the PM may act on as if the user had given it, and every Stop hook re-runs the dispatch, so resetting the task doesn't stick. |
| F4 | `get_task` returned an empty or truncated body (181 characters of a long description). Task #4021 shows `Body: (none)`. | The PM puts the brief in the `spawn_agent` message, not in the task, so `tasks.body` is NULL for #4018–#4022. **Unverified:** the 181-character truncation. `get_task` doesn't truncate, so the cut happened before or at `create_task`. |
| F5 | `create_task` returned #4021 twice, and the second call overwrote a different task (the `where_raw` fix), which had to be recreated as #4022. | **Unverified.** `tasks.id` is `AUTOINCREMENT`, so SQLite ID reuse is ruled out. Nothing makes `create_task` idempotent, and nothing records history, so the overwrite can't be reconstructed. |
| F6 | Task #4019 showed `in_progress` after the PM had set it `completed`. | **Unverified.** Any agent may call `update_task_status`, and #4019 has `updated_at == created_at`, so no trace of who changed it survives. One candidate is the Stop-hook dispatch in F3, which flips any `pending` task to `in_progress` without an actor. It explains the flip only if #4019 had been reopened as `pending` or recreated (F7). |
| F7 | Task #4019 vanished from the tracker and was recreated. | **Unverified.** `delete_task` is a hard delete open to every agent, and `list_tasks` hides `completed` rows older than 7 days. No audit log exists. |
| F8 | `delete_agent` reported success for agent 3473, but the agent stayed listed and kept its slot until a second delete. | **Unverified.** `delete_agent` saves `deleted_at`, calls `stop_agent_session`, and clears `session_id`. Yet the row for 3473 had a `session_id` again after the delete, so something re-registered the session; the hook endpoints don't check `deleted_at`. Deleted agents also keep `status = running` (3441, 3465). |
| F9 | `spawn_agent` rejects `agent_type: custom`, although the PM prompt lists it. | Confirmed. `SpawnAgentInput.agent_type` allows `pm`, `software_engineer`, `software_engineer_frontend`, `reviewer`, `qa` and `qa_browser`, while the `agents.agent_type` column defaults to `custom`. |
| F10 | Agents 3441 and 3465 were deleted externally mid-task with no notice to the PM. | Confirmed. `DeleteAgentTool` notifies nobody, and the agent's task keeps its status. Agent 3440 is deleted and still holds `task_id = 3974`. |
| F11 | The 5-slot cap left work unowned. | Confirmed. `max_agents_per_project` defaults to 10, and this project sets it to 5. The limit counts every non-deleted agent, including agents whose PR merged hours ago. Nothing frees a slot or queues the waiting task. |

## 3. Proposals

Each item gives the problem, the API and schema change, backward compatibility, and
a rollout step. Phase 0 (§3.0) is a set of small fixes whose causes are confirmed.
Phase 1 covers items 3.1–3.3.

### 3.0 Phase 0 — cheap, confirmed fixes

Each fix below is small, has a confirmed cause, and needs no new protocol.

| # | Fix | Failures |
| --- | --- | --- |
| a | **Stop-hook dispatch.** Remove the automatic "first `pending` task → first live agent" dispatch from `_handle_claude_stopped`. If the dispatch is kept for single-agent projects, it dispatches only tasks assigned to the target agent (`agents.task_id`), skips deleted and `pm` agents, and writes through `Terminal.send`. Every PTY write in the app goes through `Terminal.send`, so `_send_lock` and the bracketed paste cover all injections. Nothing is ever injected into a `pm` session unattributed. Every relay injection carries its `[Message from Agent '<name>']` or `[relay <uid>]` prefix, so it can't pass as the human's input. | F3, F3b, F6 |
| b | **Delivery state.** Set `delivered` after `terminal.send` returns, and on the headless path only when the queued flush sends the message. `get_agent_messages` reads `agent_relay_messages` for the calling agent. | F1, F2 |
| c | **Agent type.** `SpawnAgentInput.agent_type` and `app/prompts/pm.html` draw their lists from one `AgentType` enum, and the column default stops being `custom`. | F9 |
| d | **Task history.** Every task write bumps `updated_at`. An append-only `task_events` table is written by every task tool (schema in §3.3). | F5, F6, F7 |

**Backward compatibility.** None of the fixes changes a tool signature. Fix (a)
removes an implicit auto-dispatch that the multi-agent PM flow doesn't rely on: the
PM assigns work through `spawn_agent` and `send_message_to_agent`.

**Rollout.** One small PR per fix, (a) first.

### 3.1 Reliable delivery (F1, F2, F3, F4)

**Problem.** Delivery state is inferred from the agent's free-text reply. Message IDs
come from two tables. One injection path bypasses `Terminal.send` (fixed in §3.0a).
The task's content travels only inside the message.

**Schema.** Extend `agent_relay_messages`:

| Column | Type | Purpose |
| --- | --- | --- |
| `uid` | `VARCHAR(26) UNIQUE` | Globally unique ID (ULID), returned to callers in place of the row ID. |
| `idempotency_key` | `VARCHAR NULL`, unique per `from_agent_id` | Lets a retried send return the original `uid` instead of creating a duplicate row. |
| `status` | `queued` · `delivered` · `unconfirmed` · `read` · `acked` | Replaces `pending` · `delivered`. |
| `delivered_at`, `read_at`, `acked_at` | `TIMESTAMP NULL` | Set by the relay, not by the sender. |
| `attempts` | `INTEGER DEFAULT 0` | Counts redelivery attempts. |
| `task_id`, `task_snapshot` | `INTEGER NULL`, `TEXT NULL` (JSON) | The task's state at send time. |
| `kind` | `VARCHAR DEFAULT 'text'` | Used by §3.4. |

Retire `agent_messages` from `get_agent_messages`, or keep it only for
project-to-project mail under a different tool name.

**Delivery semantics.**

- **`delivered`** is set *after* `terminal.send` returns (§3.0b). For the headless
  path, it is set when `deliver_pending_relay_messages` sends the message into the
  spawned CLI, not when the spawn is scheduled.
- **`read`** is set by the relay when the receiver's next `UserPromptSubmit` hook
  arrives at `/api/agent-hook-events` after delivery. A pasted message is submitted
  as a prompt, so this hook is direct evidence that the receiver took it in.
  `PostToolUse` only shows that the agent is busy, not that it took in the message,
  so it doesn't count. The relay records `read` itself, so no reply from the agent is
  needed.
- **`acked`** is set when the receiver sends a `kind = ack` message that references
  the `uid` (§3.4), or calls the new `ack_message(uid)` tool.
- **Framing.** Each injection is framed as
  `[relay <uid>] [Message from Agent '<name>']: …` and goes through `Terminal.send`,
  whose `_send_lock` already serialises writes to one terminal. No new lock is
  needed.
- **Receiver-side dedup.** `deliver_pending_relay_messages` skips any `uid` already
  `delivered`. The agent prompt tells agents to ignore a `uid` they have already seen.
- **No blind redelivery.** A message still `delivered` but not `read` after 120 s is
  **not** typed into the live PTY again, because that would re-create F2. The relay
  marks it `unconfirmed` and notifies the sender. It re-sends a message only when the
  receiver's session has restarted (a new `session_id`), and at most once
  (`attempts`).

**API.**

- `send_message_to_agent(..., idempotency_key?, task_id?)` returns
  `{uid, status}` as JSON text, for example
  `{"uid":"01J…","status":"delivered"}`.
- New `get_message_status(uid)` returns
  `{uid, status, delivered_at, read_at, acked_at, attempts}`, or `not_found`.
- The send response is built from the stored row, re-read after commit. It carries
  `to_agent_id` and a short hash of the content, so a sender can tell when the ID it
  got back isn't its own message (F2b). The PM prompt checks `get_message_status` for
  every review or task hand-off.
- New `ack_message(uid)`.
- `get_agent_messages(agent_id, unread_only)` reads `agent_relay_messages` for that
  agent, and listing marks the returned rows `read`.
- Task snapshot: when `task_id` is given, or when `spawn_agent` is given one, the
  relay embeds `get_task`'s full output (title, body, acceptance criteria) under
  `[task #<id>]` in the injected text. `create_task` rejects an empty `body` when
  `acceptance_criteria` is empty, so a brief can't live only in a message (F4).

**Backward compatibility.** Existing callers keep working. The response text still
starts with `Message delivered to agent '<name>'`, and the `uid` is appended. A
free-text `ACK task #<id>` keeps working and is also parsed into `acked` for the
latest message from that sender carrying `task_id = <id>`. `pending` rows are
migrated to `queued`.

**Rollout.** (1) Migration plus a dual-write of `uid` (post-send `delivered` ships
in §3.0b). (2) Framing and receiver-side dedup. (3) `read` driven by the
`UserPromptSubmit` hook. (4) `get_message_status` and the
inbox switch. (5) Update the PM prompt to poll `get_message_status` instead of
waiting 60 s for an ACK.

### 3.2 Agent health (F1, F8, F10)

**Problem.** The PM can't tell a silent-but-working agent from a dead one, so the
"no ACK in 60 s → delete and respawn" rule kills working agents. Agents disappear
without notice, and their tasks stay assigned to nobody.

**Schema.** Add to `agents`: `last_heartbeat_at TIMESTAMP`, `heartbeat_note
VARCHAR(140)`, `worktree_branch`, `worktree_head_sha`, `worktree_last_commit_at`,
`worktree_last_change_at`, and `deleted_reason VARCHAR NULL`.

**Heartbeats.**

- **Passive.** Every hook event at `/api/agent-hook-events` already proves
  liveness, so the handler sets `last_heartbeat_at`. Most agents need no new
  behaviour.
- **Active.** A new tool, `heartbeat(agent_id, note)`, takes a short status
  ("running tests", "waiting on review"). Agents call it every 30–60 s during long
  silent work.
- **Worktree probe.** A relay background loop, every 60 s, reads each live agent's
  worktree (`.claude/worktrees/agent-<id>` or the task worktree recorded in
  `tasks.branch`): `git rev-parse HEAD`, the last commit time, and the newest file
  mtime. It uses `app/services/git_repository.py`. This answers "is it working?"
  without asking the agent.
- **Derived health**, shown in `list_agents` and `get_orchestrated_agents`:
  - `healthy` if the last heartbeat is under 90 s old.
  - `quiet` if it is 90 s–5 min old but the worktree changed.
  - `stalled` if it is older than 5 min and the worktree hasn't changed.
  - `dead` if the session is gone.
  The PM respawns only `dead` agents and pings `stalled` ones.

**Deletion.**

- `delete_agent(agent_id, reason?)` already stops the session and clears
  `session_id`. It also sets `status = deleted`. `claude_hook_controller` and
  `agent_hook_event_controller` ignore events for agents with `deleted_at` set, so a
  dying CLI can't re-register its session (F8). The tool re-reads the row and reports
  failure if the agent is still listed.
- Every deletion, including deletion from the UI, emits a relay message to the
  orchestrator (`orchestrator_id`, else the project's PM): `kind = report`,
  `agent deleted: <name> (<reason>)`. Its task loses its assignee and goes back to
  today's `pending`, which becomes `created` once §3.3 lands. The task keeps its
  branch and head SHA (F10).

**Backward compatibility.** Heartbeats are additive. The 60 s ACK rule keeps working
until the PM prompt switches to health states. `delete_agent` keeps its signature,
and `reason` is optional.

**Rollout.** (1) Passive heartbeat from hooks. (2) Deletion fix and notification.
(3) Worktree probe. (4) `heartbeat` tool and prompt changes. (5) Drop the 60 s rule
from the PM prompt.

### 3.3 Task state machine (F5, F6, F7)

**Problem.** Any agent can set any status, delete any task, or overwrite fields.
History isn't recorded, so failures like #4019 can't be explained afterwards.

**States.**

```text
created → assigned → acked → in_progress → in_review → approved(sha) → merged → done
                                   ↘ blocked ↗                 ↘ changes_requested → in_progress
any non-terminal → cancelled
```

**Caller identity.** The ownership rules and `actor_agent_id` below are only as
trustworthy as the caller's identity. Today `/mcp` doesn't authenticate callers, and
`sender_agent_id` is whatever the caller claims. Until the following ships, every
ownership rule is **advisory**: it is logged in `task_events` and returned as a
warning, never enforced.

- **Per-agent token.** At spawn, `AgentCreateAction` mints a random token, stores
  its hash in `agents.relay_token_hash`, and passes the token to the CLI process as
  the environment variable `KEERA_AGENT_TOKEN`.
- **Header.** `McpSettingWriteAction` adds the header
  `"X-Keera-Agent-Token": "${KEERA_AGENT_TOKEN}"` to the shared `.mcp.json` entry,
  using the CLI's env-var expansion. The agent prompts tell agents to send the same
  header in direct `curl` calls.
- **Server side.** `server.py` resolves the token to an agent before dispatch. The
  resolved agent replaces `sender_agent_id` and `from_agent_id`, and a mismatch is an
  error.
- **Requests without a token get least privilege.** They may read (`list_tasks`,
  `get_task`, `list_agents`) and nothing else. They can't change status, delete,
  spawn, or send as an agent. Otherwise an agent could gain full privilege just by
  leaving the header out.
- **The UI and humans have their own credential.** The UI already calls the app's
  HTTP routes, not `/mcp`, so it keeps that path. A human who drives `/mcp` by hand
  uses a user token generated in Settings, sent as `X-Keera-User-Token`. That token
  is separate from agent tokens and never placed in an agent's environment.
- **Other providers.** Only Claude reads `.mcp.json`.
  - **Gemini** gets a per-agent settings file from `write_gemini_settings`, which
    already writes `mcpServers.keera`. The same entry gains
    `headers: {"X-Keera-Agent-Token": …}`.
  - **Codex** gets no relay MCP entry from Keera today (`app/ai/providers/codex.py`).
    `build_command` would add one through `--config`, with the header sourced from
    `KEERA_AGENT_TOKEN`.
  - Until each provider is verified to send the header, enforcement stays off in
    projects that run that provider.
- **Threat model.** The token stops agents from acting under each other's identity
  by mistake (a wrong `sender_agent_id`, a copied PM command). It is **not** a
  security boundary. Every agent runs as the same OS user, so one agent can read
  another's environment through `ps` or `/proc`. To narrow that window, the token is
  rotated on every session start (new `session_id`). Real isolation would need
  separate OS users or sandboxes, which is out of scope here.
- **Enforcement.** Ownership rules switch from advisory to enforced per project,
  behind a setting, and only once every live agent in that project carries a token.

**Rules.**

- **Transitions.** They are enforced by a `TaskTransitionAction`. The tool returns
  `Error: illegal transition in_progress → done` instead of saving.
- **Ownership.**
  - Only the PM (`agent_type = pm`) may set `done` or `cancelled`, call
    `delete_task`, or reopen a terminal task (F6).
  - The assignee may move `acked` → `in_progress` → `in_review`.
  - Only a `reviewer` may set `approved` or `changes_requested`.
- **Approved SHA.** `approved` requires `head_sha`. The relay stores
  `tasks.approved_sha`. A new `record_merge(task_id, merged_sha)` moves the task to
  `merged` only when the PR's merged head equals `approved_sha`. Any push after the
  approval sends the task back to `in_review`. The relay checks the head through
  `app/services/github_cli.py`.
- **Dependencies.** New table `task_dependencies(task_id, depends_on_task_id)`. A QA
  or review task stays `blocked` until its dependency reaches `in_review`, or `done`
  for a hard dependency. `list_tasks` shows `blocked by #N`.
- **Audit log.** New append-only `task_events(id, task_id, actor_agent_id,
  from_status, to_status, fields_changed JSON, created_at)`. It is written by every
  task tool, including `create_task` and `delete_task`. `delete_task` becomes a soft
  delete (`deleted_at`), and `get_task_history(task_id)` reads the log (F7).
- **Idempotent create.** `create_task(..., idempotency_key?)`. A repeated key returns
  the existing task. `update_task` takes an optional `expected_updated_at` and
  refuses a stale write, so concurrent edits can't overwrite a different task's
  content (F5). `updated_at` is bumped on every write.

**Backward compatibility.** Old statuses map to new ones: `pending` → `created`,
`completed` → `done`, and `in_progress`, `in_review` and `cancelled` keep their
names. `update_task_status` accepts the old names and maps them. For one release the
ownership rule stays advisory until caller tokens are enforced.

**Rollout.** (1) `task_events` plus the `updated_at` fix (§3.0d). (2) Soft delete
and idempotency keys. (3) The new states with mapping. (4) Per-agent tokens, then
ownership rules, advisory first and enforced once tokens are. (5) `approved_sha` and
the merge gate. (6) Dependencies.

### 3.4 Typed messages

**Problem.** Every message is free text, so the relay can't tell an ACK from a
question or a PR report. A question an agent asks the PM leaves the task looking
`in_progress`.

**API.** `send_message_to_agent(..., kind?, fields?)` takes one of these kinds:

| `kind` | Required `fields` | Relay effect |
| --- | --- | --- |
| `ack` | `task_id` or `ref_uid` | Message → `acked`; task `assigned` → `acked`. |
| `question` | `task_id`, `question` | Task → `blocked` until a reply with `ref_uid` arrives. The question also surfaces in the existing Inbox (`agent_questions`). |
| `blocked` | `task_id`, `reason` | Task → `blocked`. |
| `report` | `task_id`, `pr_url`, `head_sha`, `tests`, `files_changed` | Copies the PR fields onto the task (`pr_url`, `branch`, `additions`, `deletions`). Task → `in_review`. |
| `review_verdict` | `task_id`, `pr_url`, `head_sha`, `verdict` (`approve`/`changes`) | Task → `approved(head_sha)` or `changes_requested`. |

**Backward compatibility.** `kind` defaults to `text`, which behaves exactly as
today. `fields` are validated only when `kind` is set.

**Rollout.** After 3.1 and 3.3. Ship `ack` and `report` first, then the rest.

### 3.5 Capacity (F11)

**Problem.** Finished agents hold slots, and a task that can't get an agent has
nowhere to wait.

**Change.**

- When a task reaches `merged`, the relay marks its agent `finished` and frees its
  slot. The limit counts only agents with `status not in (finished, deleted)`.
- Unassigned tasks enter a priority queue, ordered by `priority`, then `created_at`,
  with dependencies respected. New `claim_next_task(agent_id)` and
  `get_task_queue(project_path)` tools let the PM assign a waiting task as soon as a
  slot frees.
- `spawn_agent` returns `Error: agent limit reached; task #N queued at position K`
  instead of a bare error.

**Backward compatibility.** Finished agents remain visible in history. Only the
limit count changes.

**Rollout.** After 3.3 (it needs `merged`).

### 3.6 Visibility

**Change.**

- **Board.** A live board page at `routes/web.py` shows four columns: agents (health
  from §3.2, last heartbeat note), tasks by state (§3.3), PR review state (`head_sha`
  versus `approved_sha`), and message delivery (§3.1). It is pushed over the
  existing Reverb broadcast.
- **Decision digest.** When a task enters `blocked` with a `question`, or a merge is
  ready, the relay sends a digest to the user. That is a desktop notification plus
  an Inbox item, batched every 5 minutes. This replaces the PM-only
  `[HEARTBEAT]` text from `app/heartbeat.py`.

**Rollout.** Last. It reads only state the earlier phases record.

## 4. Phases

| Phase | Items | Outcome |
| --- | --- | --- |
| 0 | 3.0 (a) Stop-hook dispatch through `Terminal.send`, (b) `delivered` after send and the inbox reading `agent_relay_messages`, (c) the `AgentType` enum, (d) the `updated_at` bump and `task_events` | The confirmed causes of F1–F3, F6 and F9 are removed, and every later task change leaves a trace. |
| 1 | 3.1 Reliable delivery, 3.2 Agent health, 3.3 Task state machine (with per-agent tokens) | The PM can trust message state, agent liveness and task history without inspecting worktrees. |
| 2 | 3.4 Typed messages, 3.5 Capacity | The relay drives task state from messages and keeps slots full. |
| 3 | 3.6 Visibility | The user sees the team on one board and is pinged only when a decision is needed. |

Each phase ships behind the old behaviour first: dual-write, warnings before
enforcement, and free-text ACK still parsed.

## 5. Open questions

1. **Read signal.** Codex and Gemini agents have different hook sets from Claude's.
   What is their equivalent of `UserPromptSubmit` (for example Gemini's
   `BeforeAgent`)?
2. **Stop-hook dispatch.** Does any single-agent flow rely on the automatic
   dispatch that §3.0a removes, or can it go entirely?
3. **Truncation (F4).** Where was the 181-character cut made? Was it the PM's
   client, the JSON-RPC parse in `_parse_messages` / `_decode_concatenated`, or the
   UI? This needs a reproduction before Phase 1 closes.
4. **Duplicate `create_task` (F5).** Was the repeated #4021 a client retry, or a
   server-side race? Phase 1's `task_events` log will answer it next time. Should
   `idempotency_key` be required for orchestrator agents?
5. **Merge authority.** Should the relay perform the merge itself after checking
   `approved_sha`, or only gate the PM's `record_merge`?
6. **Heartbeat cost.** Does a 60 s worktree probe across ten agents cost too much
   on large repositories? Should it fall back to watching `.git/HEAD` instead?
7. **Dedup scope.** Should the relay dedup identical content from the same sender
   within N seconds, or only by `uid` / `idempotency_key`?
