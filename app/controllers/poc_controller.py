from fastapi import Request, WebSocket
from fastapi_startkit.application import app
from fastapi_startkit.inertia.inertia import Inertia

from app.terminal.manager import TerminalManager
from app.terminal.websocket_terminal import WebsocketTerminal


async def poc_page(request: Request):
    return Inertia.render("Poc", {})

async def poc_ws(websocket: WebSocket):
    await websocket.accept()
    terminal_manager: TerminalManager = app().make('terminal')

    session_id = terminal_manager.create()
    terminal = terminal_manager.get(session_id)
    try:
        bridge = WebsocketTerminal(websocket, terminal)
        await bridge.run(auto_send=b'claude\n')
    finally:
        terminal_manager.close(session_id)
