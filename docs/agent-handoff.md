# Agent handoff between Keera servers

Phase 1 moves a running **Claude** agent from one Keera server to another (local→cloud
or cloud→local) with its worktree changes and its conversation, and resumes it there
with `claude --resume <session-id>`. The same code runs on both ends; every Keera is
both a source and a target.

## Pieces

| Piece | Where |
| --- | --- |
| Servers resource (`local`/`cloud`, name, base URL, token) | `servers` table, `server_controller`, Settings → Servers & Handoff |
| Push (source side) | `POST /api/agents/{id}/handoffs` → `AgentHandoffPushAction` |
| Import (target side) | `GET /api/handoff`, `POST /api/handoffs/preflight`, `POST /api/handoffs` → `plan_target`, `AgentHandoffImportAction` |
| History | `handoffs` table (`outgoing` on the source, `incoming` on the target), unique on `(handoff_key, direction)` |
| Agent state | `agents.handed_off_at`, `handed_off_to`, `handed_off_url`, `resume_session_id`, `handoff_claim`, `handoff_claimed_at` |
| Git snapshot / checkout | `app/services/handoff/git_snapshot.py` |
| Transcript export, rewrite, install | `app/services/handoff/transcript.py` |

## Protocol

```
Source Keera                                   Target Keera
------------                                   ------------
0. claim the agent in the DB (handoff_claim), refuse if claimed or handed off
1. refuse if any changed file looks like a secret (nothing stopped yet)
2. POST /api/handoffs/preflight ─────────────────▶ match project by origin URL, resolve the
   {remote_url, provider, model, complexity}       model (or the complexity default), run
                                       ◀─────────  AgentCreateAction.validate(); 200 or 4xx
3. stop the agent's PTY (session kept resumable)
4. snapshot worktree → commit W (temp index), re-check secrets
5. git push origin W:refs/heads/handoff/agent-<id>-<ts>
6. read ~/.claude/projects/<enc(worktree)>/<sid>.jsonl (+ <sid>/**)
7. POST /api/handoffs (Bearer token, JSON) ───────▶ a. auth, then a size-capped body parse
                                                   b. replay or claim handoff_key (unique row)
                                                   c. plan_target again (project, model)
                                                   d. create agent; skip ids whose
                                                      worktree slot is already taken
                                                   e. fetch branch, verify SHA == W,
                                                      worktree add -b worktree-agent-<new>
                                                      reset --mixed base (W → uncommitted)
                                                   f. rewrite + install transcript under
                                                      <config>/projects/<enc(new worktree)>/
                                                   g. resume_session_id = sid, has_session,
                                                      incoming handoff completed
                                       ◀─────── 200 {agent_id, project_id, url, replayed}
                                                   h. spawn: claude --worktree agent-<new>
                                                      --resume <sid>, then inject a
                                                      handoff note
8. mark source agent handed_off (+ target name/url), handoff completed, release the claim
```

The payload (`IncomingHandoffRequest`) carries:

- `handoff_key`, `source` (name, base URL);
- `agent`: source id, name, role (`agent_type`), provider, model, complexity, description,
  system prompt and whether it is the source's default for that role, flags, permission
  mode, and the source task (`id`, `title`);
- `git`: remote URL, handoff branch, source branch, `base_sha` (source HEAD), `head_sha`
  (snapshot), `wip` (whether the snapshot added a commit);
- `transcript`: session id and files (`text`, or `base64` when not UTF-8);
- `paths`: source worktree, project root, home and Claude config dir, used for rewriting.

### Worktree snapshot

The snapshot never touches the source checkout. It builds a tree in a temporary
`GIT_INDEX_FILE` (`read-tree HEAD`, `add -A`, `write-tree`) and, only when the tree differs
from HEAD, creates `W = commit-tree <tree> -p HEAD`. Pushing `W` also pushes every local
commit under it, so committed, uncommitted and untracked work all arrive. `.gitignore` is
respected, so ignored files never leave the machine.

**Secrets are refused, not silently dropped.** Two sets of files are checked
case-insensitively against `looks_secret()`. The first is every file the snapshot would add
or change relative to HEAD. The second is every file added or changed by a commit no remote
has yet (`git log -m --name-only HEAD --not --remotes`), including one a later commit
deleted again, because pushing the snapshot publishes those commits too. That covers `.env`,
`.env.*`, `*.env`, `.envrc`, every `id_*` SSH key type, `*.pem`, `*.key`, `*.p12`, `*.pfx`,
`*.jks`, `*.keystore`, `*.kdbx`, `.npmrc`, `.pypirc`, `.netrc`, `.git-credentials`,
`.pgpass`, `credentials`, `credentials.json`, `*-key.json`, `service-account*.json`,
`*.tfvars`, `*.tfstate`, `secrets.*`, `settings.local.json`, `.htpasswd`, `.s3cfg`,
`.boto`, `.vault-token`, `client_secret*.json`, `kubeconfig`, `*.kubeconfig`, `*.asc`, and
anything under `.aws/`,
`.ssh/`, `.gnupg/`, `.docker/config.json` or `.kube/config`. Templates such as
`.env.example` and public keys (`*.pub`) are allowed. On a match the push fails with a 422
that lists the files, so the user can delete or ignore them, or rewrite the unpushed
commits. The check runs before anything is stopped and again on the final snapshot.
Secrets that already exist on a remote are out of scope, since the handoff doesn't
publish them again.

