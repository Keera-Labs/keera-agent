"""MCP tool definitions — Tool subclasses for all 11 Keera tools."""

import datetime
import json
import os
from typing import Literal, Optional, Union

from fastapi_startkit.mcp import Response, Tool
from pydantic import BaseModel, Field

from app.actions.agent_health_action import (
    agent_health,
    has_live_session,
    heartbeat_age,
    record_heartbeat,
)
from app.actions.agent_status_action import utc_now
from app.actions.task_transition_action import (
    TaskMergeAction,
    TaskTransitionAction,
    record_task_event,
    revoke_stale_approval,
    soft_delete_task,
)
from app.constant.agent_types import DEFAULT_AGENT_TYPE, AgentType
from app.constant.task_status import TERMINAL_STATUSES, TaskStatus, canonical_status
from app.exceptions.task_rule_rejected_error import TaskRuleRejectedError
from app.models.Project import Project
from app.models.Task import REVIEW_FIELDS, Task
from app.models.TaskDependency import TaskDependency
from app.models.TaskEvent import TaskEvent
from app.requests.task_request import TaskReviewFields
from app.services.pull_request_head import merged_pull_request_head
from app.services.task_policy import (
    TaskRules,
    blocking_dependencies,
    pm_only_violations,
    task_actor,
)

ACTOR_FIELD_DESCRIPTION = (
    "Your own agent ID. Optional: recorded in the task history when your MCP client "
    "sends no agent token."
)
RELAY_SHA_FIELDS = ("head_sha", "approved_sha", "merged_sha")

# ── helpers ───────────────────────────────────────────────────────────────────


def _load_json(value) -> list:
    if not value:
        return []
    # The model may already cast JSON columns to a list; legacy rows and
    # raw paths hand us the JSON string instead.
    if isinstance(value, list):
        return value
    try:
        return json.loads(value)
    except (ValueError, TypeError):
        return []


def _serialize_task(t: Task) -> dict:
    return {
        "id": t.id,
        "title": t.title,
        "body": t.body,
        "priority": t.priority or "medium",
        "status": t.status,
        "assignees": _load_json(t.assignees),
        "acceptance_criteria": _load_json(t.acceptance_criteria),
        "testing_methods": _load_json(t.testing_methods),
        "validation_steps": _load_json(t.validation_steps),
        **{field: getattr(t, field, None) for field in REVIEW_FIELDS},
        **{field: getattr(t, field, None) for field in RELAY_SHA_FIELDS},
        "completed_at": t.completed_at,
        "deleted_at": t.deleted_at,
        "created_at": str(t.created_at),
        "updated_at": str(t.updated_at),
    }


def _with_warnings(text: str, warnings: list[str]) -> str:
    return "\n".join([text, *(f"Warning: {w} (advisory)" for w in warnings)])


def _matching_statuses(status: str) -> list[str]:
    return [s.value for s in TaskStatus if canonical_status(s.value) == canonical_status(status)]


async def _live_task(task_id: int) -> Task | None:
    return await Task.where("id", task_id).where_null("deleted_at").first()


async def _project_by_path(path: str) -> Optional[Project]:
    projects = await Project.all()
    expanded = os.path.expanduser(path).rstrip("/")
    for p in projects:
        if os.path.expanduser(p.path).rstrip("/") == expanded:
            return p
    return None


# ── create_task ───────────────────────────────────────────────────────────────


class CreateTaskInput(BaseModel):
    project_path: str = Field(
        description="Absolute path of the project (use the current working directory)."
    )
    title: str = Field(description="Short, imperative title. e.g. 'Add CSV export for tasks'.")
    body: Optional[str] = Field(
        default=None, description="One-paragraph summary of what needs to be built and why."
    )
    acceptance_criteria: list[str] = Field(
        min_length=1,
        description="Concrete, checkable statements that define when the task is done.",
    )
    testing_methods: list[str] = Field(
        min_length=1, description="How the feature will be tested (unit, integration, manual, e2e)."
    )
    validation_steps: list[str] = Field(
        min_length=1, description="QA / edge-case checks to perform before marking done."
    )
    priority: str = Field(
        default="medium",
        pattern="^(low|medium|high)$",
        description="Task priority. Default: medium.",
    )
    assignees: list[str] = Field(
        default_factory=list, description="Names of people assigned to this task (can be empty)."
    )
    idempotency_key: Optional[str] = Field(
        default=None,
        description="Optional key; repeating a create with the same key returns the existing task.",
    )
    actor_agent_id: Optional[int] = Field(default=None, description=ACTOR_FIELD_DESCRIPTION)


