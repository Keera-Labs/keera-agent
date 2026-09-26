from app.actions.terminal_write_action import TerminalWriteAction
from app.models.Agent import Agent
from app.models.AgentRelayMessage import AgentRelayMessage
from app.terminal.readiness import is_cli_ready


def relay_text(sender_name: str, content: str) -> str:
    return f"[Message from Agent '{sender_name}']: {content}"


async def claim_relay_message(msg_id: int) -> bool:
    """Move a message from pending to delivered; exactly one concurrent caller wins it."""
    claimed = (
        await AgentRelayMessage.where("id", msg_id)
        .where("status", "pending")
        .update({"status": "delivered"})
    )
    return claimed > 0


async def deliver_pending_relay_messages(agent_id: int) -> int:
    """Send an agent's queued relay messages into its CLI once it is ready.

    Returns how many messages this call delivered. Messages stay pending while
    the CLI is booting, which includes waiting on a startup dialog.
    """
    agent = await Agent.find(agent_id)
    session_id = agent.session_id if agent else None
    terminal = TerminalWriteAction.prepare(session_id, "").resolve_terminal()
    if not terminal or not is_cli_ready(session_id):
        return 0

    pending = (
        await AgentRelayMessage.where("to_agent_id", agent_id)
        .where("status", "pending")
        .order_by("id", "asc")
        .get()
    )
    delivered = 0
    for msg in pending:
        # Claimed before the (slow) send, so a concurrent flush skips it.
        if not await claim_relay_message(msg.id):
            continue
        from_agent = await Agent.find(msg.from_agent_id)
        sender_name = from_agent.name if from_agent else f"Agent #{msg.from_agent_id}"
        await terminal.send(relay_text(sender_name, msg.content))
        delivered += 1
    return delivered
