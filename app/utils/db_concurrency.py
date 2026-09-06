"""Serialize ORM queries on fastapi-startkit's shared async DB connection.

The masoniteorm integration caches ONE Connection per database and ONE
SQLAlchemy AsyncConnection inside it, shared by every coroutine: HTTP
handlers, the PM check-in scheduler loop, the heartbeat task, MCP calls.
Each query autocommits (execute + commit) with await points in between, so
two concurrent coroutines interleave on the same transaction: one commits
and deactivates it while the other is still committing, tripping
SQLAlchemy's internal asserts and 500ing requests (#1370).

Until the ORM checks out a connection per coroutine, make each query unit
atomic with a re-entrant per-connection lock (re-entrant because e.g.
``select_one`` calls ``run`` internally on the same asyncio task).
"""

import asyncio
import functools

from fastapi_startkit.masoniteorm.connections.connection import Connection

GUARDED_METHODS = (
    "run",
    "execute",
    "statement",
    "select",
    "select_one",
    "insert",
    "insert_get_id",
    "update",
    "delete",
    "begin_transaction",
    "commit_transaction",
    "rollback",
    "close",
)


class ReentrantAsyncLock:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._owner: asyncio.Task | None = None
        self._depth = 0

    async def __aenter__(self) -> "ReentrantAsyncLock":
        task = asyncio.current_task()
        if self._owner is not task:
            await self._lock.acquire()
            self._owner = task
        self._depth += 1
        return self

    async def __aexit__(self, *exc) -> None:
        self._depth -= 1
        if self._depth == 0:
            self._owner = None
            self._lock.release()


def _lock_for(connection: Connection) -> ReentrantAsyncLock:
    # asyncio primitives bind to one event loop; tests create a loop per test
    # while the Connection singleton survives, so key the lock by loop.
    loop = asyncio.get_running_loop()
    stored = getattr(connection, "_query_lock", None)
    if stored is None or stored[0] is not loop:
        stored = (loop, ReentrantAsyncLock())
        connection._query_lock = stored
    return stored[1]


def _guarded(method):
    @functools.wraps(method)
    async def wrapper(self, *args, **kwargs):
        async with _lock_for(self):
            return await method(self, *args, **kwargs)

    return wrapper


def serialize_connection_queries() -> None:
    if getattr(Connection, "_queries_serialized", False):
        return
    for name in GUARDED_METHODS:
        setattr(Connection, name, _guarded(getattr(Connection, name)))
    Connection._queries_serialized = True
