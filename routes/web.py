from fastapi_startkit.fastapi import Router

from app.controllers import (
    agent_controller,
    agent_dispatch_controller,
    agent_message_controller,
    agent_permission_controller,
    agent_relay_controller,
    agent_template_controller,
    agent_trigger_controller,
    ai_controller,
    broadcasting_controller,
    claude_hook_controller,
    command_controller,
    dashboard_controller,
    default_permission_controller,
    global_settings_controller,
    heartbeat_controller,
    home_controller,
    plugin_controller,
    settings_controller,
    task_controller,
    tasks_page_controller,
    terminal_controller,
)
from app.mcp.server import KeeraServer

router = Router()

mcp_server = KeeraServer()
router.router.include_router(mcp_server.router(prefix="/mcp"))


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
router.post("/api/projects/{project_id}/agents/spawn", agent_dispatch_controller.spawn)
router.get("/api/projects/{project_id}/default-agent", agent_controller.get_default)
router.post("/api/projects/{project_id}/default-agent", agent_controller.set_default)
router.patch("/api/agents/{agent_id}", agent_controller.update)
router.delete("/api/agents/{agent_id}", agent_controller.destroy)
router.get("/api/agents/{agent_id}/output", agent_controller.output)
router.post("/api/agents/{agent_id}/adopt-work", agent_dispatch_controller.adopt_work)

# Agent templates — GLOBAL (project_id NULL)
router.get("/api/agent-templates", agent_template_controller.index)
router.post("/api/agent-templates", agent_template_controller.store)
router.post("/api/agent-templates/sync-defaults", agent_template_controller.sync_defaults)
router.patch("/api/agent-templates/{template_id}", agent_template_controller.update)
router.delete("/api/agent-templates/{template_id}", agent_template_controller.destroy)

# Agent templates — PROJECT-scoped (effective list + copy-on-write overrides)
router.get("/api/projects/{project_id}/agent-templates", agent_template_controller.project_index)
router.post("/api/projects/{project_id}/agent-templates", agent_template_controller.project_store)
router.post(
    "/api/projects/{project_id}/agent-templates/reset", agent_template_controller.project_reset
)
router.patch(
    "/api/projects/{project_id}/agent-templates/{template_id}",
    agent_template_controller.project_update,
)
router.delete(
    "/api/projects/{project_id}/agent-templates/{template_id}",
    agent_template_controller.project_destroy,
)

# Agent-to-agent relay
router.post("/api/agent-relay", agent_relay_controller.relay)
router.get("/api/agents/{agent_id}/relay-messages", agent_relay_controller.get_messages)

# Backend-triggered agent start
router.post("/api/agents/{agent_id}/trigger", agent_trigger_controller.trigger)

router.get("/api/agents/{agent_id}/permissions", agent_permission_controller.show)
router.patch("/api/agents/{agent_id}/permissions", agent_permission_controller.update)
router.get("/api/default-permissions", default_permission_controller.show)
router.patch("/api/default-permissions", default_permission_controller.update)

# Global app settings
router.get("/api/global-settings", global_settings_controller.get_global_settings)
router.patch("/api/global-settings", global_settings_controller.update_global_settings)

# Plugin system — list discovered plugins and toggle activation (before wildcard)
router.get("/api/plugins", plugin_controller.index)
router.post("/api/plugins/{slug}/activate", plugin_controller.activate)
router.post("/api/plugins/{slug}/deactivate", plugin_controller.deactivate)
router.post("/api/plugins/{slug}/uninstall", plugin_controller.uninstall)

# Heartbeat management — before wildcard
router.get("/api/heartbeat/status", heartbeat_controller.status)
router.post("/api/heartbeat/start", heartbeat_controller.start)
router.post("/api/heartbeat/stop", heartbeat_controller.stop)

# Settings page — before wildcard
router.get("/settings", settings_controller.settings)

# AI chat route — before wildcard
router.post("/api/ai/chat", ai_controller.chat)

# Broadcasting page and API — before wildcard
router.get("/broadcasting", broadcasting_controller.broadcasting_page)
router.post("/api/broadcasting/ping", broadcasting_controller.ping)

# Wildcard page routes — must come last
router.get("/", dashboard_controller.page)
router.get("/{project}/tasks", tasks_page_controller.tasks_page)
router.get("/{project}/agents/{agent_id}", home_controller.agent_page)
router.get("/{project}", home_controller.project_home)

router.router.add_api_websocket_route("/{project}/ws", terminal_controller.terminal_ws)
router.router.add_api_websocket_route(
    "/{project}/command-ws/{command_id}", command_controller.command_ws
)
