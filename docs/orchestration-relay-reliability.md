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
| F3 | The receiver saw an ACK with the title of another task (#4022) appended. | The stored row `#38416` holds the exact ACK text. The corruption therefore happened at PTY injection. Two writes (the relay message and a concurrent spawn or task injection) landed in the same input line, because injection is unframed and not serialised per session. |
| F4 | `get_task` returned an empty or truncated body (181 characters of a long description). Task #4021 shows `Body: (none)`. | The PM puts the brief in the `spawn_agent` message, not in the task, so `tasks.body` is NULL for #4018–#4022. **Unverified:** the 181-character truncation. `get_task` doesn't truncate, so the cut happened before or at `create_task`. |
| F5 | `create_task` returned #4021 twice, and the second call overwrote a different task (the `where_raw` fix), which had to be recreated as #4022. | **Unverified.** `tasks.id` is `AUTOINCREMENT`, so SQLite ID reuse is ruled out. Nothing makes `create_task` idempotent, and nothing records history, so the overwrite can't be reconstructed. |
| F6 | Task #4019 showed `in_progress` after the PM had set it `completed`. | **Unverified.** Any agent may call `update_task_status`, and #4019 has `updated_at == created_at`, so no trace of who changed it survives. |
| F7 | Task #4019 vanished from the tracker and was recreated. | **Unverified.** `delete_task` is a hard delete open to every agent, and `list_tasks` hides `completed` rows older than 7 days. No audit log exists. |
| F8 | `delete_agent` reported success for agent 3473, but the agent stayed listed and kept its slot until a second delete. | **Unverified.** `deleted_at` is saved before `stop_agent_session`, and nothing stops a live CLI from re-registering its session through the hooks. The row still has a `session_id` after the delete. Deleted agents also keep `status = running` (3441, 3465). |
| F9 | `spawn_agent` rejects `agent_type: custom`, although the PM prompt lists it. | Confirmed. `SpawnAgentInput.agent_type` allows `pm`, `software_engineer`, `software_engineer_frontend`, `reviewer`, `qa` and `qa_browser`, while the `agents.agent_type` column defaults to `custom`. |
| F10 | Agents 3441 and 3465 were deleted externally mid-task with no notice to the PM. | Confirmed. `DeleteAgentTool` notifies nobody, and the agent's task keeps its status. Agent 3440 is deleted and still holds `task_id = 3974`. |
| F11 | The 5-slot cap left work unowned. | Confirmed. The limit counts every non-deleted agent, including agents whose PR merged hours ago. Nothing frees a slot or queues the waiting task. |

## 3. Proposals

Each item gives the problem, the API and schema change, backward compatibility, and
a rollout step. Phase 1 covers items 3.1–3.3.

### 3.1 Reliable delivery (F1, F2, F3, F4)

**Problem.** Delivery state is inferred from the agent's free-text reply. Message IDs
come from two tables. Injection is unframed, so concurrent writes interleave. The
task's content travels only inside the message.

**Schema.** Extend `agent_relay_messages`:

| Column | Type | Purpose |
| --- | --- | --- |
| `uid` | `VARCHAR(26) UNIQUE` | Globally unique ID (ULID), returned to callers in place of the row ID. |
| `idempotency_key` | `VARCHAR NULL`, unique per `from_agent_id` | Lets a retried send return the original `uid` instead of creating a duplicate row. |
| `status` | `queued` · `delivered` · `read` · `acked` | Replaces `pending` · `delivered`. |
| `delivered_at`, `read_at`, `acked_at` | `TIMESTAMP NULL` | Set by the relay, not by the sender. |
| `attempts` | `INTEGER DEFAULT 0` | Counts redelivery attempts. |
| `task_id`, `task_snapshot` | `INTEGER NULL`, `TEXT NULL` (JSON) | The task's state at send time. |
| `kind` | `VARCHAR DEFAULT 'text'` | Used by §3.4. |

Retire `agent_messages` from `get_agent_messages`, or keep it only for
project-to-project mail under a different tool name.

**Delivery semantics.**

- **`delivered`** is set *after* `terminal.send` returns. For the headless path, it
  is set when `deliver_pending_relay_messages` sends the message into the spawned
  CLI, not when the spawn is scheduled.
- **`read`** is set by the relay when the receiver's next `UserPromptSubmit` or
  `PostToolUse` hook arrives at `/api/agent-hook-events` after delivery. This is
  evidence that the receiver processed its input. The relay records it itself, so
  no reply from the agent is needed.
- **`acked`** is set when the receiver sends a `kind = ack` message that references
  the `uid` (§3.4), or calls the new `ack_message(uid)` tool.
- **Per-session injection lock.** `TerminalWriteAction` takes an `asyncio.Lock` per
  `session_id`, so the spawn prompt, relay messages and check-ins never interleave
  (F3). Each injection is framed as `[relay <uid>] [Message from Agent '<name>']: …`,
  so the receiver can dedup.
- **Receiver-side dedup.** `deliver_pending_relay_messages` skips any `uid` already
  `delivered`. The agent prompt tells agents to ignore a `uid` they have already seen.
- **Redelivery.** A message still `delivered` but not `read` after 120 s is re-sent
  once, with `attempts` incremented. After the second attempt the sender is notified
  (§3.2).

**API.**

- `send_message_to_agent(..., idempotency_key?, task_id?)` returns
  `{uid, status}` as JSON text, for example
  `{"uid":"01J…","status":"delivered"}`.
- New `get_message_status(uid)` returns
  `{uid, status, delivered_at, read_at, acked_at, attempts}`.
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

**Rollout.** (1) Migration plus a dual-write of `uid`. (2) Injection lock and
post-send `delivered`. (3) Hook-driven `read`. (4) `get_message_status` and the
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

- `delete_agent(agent_id, reason?)` stops the session first, then clears
  `session_id` and sets `deleted_at` and `status = deleted` in one update.
  `claude_hook_controller` and `agent_hook_event_controller` ignore events for
  agents with `deleted_at` set, so a dying CLI can't re-register (F8). The tool
  re-reads the row and reports failure if the agent is still listed.
- Every deletion, including deletion from the UI, emits a relay message to the
  orchestrator (`orchestrator_id`, else the project's PM): `kind = report`,
  `agent deleted: <name> (<reason>)`. Its task goes back to `assigned = NULL`,
  status `created`, with the branch and head SHA kept on the task (F10).

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
ownership rule is reported as a warning before it is enforced.

**Rollout.** (1) `task_events` plus the `updated_at` fix, logging only. (2) Soft
delete and idempotency keys. (3) The new states with mapping. (4) Ownership rules,
first as warnings, then enforced. (5) `approved_sha` and the merge gate. (6)
Dependencies.

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
- Fix F9: `SpawnAgentInput.agent_type` and the PM prompt (`app/prompts/pm.html`)
  draw their lists from one `AgentType` enum.

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
| 1 | 3.1 Reliable delivery, 3.2 Agent health, 3.3 Task state machine | The PM can trust message state, agent liveness and task history without inspecting worktrees. |
| 2 | 3.4 Typed messages, 3.5 Capacity | The relay drives task state from messages and keeps slots full. |
| 3 | 3.6 Visibility | The user sees the team on one board and is pinged only when a decision is needed. |

Each phase ships behind the old behaviour first: dual-write, warnings before
enforcement, and free-text ACK still parsed.

## 5. Open questions

1. **Read signal.** Is a hook event after injection strong enough evidence of
   `read` for Codex and Gemini agents, whose hook sets differ from Claude's?
2. **Truncation (F4).** Where was the 181-character cut made? Was it the PM's
   client, the JSON-RPC parse in `_parse_messages` / `_decode_concatenated`, or the
   UI? This needs a reproduction before Phase 1 closes.
3. **Duplicate `create_task` (F5).** Was the repeated #4021 a client retry, or a
   server-side race? Phase 1's `task_events` log will answer it next time. Should
   `idempotency_key` be required for orchestrator agents?
4. **Merge authority.** Should the relay perform the merge itself after checking
   `approved_sha`, or only gate the PM's `record_merge`?
5. **Heartbeat cost.** Does a 60 s worktree probe across ten agents cost too much
   on large repositories? Should it fall back to watching `.git/HEAD` instead?
6. **Dedup scope.** Should the relay dedup identical content from the same sender
   within N seconds, or only by `uid` / `idempotency_key`?
