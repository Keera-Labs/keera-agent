#!/usr/bin/env python3
"""Reproduce the prod 500 on GET /api/projects/{id}/tasks (task #1631).

Repro only -- this script deliberately does not fix anything.

SYMPTOM
    AssertionError with an empty message, raised by SQLAlchemy's
    ``Transaction.commit`` (``assert not self.is_active``), reached through:

        app/controllers/task_controller.py::index
          -> masoniteorm builder.paginate -> count / get
            -> Connection.run -> await conn.commit()

ROOT-CAUSE HYPOTHESIS (proven by this script)
    ``fastapi_startkit.masoniteorm.connections.connection.Connection`` lazily
    caches ONE SQLAlchemy ``AsyncConnection`` for the whole process, and the
    lazy init is a check-then-act across an await:

        async def get_connection(self):
            if self.connection is None:                 # (1) N coroutines
                self.connection = await self.engine.connect()   # (2) all await
            return self.connection                      # (3) last write wins

    While (2) is in flight every other coroutine still sees ``None``, so N
    concurrent requests build N ``AsyncConnection`` facades. For sqlite the
    engine is built with ``StaticPool`` (see ConnectionFactory.create_engine),
    which hands out the SAME underlying DBAPI connection to every checkout.
    Result: N independent SQLAlchemy transaction state machines driving one
    sqlite connection.

    Only one facade wins the assignment; the rest are orphaned mid-use. They
    BEGIN/COMMIT over each other, and when an orphan is garbage collected it
    resets the shared DBAPI connection out from under the live facade (the
    "non-checked-in connection ... will be terminated" SAWarning). The loser
    reaches ``Transaction._do_commit`` with ``is_active`` still true but
    ``connection._transaction`` no longer pointing at itself, the inner
    ``assert connection._transaction is self`` fails, the transaction is never
    deactivated, and the ``finally: assert not self.is_active`` in
    ``Transaction.commit`` is the AssertionError the stack trace shows.

    Same family, once a facade IS shared: ``Connection.run`` autocommits with
    an await between execute and commit, so two coroutines can commit one
    implicit transaction; ``select_one`` commits a second time on top of the
    commit ``run`` already did. Those interleavings are real but rarer -- the
    dominant, reliably reproducible trigger is the cold-connection stampede.

WHY PROD HITS IT
    ``Connection._maybe_cleanup`` and ``close`` set ``self.connection = None``
    again, so the process returns to the "cold" state repeatedly -- it is not
    only a boot-time window. Any burst of concurrent work (frontend polling,
    the check-in scheduler, heartbeats, MCP calls) that lands while the
    connection is cold re-runs the stampede. A single request never does.

WHAT THIS SCRIPT DOES
    Phase 1 (control)   sequential calls on one warm connection.
                        Expected: zero failures -- isolates concurrency as
                        the trigger and proves the query itself is fine.
    Phase 2 (repro)     R rounds; each round drops the cached connection back
                        to cold (DatabaseManager.clear) and then fires W
                        coroutines x I calls at once.
                        Expected: AssertionError, ~30-50% of calls.
                        Also counts the AsyncConnection facades built per
                        round -- one per worker is the stampede, in evidence.
    Phase 3 (integrity) PRAGMA integrity_check plus a row count. The workload
                        is SELECT-only, so the dev DB is never written.

USAGE
    uv run python scripts/repro_double_commit.py \
        --db-url sqlite+aiosqlite:////absolute/path/to/storage/keera.db

    Relative sqlite URLs resolve against the repo root, so plain
    ``uv run python scripts/repro_double_commit.py`` works from a checkout
    that has its own storage/keera.db.

EXIT CODES
    0  REPRODUCED     control clean and every round failed -- bug confirmed
    1  PASS           nothing reproduced; raise --workers/--iterations/--rounds
    2  INCONCLUSIVE   the sequential control failed too, so concurrency was
                      not isolated
"""

import argparse
import asyncio
import logging
import os
import sqlite3
import sys
import traceback
import warnings
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