class CreateTaskTool(Tool):
    name = "create_task"
    description = (
        "Create a well-planned task in the current Keera project. "
        "Before calling this tool, think through the full implementation plan: "
        "what 'done' looks like (acceptance_criteria), how it will be tested "
        "(testing_methods), and what edge cases / QA steps are needed "
        "(validation_steps). All three are required."
    )

    def schema(self):
        return CreateTaskInput

    async def handle(self, arguments: dict) -> Response:
        project = await _project_by_path(arguments["project_path"])
        if not project:
            return Response.text(
                f"Error: no Keera project found at path '{arguments['project_path']}'"
            )

        title = arguments["title"].strip()
        if not title:
            return Response.text("Error: title is required")

        actor = await task_actor(arguments.get("actor_agent_id"))
        try:
            (await TaskRules.for_project(project.id)).require_identity(actor)
        except TaskRuleRejectedError as exc:
            return Response.text(f"Error: {exc}")

        idempotency_key = (arguments.get("idempotency_key") or "").strip() or None
        if idempotency_key:
            existing = (
                await Task.where("project_id", project.id)
                .where("idempotency_key", idempotency_key)
                .first()
            )
            if existing:
                return Response.text(
                    f"✓ Task #{existing.id} created: {existing.title} (existing task for this idempotency_key)"
                )

        task = await Task.create(
            {
                "project_id": project.id,
                "title": title,
                "body": (arguments.get("body") or "").strip() or None,
                "priority": arguments.get("priority", "medium"),
                "assignees": json.dumps(arguments.get("assignees") or []),
                "acceptance_criteria": json.dumps(arguments.get("acceptance_criteria") or []),
                "testing_methods": json.dumps(arguments.get("testing_methods") or []),
                "validation_steps": json.dumps(arguments.get("validation_steps") or []),
                "status": "pending",
                "idempotency_key": idempotency_key,
            }
        )
        await record_task_event(
            task.id,
            actor.agent_id,
            None,
            "pending",
            {"title": title, "idempotency_key": idempotency_key},
        )

        ac = arguments.get("acceptance_criteria") or []
        lines = [f"✓ Task #{task.id} created: {title}", ""]
        if ac:
            lines.append("Acceptance criteria:")
            for c in ac:
                lines.append(f"  • {c}")
        return Response.text("\n".join(lines))


# ── list_tasks ────────────────────────────────────────────────────────────────


class ListTasksInput(BaseModel):
    project_path: str = Field(
        description="Absolute path of the project (use the current working directory)."
    )
    status: Optional[str] = Field(
        default=None,
        pattern=TaskStatus.pattern(),
        description="Filter by status. Omit to return all tasks.",
    )


class ListTasksTool(Tool):
    name = "list_tasks"
    description = "List tasks for the current Keera project, optionally filtered by status."

    def schema(self):
        return ListTasksInput

    async def handle(self, arguments: dict) -> Response:
        project = await _project_by_path(arguments["project_path"])
        if not project:
            return Response.text(
                f"Error: no Keera project found at path '{arguments['project_path']}'"
            )

        q = Task.where("project_id", project.id).where_null("deleted_at")
        status = arguments.get("status")
        # completed_at is stamped in UTC (see Task.completed_at_for), so the cutoff
        # compared against it must be computed in UTC too.
        cutoff = (
            datetime.datetime.now(datetime.UTC).replace(tzinfo=None) - datetime.timedelta(days=7)
        ).isoformat()
        if status:
            q = q.where_in("status", _matching_statuses(status))
            if canonical_status(status) == "done":
                q = q.where("completed_at", ">=", cutoff)
        else:
            q = q.where(
                lambda query: query.where_not_in("tasks.status", list(TERMINAL_STATUSES)).or_where(
                    "tasks.completed_at", ">=", cutoff
                )
            )
        tasks = await q.get()

        if not tasks:
            return Response.text("No tasks found.")

        lines = []
        for t in tasks:
            priority = t.priority or "medium"
            line = f"[{t.status}] #{t.id} {t.title or t.body}  ({priority})"
            blockers = await blocking_dependencies(t.id)
            if blockers:
                line += "  blocked by " + ", ".join(f"#{b}" for b in blockers)
            lines.append(line)
        return Response.text("\n".join(lines))


# ── get_task ──────────────────────────────────────────────────────────────────


class GetTaskInput(BaseModel):
    task_id: int = Field(description="The numeric task ID.")


class GetTaskTool(Tool):
    name = "get_task"
    description = "Get full details of a single task by ID."

    def schema(self):
        return GetTaskInput

    async def handle(self, arguments: dict) -> Response:
        task = await Task.find(arguments["task_id"])
        if not task:
            return Response.text(f"Error: task #{arguments['task_id']} not found")

        t = _serialize_task(task)
        lines = [
            f"#{t['id']} {t['title']}",
            f"Status:   {t['status']}",
            f"Priority: {t['priority']}",
            f"Assignees: {', '.join(t['assignees']) if t['assignees'] else 'none'}",
            f"Created:  {t['created_at']}",
            f"Updated:  {t['updated_at']}",
            *([f"Completed: {t['completed_at']}"] if t["completed_at"] else []),
            *([f"Deleted:  {t['deleted_at']}"] if t["deleted_at"] else []),
            *(
                f"{field}: {t[field]}"
                for field in (*REVIEW_FIELDS, *RELAY_SHA_FIELDS)
                if t[field] is not None
            ),
            *(await _dependency_lines(task.id)),
            "",
            "Body:",
            t["body"] or "(none)",
        ]
        if t["acceptance_criteria"]:
            lines += ["", "Acceptance criteria:"] + [f"  • {c}" for c in t["acceptance_criteria"]]
        if t["testing_methods"]:
            lines += ["", "Testing methods:"] + [f"  • {m}" for m in t["testing_methods"]]
        if t["validation_steps"]:
            lines += ["", "Validation steps:"] + [f"  • {s}" for s in t["validation_steps"]]
        return Response.text("\n".join(lines))


