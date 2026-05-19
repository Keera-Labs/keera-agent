from fastapi_startkit.fastapi import Router

from app.controllers import home_controller
from app.controllers import terminal_controller
from app.controllers import project_controller

router = Router()

router.get("/api/projects", project_controller.index)
router.get("/api/validate-path", project_controller.validate_path)
router.post("/api/projects", project_controller.store)
router.get("/", home_controller.index)
router.get("/{project}", home_controller.project)
router.router.add_api_websocket_route("/{project}/ws", terminal_controller.terminal_ws)
