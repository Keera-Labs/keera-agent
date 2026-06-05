import asyncio
import os
import pty
import subprocess

from fastapi import Request, WebSocket, WebSocketDisconnect
from fastapi_startkit.inertia.inertia import Inertia


async def poc_page(request: Request):
    return Inertia.render("Poc", {})


async def poc_ws(websocket: WebSocket):
    await websocket.accept()

    shell = os.environ.get('SHELL', '/bin/bash')
    master_fd, slave_fd = pty.openpty()

    proc = subprocess.Popen(
        [shell],
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        close_fds=True,
        cwd=os.path.expanduser('~'),
        env=os.environ.copy(),
    )
    os.close(slave_fd)

    loop = asyncio.get_event_loop()
    stopped = asyncio.Event()

    async def auto_start():
        await asyncio.sleep(0.5)
        os.write(master_fd, b'claude\n')

    async def pty_to_ws():
        queue: asyncio.Queue = asyncio.Queue()

        def on_readable():
            try:
                data = os.read(master_fd, 4096)
                if data:
                    queue.put_nowait(data)
            except OSError:
                pass

        loop.add_reader(master_fd, on_readable)
        try:
            while not stopped.is_set():
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=0.1)
                    await websocket.send_bytes(item)
                except asyncio.TimeoutError:
                    continue
        finally:
            try:
                loop.remove_reader(master_fd)
            except Exception:
                pass

    async def ws_to_pty():
        while not stopped.is_set():
            try:
                msg = await websocket.receive()
                if msg.get('type') == 'websocket.disconnect':
                    break
                if msg.get('bytes'):
                    os.write(master_fd, msg['bytes'])
            except (WebSocketDisconnect, Exception):
                break
        stopped.set()

    async def watch_process():
        await loop.run_in_executor(None, proc.wait)
        stopped.set()

    tasks = [
        asyncio.create_task(pty_to_ws()),
        asyncio.create_task(ws_to_pty()),
        asyncio.create_task(watch_process()),
        asyncio.create_task(auto_start()),
    ]

    try:
        await asyncio.gather(*tasks, return_exceptions=True)
    finally:
        for t in tasks:
            t.cancel()
        try:
            proc.kill()
        except Exception:
            pass
        try:
            os.close(master_fd)
        except Exception:
            pass