async def _dependency_lines(task_id: int) -> list[str]:
    dependencies = await TaskDependency.where("task_id", task_id).get()
    if not dependencies:
        return []
    blockers = await blocking_dependencies(task_id)
    depends_on = ", ".join(
        f"#{d.depends_on_task_id}{' (hard)' if d.hard else ''}" for d in dependencies
    )
    lines = [f"Depends on: {depends_on}"]
    if blockers:
        lines.append("Blocked by: " + ", ".join(f"#{b}" for b in blockers))
    return lines


# ── update_task ───────────────────────────────────────────────────────────────


class UpdateTaskInput(TaskReviewFields):
    task_id: int = Field(description="The numeric task ID.")
    title: Optional[str] = None
    body: Optional[str] = None
    priority: Optional[str] = Field(default=None, pattern="^(low|medium|high)$")
    assignees: Optional[list[str]] = None
    acceptance_criteria: Optional[list[str]] = None
    testing_methods: Optional[list[str]] = None
    validation_steps: Optional[list[str]] = None
    head_sha: Optional[str] = Field(
        default=None,
        description="Current head commit of the task's PR. A new head after approval sends the task back to in_review.",
    )
    expected_updated_at: Optional[str] = Field(
        default=None,
        description="The task's Updated value from get_task; the update is refused if the task changed since.",
    )
    actor_agent_id: Optional[int] = Field(default=None, description=ACTOR_FIELD_DESCRIPTION)


class UpdateTaskTool(Tool):
    name = "update_task"
    description = (
        "Update any fields of a task (title, body, acceptance_criteria, testing_methods, "
        "validation_steps, priority, assignees). Also report your work on it: pr_number, "
        "pr_url, branch, head_sha, additions/deletions (diff line counts), review_note, and "
        "progress_step/progress_total (e.g. step 2 of 5). Pass expected_updated_at to "
        "refuse a stale write."
    )

    def schema(self):
        return UpdateTaskInput

    async def handle(self, arguments: dict) -> Response:
        task = await _live_task(arguments["task_id"])
        if not task:
            return Response.text(f"Error: task #{arguments['task_id']} not found")

        expected = arguments.get("expected_updated_at")
        if expected is not None and str(task.updated_at) != expected:
            return Response.text(
                f"Error: task #{task.id} changed since {expected} (now {task.updated_at}); "
                "re-read it with get_task and retry"
            )

        actor = await task_actor(arguments.get("actor_agent_id"))
        try:
            (await TaskRules.for_project(task.project_id)).require_identity(actor)
        except TaskRuleRejectedError as exc:
            return Response.text(f"Error: {exc}")

        changes = {}
        for field in ["title", "body", "priority", "head_sha", *REVIEW_FIELDS]:
            if arguments.get(field) is not None:
                changes[field] = arguments[field]
        for field in ["assignees", "acceptance_criteria", "testing_methods", "validation_steps"]:
            if arguments.get(field) is not None:
                changes[field] = json.dumps(arguments[field])

        revoked = False
        if changes:
            if "head_sha" in changes:
                revoked = await revoke_stale_approval(task, changes["head_sha"], actor)
            await task.update({**changes, "updated_at": utc_now()})
            await record_task_event(task.id, actor.agent_id, task.status, task.status, changes)

        text = f"Task #{task.id} '{task.title or task.body}' updated."
        if revoked:
            text += " Its head moved after approval, so it is back in in_review."
        return Response.text(text)


# ── update_task_status ────────────────────────────────────────────────────────


class UpdateTaskStatusInput(BaseModel):
    task_id: int = Field(description="The numeric task ID.")
    status: str = Field(pattern=TaskStatus.pattern())
    head_sha: Optional[str] = Field(
        default=None, description="The PR head commit being approved. Required for approved."
    )
    actor_agent_id: Optional[int] = Field(default=None, description=ACTOR_FIELD_DESCRIPTION)


