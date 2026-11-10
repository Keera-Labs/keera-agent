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


STEP_CLAIMED = "claimed"
STEP_DONE = "done"
REQUEUE_STEP = "teardown_requeue"
REPORT_STEP = "teardown_report"


def teardown_finished(agent: Agent) -> bool:
    return getattr(agent, REPORT_STEP, None) == STEP_DONE


class AgentDeleteAction:
    def __init__(self, agent: Agent, reason: str | None = None):
        self.agent = agent
        self.reason = (reason or "").strip() or None

    async def execute(self) -> bool:
        await live_agent(self.agent.id).update(
            {"deleted_at": utc_now(), "deleted_reason": self.reason, "status": "deleted"}
        )
        await self._stop_newest_session(await Agent.find(self.agent.id))
        await self._run_step(REQUEUE_STEP, self._requeue_task)
        await self._run_step(REPORT_STEP, self._notify_orchestrator, after=REQUEUE_STEP)
        return await live_agent(self.agent.id).first() is None

    async def _run_step(self, step: str, perform, after: str | None = None) -> None:
        claim = Agent.where("id", self.agent.id).where_null(step)
        if after:
            claim = claim.where(after, STEP_DONE)
        if not await claim.update({step: STEP_CLAIMED}):
            return
        outcome = None
        try:
            await perform(await Agent.find(self.agent.id))
            outcome = STEP_DONE
        finally:
            await Agent.where("id", self.agent.id).where(step, STEP_CLAIMED).update({step: outcome})

    async def _stop_newest_session(self, agent: Agent) -> None:
        from app.controllers.agent_controller import stop_agent_session

        await stop_agent_session(agent.session_id)
        await app().make("terminal").close_agent(agent.id)
        if agent.session_id:
            await (
                Agent.where("id", agent.id)
                .where("session_id", agent.session_id)
                .update({"session_id": None})
            )

    async def _requeue_task(self, agent: Agent) -> None:
        task = await self._held_task(agent)
        if not task or canonical_status(task.status) not in PRE_REVIEW_STATUSES:
            return
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
                "reason": f"agent {agent.name} deleted: {agent.deleted_reason or 'no reason given'}",
            },
        )

    async def _notify_orchestrator(self, agent: Agent) -> None:
        recipient = await self._orchestrator(agent)
        if recipient:
            report = self._report(agent, await self._held_task(agent))
            await AgentMessageSendAction.prepare(agent, recipient, report).execute()
        await Agent.where("id", agent.id).update({"task_id": None})

    async def _held_task(self, agent: Agent) -> Task | None:
        return await Task.find(agent.task_id) if getattr(agent, "task_id", None) else None

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
        text = f"agent deleted: {agent.name} ({agent.deleted_reason or 'no reason given'})"
        if not task:
            return text
        text += f"; task #{task.id} is now {task.status} and unassigned"
        if task.branch:
            head = getattr(agent, "worktree_head_sha", None)
            text += f" (branch {task.branch}{f' @ {head[:8]}' if head else ''})"
        return text
