#!/usr/bin/env python3
"""Reproduce the prod 500 on GET /api/projects/{id}/tasks (task #1631).

Repro only -- this script deliberately does not fix anything.

RUN IT (from the repo root, against the dev DB in your .env)

    uv run python -m scripts.repro_double_commit

SYMPTOM
    A bare sqlalchemy AssertionError from ``Transaction.commit``'s
    ``assert not self.is_active``, reached through:

        app/controllers/task_controller.py::index
          -> builder.paginate -> count -> aggregate
            -> Connection.select_one -> await conn.commit()

    Everything below ``paginate`` is the ORM, so this script drives the same
    ``Task...paginate()`` the endpoint runs rather than importing the
    controller. The controller is not implicated; it is one caller of many.

ROOT CAUSE
    ``Connection.get_connection`` caches ONE SQLAlchemy ``AsyncConnection``
    for the whole process, and its lazy init is a check-then-act across an
    await:

        if self.connection is None:                       # N coroutines see None
            self.connection = await self.engine.connect() # all of them await
        return self.connection                            # last write wins

    For sqlite the engine uses ``StaticPool``, which hands the SAME underlying
    DBAPI connection to every checkout -- so N concurrent requests end up with
    N independent SQLAlchemy transaction state machines driving one sqlite
    connection. They BEGIN/COMMIT over each other, and orphaned facades reset
    the shared connection out from under the live one when garbage collected.
    The loser fails ``assert connection._transaction is self`` inside
    ``_deactivate_from_connection``; that leaves the transaction active, so the
    ``finally: assert not self.is_active`` in ``Transaction.commit`` is what
    surfaces, masking the real cause.

    One request at a time never hits this. That is why it only shows up in the
    dist/ build, where real traffic overlaps with the background loops.

WHY EACH ROUND RESETS THE CONNECTION
    The failure only reproduces from a COLD connection -- once it is warm,
    even 100 concurrent workers stay clean. Production keeps returning to that
    cold state because ``Connection._maybe_cleanup`` and ``close`` both reset
    ``self.connection = None``, so any burst of concurrent work that lands
    while it is cold re-runs the stampede. Each round below reproduces that by
    dropping the cached connection first.

EXPECTED OUTPUT
    Sequential run clean, every concurrent round failing ~15-50% of its calls
    (the rate swings between runs; what is stable is that no round is clean).
    The workload is SELECT-only, so the dev DB is never written.

Full write-up and measured numbers: REPRO_NOTES.md
"""

import asyncio
import logging
import traceback
import warnings

from app.models.Task import Task
from bootstrap.application import app

PROJECT_ID = 14
SEQUENTIAL_CALLS = 30
WORKERS = 20
CALLS_PER_WORKER = 60
ROUNDS = 3


async def list_tasks():
    """The query shape the endpoint runs: paginate() = a COUNT plus a SELECT.

    Deliberately not calling task_controller.index -- the bug is in the ORM's
    connection layer, so the repro should not depend on controller code that
    may change around it. Any paginate() over any table reproduces this.
    """
    return await Task.where("project_id", PROJECT_ID).paginate()


async def hammer(workers: int, calls: int) -> tuple[int, str | None]:
    """Run the query from `workers` coroutines at once, counting failures."""
    failures = 0
    first_error: str | None = None

    async def worker() -> None:
        nonlocal failures, first_error
        for _ in range(calls):
            try:
                await list_tasks()
            except BaseException:  # noqa: BLE001 - any failure counts
                failures += 1
                if first_error is None:
                    first_error = traceback.format_exc()

    await asyncio.gather(*(worker() for _ in range(workers)))
    return failures, first_error


async def main() -> int:
    # The ORM builds its engine with echo=True, which would drown the report.
    logging.disable(logging.CRITICAL)
    warnings.simplefilter("ignore")

    print(f"Repro #1631 - tasks paginate, project {PROJECT_ID}\n")

    sequential_failures, _ = await hammer(1, SEQUENTIAL_CALLS)
    print(f"sequential : {sequential_failures}/{SEQUENTIAL_CALLS} failed  (expected 0)")

    calls = WORKERS * CALLS_PER_WORKER
    total_failures = 0
    first_error = None

    print(f"concurrent : {ROUNDS} rounds x {WORKERS} workers x {CALLS_PER_WORKER} calls")
    for round_number in range(1, ROUNDS + 1):
        # Back to the cold state prod keeps returning to -- see the docstring.
        await app.make("db").clear()

        failures, error = await hammer(WORKERS, CALLS_PER_WORKER)
        first_error = first_error or error
        total_failures += failures
        print(f"  round {round_number}: {failures}/{calls} failed ({failures / calls * 100:.1f}%)")

    if first_error:
        print(f"\nFirst failure:\n{first_error}")

    total_calls = ROUNDS * calls
    if sequential_failures:
        print("INCONCLUSIVE: the sequential run failed too, concurrency is not isolated.")
        return 1

    if not total_failures:
        print("PASS: nothing reproduced. Raise WORKERS / CALLS_PER_WORKER / ROUNDS.")
        return 1

    print(
        f"REPRODUCED: sequential 0/{SEQUENTIAL_CALLS}, "
        f"concurrent {total_failures}/{total_calls} "
        f"({total_failures / total_calls * 100:.1f}%)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
