from fastapi import Request
from fastapi.responses import JSONResponse

from app import heartbeat


async def status(request: Request):
    return JSONResponse({"running": heartbeat.is_running()})


async def start(request: Request):
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass
    interval = int(body.get("interval_seconds", 300))
    heartbeat.start(interval_seconds=interval)
    return JSONResponse({"running": True, "interval_seconds": interval})


async def stop(request: Request):
    stopped = heartbeat.stop()
    return JSONResponse({"running": False, "stopped": stopped})
