from fastapi_startkit.fastapi import Router

from app.controllers import home_controller
from app.controllers import terminal_controller
from app.controllers import project_controller
from app.controllers import task_controller
from app.controllers import workspace_controller
from app.controllers import claude_hook_controller

router = Router()

# API endpoints — must be registered before the /{project} wildcard
router.get("/api/workspaces", workspace_controller.index)
router.post("/api/workspaces", workspace_controller.store)
router.patch("/api/workspaces/{workspace_id}", workspace_controller.update)
router.delete("/api/workspaces/{workspace_id}", workspace_controller.destroy)

router.get("/api/projects", project_controller.index)
router.get("/api/validate-path", project_controller.validate_path)
router.post("/api/projects", project_controller.store)
router.get("/api/projects/{project_id}/tasks", task_controller.index)
router.post("/api/projects/{project_id}/tasks", task_controller.store)
router.patch("/api/tasks/{task_id}", task_controller.update)
router.delete("/api/tasks/{task_id}", task_controller.destroy)

router.post("/api/claude-stopped", claude_hook_controller.claude_stopped)

# Wildcard page routes — must come last
router.get("/", home_controller.home)
router.get("/{project}", home_controller.home)

router.router.add_api_websocket_route("/{project}/ws", terminal_controller.terminal_ws)
