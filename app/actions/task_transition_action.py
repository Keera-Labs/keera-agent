from app.actions.agent_status_action import utc_now
from app.constant.task_status import TERMINAL_STATUSES, canonical_status
from app.exceptions.task_rule_rejected_error import TaskRuleRejectedError
from app.models.Task import Task
from app.models.TaskEvent import TaskEvent
from app.services.task_policy import (
    TaskActor,
    TaskRules,
    dependency_violations,
    ownership_violations,
    pm_only_violations,
    transition_violations,
)

APPROVAL_SURVIVES = {"approved", "merged", "done"}
MIN_SHA_LENGTH = 7


def same_sha(left: str | None, right: str | None) -> bool:
    if not left or not right:
        return False
    left, right = left.strip().lower(), right.strip().lower()
    if min(len(left), len(right)) < MIN_SHA_LENGTH:
        return left == right
    return left.startswith(right) or right.startswith(left)


async def record_task_event(
    task_id: int,
    actor_agent_id: int | None,
    from_status: str | None,
    to_status: str | None,
    fields_changed: dict | None = None,
) -> TaskEvent:
    return await TaskEvent.create(
        {
            "task_id": task_id,
            "actor_agent_id": actor_agent_id,
            "from_status": from_status,
            "to_status": to_status,
            "fields_changed": fields_changed or {},
            "created_at": utc_now(),
        }
    )


async def soft_delete_task(
    task: Task, actor_agent_id: int | None, warnings: list[str] | None = None
) -> None:
    from_status = task.status
    status = from_status if from_status in TERMINAL_STATUSES else "cancelled"
    now = utc_now()
    await task.update(
        {
            "status": status,
            "completed_at": task.completed_at_for(status),
            "deleted_at": now,
            "updated_at": now,
        }
    )
    fields = {"deleted_at": now, **({"warnings": warnings} if warnings else {})}
    await record_task_event(task.id, actor_agent_id, from_status, status, fields)


async def revoke_stale_approval(task: Task, head_sha: str, actor: TaskActor) -> bool:
    if canonical_status(task.status) != "approved" or same_sha(head_sha, task.approved_sha):
        return False
    from_status = task.status
    await task.update({"status": "in_review", "approved_sha": None, "updated_at": utc_now()})
    await record_task_event(
        task.id,
        actor.agent_id,
        from_status,
        "in_review",
        {"head_sha": head_sha, "reason": "head moved after approval"},
    )
    return True


class TaskTransitionAction:
    def __init__(
        self,
        task: Task,
        status: str,
        actor: TaskActor,
        head_sha: str | None = None,
        fields: dict | None = None,
        merge_gate_passed: bool = False,
    ):
        self.task = task
        self.status = status
        self.actor = actor
        self.head_sha = head_sha
        self.fields = fields or {}
        self.merge_gate_passed = merge_gate_passed

    @staticmethod
    def prepare(task: Task, status: str, actor: TaskActor, **options) -> "TaskTransitionAction":
        return TaskTransitionAction(task, status, actor, **options)

    async def execute(self) -> list[str]:
        rules = await TaskRules.for_project(self.task.project_id)
        rules.require_identity(self.actor)
        transition = [
            *transition_violations(self.task.status, self.status),
            *self._gate_violations(),
            *await dependency_violations(self.task, self.status),
        ]
        ownership = ownership_violations(self.task, self.status, rules.effective_actor(self.actor))
        warnings = rules.settle(self.task.id, transition, ownership)

        from_status = self.task.status
        changes = self._changes()
        await self.task.update(changes)
        recorded = {key: changes[key] for key in changes if key not in ("status", "updated_at")}
        if warnings:
            recorded["warnings"] = warnings
        await record_task_event(
            self.task.id, self.actor.agent_id, from_status, self.status, recorded
        )
        return warnings

    def _gate_violations(self) -> list[str]:
        target = canonical_status(self.status)
        if target == "merged" and not self.merge_gate_passed:
            return ["merged is set only by record_merge"]
        if target == "approved" and not self.head_sha:
            return ["approved requires head_sha"]
        return []

    def _changes(self) -> dict:
        changes = {
            **self.fields,
            "status": self.status,
            "completed_at": self.task.completed_at_for(self.status),
            "updated_at": utc_now(),
        }
        target = canonical_status(self.status)
        if self.head_sha:
            changes["head_sha"] = self.head_sha
        if target == "approved":
            changes["approved_sha"] = self.head_sha
        elif target not in APPROVAL_SURVIVES:
            changes["approved_sha"] = None
        return changes


class TaskMergeAction:
    def __init__(self, task: Task, actor: TaskActor, merged_sha: str):
        self.task = task
        self.actor = actor
        self.merged_sha = merged_sha

    @staticmethod
    def prepare(task: Task, actor: TaskActor, merged_sha: str) -> "TaskMergeAction":
        return TaskMergeAction(task, actor, merged_sha)

    async def execute(self) -> list[str]:
        rules = await TaskRules.for_project(self.task.project_id)
        rules.require_identity(self.actor)
        warnings = rules.settle(
            self.task.id,
            [],
            pm_only_violations("record a merge", rules.effective_actor(self.actor)),
        )
        if canonical_status(self.task.status) != "approved" or not self.task.approved_sha:
            raise TaskRuleRejectedError(
                f"task #{self.task.id} is not approved (status {self.task.status})"
            )
        if not same_sha(self.merged_sha, self.task.approved_sha):
            await revoke_stale_approval(self.task, self.merged_sha, self.actor)
            raise TaskRuleRejectedError(
                f"merged head {self.merged_sha} does not match approved_sha "
                f"{self.task.approved_sha}; task #{self.task.id} is back in in_review"
            )
        return (
            warnings
            + await TaskTransitionAction(
                self.task,
                "merged",
                self.actor,
                fields={"merged_sha": self.merged_sha},
                merge_gate_passed=True,
            ).execute()
        )
