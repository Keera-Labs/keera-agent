from fastapi_startkit.fastapi import Router

from app.controllers import home_controller
from app.controllers import terminal_controller
from app.controllers import project_controller
from app.controllers import task_controller
from app.controllers import workspace_controller

router = Router()

router.get("/", home_controller.home)
router.get("/{project}", home_controller.home)

# Workspace API endpoints
router.get("/api/workspaces", workspace_controller.index)
router.post("/api/workspaces", workspace_controller.store)
router.router.add_api_route("/api/workspaces/{workspace_id}", workspace_controller.update, methods=["PATCH"])
router.router.add_api_route("/api/workspaces/{workspace_id}", workspace_controller.destroy, methods=["DELETE"])

# Project API endpoints
router.get("/api/projects", project_controller.index)
router.get("/api/validate-path", project_controller.validate_path)
router.post("/api/projects", project_controller.store)
router.get("/api/projects/{project_id}/tasks", task_controller.index)
router.post("/api/projects/{project_id}/tasks", task_controller.store)
router.router.add_api_route("/api/tasks/{task_id}", task_controller.update, methods=["PATCH"])
router.router.add_api_route("/api/tasks/{task_id}", task_controller.destroy, methods=["DELETE"])

router.router.add_api_websocket_route("/{project}/ws", terminal_controller.terminal_ws)
