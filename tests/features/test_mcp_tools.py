"""Feature tests for MCP task and agent tools.

Exercises CreateTaskTool, ListTasksTool, UpdateTaskTool, UpdateTaskStatusTool,
DeleteTaskTool, and SendMessageTool against a real test database to catch
schema-drift bugs (e.g. writing a dropped column).
"""
import json

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.models.Task import Task
from app.mcp.tools import (
    CreateTaskTool,
    ListTasksTool,
    GetTaskTool,
    UpdateTaskTool,
    UpdateTaskStatusTool,
    DeleteTaskTool,
    SendMessageTool,
    KEERA_TOOLS,
)
from databases.factories.project_factory import ProjectFactory
from databases.factories.task_factory import TaskFactory
from tests.test_case import TestCase


def _text(response) -> str:
    """Extract the text from an MCP Response."""
    content = response.to_content()
    return content[0]["text"] if content else ""


class TestCreateTaskTool(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()
        self.tool = CreateTaskTool()

    async def _create(self, **kwargs) -> str:
        base = {
            "project_path": self.project.path,
            "title": "Implement feature X",
            "acceptance_criteria": ["Works end-to-end"],
            "testing_methods": ["Unit test"],
            "validation_steps": ["QA smoke test"],
        }
        base.update(kwargs)
        response = await self.tool.handle(base)
        return _text(response)

    async def test_creates_task_without_description_column_error(self):
        """Core regression: create_task must not try to INSERT description."""
        text = await self._create()
        self.assertIn("Task #", text)
        self.assertIn("Implement feature X", text)

    async def test_body_is_stored_correctly(self):
        text = await self._create(body="Detailed body text here.")
        # Extract task ID from response
        task_id = int(text.split("Task #")[1].split(" ")[0].rstrip(":"))
        task = await Task.find(task_id)
        self.assertIsNotNone(task)
        self.assertEqual(task.body, "Detailed body text here.")
        # No description column — just body
        self.assertFalse(hasattr(task, "description") and task.description is not None,
                         "description column must not be populated")

    async def test_body_defaults_to_none_when_omitted(self):
        text = await self._create()
        task_id = int(text.split("Task #")[1].split(" ")[0].rstrip(":"))
        task = await Task.find(task_id)
        self.assertIsNone(task.body)

    async def test_acceptance_criteria_appear_in_response(self):
        text = await self._create(acceptance_criteria=["Criterion one", "Criterion two"])
        self.assertIn("Criterion one", text)
        self.assertIn("Criterion two", text)

    async def test_priority_stored(self):
        text = await self._create(priority="high")
        task_id = int(text.split("Task #")[1].split(" ")[0].rstrip(":"))
        task = await Task.find(task_id)
        self.assertEqual(task.priority, "high")

    async def test_unknown_project_path_returns_error(self):
        response = await self.tool.handle({
            "project_path": "/nonexistent/path/xyz",
            "title": "Won't work",
            "acceptance_criteria": ["x"],
            "testing_methods": ["x"],
            "validation_steps": ["x"],
        })
        self.assertIn("Error", _text(response))

    async def test_status_defaults_to_pending(self):
        text = await self._create()
        task_id = int(text.split("Task #")[1].split(" ")[0].rstrip(":"))
        task = await Task.find(task_id)
        self.assertEqual(task.status, "pending")


class TestListTasksTool(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()
        self.tool = ListTasksTool()

    async def test_lists_tasks_without_description_error(self):
        """list_tasks must not crash accessing a non-existent .description attr."""
        await TaskFactory.new().create(project_id=self.project.id, title="Task Alpha")
        response = await self.tool.handle({"project_path": self.project.path})
        text = _text(response)
        self.assertIn("Task Alpha", text)

    async def test_filter_by_status(self):
        await TaskFactory.new().create(project_id=self.project.id, title="Pending one", status="pending")
        await TaskFactory.new().create(project_id=self.project.id, title="Done one", status="completed")

        response = await self.tool.handle({
            "project_path": self.project.path,
            "status": "pending",
        })
        text = _text(response)
        self.assertIn("Pending one", text)
        self.assertNotIn("Done one", text)

    async def test_no_tasks_returns_message(self):
        response = await self.tool.handle({"project_path": self.project.path})
        self.assertIn("No tasks found", _text(response))


class TestGetTaskTool(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()
        self.tool = GetTaskTool()

    async def test_get_task_returns_body_label(self):
        task = await TaskFactory.new().create(
            project_id=self.project.id,
            title="My Task",
            body="This is the body.",
        )
        response = await self.tool.handle({"task_id": task.id})
        text = _text(response)
        self.assertIn("My Task", text)
        self.assertIn("Body:", text)
        self.assertIn("This is the body.", text)
        # Must not reference old "Description:" label for the body field
        self.assertNotIn("Description:", text)

    async def test_get_task_not_found(self):
        response = await self.tool.handle({"task_id": 999999})
        self.assertIn("Error", _text(response))


class TestUpdateTaskTool(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()
        self.tool = UpdateTaskTool()

    async def test_update_body_without_description_column_error(self):
        """update_task must not try to SET description on a row."""
        task = await TaskFactory.new().create(project_id=self.project.id, title="Old title")
        response = await self.tool.handle({
            "task_id": task.id,
            "body": "Updated body content.",
        })
        text = _text(response)
        self.assertNotIn("Error", text)
        updated = await Task.find(task.id)
        self.assertEqual(updated.body, "Updated body content.")

    async def test_update_title(self):
        task = await TaskFactory.new().create(project_id=self.project.id, title="Original")
        await self.tool.handle({"task_id": task.id, "title": "Revised"})
        updated = await Task.find(task.id)
        self.assertEqual(updated.title, "Revised")

    async def test_update_not_found(self):
        response = await self.tool.handle({"task_id": 999999, "title": "X"})
        self.assertIn("Error", _text(response))


class TestUpdateTaskStatusTool(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()
        self.tool = UpdateTaskStatusTool()

    async def test_update_status_without_description_error(self):
        task = await TaskFactory.new().create(project_id=self.project.id, title="In flight")
        response = await self.tool.handle({
            "task_id": task.id,
            "status": "in_progress",
        })
        text = _text(response)
        self.assertNotIn("Error", text)
        self.assertIn("in_progress", text)

    async def test_update_status_not_found(self):
        response = await self.tool.handle({"task_id": 999999, "status": "completed"})
        self.assertIn("Error", _text(response))


class TestDeleteTaskTool(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()
        self.tool = DeleteTaskTool()

    async def test_delete_task_without_description_error(self):
        task = await TaskFactory.new().create(project_id=self.project.id, title="To be deleted")
        response = await self.tool.handle({"task_id": task.id})
        text = _text(response)
        self.assertNotIn("Error", text)
        self.assertIn("deleted", text.lower())
        self.assertIsNone(await Task.find(task.id))

    async def test_delete_not_found(self):
        response = await self.tool.handle({"task_id": 999999})
        self.assertIn("Error", _text(response))


class TestSendMessageToolValidation(TestCase, DatabaseTransaction):
    """Tests for send_message_to_agent input validation and name-based lookup."""

    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.tool = SendMessageTool()

    async def test_missing_all_params_returns_clear_error(self):
        response = await self.tool.handle({})
        text = _text(response)
        self.assertIn("Error", text)
        self.assertIn("missing required parameter", text)
        # All three required params must be mentioned
        self.assertIn("sender_agent_id", text)
        self.assertIn("receiver_agent_id", text)
        self.assertIn("message", text)

    async def test_missing_receiver_returns_clear_error(self):
        response = await self.tool.handle({
            "sender_agent_id": 1,
            "message": "hello",
        })
        text = _text(response)
        self.assertIn("Error", text)
        self.assertIn("receiver_agent_id", text)

    async def test_missing_sender_returns_clear_error(self):
        response = await self.tool.handle({
            "receiver_agent_id": 1,
            "message": "hello",
        })
        text = _text(response)
        self.assertIn("Error", text)
        self.assertIn("sender_agent_id", text)

    async def test_non_numeric_sender_id_returns_clear_error(self):
        response = await self.tool.handle({
            "sender_agent_id": "not-a-number",
            "receiver_agent_id": 1,
            "message": "hello",
        })
        text = _text(response)
        self.assertIn("Error", text)
        self.assertIn("sender_agent_id", text)

    async def test_unknown_receiver_by_id_returns_error(self):
        from app.models.Agent import Agent
        # We need a valid sender first
        project = await ProjectFactory.new().create()
        sender = await Agent.create({
            "project_id": project.id,
            "name": "Sender",
            "model": "claude-sonnet-4-6",
            "status": "idle",
        })
        response = await self.tool.handle({
            "sender_agent_id": sender.id,
            "receiver_agent_id": 999999,
            "message": "ping",
        })
        text = _text(response)
        self.assertIn("Error", text)
        self.assertIn("999999", text)

    async def test_receiver_by_name_not_found_returns_helpful_error(self):
        from app.models.Agent import Agent
        project = await ProjectFactory.new().create()
        sender = await Agent.create({
            "project_id": project.id,
            "name": "Sender",
            "model": "claude-sonnet-4-6",
            "status": "idle",
        })
        response = await self.tool.handle({
            "sender_agent_id": sender.id,
            "receiver_agent_id": "NonExistentAgent",
            "message": "ping",
        })
        text = _text(response)
        self.assertIn("Error", text)
        self.assertIn("NonExistentAgent", text)
        # Must hint to use list_agents
        self.assertIn("list_agents", text)

    async def test_receiver_by_name_case_insensitive(self):
        """Name lookup must be case-insensitive and find existing agent."""
        from app.models.Agent import Agent
        project = await ProjectFactory.new().create()
        sender = await Agent.create({
            "project_id": project.id,
            "name": "Sender Bot",
            "model": "claude-sonnet-4-6",
            "status": "idle",
        })
        receiver = await Agent.create({
            "project_id": project.id,
            "name": "PM Agent",
            "model": "claude-sonnet-4-6",
            "status": "idle",
        })
        # The action will try to spawn headlessly which won't work in tests,
        # but we can verify the agent was found (no "not found" error)
        response = await self.tool.handle({
            "sender_agent_id": sender.id,
            "receiver_agent_id": "pm agent",  # lowercase
            "message": "Hello from test",
        })
        text = _text(response)
        # Should NOT get "no agent found with name" error
        self.assertNotIn("no agent found with name", text.lower())
        # Should mention the agent's display name
        self.assertIn("PM Agent", text)


class TestSendMessageToDeletedAgent(TestCase, DatabaseTransaction):
    """Guard: send_message_to_agent must reject messages to soft-deleted agents."""

    async def asyncSetUp(self):
        await super().asyncSetUp()
        import datetime
        from app.models.Agent import Agent

        self.tool = SendMessageTool()
        project = await ProjectFactory.new().create()

        self.sender = await Agent.create({
            "project_id": project.id,
            "name": "Sender Agent",
            "model": "claude-sonnet-4-6",
            "status": "idle",
        })

        self.deleted_agent = await Agent.create({
            "project_id": project.id,
            "name": "Deleted Agent",
            "model": "claude-sonnet-4-6",
            "status": "idle",
            "deleted_at": str(datetime.datetime.utcnow()),
        })

    async def test_send_to_deleted_agent_by_id_returns_error(self):
        """Messaging a soft-deleted agent by numeric ID must return a clear error."""
        response = await self.tool.handle({
            "sender_agent_id": self.sender.id,
            "receiver_agent_id": self.deleted_agent.id,
            "message": "Are you there?",
        })
        text = _text(response)
        self.assertIn("Error", text)
        self.assertIn("deleted", text.lower())
        self.assertIn(str(self.deleted_agent.id), text)

    async def test_send_to_deleted_agent_by_name_returns_error(self):
        """Messaging a soft-deleted agent by name must return a clear error (name lookup skips deleted)."""
        response = await self.tool.handle({
            "sender_agent_id": self.sender.id,
            "receiver_agent_id": "Deleted Agent",
            "message": "Hello?",
        })
        text = _text(response)
        self.assertIn("Error", text)
        # Name-based lookup skips deleted agents, so it returns "no agent found"
        self.assertIn("Deleted Agent", text)

    async def test_send_to_active_agent_by_id_is_not_blocked(self):
        """Active (non-deleted) agents must still be reachable by numeric ID."""
        from app.models.Agent import Agent

        project = await ProjectFactory.new().create()
        active_receiver = await Agent.create({
            "project_id": project.id,
            "name": "Active Receiver",
            "model": "claude-sonnet-4-6",
            "status": "idle",
        })
        response = await self.tool.handle({
            "sender_agent_id": self.sender.id,
            "receiver_agent_id": active_receiver.id,
            "message": "Hello active agent!",
        })
        text = _text(response)
        # Must NOT be the deleted-agent error
        self.assertNotIn("is deleted", text.lower())
        # Should mention the receiver's name in a success/queue response
        self.assertIn("Active Receiver", text)


class TestMcpToolNames(TestCase):
    """Verify MCP tool names are consistent — relay_to_agent must NOT be registered."""

    def test_send_message_to_agent_is_registered(self):
        """The real tool name is send_message_to_agent."""
        names = [cls().name for cls in KEERA_TOOLS]
        self.assertIn("send_message_to_agent", names)

    def test_relay_to_agent_is_not_registered(self):
        """relay_to_agent is a stale alias that was never wired — must not exist."""
        names = [cls().name for cls in KEERA_TOOLS]
        self.assertNotIn("relay_to_agent", names)

    def test_system_prompt_fallback_references_correct_tool(self):
        """The PM fallback prompt must reference send_message_to_agent, not relay_to_agent."""
        from app.utils.system_prompts import _SYSTEM_PROMPTS_FALLBACK
        pm_prompt = _SYSTEM_PROMPTS_FALLBACK.get("pm", "")
        self.assertIn("send_message_to_agent", pm_prompt)
        self.assertNotIn("relay_to_agent", pm_prompt)