class UpdateTaskStatusTool(Tool):
    name = "update_task_status"
    description = (
        "Change the status of a task. Lifecycle: created → assigned → acked → in_progress → "
        "in_review → approved (needs head_sha) → merged (via record_merge) → done; in_progress ↔ "
        "blocked; in_review → changes_requested → in_progress; any non-terminal → cancelled. "
        "The legacy names pending (= created) and completed (= done) are still accepted."
    )

    def schema(self):
        return UpdateTaskStatusInput

    async def handle(self, arguments: dict) -> Response:
        task = await _live_task(arguments["task_id"])
        if not task:
            return Response.text(f"Error: task #{arguments['task_id']} not found")
        status = arguments["status"]
        actor = await task_actor(arguments.get("actor_agent_id"))
        try:
            warnings = await TaskTransitionAction.prepare(
                task, status, actor, head_sha=arguments.get("head_sha")
            ).execute()
        except TaskRuleRejectedError as exc:
            return Response.text(f"Error: {exc}")
        return Response.text(
            _with_warnings(f"Task #{task.id} '{task.title or task.body}' → {task.status}", warnings)
        )


# ── delete_task ───────────────────────────────────────────────────────────────


class DeleteTaskInput(BaseModel):
    task_id: int = Field(description="The numeric task ID to delete.")
    actor_agent_id: Optional[int] = Field(default=None, description=ACTOR_FIELD_DESCRIPTION)


class DeleteTaskTool(Tool):
    name = "delete_task"
    description = "Delete a task by ID. The task is cancelled and hidden; its history is kept."

    def schema(self):
        return DeleteTaskInput

    async def handle(self, arguments: dict) -> Response:
        task = await _live_task(arguments["task_id"])
        if not task:
            return Response.text(f"Error: task #{arguments['task_id']} not found")
        actor = await task_actor(arguments.get("actor_agent_id"))
        rules = await TaskRules.for_project(task.project_id)
        try:
            rules.require_identity(actor)
            warnings = rules.settle(
                task.id, [], pm_only_violations("delete a task", rules.effective_actor(actor))
            )
        except TaskRuleRejectedError as exc:
            return Response.text(f"Error: {exc}")

        title = task.title or task.body or f"#{task.id}"
        await soft_delete_task(task, actor.agent_id, warnings)
        return Response.text(_with_warnings(f"Task '{title}' deleted.", warnings))


# ── get_task_history ──────────────────────────────────────────────────────────


class GetTaskHistoryInput(BaseModel):
    task_id: int = Field(description="The numeric task ID.")


class GetTaskHistoryTool(Tool):
    name = "get_task_history"
    description = "Show the audit log of a task: every create, field change, status change and delete, with its actor."

    def schema(self):
        return GetTaskHistoryInput

    async def handle(self, arguments: dict) -> Response:
        events = await TaskEvent.where("task_id", arguments["task_id"]).order_by("id", "asc").get()
        if not events:
            return Response.text(f"No history for task #{arguments['task_id']}.")
        lines = [f"History of task #{arguments['task_id']}:"]
        for event in events:
            actor = f"agent #{event.actor_agent_id}" if event.actor_agent_id else "unknown actor"
            transition = f"{event.from_status or '-'} → {event.to_status or '-'}"
            fields = json.dumps(event.fields_changed) if event.fields_changed else ""
            lines.append(f"  {event.created_at}  {actor}  {transition}  {fields}".rstrip())
        return Response.text("\n".join(lines))


# ── record_merge ──────────────────────────────────────────────────────────────


class RecordMergeInput(BaseModel):
    task_id: int = Field(description="The numeric task ID.")
    merged_sha: Optional[str] = Field(
        default=None,
        description="Head commit of the merged PR. Omit to read it from GitHub through the task's pr_number or pr_url.",
    )
    actor_agent_id: Optional[int] = Field(default=None, description=ACTOR_FIELD_DESCRIPTION)


class RecordMergeTool(Tool):
    name = "record_merge"
    description = (
        "Record that an approved task's PR was merged. The task moves to merged only when the "
        "merged head equals the approved head_sha; otherwise it goes back to in_review."
    )

    def schema(self):
        return RecordMergeInput

    async def handle(self, arguments: dict) -> Response:
        task = await _live_task(arguments["task_id"])
        if not task:
            return Response.text(f"Error: task #{arguments['task_id']} not found")
        actor = await task_actor(arguments.get("actor_agent_id"))
        merged_sha = arguments.get("merged_sha")
        try:
            if not merged_sha:
                merged_sha = await merged_pull_request_head(task)
            warnings = await TaskMergeAction.prepare(task, actor, merged_sha).execute()
        except TaskRuleRejectedError as exc:
            return Response.text(f"Error: {exc}")
        return Response.text(
            _with_warnings(f"Task #{task.id} merged at {merged_sha} → {task.status}", warnings)
        )


# ── add_task_dependency ───────────────────────────────────────────────────────


class AddTaskDependencyInput(BaseModel):
    task_id: int = Field(description="The task that waits.")
    depends_on_task_id: int = Field(description="The task it waits for.")
    hard: bool = Field(
        default=False,
        description="False: unblocked once the dependency reaches in_review. True: only once it is done.",
    )
    actor_agent_id: Optional[int] = Field(default=None, description=ACTOR_FIELD_DESCRIPTION)


