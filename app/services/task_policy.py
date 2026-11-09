import logging
from dataclasses import dataclass

from app.constant.task_status import TERMINAL_STATUSES, canonical_status
from app.exceptions.task_rule_rejected_error import TaskRuleRejectedError
from app.models.Agent import Agent
from app.models.Project import Project
from app.models.Task import Task
from app.models.TaskDependency import TaskDependency
from app.services.relay_identity import current_caller, every_live_agent_carries_token

logger = logging.getLogger("keera.tasks")

ALLOWED_TRANSITIONS = {
    "created": {"assigned", "blocked", "cancelled"},
    "assigned": {"acked", "blocked", "created", "cancelled"},
    "acked": {"in_progress", "blocked", "created", "cancelled"},
    "in_progress": {"blocked", "in_review", "created", "cancelled"},
    "blocked": {"created", "assigned", "acked", "in_progress", "cancelled"},
    "in_review": {"approved", "changes_requested", "in_progress", "cancelled"},
    "approved": {"merged", "in_review", "changes_requested", "cancelled"},
    "changes_requested": {"in_progress", "created", "cancelled"},
    "merged": {"done", "cancelled"},
    "done": {"created", "in_progress"},
    "cancelled": {"created", "in_progress"},
}

PRE_REVIEW_STATUSES = frozenset(
    {"created", "assigned", "acked", "in_progress", "blocked", "changes_requested"}
)
REQUEUE_STATUS = "created"

PM_TARGETS = {"done", "cancelled"}
REVIEWER_TARGETS = {"approved", "changes_requested"}
ASSIGNEE_TARGETS = {"acked", "in_progress", "in_review"}
GATED_BY_DEPENDENCIES = {"acked", "in_progress", "in_review", "approved", "merged", "done"}
SOFT_DEPENDENCY_MET = {"in_review", "approved", "merged", "done"}
CANONICAL_TERMINAL = {canonical_status(s) for s in TERMINAL_STATUSES}

ENFORCE = "enforce"
WARN = "warn"


@dataclass(frozen=True)
class TaskActor:
    agent: Agent | None = None
    authenticated: bool = False

    @property
    def agent_id(self) -> int | None:
        return self.agent.id if self.agent else None

    def is_type(self, agent_type: str) -> bool:
        return self.agent is not None and self.agent.agent_type == agent_type

    def is_assignee(self, task: Task) -> bool:
        return self.agent is not None and self.agent.task_id == task.id


async def task_actor(claimed_agent_id: int | None = None) -> TaskActor:
    caller = current_caller()
    if caller.agent is not None:
        return TaskActor(agent=caller.agent, authenticated=True)
    if claimed_agent_id is None:
        return TaskActor()
    return TaskActor(agent=await Agent.find(claimed_agent_id))


@dataclass(frozen=True)
class TaskRules:
    transitions_enforced: bool = False
    ownership_enforced: bool = False

    @classmethod
    async def for_project(cls, project_id: int) -> "TaskRules":
        project = await Project.find(project_id)
        if project is None or (project.task_rules or WARN) != ENFORCE:
            return cls()
        return cls(
            transitions_enforced=True,
            ownership_enforced=await every_live_agent_carries_token(project_id),
        )

    def effective_actor(self, actor: TaskActor) -> TaskActor:
        if self.ownership_enforced and not actor.authenticated:
            return TaskActor()
        return actor

    def require_identity(self, actor: TaskActor) -> None:
        if self.ownership_enforced and not actor.authenticated:
            raise TaskRuleRejectedError("caller unidentified: task writes need an agent token")

    def settle(self, task_id: int | None, transition: list[str], ownership: list[str]) -> list[str]:
        if self.transitions_enforced and transition:
            raise TaskRuleRejectedError(transition[0])
        if self.ownership_enforced and ownership:
            raise TaskRuleRejectedError(ownership[0])
        warnings = [*transition, *ownership]
        for warning in warnings:
            logger.warning("task #%s rule violation (advisory): %s", task_id, warning)
        return warnings


def transition_violations(from_status: str | None, to_status: str) -> list[str]:
    source, target = canonical_status(from_status), canonical_status(to_status)
    if source == target or target in ALLOWED_TRANSITIONS.get(source, set()):
        return []
    return [f"illegal transition {from_status} → {to_status}"]


def ownership_violations(task: Task, to_status: str, actor: TaskActor) -> list[str]:
    source, target = canonical_status(task.status), canonical_status(to_status)
    if source == target:
        return []
    unidentified = "" if actor.agent else " (caller unidentified)"
    if target in PM_TARGETS or source in CANONICAL_TERMINAL:
        if not actor.is_type("pm"):
            return [f"only a pm may move a task to {to_status}{unidentified}"]
    elif target in REVIEWER_TARGETS:
        if not actor.is_type("reviewer"):
            return [f"only a reviewer may set {to_status}{unidentified}"]
    elif target in ASSIGNEE_TARGETS:
        if not (actor.is_assignee(task) or actor.is_type("pm")):
            return [f"only the assignee or a pm may move a task to {to_status}{unidentified}"]
    return []


def pm_only_violations(action: str, actor: TaskActor) -> list[str]:
    if actor.is_type("pm"):
        return []
    unidentified = "" if actor.agent else " (caller unidentified)"
    return [f"only a pm may {action}{unidentified}"]


async def blockers_by_task(task_ids: list[int]) -> dict[int, list[int]]:
    if not task_ids:
        return {}
    dependencies = await TaskDependency.where_in("task_id", task_ids).get()
    upstream_ids = list({dependency.depends_on_task_id for dependency in dependencies})
    upstreams = (
        {task.id: task for task in await Task.where_in("id", upstream_ids).get()}
        if upstream_ids
        else {}
    )
    blockers: dict[int, list[int]] = {}
    for dependency in dependencies:
        upstream = upstreams.get(dependency.depends_on_task_id)
        if upstream is None or upstream.deleted_at:
            continue
        status = canonical_status(upstream.status)
        met = status == "done" if dependency.hard else status in SOFT_DEPENDENCY_MET
        if not met:
            blockers.setdefault(dependency.task_id, []).append(upstream.id)
    return blockers


async def blocking_dependencies(task_id: int) -> list[int]:
    return (await blockers_by_task([task_id])).get(task_id, [])


async def dependency_violations(task: Task, to_status: str) -> list[str]:
    if canonical_status(to_status) not in GATED_BY_DEPENDENCIES:
        return []
    if canonical_status(task.status) == canonical_status(to_status):
        return []
    blockers = await blocking_dependencies(task.id)
    return [f"task #{task.id} is blocked by #{blocker}" for blocker in blockers]
