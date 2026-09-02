# Repro notes — 500 on `GET /api/projects/{id}/tasks` (task #1631)

Reproduction only. No fix is included here.

## Symptom

`sqlalchemy` `AssertionError` with an empty message, raised from
`Transaction.commit`'s `assert not self.is_active`, reached through
`app/controllers/task_controller.py:14` → `builder.paginate` → `count` →
`aggregate` → `Connection.select_one` → `await conn.commit()`. Seen in the
`dist/` build.

## Verdict

**REPRODUCED.**

| Phase | Workload | Result |
| --- | --- | --- |
| Sequential control | 30 `paginate()` calls | 0/30 failed (0.0%) |
| Concurrent | 3 rounds × 20 workers × 60 calls | 1548/3600 failed (**43.0%**), 3/3 rounds |

Per-round failure rates: 39.6%, 44.5%, 44.9%. The rate swings between runs
(observed 15–79% per round across many runs); what is stable is that **no
round is ever clean**.

A single non-concurrent request never errors, which isolates concurrency as
the trigger. The workload is `SELECT`-only, so the dev DB is never written —
verified out of band: the file mtime is unchanged and `PRAGMA integrity_check`
returns `ok` after a full run.

The captured traceback matches the reported production stack frame for frame,
down to the `aggregate` → `select_one` → `commit` legs.

## Run it

From the repo root, against whatever `DB_URL` your `.env` points at:

```bash
uv run python -m scripts.repro_double_commit
```

The script boots the app through the normal `bootstrap.application` entry
point, exactly like `artisan` does — no bespoke DB wiring. Tunables are plain
constants at the top of the file: `PROJECT_ID`, `SEQUENTIAL_CALLS`, `WORKERS`,
`CALLS_PER_WORKER`, `ROUNDS`.

It drives `Task...paginate()` directly rather than importing
`task_controller.index`. Everything below `paginate` in the production stack
is ORM code, so the controller is not implicated — it is just one caller of
many, and the repro should not depend on application code that may change
around it.

Exit codes: `0` reproduced, `1` not reproduced or inconclusive.

## Root cause

The PM's hypothesis — *a shared global async DB connection reused across
concurrent requests* — is **confirmed**, with one refinement about the exact
mechanism.

`fastapi_startkit.masoniteorm.connections.connection.Connection` caches one
`AsyncConnection` for the whole process, and the lazy init is a check-then-act
across an `await`:

```python
async def get_connection(self) -> AsyncConnection:
    if self.connection is None:                       # (1) N coroutines see None
        self.connection = await self.engine.connect() # (2) all of them await
    return self.connection                            # (3) last write wins
```

While (2) is in flight, every other coroutine still sees `None`. Counting the
facades during investigation (a temporary wrapper around `get_connection`)
confirmed it: **20 concurrent workers build 20 distinct `AsyncConnection`
facades** where the design assumes exactly 1. With a single worker, exactly 1.

For sqlite, `ConnectionFactory.create_engine` builds the engine with
`StaticPool`, which hands the *same* underlying DBAPI connection to every
checkout. So those 20 facades are 20 independent SQLAlchemy transaction state
machines driving one sqlite connection. Only one wins the assignment in (3);
the rest are orphaned mid-use, and when an orphan is garbage collected it
resets the shared DBAPI connection out from under the live facade — visible as
SQLAlchemy's `non-checked-in connection ... will be terminated` warning.

The loser then reaches `Transaction._do_commit` with `is_active` still true but
`connection._transaction` no longer pointing at itself:

```
base.py:2699 _deactivate_from_connection -> assert self.connection._transaction is self   # fails first
base.py:2642 commit -> finally: assert not self.is_active                                 # what surfaces
```

The inner assert fails, so the transaction is never deactivated, so the
`finally` in `Transaction.commit` raises the `assert not self.is_active` that
production reports. The original cause is masked by the second assert.

### Secondary interleavings (same family)

Once a single facade *is* shared, two more non-atomic spots make it worse:

- `Connection.run` / `execute` autocommit with an `await` between `execute`
  and `commit`, so two coroutines can commit one implicit transaction.
- `Connection.select_one` commits a second time on top of the commit that
  `run` already performed — a literal double commit. This is the exact frame
  in the production stack.

These are real but rarer on their own; the dominant, reliably reproducible
trigger is the cold-connection stampede.

## Why production hits this, and not just at boot

`Connection._maybe_cleanup` (after every `commit_transaction` / `rollback`)
and `Connection.close` both set `self.connection = None`, returning the
process to the "cold" state repeatedly. Any burst of concurrent work that
lands while the connection is cold — frontend polling, the check-in scheduler
loop, heartbeats, MCP calls — re-runs the stampede. That matches the
intermittent nature of the production 500s.

Empirically the failure only reproduces from a cold connection: once the
connection is warm, 100 workers × 20 calls produced zero errors. This is why
the script explicitly drops back to cold (`DatabaseManager.clear()`) before
each round instead of relying on process start.

## Prior art

Branch `task/1370-shared-db-connection` (commit `cc3877b`, unmerged, not on
`dev`) diagnosed the same shared-connection family and serialised every query
behind a re-entrant per-connection lock. That lock wraps `run`/`execute`/etc.,
which call `get_connection` internally, so it should cover the stampede this
repro isolates as well as the commit interleavings. Whoever picks up the fix
should run this script against that branch to confirm, and decide whether
serialising *all* queries process-wide is the shape they want versus making
`get_connection` atomic and giving each coroutine its own connection.