### Model

The target runs the agent on the source's model when it is configured there. Otherwise it
uses its own default for the task's complexity. The preflight result, the push result
(`notice` on the outgoing handoff) and the agent's resume note all say so, for example
"claude-sonnet-5 is not configured on this server, so the agent runs on claude-opus-5."
The UI shows it after the push.

On the target the WIP commit is undone with `reset --mixed <base_sha>`, so the agent finds
the same committed history plus the same modified/untracked files it left behind (the
staged/unstaged split is not preserved). The target branch is always
`worktree-agent-<new id>` so it never collides with a branch the target already has (a
round trip would otherwise hit the original, still checked-out branch). The resume note
tells the agent its old branch name and how to push to it.

Agent ids are per database, so two Keeras on one checkout (for example dev and dist) can
both own an `agent-<id>` slot. If the new agent's `worktree-agent-<id>` branch or
`.claude/worktrees/agent-<id>` path already exists, the import soft-deletes that unused
agent row and creates another, up to five times, then returns 409. An existing checkout or
transcript is never modified or removed. Rollback only removes what this import created.

### System prompt

If the source prompt is the source's default for the role, the target regenerates its own
default, which embeds the target's MCP URL. A custom prompt is kept, but URLs on the
source's origin, and any `http(s)://<host>:<source port>/mcp|/api…` alias of it (for
example a tailnet name), are rewritten to the target's base URL.

### Conversation

The source picks the newest `*.jsonl` in the agent worktree's path-encoded transcript dir
(what `--continue` would pick), read **after** the PTY is stopped so it is final. It is
installed on the target under the new worktree's encoded dir with the **same session id**,
so `claude --resume <sid>` continues the same conversation. `--worktree agent-<id>`
reuses the pre-created worktree and finds the transcript there (verified with the CLI).
`resume_session_id` is cleared once the CLI produces output; later restarts use
`--continue`, which finds the same session.

## Path rewriting

`PathRewriter` maps, longest first:

| Source | Target |
| --- | --- |
| worktree path | new worktree path |
| project root | target project root |
| Claude config dir | target config dir |
| `enc(worktree)` (e.g. `-home-a-app--claude-worktrees-agent-7`) | `enc(new worktree)` |
| `enc(project root)` (used in Claude's scratchpad paths) | `enc(target root)` |
| home dir | target home dir |

A match must not be preceded or followed by a path character (`[A-Za-z0-9._-]`), so
`/home/alice` does not rewrite `/home/alicex` or `/opt/home/alice`. JSONL lines are parsed
and every string (and key) is rewritten, then re-serialized compactly. Unparseable lines
are rewritten as text. Other transcript files are rewritten as text, and binary files are
copied as-is. Rewriting also changes historic tool output and assistant text (an answer
that printed the old `cwd` now shows the new one). That keeps the model's picture of the
filesystem consistent, but it does change the record. Incoming paths are validated:
only `<sid>.jsonl` and files under `<sid>/` are written, and `..` or absolute paths are
rejected.

## Auth

- Each server's inbound handoff API is enabled by `KEERA_HANDOFF_TOKEN` in its `.env`.
  Without it, `/api/handoff*` returns 403. A wrong or missing bearer gets 401. The token
  is compared with `hmac.compare_digest`.
- Auth is a FastAPI dependency (`require_handoff_token`), and the endpoints declare no body
  parameter, so the token is checked **before** the body is read. An unauthenticated
  caller gets a 401 and never sees the schema. Only then is the body streamed, capped at
  `KEERA_HANDOFF_MAX_BYTES` (default 64 MiB, 413 above it), and validated (422).
- A server record stores the **target's** token. The API never returns it (`has_token`
  only), the settings form keeps it when left blank on edit, and it is never logged
  (errors and logs carry only the server id or name).
- **The token is stored in plaintext** in the `servers` table. Encrypting it is not cheap
  here: Keera has no app key or crypto dependency, and a key kept in the same `storage/`
  directory as `keera.db` would protect very little. Treat `storage/keera.db` as a
  secret: it is git-ignored and should stay readable only by the Keera user. Use a
  dedicated, rotatable `KEERA_HANDOFF_TOKEN` per server, never a reused credential (see
  open questions).