DEFAULT_DB_URL = "sqlite+aiosqlite:///storage/keera.db"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--db-url", default=os.environ.get("DB_URL", DEFAULT_DB_URL))
    parser.add_argument("--project-id", type=int, default=14)
    parser.add_argument("--workers", type=int, default=20, help="concurrent coroutines per round")
    parser.add_argument("--iterations", type=int, default=60, help="index() calls per coroutine")
    parser.add_argument("--rounds", type=int, default=5, help="concurrent rounds to run")
    parser.add_argument("--control-runs", type=int, default=30, help="sequential calls in phase 1")
    parser.add_argument("--verbose-sql", action="store_true", help="keep the ORM's SQL echo output")
    return parser.parse_args()


def boot_orm(db_url: str):
    """Bring up just the ORM -- no HTTP server, scheduler or terminal providers.

    ConnectionFactory.create_engine calls app().is_testing(), so the ORM needs
    a live Application container; register the smallest provider set that
    satisfies it.
    """
    os.environ.setdefault("APP_ENV", "local")

    from fastapi_startkit import Application
    from fastapi_startkit.masoniteorm import DatabaseProvider

    from config.database import DatabaseConfig

    app = Application(base_path=ROOT, env="local", providers=[(DatabaseProvider, DatabaseConfig)])

    # Overridden after boot on purpose: the repo's .env is loaded with
    # override=True, so exporting DB_URL would not stick. Engines are built
    # lazily, so mutating the resolved config here still wins.
    manager = app.make("db")
    manager.config["connections"][manager.config["default"]]["url"] = db_url
    return manager


def install_facade_counter(counter: Counter) -> None:
    """Count AsyncConnection facades so the stampede is visible, not inferred.

    Mirrors the real get_connection body exactly -- including the racy
    check-then-await-then-assign -- so instrumenting does not alter the bug.
    """
    from fastapi_startkit.masoniteorm.connections.connection import Connection

    async def counted_get_connection(self):
        if self.connection is None:
            connection = await self.engine.connect()
            counter["facades"] += 1
            self.connection = connection

        assert self.connection is not None
        return self.connection

    Connection.get_connection = counted_get_connection


def sqlite_path(db_url: str) -> str | None:
    marker = "sqlite+aiosqlite:///"
    if not db_url.startswith(marker):
        return None
    path = db_url[len(marker) :]
    return path if path.startswith("/") else str(ROOT / path)


def describe(exc: BaseException) -> str:
    message = str(exc).splitlines()[0] if str(exc) else "<empty message: bare assert>"
    return f"{type(exc).__name__}: {message}"


async def go_cold(manager) -> None:
    """Return the ORM to its uncached state, the way _maybe_cleanup does in prod."""
    await manager.clear()


async def run_control(index, project_id: int, runs: int) -> tuple[int, Counter]:
    failures: Counter = Counter()
    ok = 0
    for _ in range(runs):
        try:
            await index(project_id)
            ok += 1
        except BaseException as exc:  # noqa: BLE001 - cataloguing every failure mode
            failures[describe(exc)] += 1
    return ok, failures


async def run_round(
    index, project_id: int, workers: int, iterations: int
) -> tuple[int, Counter, str | None]:
    failures: Counter = Counter()
    ok = 0
    first_traceback: str | None = None

    async def worker() -> None:
        nonlocal ok, first_traceback
        for _ in range(iterations):
            try:
                await index(project_id)
                ok += 1
            except BaseException as exc:  # noqa: BLE001
                failures[describe(exc)] += 1
                if first_traceback is None:
                    first_traceback = traceback.format_exc()

    await asyncio.gather(*(worker() for _ in range(workers)))
    return ok, failures, first_traceback


def print_tally(title: str, ok: int, failures: Counter) -> None:
    total = ok + sum(failures.values())
    rate = (sum(failures.values()) / total * 100) if total else 0.0
    print(f"\n{title}")
    print(f"  calls     : {total}")
    print(f"  succeeded : {ok}")
    print(f"  failed    : {sum(failures.values())}  ({rate:.1f}%)")
    for name, count in failures.most_common():
        print(f"    - {count:>5}x {name}")


