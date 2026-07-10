from fastapi_startkit.fastapi import Router

from app.controllers import project_controller, workspace_controller

router = Router()

router.get("/api/workspaces", workspace_controller.index)
router.post("/api/workspaces", workspace_controller.store)
router.patch("/api/workspaces/{workspace_id}", workspace_controller.update)
router.delete("/api/workspaces/{workspace_id}", workspace_controller.destroy)

router.get("/api/projects", project_controller.index)
router.get("/api/validate-path", project_controller.validate_path)
router.post("/api/projects", project_controller.store)
router.patch("/api/projects/{project_id}", project_controller.update)
router.delete("/api/projects/{project_id}", project_controller.destroy)
router.post("/api/projects/{project_id}/upload-image", project_controller.upload_image)
router.post("/api/projects/{project_id}/open-directory", project_controller.open_directory)