- Requests also pass Keera's existing trusted-host check, so `base_url` must use the
  host the target serves on.

## Failure handling

| Failure | Outcome |
| --- | --- |
| Changed files look like secrets | 422 listing them, before anything is stopped. |
| Target down, bad token, handoffs disabled, no matching project, model or provider not allowed | The preflight fails **before** anything is stopped. The agent keeps running. 502 with the target's client-safe reason. |
| Not a Claude agent, PM/no-worktree agent, no transcript, no `origin` | 422 before stopping. |
| Failure after the stop with a definite outcome (git error, push rejected, target 4xx) | The remote `handoff/*` branch is deleted, the outgoing handoff is marked `failed` with the error, the claim is released, and if the agent had a live session it is **restarted** (`--continue`) with a note that the move failed. The source worktree and transcript were never touched. |
| Failure after the stop with an **uncertain** outcome (timeout, connection drop, 5xx, invalid response) | Same, except the source is **not** restarted, because the target may already be running it. The error says to push again, and the retry reuses the key, so the target replays (`replayed: true`) or imports cleanly. |
| Any other exception (an `OSError`, a bug) | The same compensation runs, logged with a traceback, recorded as "Unexpected handoff failure.", then re-raised (500). |
| Target fails midway (fetch, worktree, transcript) | The import compensates. It soft-deletes the new agent, removes only the worktree and branch it created, removes transcript files written so far, and deletes its claim row so a retry can run. The source sees a 4xx/5xx, as above. |
| Git command hangs | Every git call has a 300 s timeout, translated to a handoff error. |

The source agent is marked `handed_off` only after the target returns 200. It is never
deleted. It keeps its worktree and transcript and shows "Moved to <server> (agent #n)"
with a link. Spawn paths (trigger, terminal WebSocket, headless spawns) refuse a
handed-off agent, relay and MCP messages to it are rejected with where it went, and a
second push gets a 409.

## Idempotency

- **Double-click / concurrent pushes**: the source claims the agent with one conditional
  `UPDATE agents SET handoff_claim=<token> WHERE id=? AND handed_off_at IS NULL AND
  (handoff_claim IS NULL OR handoff_claimed_at < now-15min)` and re-reads it. Only the
  request whose token landed proceeds; the others get 409. This works across processes.
  While claimed, terminal, trigger and headless spawns refuse the agent. A claim older
  than 15 minutes (a crashed server) can be taken over.
- **Retries**: a new push to the same server after a failure reopens the failed outgoing
  handoff and reuses its key.
- **Target dedupe**: the target inserts an `importing` row for `(handoff_key, incoming)`
  under a unique index before doing any work. A concurrent duplicate gets 409, a completed
  key returns the same agent (`replayed: true`), and a completed key whose agent was
  deleted since is imported again. A failed import deletes its row. A stale `importing`
  row (over 15 minutes old) is taken over.
- **Why 15 minutes is enough**: `CLAIM_TTL` and `IMPORT_TTL` must outlast the longest gap
  between two refreshes, so a slow but healthy handoff is never taken over. Bounding the
  steps instead would not be tight enough. Each git call times out at 300 s, the
  preflight at 30 s and the send at 300 s, but a snapshot or checkout chains several git
  calls, so their worst case adds up past 15 minutes. So a heartbeat
  (`app/services/handoff/tasks.py`) refreshes `handoff_claimed_at` on the source, and the
  `importing` row's `updated_at` on the target, every 60 s for as long as the handoff
  runs, whatever step it is in. The longest gap is then about 60 s plus event-loop
  delay, far under 15 minutes. A failed beat is logged and the next one retries. A server
  that dies mid-handoff stops beating, and its claim becomes takeable 15 minutes after
  the last beat.

## What does not move

- **Running processes**: the CLI, dev servers, background shells and in-flight tool calls
  stop. The agent resumes at its last saved turn. A tool call that was mid-flight is lost.
- **Ignored files and secrets**: `.env`, build output, `node_modules`, and so on. The
  target supplies its own through the project's `worktree_copy_paths`. The resume note
  says so.
- **Env and credentials**: the target agent runs with the target's environment, Claude
  login and `CLAUDE_CONFIG_DIR` (per workspace).
- **MCP and relay identity**: agent ids are per server, so the moved agent gets a new id.
  Its roster, relay URL and MCP server are now the target's (relay instructions are
  re-sent on spawn and the note states the new id). Agents left on the source, such as
  its PM, cannot message it, and messages queued for the old id stay on the source.
  Cross-server relay is out of scope.
