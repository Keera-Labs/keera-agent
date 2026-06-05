from fastapi_startkit.fastapi import Router

from app.controllers import home_controller
from app.controllers import tasks_page_controller
from app.controllers import terminal_controller
from app.controllers import project_controller
from app.controllers import task_controller
from app.controllers import workspace_controller
from app.controllers import claude_hook_controller
from app.controllers import command_controller
from app.controllers import agent_message_controller
from app.controllers import permission_controller
from app.controllers import agent_controller
from app.controllers import agent_relay_controller
from app.controllers import agent_trigger_controller
from app.controllers import agent_template_controller
from app.controllers import poc_controller
from app.mcp import controller as mcp_controller

router = Router()

# API endpoints — must be registered before the /{project} wildcard
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
router.get("/api/projects/{project_id}/tasks", task_controller.index)
router.post("/api/projects/{project_id}/tasks", task_controller.store)
router.patch("/api/tasks/{task_id}", task_controller.update)
router.delete("/api/tasks/{task_id}", task_controller.destroy)

router.get("/api/projects/{project_id}/commands", command_controller.index)
router.post("/api/projects/{project_id}/commands", command_controller.store)
router.post("/api/commands/{command_id}/run", command_controller.run)
router.post("/api/commands/{command_id}/stop", command_controller.stop)
router.get("/api/commands/{command_id}/output", command_controller.output)
router.get("/api/commands/{command_id}/runs", command_controller.runs)
router.patch("/api/commands/{command_id}", command_controller.update)
router.delete("/api/commands/{command_id}", command_controller.destroy)

router.post("/api/claude-started", claude_hook_controller.claude_started)
router.post("/api/claude-stopped", claude_hook_controller.claude_stopped)

router.get("/api/projects/{project_id}/messages", agent_message_controller.index)
router.patch("/api/messages/{message_id}/read", agent_message_controller.mark_read)

router.get("/api/projects/{project_id}/agents", agent_controller.index)
router.post("/api/projects/{project_id}/agents", agent_controller.store)
router.post("/api/projects/{project_id}/agents/spawn", agent_controller.spawn)
router.get("/api/projects/{project_id}/default-agent", agent_controller.get_default)
router.post("/api/projects/{project_id}/default-agent", agent_controller.set_default)
router.patch("/api/agents/{agent_id}", agent_controller.update)
router.delete("/api/agents/{agent_id}", agent_controller.destroy)
router.get("/api/agents/{agent_id}/output", agent_controller.output)

# Agent templates
router.get("/api/agent-templates", agent_template_controller.index)
router.post("/api/agent-templates", agent_template_controller.store)
router.patch("/api/agent-templates/{template_id}", agent_template_controller.update)
router.delete("/api/agent-templates/{template_id}", agent_template_controller.destroy)

# Agent-to-agent relay
router.post("/api/agent-relay", agent_relay_controller.relay)
router.get("/api/agents/{agent_id}/relay-messages", agent_relay_controller.get_messages)

# Backend-triggered agent start
router.post("/api/agents/{agent_id}/trigger", agent_trigger_controller.trigger)

router.get("/api/projects/{project_id}/permissions", permission_controller.get_project_permissions)
router.patch("/api/projects/{project_id}/permissions", permission_controller.update_project_permissions)
router.get("/api/agents/{agent_id}/permissions", permission_controller.get_agent_permissions)
router.patch("/api/agents/{agent_id}/permissions", permission_controller.update_agent_permissions)
router.get("/api/default-permissions", permission_controller.get_default_permissions)
router.patch("/api/default-permissions", permission_controller.update_default_permissions)

# MCP — JSON-RPC 2.0 endpoint (same server, no extra process)
router.post("/mcp", mcp_controller.handle)
router.get("/mcp", mcp_controller.handle_get)

# POC route — before wildcard
router.get("/poc", poc_controller.poc_page)
router.router.add_api_websocket_route("/poc/ws", poc_controller.poc_ws)

# Wildcard page routes — must come last
router.get("/", home_controller.home)
router.get("/{project}/tasks", tasks_page_controller.tasks_page)
router.get("/{project}/agents/{agent_id}", home_controller.agent_page)
router.get("/{project}", home_controller.project_home)

router.router.add_api_websocket_route("/{project}/ws", terminal_controller.terminal_ws)
router.router.add_api_websocket_route("/{project}/command-ws/{command_id}", command_controller.command_ws)