class AddTaskDependencyTool(Tool):
    name = "add_task_dependency"
    description = (
        "Make a task wait for another one (e.g. QA waits for the implementation). A blocked task "
        "can't move forward until its dependency reaches in_review, or done for a hard dependency."
    )

    def schema(self):
        return AddTaskDependencyInput

    async def handle(self, arguments: dict) -> Response:
        task = await _live_task(arguments["task_id"])
        upstream = await _live_task(arguments["depends_on_task_id"])
        if not task or not upstream:
            missing = arguments["task_id"] if not task else arguments["depends_on_task_id"]
            return Response.text(f"Error: task #{missing} not found")
        if task.id == upstream.id:
            return Response.text("Error: a task cannot depend on itself")
        if task.project_id != upstream.project_id:
            return Response.text("Error: both tasks must belong to the same project")
        if await _depends_on(upstream.id, task.id):
            return Response.text(
                f"Error: task #{upstream.id} already depends on #{task.id}; this would form a cycle"
            )

        actor = await task_actor(arguments.get("actor_agent_id"))
        try:
            (await TaskRules.for_project(task.project_id)).require_identity(actor)
        except TaskRuleRejectedError as exc:
            return Response.text(f"Error: {exc}")

        hard = bool(arguments.get("hard"))
        existing = (
            await TaskDependency.where("task_id", task.id)
            .where("depends_on_task_id", upstream.id)
            .first()
        )
        if existing:
            await existing.update({"hard": hard})
        else:
            await TaskDependency.create(
                {"task_id": task.id, "depends_on_task_id": upstream.id, "hard": hard}
            )
        await record_task_event(
            task.id,
            actor.agent_id,
            task.status,
            task.status,
            {"depends_on": upstream.id, "hard": hard},
        )
        return Response.text(
            f"Task #{task.id} now depends on #{upstream.id}{' (hard)' if hard else ''}."
        )


async def _depends_on(task_id: int, target_id: int) -> bool:
    seen = set()
    frontier = [task_id]
    while frontier:
        current = frontier.pop()
        if current == target_id:
            return True
        if current in seen:
            continue
        seen.add(current)
        dependencies = await TaskDependency.where("task_id", current).get()
        frontier.extend(d.depends_on_task_id for d in dependencies)
    return False


# ── send_message_to_agent ─────────────────────────────────────────────────────


class SendMessageInput(BaseModel):
    sender_agent_id: int = Field(description="Your own agent ID (numeric).")
    receiver_agent_id: Union[int, str] = Field(
        description="The ID (numeric) or name of the agent to send the message to."
    )
    message: str = Field(description="The message content to send.")


class SendMessageTool(Tool):
    name = "send_message_to_agent"
    description = (
        "Send a message from this agent to another agent. "
        "receiver_agent_id accepts either a numeric agent ID or the agent's name. "
        "If the target agent is active, the message is delivered immediately to its terminal. "
        "Otherwise it is queued and delivered when it next connects."
    )

    def schema(self):
        return SendMessageInput

    async def handle(self, arguments: dict) -> Response:
        from app.actions.agent_message_send_action import AgentMessageSendAction
        from app.models.Agent import Agent

        # Validate required fields explicitly so callers get a clear error message
        missing = [
            f
            for f in ("sender_agent_id", "receiver_agent_id", "message")
            if f not in arguments or arguments[f] is None
        ]
        if missing:
            return Response.text(
                f"Error: missing required parameter(s): {', '.join(missing)}. "
                "Expected: sender_agent_id (int), receiver_agent_id (int or agent name), message (str)."
            )

        sender_id = arguments["sender_agent_id"]
        if not isinstance(sender_id, int):
            try:
                sender_id = int(sender_id)
            except (TypeError, ValueError):
                return Response.text(
                    f"Error: sender_agent_id must be a numeric agent ID, got '{sender_id}'. "
                    "Expected: sender_agent_id (int), receiver_agent_id (int or agent name), message (str)."
                )

        sender = await Agent.find(sender_id)
        if not sender:
            return Response.text(f"Error: agent #{sender_id} not found")
        if getattr(sender, "deleted_at", None):
            return Response.text(f"Error: agent #{sender_id} not found or has been deleted")

        # receiver_agent_id accepts int ID or string name
        raw_receiver = arguments["receiver_agent_id"]
        receiver = None
        if isinstance(raw_receiver, int) or (
            isinstance(raw_receiver, str) and raw_receiver.isdigit()
        ):
            receiver = await Agent.find(int(raw_receiver))
            if not receiver:
                return Response.text(f"Error: agent #{raw_receiver} not found")
            if getattr(receiver, "deleted_at", None):
                return Response.text(f"Error: agent #{raw_receiver} not found or has been deleted")
        else:
            # Look up by name (case-insensitive), skip deleted agents
            all_agents = await Agent.where_null("deleted_at").get()
            name_lower = str(raw_receiver).lower()
            for a in all_agents:
                if (a.name or "").lower() == name_lower:
                    receiver = a
                    break
            if not receiver:
                return Response.text(
                    f"Error: no agent found with name '{raw_receiver}'. "
                    "Use list_agents to see available agents and their IDs."
                )

        content = str(arguments["message"]).strip()
        if not content:
            return Response.text("Error: message cannot be empty")

        msg_id, delivered = await AgentMessageSendAction.prepare(
            sender, receiver, content
        ).execute()

        if delivered:
            return Response.text(f"Message delivered to agent '{receiver.name}' (#{msg_id})")
        return Response.text(
            f"Message queued for agent '{receiver.name}' (#{msg_id}) — will be delivered when Claude is ready"
        )