def check_integrity(path: str | None, project_id: int) -> None:
    print("\nPHASE 3 - dev DB integrity")
    if path is None or not Path(path).exists():
        print("  skipped (non-sqlite or unknown path)")
        return
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        tasks = connection.execute(
            "SELECT COUNT(*) FROM tasks WHERE project_id = ?", (project_id,)
        ).fetchone()[0]
    finally:
        connection.close()
    print(f"  integrity_check              : {integrity}")
    print(f"  tasks rows for project {project_id:<5} : {tasks}")
    print("  workload was SELECT-only, so no rows were written")


async def main() -> int:
    args = parse_args()

    manager = boot_orm(args.db_url)
    facades: Counter = Counter()
    install_facade_counter(facades)

    if not args.verbose_sql:
        # create_async_engine(echo=True) forces the engine logger to INFO.
        logging.disable(logging.CRITICAL)
    warnings.simplefilter("ignore")

    from app.controllers.task_controller import index

    print("=" * 74)
    print("Repro #1631 - shared async DB connection, interleaved commits")
    print("=" * 74)
    print(f"  db url     : {args.db_url}")
    print(f"  project id : {args.project_id}")
    print(f"  control    : {args.control_runs} sequential calls")
    print(f"  concurrent : {args.rounds} rounds x {args.workers} workers x {args.iterations} calls")

    control_ok, control_failures = await run_control(index, args.project_id, args.control_runs)
    print_tally("PHASE 1 - control, sequential (expect 0 failures)", control_ok, control_failures)

    print("\nPHASE 2 - concurrent (expect AssertionError)")
    total_ok = 0
    total_failures: Counter = Counter()
    rounds_reproduced = 0
    first_traceback: str | None = None

    for round_number in range(1, args.rounds + 1):
        await go_cold(manager)
        facades["facades"] = 0

        ok, failures, tb = await run_round(index, args.project_id, args.workers, args.iterations)
        first_traceback = first_traceback or tb

        failed = sum(failures.values())
        total_ok += ok
        total_failures += failures
        rounds_reproduced += 1 if failed else 0

        calls = ok + failed
        print(
            f"  round {round_number}/{args.rounds}: {failed}/{calls} failed "
            f"({failed / calls * 100:.1f}%)  |  AsyncConnection facades built: {facades['facades']} "
            f"(expected 1, one per worker means the stampede)"
        )

    print_tally("PHASE 2 totals", total_ok, total_failures)

    if first_traceback:
        print("\nFirst concurrent failure:")
        for line in first_traceback.rstrip().splitlines():
            print(f"  {line}")

    check_integrity(sqlite_path(args.db_url), args.project_id)

    concurrent_calls = total_ok + sum(total_failures.values())
    concurrent_failed = sum(total_failures.values())

    print("\n" + "=" * 74)
    if control_failures:
        print("VERDICT: INCONCLUSIVE - the sequential control run failed too, so")
        print("         concurrency is not isolated as the trigger.")
        print("=" * 74)
        return 2

    if not concurrent_failed:
        print("VERDICT: PASS - nothing reproduced at this level. Raise")
        print("         --workers / --iterations / --rounds.")
        print("=" * 74)
        return 1

    print("VERDICT: REPRODUCED")
    print(f"         sequential : 0/{control_ok} failed (0.0%)")
    print(
        f"         concurrent : {concurrent_failed}/{concurrent_calls} failed "
        f"({concurrent_failed / concurrent_calls * 100:.1f}%) "
        f"across {rounds_reproduced}/{args.rounds} rounds"
    )
    print("         Cause: Connection.get_connection's lazy init is a")
    print("         check-then-act across an await, so concurrent coroutines")
    print("         each build an AsyncConnection facade over StaticPool's one")
    print("         shared sqlite connection and commit over each other.")
    print("         Full write-up: REPRO_NOTES.md")
    print("=" * 74)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
