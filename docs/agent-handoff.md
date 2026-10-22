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
| Import (target side) | `GET /api/handoff`, `POST /api/handoffs` → `AgentHandoffImportAction` |
| History | `handoffs` table (`outgoing` on the source, `incoming` on the target) |
| Agent state | `agents.handed_off_at`, `handed_off_to`, `handed_off_url`, `resume_session_id` |
| Git snapshot / checkout | `app/services/handoff/git_snapshot.py` |
| Transcript export, rewrite, install | `app/services/handoff/transcript.py` |

## Protocol

```
Source Keera                                   Target Keera
------------                                   ------------
1. GET  /api/handoff  (Bearer token)   ───────▶ 200 {name, base_url, providers}
2. stop the agent's PTY (session kept resumable)
3. snapshot worktree → commit W (temp index)
4. git push origin W:refs/heads/handoff/agent-<id>-<ts>
5. read ~/.claude/projects/<enc(worktree)>/<sid>.jsonl (+ <sid>/**)
6. POST /api/handoffs (Bearer token, JSON) ───────▶ a. dedupe on handoff_key
                                                   b. match project by origin URL
                                                   c. create agent (AgentCreateAction)
                                                   d. fetch branch, verify SHA == W,
                                                      worktree add -b worktree-agent-<new>
                                                      reset --mixed base (W → uncommitted)
                                                   e. rewrite + install transcript under
                                                      <config>/projects/<enc(new worktree)>/
                                                   f. resume_session_id = sid, has_session
                                                   g. record incoming handoff
                                       ◀─────── 200 {agent_id, project_id, url, replayed}
                                                   h. spawn: claude --worktree agent-<new>
                                                      --resume <sid>, then inject a
                                                      handoff note
7. mark source agent handed_off (+ target name/url), handoff completed
```

The payload (`IncomingHandoffRequest`) carries:

- `handoff_key`, `source` (name, base URL);
- `agent`: source id, name, role (`agent_type`), provider, model, complexity, description,
  system prompt, flags, permission mode, and the source task (`id`, `title`);
- `git`: remote URL, handoff branch, source branch, `base_sha` (source HEAD), `head_sha`
  (snapshot), `wip` (whether the snapshot added a commit);
- `transcript`: session id and files (`text`, or `base64` when not UTF-8);
- `paths`: source worktree, project root, home and Claude config dir, used for rewriting.

### Worktree snapshot

The snapshot never touches the source checkout. It builds a tree in a temporary
`GIT_INDEX_FILE` (`read-tree HEAD`, `add -A`, `write-tree`) and, only when the tree differs
from HEAD, creates `W = commit-tree <tree> -p HEAD`. Pushing `W` also pushes every local
commit under it, so committed, uncommitted and untracked work all arrive. `.gitignore` is
respected, and these are excluded even if not ignored: `.env`, `.env.*`, `*.pem`, `*.key`,
`id_rsa*`, `id_ed25519*`, `.claude/settings.local.json`.

On the target the WIP commit is undone with `reset --mixed <base_sha>`, so the agent finds
the same committed history plus the same modified/untracked files it left behind (the
staged/unstaged split is not preserved). The target branch is always
`worktree-agent-<new id>` so it never collides with a branch the target already has (a
round trip would otherwise hit the original, still checked-out branch). The resume note
tells the agent its old branch name and how to push to it.

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
- A server record stores the **target's** token. The API never returns it (`has_token`
  only), the settings form keeps it when left blank on edit, and it is never logged
  (errors and logs carry only the server id or name).
- Requests also pass Keera's existing trusted-host check, so `base_url` must use the
  host the target serves on.

## Failure handling

| Failure | Outcome |
| --- | --- |
| Target down, bad token, handoffs disabled | Preflight `GET /api/handoff` fails **before** anything is stopped. The agent keeps running. 502 with a client-safe message. |
| Not a Claude agent, PM/no-worktree agent, no transcript, no `origin` | 422 before stopping. |
| Push or target rejection after the stop | Outgoing handoff is marked `failed` with the error. The source worktree, branch and transcript are untouched (snapshot used a temp index). The agent is stopped but resumable with Restart (`--continue`). 502. |
| Target fails midway (fetch, worktree, transcript) | The import compensates: soft-deletes the new agent, removes its worktree and branch, deletes written transcript files, records nothing. The source sees a 4xx/5xx, as above. |
| Target accepted but the response was lost (timeout) | The source records `failed`. A retry reuses the same `handoff_key`, so the target returns the agent it already created (`replayed: true`) instead of a duplicate. |

The source agent is marked `handed_off` only after the target returns 200. It is never
deleted. It keeps its worktree and transcript and shows "Moved to <server> (agent #n)"
with a link. Spawn paths (trigger, terminal WebSocket, headless spawns) refuse a
handed-off agent, relay and MCP messages to it are rejected with where it went, and a
second push gets a 409.

## Idempotency

- **Double-click**: an in-process per-agent guard (`agents_in_flight`) makes a second push
  return 409 while the first runs. The same guard blocks terminal and trigger spawns during
  the push. A finished handoff makes later pushes 409.
- **Retries**: a new push to the same server after a failure reuses the failed handoff's
  key. The target serializes imports per key and returns the existing agent for a
  completed key.
- The guard is per process. Keera runs as one process, and a multi-worker deployment
  would need a DB-level lock (see open questions).

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
- Push to a bad-token server and to a down server both returned 502, and the agent kept
  running.
- Two concurrent pushes returned one 200 and one 409.
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

1. **Token storage**: server tokens are stored in plaintext in SQLite. Should we encrypt
   them at rest, or keep them in the OS keychain?
2. **Token issuance**: there is one static inbound token per server. Should we have
   per-peer tokens, rotation, or a pairing flow ("show a code on the target")?
3. **Handoff branch cleanup**: `handoff/*` branches stay on the remote. Should they be
   deleted after the target checks them out, or kept as an audit trail?
4. **Branch identity on the target**: the agent works on `worktree-agent-<new id>` and is
   told to push to its old branch. Should we check out the original branch name when the
   target doesn't already have it?
5. **Project matching**: projects match by `origin` URL only. Offer a project picker, or
   clone the repo on the target when no project matches?
6. **Cross-server relay**: should the source PM still be able to message a moved agent
   (forwarding or a shared relay)?
7. **Long transfers**: the push is a synchronous request (target timeout 300 s). Large
   transcripts or slow remotes may need a background job with progress.
8. **Multi-worker deployments**: the in-flight guard is per process. Replace it with a DB
   row lock if Keera ever runs several workers.
9. **Codex and Gemini support**: design their session export and resume, and decide
   whether PM agents (no worktree) should be movable.
