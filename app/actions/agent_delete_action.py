import re

from fastapi_startkit.application import app

from app.actions.agent_message_send_action import AgentMessageSendAction
from app.actions.agent_status_action import live_agent, utc_now
from app.actions.task_transition_action import record_task_event, write_task
from app.constant.task_status import canonical_status
from app.models.Agent import Agent
from app.models.Task import Task
from app.services.task_policy import PRE_REVIEW_STATUSES, REQUEUE_STATUS, task_actor
from app.services.worktree_cleanup import PROTECTED_BRANCHES

AGENT_DEFAULT_BRANCH = re.compile(r"worktree-agent-\d+")


def _other_live_agents(agent: Agent):
    return Agent.where_null("deleted_at").where("id", "!=", agent.id)


def _is_task_branch(branch: str | None) -> bool:
    return (
        bool(branch)
        and branch not in PROTECTED_BRANCHES
        and not AGENT_DEFAULT_BRANCH.fullmatch(branch)
    )


class AgentDeleteAction:
    def __init__(self, agent: Agent, reason: str | None = None):
        self.agent = agent
        self.reason = (reason or "").strip() or None

    async def execute(self) -> bool:
        if not await self._mark_deleted_before_teardown():
            return True
        deleted = await Agent.find(self.agent.id)
        await self._stop_newest_session(deleted)
        task = await self._requeue_task(deleted)
        await self._notify_orchestrator(deleted, task)
        return await Agent.where("id", self.agent.id).where_null("deleted_at").first() is None

    async def _mark_deleted_before_teardown(self) -> bool:
        return await live_agent(self.agent.id).update(
            {"deleted_at": utc_now(), "deleted_reason": self.reason, "status": "deleted"}
        )

    async def _stop_newest_session(self, agent: Agent) -> None:
        from app.controllers.agent_controller import stop_agent_session

        await stop_agent_session(agent.session_id)
        await app().make("terminal").close_agent(agent.id)
        await Agent.where("id", agent.id).update({"session_id": None, "task_id": None})

    async def _requeue_task(self, agent: Agent) -> Task | None:
        task = await Task.find(agent.task_id) if getattr(agent, "task_id", None) else None
        if not task:
            return None
        if canonical_status(task.status) not in PRE_REVIEW_STATUSES:
            return task
        previous_status = task.status
        values = {"status": REQUEUE_STATUS}
        assignees = task.assignees or []
        if agent.name in assignees:
            values["assignees"] = [a for a in assignees if a != agent.name]
        branch = getattr(agent, "worktree_branch", None)
        if not task.branch and _is_task_branch(branch):
            values["branch"] = branch
        await write_task(task, values)
        await record_task_event(
            task.id,
            (await task_actor()).agent_id,
            previous_status,
            REQUEUE_STATUS,
            {
                **{key: value for key, value in values.items() if key != "status"},
                "deleted_agent_id": agent.id,
                "reason": f"agent {agent.name} deleted: {self.reason or 'no reason given'}",
            },
        )
        return await Task.find(task.id)

    async def _notify_orchestrator(self, agent: Agent, task: Task | None) -> None:
        recipient = await self._orchestrator(agent)
        if recipient:
            await AgentMessageSendAction.prepare(
                agent, recipient, self._report(agent, task)
            ).execute()

    async def _orchestrator(self, agent: Agent) -> Agent | None:
        if getattr(agent, "orchestrator_id", None):
            orchestrator = (
                await _other_live_agents(agent).where("id", agent.orchestrator_id).first()
            )
            if orchestrator:
                return orchestrator
        return (
            await _other_live_agents(agent)
            .where("project_id", agent.project_id)
            .where("agent_type", "pm")
            .order_by("id", "asc")
            .first()
        )

    def _report(self, agent: Agent, task: Task | None) -> str:
        text = f"agent deleted: {agent.name} ({self.reason or 'no reason given'})"
        if not task:
            return text
        text += f"; task #{task.id} is now {task.status} and unassigned"
        if task.branch:
            head = getattr(agent, "worktree_head_sha", None)
            text += f" (branch {task.branch}{f' @ {head[:8]}' if head else ''})"
        return text