# ── get_agent_messages ────────────────────────────────────────────────────────


class GetAgentMessagesInput(BaseModel):
    project_path: str = Field(
        description="Absolute path of the project (use current working directory)."
    )
    unread_only: bool = Field(
        default=False, description="If true, return only unread/pending messages."
    )


class GetAgentMessagesTool(Tool):
    name = "get_agent_messages"
    description = "Get messages in the inbox for this agent (sent from other agents)."

    def schema(self):
        return GetAgentMessagesInput

    async def handle(self, arguments: dict) -> Response:
        from app.models.AgentMessage import AgentMessage

        project = await _project_by_path(arguments["project_path"])
        if not project:
            return Response.text(
                f"Error: no Keera project found at path '{arguments['project_path']}'"
            )

        q = AgentMessage.where("receiver_project_id", project.id)
        if arguments.get("unread_only"):
            q = q.where("status", "pending")
        messages = await q.order_by("id", "asc").get()

        if not messages:
            return Response.text("No messages.")

        projects = await Project.all()
        proj_map = {p.id: p for p in projects}

        lines = []
        for m in messages:
            sender_name = (
                proj_map[m.sender_project_id].name
                if m.sender_project_id in proj_map
                else str(m.sender_project_id)
            )
            lines.append(f"[#{m.id}] [{m.status}] From {sender_name}: {m.content}")
        return Response.text("\n".join(lines))


# ── list_agents ───────────────────────────────────────────────────────────────


class ListAgentsInput(BaseModel):
    project_path: str = Field(
        description="Absolute path of the project (use the current working directory)."
    )


class ListAgentsTool(Tool):
    name = "list_agents"
    description = "List all agents registered in the current project."

    def schema(self):
        return ListAgentsInput

    async def handle(self, arguments: dict) -> Response:
        from app.models.Agent import Agent

        project = await _project_by_path(arguments["project_path"])
        if not project:
            return Response.text(
                f"Error: no Keera project found at path '{arguments['project_path']}'"
            )

        agents = await Agent.where("project_id", project.id).where_null("deleted_at").get()
        if not agents:
            return Response.text("No agents registered in this project.")

        lines = [f"Agents in '{project.name}' (project_id={project.id}):"]
        for a in agents:
            health = agent_health(a, has_live_session(a))
            note = f", note: {a.heartbeat_note}" if a.heartbeat_note else ""
            lines.append(
                f"  - {a.name} (ID: {a.id}, type: {a.agent_type}, provider: {a.provider}, "
                f"status: {a.status}, health: {health}, last heartbeat: {heartbeat_age(a)}{note})"
            )
        return Response.text("\n".join(lines))


# ── spawn_agent ───────────────────────────────────────────────────────────────


class SpawnAgentInput(BaseModel):
    project_path: str = Field(
        description="Absolute path of the project (use the current working directory)."
    )
    name: str = Field(
        description="Short display name for the agent (e.g. 'Backend Engineer', 'QA Bot')."
    )
    agent_type: str = Field(
        pattern=AgentType.pattern(),
        description="Role type for the agent.",
    )
    message: Optional[str] = Field(
        default=None,
        description="Initial task or instruction to send to the agent after it starts. Omit to create an idle agent.",
    )
    provider: Optional[Literal["codex", "claude", "gemini"]] = Field(
        default=None,
        description="Agent backend to run (codex, claude or gemini). Omit to use the configured default.",
    )
    complexity: str = Field(
        pattern="^(easy|medium|hard)$",
        description=(
            "Task complexity (easy|medium|hard). REQUIRED — it selects the model "
            "configured for that tier in Settings > Providers; without a saved choice "
            "codex uses gpt-5.6-luna/gpt-5.6-terra/gpt-5.6-sol and claude uses "
            "claude-sonnet-5/claude-opus-5/claude-fable-5; gemini uses gemini-3.8-flash for all tiers."
        ),
    )
    task_id: Optional[int] = Field(
        default=None, description="ID of the task this agent is working on."
    )
    from_agent_id: Optional[int] = Field(
        default=None,
        description="ID of the agent spawning this one. Sets orchestrator_id on the new agent.",
    )


