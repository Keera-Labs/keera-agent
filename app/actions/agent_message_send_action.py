import asyncio
import os

from app.actions.relay_delivery import claim_relay_message, relay_text
from app.actions.terminal_write_action import TerminalWriteAction
from app.models.Agent import Agent
from app.models.AgentRelayMessage import AgentRelayMessage
from app.terminal.readiness import is_cli_ready


class AgentMessageSendAction:
    def __init__(self, from_agent: Agent, to_agent: Agent, content: str):
        self.from_agent = from_agent
        self.to_agent = to_agent
        self.content = content

    @staticmethod
    def prepare(from_agent: Agent, to_agent: Agent, content: str) -> "AgentMessageSendAction":
        return AgentMessageSendAction(from_agent, to_agent, content)

    async def execute(self) -> tuple[int, bool]:
        """Create a relay message, inject immediately if receiver is connected,
        or spawn headlessly if idle. Returns (message_id, delivered)."""
        from app.models.Project import Project

        msg = await AgentRelayMessage.create(
            {
                "from_agent_id": self.from_agent.id,
                "to_agent_id": self.to_agent.id,
                "content": self.content,
                "status": "pending",
            }
        )

        text = relay_text(self.from_agent.name, self.content)
        terminal = TerminalWriteAction.prepare(self.to_agent.session_id, text).resolve_terminal()

        if terminal:
            if not is_cli_ready(self.to_agent.session_id):
                # Still booting: leave it pending; the spawn path flushes it once ready.
                return msg.id, False
            # A flush that started meanwhile may already have delivered it.
            if await claim_relay_message(msg.id):
                await terminal.send(text)
            return msg.id, True

        # Receivers idle — spawn headlessly with the message as its initial task
        project = await Project.find(self.to_agent.project_id)
        if project:
            from app.controllers.agent_trigger_controller import _spawn_headless_agent

            cwd = os.path.expanduser(project.path)
            asyncio.create_task(_spawn_headless_agent(self.to_agent, project, cwd, text))
            await AgentRelayMessage.where("id", msg.id).update({"status": "delivered"})
            return msg.id, True

        return msg.id, False