- **Tasks**: tasks live in each server's DB, so only the source task's id and title travel
  (mentioned in the resume note). The target agent has no linked task.
- **Codex and Gemini**: unsupported for now (422). Codex keeps sessions in
  `~/.codex/sessions` and Gemini in `~/.gemini/tmp/<project-hash>`. Both need their own
  export and resume. PM agents run in the project root without a worktree and are
  excluded too.
- Claude-local state outside the session dir (`~/.claude.json` project trust, memory
  under `projects/<enc>/memory`, MCP approvals). The target directory must be trusted
  once: `claude --worktree` refuses an untrusted workspace.

## POC: two instances on one machine

```bash
git init --bare /tmp/ho/remote.git    # plus seed commit pushed to main
git clone /tmp/ho/remote.git /tmp/ho/local-proj
git clone /tmp/ho/remote.git /tmp/ho/cloud-proj
for n in a b; do DB_DATABASE=storage/$n.db DB_URL=sqlite+aiosqlite:///storage/$n.db \
  uv run python artisan db:migrate; done
KEERA_APP_URL=http://127.0.0.1:4601 KEERA_HANDOFF_TOKEN=token-a KEERA_SERVER_NAME=local-a \
  DB_DATABASE=storage/a.db DB_URL=sqlite+aiosqlite:///storage/a.db uv run python artisan serve --port 4601
KEERA_APP_URL=http://127.0.0.1:4602 KEERA_HANDOFF_TOKEN=token-b KEERA_SERVER_NAME=cloud-b \
  DB_DATABASE=storage/b.db DB_URL=sqlite+aiosqlite:///storage/b.db uv run python artisan serve --port 4602
```

Add the `local-proj` project on A and `cloud-proj` on B (same `origin`), and run `claude`
once in each to trust it. Register B on A (Settings → Servers & Handoff, token `token-b`)
and A on B. Start a Claude agent on A, then use **Push to cloud-b** on its card.

Verified in the run behind this PR:

- An agent on A was told a code word, committed `feature.py`, left `README.md` modified
  and `notes.txt` untracked, and created a git-ignored `.env`.
- With an untracked `.npmrc` and `.aws/credentials` present, the push returned 422 listing
  both files.
- Push to a bad-token server and to a down server both returned 502.
- In all three cases the agent kept running with its session and no claim held.
- B restarted with `KEERA_HANDOFF_MAX_BYTES=100000` rejected the send with 413 (a definite
  4xx). A deleted the remote `handoff/*` branch, recorded the failure, and resumed the agent
  in the same session with a "moving you failed" note.
- Two concurrent pushes returned one 200 and one 409. The 200 reused the failed attempt's
  key.
- The custom system prompt's `http://127.0.0.1:4601/mcp` arrived on B as
  `http://127.0.0.1:4602/mcp`.
- B's agent ran `claude --worktree agent-2 --resume <same sid>`, showed ` M README.md` /
  `?? notes.txt` on top of `add feature`, had no `.env`, and answered the code word from
  B's worktree path.
- Pushing back from B to A gave A a new agent (#3) in the same conversation, which still
  knew the code word and its uncommitted files. Both earlier copies were stopped and
  marked handed off.
- Neither token appeared in either server's logs.
- Start the servers from a plain shell. A Keera started from inside a Claude session
  inherits `CLAUDE_CODE_CHILD_SESSION`, and its agents then save no transcripts.

## Open questions

1. **Token storage**: server tokens are stored in plaintext in SQLite (see Auth). Should we
   add an app key plus a crypto dependency, or use the OS keychain?
2. **Token issuance**: there is one static inbound token per server. Should we have
   per-peer tokens, rotation, or a pairing flow ("show a code on the target")?
3. **Handoff branch cleanup**: a failed handoff deletes its `handoff/*` branch. A successful
   one keeps it as an audit trail and as the base the target worktree came from. Should
   the target delete it once checked out?
4. **Branch identity on the target**: the agent works on `worktree-agent-<new id>` and is
   told to push to its old branch. Should we check out the original branch name when the
   target doesn't already have it?
5. **Project matching**: projects match by `origin` URL only. Offer a project picker, or
   clone the repo on the target when no project matches?
6. **Cross-server relay**: should the source PM still be able to message a moved agent
   (forwarding or a shared relay)?
7. **Long transfers**: the push is a synchronous request (target timeout 300 s). Large
   transcripts or slow remotes may need a background job with progress.
8. **Shared agent ids**: two Keeras on one checkout share the `agent-<id>` namespace. Import
   skips taken slots, but the *other* Keera can still collide later. Should worktree names
   carry a per-server prefix?
9. **Codex and Gemini support**: design their session export and resume, and decide
   whether PM agents (no worktree) should be movable.