class SpawnAgentTool(Tool):
    name = "spawn_agent"
    description = (
        "Create a new agent in the current project and optionally start it with an initial task. "
        "The new agent will appear in the sidebar immediately. "
        f"Use this to delegate work to specialist agents ({', '.join(t.value for t in AgentType)}). "
        "Provider defaults to the configured default provider; complexity selects the model configured for that "
        "tier in Settings > Providers, defaulting to "
        "gpt-5.6-luna/gpt-5.6-terra/gpt-5.6-sol for codex "
        "and claude-sonnet-5/claude-opus-5/claude-fable-5 for claude; gemini-3.8-flash for all gemini tiers."
    )

    def schema(self):
        return SpawnAgentInput

    async def handle(self, arguments: dict) -> Response:
        import asyncio

        from fastapi_startkit.application import app as _app

        from app.actions.agent_create_action import AgentCreateAction
        from app.controllers.global_settings_controller import read_global_settings
        from app.models.Agent import Agent as _Agent
        from app.requests.agent_requests import AgentStoreRequest
        from app.terminal.connection_manager import ConnectionManager

        name = (arguments.get("name") or "").strip()
        if not name:
            return Response.text("Error: name is required")

        # A spawned agent must always belong to the same project as the
        # orchestrator that spawned it. When from_agent_id is supplied the project
        # is derived from the orchestrator and the caller-supplied project_path is
        # ignored — a caller must not be able to place a spawned agent in another
        # project. We fall back to project_path only when there is no orchestrator
        # (e.g. the non-MCP creation paths).
        from_agent_id = arguments.get("from_agent_id")
        orchestrator = None
        if from_agent_id is not None:
            orchestrator = await _Agent.where("id", from_agent_id).where_null("deleted_at").first()
            if not orchestrator:
                return Response.text(f"Error: orchestrator agent #{from_agent_id} not found")

        if orchestrator is not None:
            project = await Project.find(orchestrator.project_id)
            if not project:
                return Response.text(
                    f"Error: orchestrator agent #{from_agent_id} is not attached to a valid project"
                )
        else:
            project = await _project_by_path(arguments["project_path"])
            if not project:
                return Response.text(
                    f"Error: no Keera project found at path '{arguments['project_path']}'"
                )

        # Enforce per-project agent limit before creating
        settings = await read_global_settings()
        limit = int(settings.get("max_agents_per_project", 10))
        count = await _Agent.where("project_id", project.id).where_null("deleted_at").count()
        if count >= limit:
            return Response.text(
                f"Error: agent limit ({limit}) reached for project '{project.name}'. Delete an agent first."
            )

        # Build the request outside the try so a validation error (e.g. a missing
        # or invalid complexity) surfaces instead of being swallowed as an
        # "Error:" string — only the limit ValueError from execute() is caught.
        complexity = arguments.get("complexity")
        provider = arguments.get("provider")
        if provider is not None:
            from app.ai import providers

            try:
                providers.get(provider)
            except ValueError as exc:
                return Response.text(f"Error: {exc}")
        request_data = {
            "name": name,
            "agent_type": arguments.get("agent_type", DEFAULT_AGENT_TYPE.value),
            "complexity": complexity,
            "description": f"{name} agent",
            # system_prompt is intentionally not forwarded: spawned agents
            # always use their role-based default prompt and a caller must
            # not be able to override an agent's role at spawn time.
            "system_prompt": None,
            "task_id": arguments.get("task_id"),
            "orchestrator_id": arguments.get("from_agent_id"),
        }
        if provider is not None:
            request_data["provider"] = provider
        request = AgentStoreRequest(**request_data)
        if arguments.get("message"):
            from app.services.gemini_cli import validate_gemini_cli

            try:
                await asyncio.to_thread(validate_gemini_cli, request.provider)
            except RuntimeError as exc:
                return Response.text(f"Error: {exc}")
        try:
            agent = await AgentCreateAction(project_id=project.id, request=request).execute()
        except ValueError as e:
            return Response.text(f"Error: {e}")

        cwd = os.path.expanduser(project.path)

        payload = json.dumps(
            {
                "type": "agent_created",
                "agent": {
                    "id": agent.id,
                    "project_id": agent.project_id,
                    "name": agent.name,
                    "description": agent.description,
                    "provider": agent.provider,
                    "model": agent.model,
                    "system_prompt": agent.system_prompt,
                    "agent_type": agent.agent_type,
                    "status": agent.status,
                    "task_id": getattr(agent, "task_id", None),
                    "created_at": str(agent.created_at) if agent.created_at else None,
                },
            }
        )
        conn_manager: ConnectionManager = _app().make("connections")
        for bridge in conn_manager.all_for_cwd(cwd):
            try:
                await bridge.write(payload)
            except Exception:
                pass

        message = (arguments.get("message") or "").strip()
        if message:
            from app.controllers.agent_trigger_controller import _spawn_headless_agent

            asyncio.create_task(_spawn_headless_agent(agent, project, cwd, message))
            return Response.text(
                f"Agent '{name}' created (ID: {agent.id}) and starting with task: {message}"
            )

        return Response.text(
            f"Agent '{name}' created (ID: {agent.id}). Use send_message_to_agent to send it a task."
        )


# ── get_orchestrated_agents ───────────────────────────────────────────────────


class GetOrchestratedAgentsInput(BaseModel):
    agent_id: int = Field(description="Your own agent ID.")


class GetOrchestratedAgentsTool(Tool):
    name = "get_orchestrated_agents"
    description = (
        "Return all agents that you have orchestrated (spawned). "
        "Shows their current status so you can track progress across your sub-agents."
    )

    def schema(self):
        return GetOrchestratedAgentsInput

    async def handle(self, arguments: dict) -> Response:
        from app.models.Agent import Agent

        orchestrator_id = arguments.get("agent_id")
        if not orchestrator_id:
            return Response.text("Error: agent_id is required")

        agents = await Agent.where("orchestrator_id", orchestrator_id).order_by("id", "asc").get()

        if not agents:
            return Response.text("You have not orchestrated any agents yet.")

        rows = []
        for a in agents:
            rows.append(
                {
                    "id": a.id,
                    "name": a.name,
                    "agent_type": a.agent_type,
                    "status": getattr(a, "status", "unknown"),
                    "active": bool(getattr(a, "session_id", None)),
                    "health": agent_health(a, has_live_session(a)).value,
                    "last_heartbeat_at": str(a.last_heartbeat_at) if a.last_heartbeat_at else None,
                    "heartbeat_note": a.heartbeat_note,
                    "worktree_branch": a.worktree_branch,
                    "worktree_head_sha": a.worktree_head_sha,
                    "worktree_last_change_at": str(a.worktree_last_change_at)
                    if a.worktree_last_change_at
                    else None,
                }
            )

        total = len(rows)
        active = sum(1 for r in rows if r["active"])
        summary = f"Orchestrated agents: {total} total, {active} active\n\n"
        return Response.text(summary + json.dumps(rows, indent=2))


# ── delete_agent ──────────────────────────────────────────────────────────────


class DeleteAgentInput(BaseModel):
    agent_id: int = Field(description="ID of the agent to delete.")
    reason: Optional[str] = Field(
        default=None, description="Why the agent is being deleted; reported to its orchestrator."
    )


class DeleteAgentTool(Tool):
    name = "delete_agent"
    description = (
        "Soft-delete an agent by ID. "
        "The agent is marked as deleted (deleted_at is set) and will no longer appear in agent lists. "
        "Its in-progress task goes back to pending, unassigned, and its orchestrator (else the "
        "project's PM) is told. Use this to remove agents that are no longer needed."
    )

    def schema(self):
        return DeleteAgentInput

    async def handle(self, arguments: dict) -> Response:
        import asyncio

        from app.actions.agent_delete_action import AgentDeleteAction
        from app.models.Agent import Agent
        from app.services.worktree_cleanup import cleanup_agent_worktree

        agent_id = arguments.get("agent_id")
        if not agent_id:
            return Response.text("Error: agent_id is required")

        agent = await Agent.find(agent_id)
        if not agent:
            return Response.text(f"Error: no agent found with ID {agent_id}")

        if getattr(agent, "deleted_at", None):
            return Response.text(f"Error: agent {agent_id} has already been deleted")

        if not await AgentDeleteAction(agent, arguments.get("reason")).execute():
            return Response.text(f"Error: agent {agent_id} is still listed after the delete")

        text = f"Agent '{agent.name}' (ID: {agent_id}) has been deleted."
        project = await Project.find(agent.project_id)
        if project:
            results = await asyncio.to_thread(
                cleanup_agent_worktree, os.path.expanduser(project.path), agent.id
            )
            kept = [r["error"] for r in results if r["error"]]
            if kept:
                text += " Worktree kept: " + "; ".join(kept)
        return Response.text(text)


# ── heartbeat ─────────────────────────────────────────────────────────────────


class HeartbeatInput(BaseModel):
    agent_id: int = Field(description="Your own agent ID.")
    note: Optional[str] = Field(
        default=None,
        description="Short status, e.g. 'running tests' or 'waiting on review' (max 140 chars).",
    )


class HeartbeatTool(Tool):
    name = "heartbeat"
    description = (
        "Tell the relay you are alive during long silent work (call every 30-60 s). "
        "The optional note is shown to your orchestrator in list_agents."
    )

    def schema(self):
        return HeartbeatInput

    async def handle(self, arguments: dict) -> Response:
        from app.models.Agent import Agent

        agent = await Agent.where("id", arguments.get("agent_id")).where_null("deleted_at").first()
        if not agent:
            return Response.text(f"Error: agent #{arguments.get('agent_id')} not found")
        await record_heartbeat(agent.id, arguments.get("note"))
        return Response.text(f"Heartbeat recorded for agent '{agent.name}'.")


# ── tool list ─────────────────────────────────────────────────────────────────

KEERA_TOOLS = [
    CreateTaskTool,
    ListTasksTool,
    GetTaskTool,
    UpdateTaskTool,
    UpdateTaskStatusTool,
    DeleteTaskTool,
    GetTaskHistoryTool,
    RecordMergeTool,
    AddTaskDependencyTool,
    SendMessageTool,
    GetAgentMessagesTool,
    ListAgentsTool,
    SpawnAgentTool,
    GetOrchestratedAgentsTool,
    DeleteAgentTool,
    HeartbeatTool,
]
