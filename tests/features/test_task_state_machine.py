import asyncio
import json

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.actions.claude_hook_action import agent_env
from app.mcp.server import _bind_caller_identity
from app.mcp.tools import (
    AddTaskDependencyTool,
    CreateTaskTool,
    DeleteTaskTool,
    GetTaskHistoryTool,
    GetTaskTool,
    ListTasksTool,
    RecordMergeTool,
    UpdateTaskStatusTool,
    UpdateTaskTool,
)
from app.models.Agent import Agent
from app.models.Project import Project
from app.models.Task import Task
from app.models.TaskEvent import TaskEvent
from app.resources.agent_resource import AgentResource
from app.services.relay_identity import (
    AGENT_TOKEN_ENV,
    RelayCaller,
    acting_as,
    issue_agent_token,
    resolve_caller,
)
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from databases.factories.task_factory import TaskFactory
from tests.test_case import TestCase

HEAD = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"
OTHER_HEAD = "ffffeeee5f60718293a4b5c6d7e8f9012345678"


def _text(response) -> str:
    content = response.to_content()
    return content[0]["text"] if content else ""


class TaskStateMachineCase(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()
        self.pm = await AgentFactory.new().create(project_id=self.project.id, agent_type="pm")
        self.reviewer = await AgentFactory.new().create(
            project_id=self.project.id, agent_type="reviewer"
        )

    async def _task(self, **overrides) -> Task:
        return await TaskFactory.new().create(project_id=self.project.id, **overrides)

    async def _status(self, task: Task, status: str, **arguments) -> str:
        return _text(
            await UpdateTaskStatusTool().handle({"task_id": task.id, "status": status, **arguments})
        )

    async def _enforce(self):
        await Project.where("id", self.project.id).update({"task_rules": "enforce"})

    async def _reload(self, task: Task) -> Task:
        return await Task.find(task.id)


class TestTransitionsInWarnMode(TaskStateMachineCase):
    async def test_illegal_transition_is_applied_with_a_warning(self):
        task = await self._task(status="created")

        text = await self._status(task, "done", actor_agent_id=self.pm.id)

        self.assertNotIn("Error", text)
        self.assertIn("Warning: illegal transition created → done", text)
        self.assertEqual((await self._reload(task)).status, "done")

    async def test_legacy_statuses_are_still_accepted(self):
        task = await self._task(status="pending")

        await self._status(task, "in_progress")
        text = await self._status(task, "completed", actor_agent_id=self.pm.id)

        self.assertNotIn("Error", text)
        reloaded = await self._reload(task)
        self.assertEqual(reloaded.status, "completed")
        self.assertIsNotNone(reloaded.completed_at)

    async def test_every_status_change_is_recorded(self):
        task = await self._task(status="created")

        await self._status(task, "assigned", actor_agent_id=self.pm.id)

        event = await TaskEvent.where("task_id", task.id).order_by("id", "desc").first()
        self.assertEqual((event.from_status, event.to_status), ("created", "assigned"))
        self.assertEqual(event.actor_agent_id, self.pm.id)


class TestTransitionsInEnforceMode(TaskStateMachineCase):
    async def test_illegal_transition_is_rejected(self):
        await self._enforce()
        task = await self._task(status="created")

        text = await self._status(task, "done", actor_agent_id=self.pm.id)

        self.assertIn("Error: illegal transition created → done", text)
        self.assertEqual((await self._reload(task)).status, "created")

    async def test_legal_transition_passes(self):
        await self._enforce()
        task = await self._task(status="created")

        text = await self._status(task, "assigned", actor_agent_id=self.pm.id)

        self.assertNotIn("Error", text)
        self.assertNotIn("Warning", text)

    async def test_ownership_stays_advisory_while_an_agent_lacks_a_token(self):
        await self._enforce()
        await AgentFactory.new().create(project_id=self.project.id, session_id="live")
        task = await self._task(status="in_review")

        text = await self._status(task, "approved", head_sha=HEAD)

        self.assertIn("Warning: only a reviewer may set approved", text)
        self.assertEqual((await self._reload(task)).status, "approved")

    async def test_ownership_is_enforced_once_every_live_agent_carries_a_token(self):
        await self._enforce()
        engineer = await AgentFactory.new().create(project_id=self.project.id, session_id="live")
        await issue_agent_token(engineer.id)
        task = await self._task(status="in_review")

        with acting_as(RelayCaller(agent=engineer, token_presented=True)):
            text = await self._status(task, "approved", head_sha=HEAD)

        self.assertIn("Error: only a reviewer may set approved", text)

    async def test_tokenless_write_is_rejected_once_ownership_is_enforced(self):
        await self._enforce()
        engineer = await AgentFactory.new().create(project_id=self.project.id, session_id="live")
        await issue_agent_token(engineer.id)
        task = await self._task(status="created")

        text = await self._status(task, "assigned", actor_agent_id=self.pm.id)

        self.assertIn("Error: caller unidentified", text)


class TestMergeGate(TaskStateMachineCase):
    async def test_approved_requires_head_sha(self):
        await self._enforce()
        task = await self._task(status="in_review")

        text = await self._status(task, "approved", actor_agent_id=self.reviewer.id)

        self.assertIn("Error: approved requires head_sha", text)

    async def test_approval_stores_the_approved_sha(self):
        task = await self._task(status="in_review")

        await self._status(task, "approved", head_sha=HEAD, actor_agent_id=self.reviewer.id)

        reloaded = await self._reload(task)
        self.assertEqual(reloaded.approved_sha, HEAD)
        self.assertEqual(reloaded.head_sha, HEAD)

    async def test_merged_cannot_be_set_through_update_task_status(self):
        await self._enforce()
        task = await self._task(status="approved", approved_sha=HEAD)

        text = await self._status(task, "merged", actor_agent_id=self.pm.id)

        self.assertIn("Error: merged is set only by record_merge", text)

    async def test_record_merge_with_matching_sha_moves_to_merged(self):
        task = await self._task(status="approved", approved_sha=HEAD)

        text = _text(
            await RecordMergeTool().handle(
                {"task_id": task.id, "merged_sha": HEAD[:12], "actor_agent_id": self.pm.id}
            )
        )

        self.assertNotIn("Error", text)
        reloaded = await self._reload(task)
        self.assertEqual(reloaded.status, "merged")
        self.assertEqual(reloaded.merged_sha, HEAD[:12])

    async def test_record_merge_with_different_sha_sends_task_back_to_review(self):
        task = await self._task(status="approved", approved_sha=HEAD)

        text = _text(
            await RecordMergeTool().handle(
                {"task_id": task.id, "merged_sha": OTHER_HEAD, "actor_agent_id": self.pm.id}
            )
        )

        self.assertIn("does not match approved_sha", text)
        reloaded = await self._reload(task)
        self.assertEqual(reloaded.status, "in_review")
        self.assertIsNone(reloaded.approved_sha)

    async def test_record_merge_needs_an_approved_task(self):
        task = await self._task(status="in_review")

        text = _text(
            await RecordMergeTool().handle(
                {"task_id": task.id, "merged_sha": HEAD, "actor_agent_id": self.pm.id}
            )
        )

        self.assertIn("is not approved", text)

    async def test_new_head_after_approval_revokes_it(self):
        task = await self._task(status="approved", approved_sha=HEAD, head_sha=HEAD)

        text = _text(await UpdateTaskTool().handle({"task_id": task.id, "head_sha": OTHER_HEAD}))

        self.assertIn("back in in_review", text)
        reloaded = await self._reload(task)
        self.assertEqual(reloaded.status, "in_review")
        self.assertIsNone(reloaded.approved_sha)

    async def test_same_head_keeps_the_approval(self):
        task = await self._task(status="approved", approved_sha=HEAD, head_sha=HEAD)

        await UpdateTaskTool().handle({"task_id": task.id, "head_sha": HEAD})

        self.assertEqual((await self._reload(task)).status, "approved")


class TestDependencies(TaskStateMachineCase):
    async def _depend(self, task: Task, upstream: Task, hard: bool = False) -> str:
        return _text(
            await AddTaskDependencyTool().handle(
                {"task_id": task.id, "depends_on_task_id": upstream.id, "hard": hard}
            )
        )

    async def test_blocked_task_warns_in_warn_mode(self):
        upstream = await self._task(status="in_progress")
        task = await self._task(status="assigned")
        await self._depend(task, upstream)

        text = await self._status(task, "acked")

        self.assertIn(f"Warning: task #{task.id} is blocked by #{upstream.id}", text)

    async def test_blocked_task_is_rejected_in_enforce_mode(self):
        await self._enforce()
        upstream = await self._task(status="in_progress")
        task = await self._task(status="assigned")
        await self._depend(task, upstream)

        text = await self._status(task, "acked")

        self.assertIn(f"Error: task #{task.id} is blocked by #{upstream.id}", text)

    async def test_soft_dependency_is_met_at_in_review(self):
        await self._enforce()
        upstream = await self._task(status="in_review")
        task = await self._task(status="assigned")
        await self._depend(task, upstream)

        self.assertNotIn("blocked by", await self._status(task, "acked"))

    async def test_hard_dependency_waits_for_done(self):
        await self._enforce()
        upstream = await self._task(status="in_review")
        task = await self._task(status="assigned")
        await self._depend(task, upstream, hard=True)

        self.assertIn("blocked by", await self._status(task, "acked"))

    async def test_cycles_and_self_dependencies_are_rejected(self):
        first = await self._task()
        second = await self._task()
        await self._depend(second, first)

        self.assertIn("cycle", await self._depend(first, second))
        self.assertIn("itself", await self._depend(first, first))

    async def test_get_and_list_show_the_blocker(self):
        upstream = await self._task(status="in_progress")
        task = await self._task(status="created", title="Waiting task")
        await self._depend(task, upstream)

        detail = _text(await GetTaskTool().handle({"task_id": task.id}))
        listing = _text(await ListTasksTool().handle({"project_path": self.project.path}))

        self.assertIn(f"#{upstream.id}", detail.split("Blocked by:")[1])
        self.assertIn(f"blocked by #{upstream.id}", listing)


class TestAuditAndConcurrency(TaskStateMachineCase):
    async def _create(self, **arguments) -> str:
        return _text(
            await CreateTaskTool().handle(
                {
                    "project_path": self.project.path,
                    "title": "Idempotent task",
                    "acceptance_criteria": ["works"],
                    "testing_methods": ["unit"],
                    "validation_steps": ["qa"],
                    **arguments,
                }
            )
        )

    async def test_create_with_the_same_idempotency_key_returns_the_existing_task(self):
        first = await self._create(idempotency_key="relay-4065-a")
        second = await self._create(idempotency_key="relay-4065-a")

        task_id = first.split("Task #")[1].split(" ")[0].rstrip(":")
        self.assertIn(f"Task #{task_id}", second)
        self.assertIn("existing task", second)
        self.assertEqual(
            await Task.where("idempotency_key", "relay-4065-a").count(),
            1,
        )

    async def test_stale_update_is_refused(self):
        task = await self._task(updated_at="2026-01-01 00:00:00")

        text = _text(
            await UpdateTaskTool().handle(
                {"task_id": task.id, "title": "New", "expected_updated_at": "2025-01-01 00:00:00"}
            )
        )

        self.assertIn("Error", text)
        self.assertNotEqual((await self._reload(task)).title, "New")

    async def test_concurrent_writes_with_the_same_expected_updated_at_let_only_one_through(self):
        task = await self._task(updated_at="2026-01-01 00:00:00")

        results = await asyncio.gather(
            *(
                UpdateTaskTool().handle(
                    {
                        "task_id": task.id,
                        "title": f"Writer {n}",
                        "expected_updated_at": "2026-01-01 00:00:00",
                    }
                )
                for n in range(2)
            )
        )

        texts = [_text(result) for result in results]
        self.assertEqual(sum("Error" in text for text in texts), 1, texts)
        winner = next(t for t in texts if "Error" not in t)
        self.assertIn((await self._reload(task)).title, winner)

    async def test_a_second_write_in_the_same_second_still_moves_updated_at(self):
        task = await self._task()
        seen = str((await self._reload(task)).updated_at)

        await UpdateTaskTool().handle({"task_id": task.id, "title": "First"})
        await UpdateTaskTool().handle({"task_id": task.id, "title": "Second"})
        stale = _text(
            await UpdateTaskTool().handle(
                {"task_id": task.id, "title": "Stale", "expected_updated_at": seen}
            )
        )

        self.assertIn("Error", stale)
        self.assertEqual((await self._reload(task)).title, "Second")

    async def test_fresh_expected_updated_at_is_accepted(self):
        task = await self._task()
        current = str((await self._reload(task)).updated_at)

        text = _text(
            await UpdateTaskTool().handle(
                {"task_id": task.id, "title": "Fresh", "expected_updated_at": current}
            )
        )

        self.assertNotIn("Error", text)
        self.assertEqual((await self._reload(task)).title, "Fresh")

    async def test_head_moved_event_keeps_the_pre_revoke_status(self):
        task = await self._task(status="approved", approved_sha=HEAD, head_sha=HEAD)

        await UpdateTaskTool().handle({"task_id": task.id, "head_sha": OTHER_HEAD})

        events = await TaskEvent.where("task_id", task.id).order_by("id", "asc").get()
        transitions = [(event.from_status, event.to_status) for event in events]
        self.assertEqual(transitions, [("approved", "approved"), ("approved", "in_review")])

    async def test_soft_delete_hides_the_task_and_keeps_its_history(self):
        task = await self._task(status="created", title="Doomed")
        await self._status(task, "assigned", actor_agent_id=self.pm.id)

        await DeleteTaskTool().handle({"task_id": task.id, "actor_agent_id": self.pm.id})

        listing = _text(await ListTasksTool().handle({"project_path": self.project.path}))
        self.assertNotIn("Doomed", listing)
        self.assertIn("Deleted:", _text(await GetTaskTool().handle({"task_id": task.id})))
        history = _text(await GetTaskHistoryTool().handle({"task_id": task.id}))
        self.assertIn("created → assigned", history)
        self.assertIn("assigned → cancelled", history)

    async def test_delete_by_a_non_pm_warns(self):
        task = await self._task()

        text = _text(await DeleteTaskTool().handle({"task_id": task.id}))

        self.assertIn("Warning: only a pm may delete a task", text)


class TestRelayIdentity(TaskStateMachineCase):
    async def test_issued_token_resolves_to_its_agent(self):
        token = await issue_agent_token(self.pm.id)

        caller = await resolve_caller(token)

        self.assertEqual(caller.agent.id, self.pm.id)
        self.assertFalse(caller.rejected)

    async def test_reissuing_revokes_the_previous_token(self):
        old = await issue_agent_token(self.pm.id)
        await issue_agent_token(self.pm.id)

        self.assertTrue((await resolve_caller(old)).rejected)

    async def test_missing_token_is_anonymous_not_rejected(self):
        caller = await resolve_caller(None)

        self.assertIsNone(caller.agent)
        self.assertFalse(caller.rejected)

    async def test_binding_fills_the_actor_from_the_token(self):
        params = {"name": "update_task_status", "arguments": {"task_id": 1, "status": "acked"}}

        error = _bind_caller_identity(
            [UpdateTaskStatusTool], params, RelayCaller(agent=self.pm, token_presented=True)
        )

        self.assertIsNone(error)
        self.assertEqual(params["arguments"]["actor_agent_id"], self.pm.id)

    async def test_binding_rejects_a_claim_for_another_agent(self):
        params = {
            "name": "update_task_status",
            "arguments": {"task_id": 1, "status": "acked", "actor_agent_id": self.reviewer.id},
        }

        error = _bind_caller_identity(
            [UpdateTaskStatusTool], params, RelayCaller(agent=self.pm, token_presented=True)
        )

        self.assertIn("does not match the calling agent", error)

    async def test_binding_lets_an_unknown_token_through_as_anonymous(self):
        params = {"name": "update_task_status", "arguments": {"task_id": 1, "status": "acked"}}

        error = _bind_caller_identity(
            [UpdateTaskStatusTool], params, RelayCaller(token_presented=True)
        )

        self.assertIsNone(error)
        self.assertNotIn("actor_agent_id", params["arguments"])

    async def test_unknown_token_over_http_runs_the_call_with_a_warning(self):
        task = await self._task(title="Visible to anonymous callers")
        body = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "get_task", "arguments": {"task_id": task.id}},
        }

        response = await self.post(
            "/mcp",
            json=body,
            headers={"Content-Type": "application/json", "X-Keera-Agent-Token": "bogus"},
        )

        texts = [item["text"] for item in response.json()["result"]["content"]]
        self.assertIn("Visible to anonymous callers", texts[0])
        self.assertIn("Warning: unknown or revoked agent token", texts[-1])

    async def test_unexpanded_placeholder_is_treated_as_no_token(self):
        caller = await resolve_caller("${KEERA_AGENT_TOKEN}")

        self.assertFalse(caller.rejected)

    async def test_rejected_token_cannot_write_once_ownership_is_enforced(self):
        await self._enforce()
        engineer = await AgentFactory.new().create(project_id=self.project.id, session_id="live")
        await issue_agent_token(engineer.id)
        task = await self._task(status="created")

        with acting_as(RelayCaller(token_presented=True)):
            text = await self._status(task, "assigned")

        self.assertIn("Error: caller unidentified", text)

    async def test_relay_token_hash_never_leaves_the_server(self):
        await issue_agent_token(self.pm.id)
        agent = await Agent.find(self.pm.id)

        payload = AgentResource(agent).serialize()

        self.assertIsNotNone(agent.relay_token_hash)
        self.assertNotIn("relay_token_hash", json.dumps(payload))

    async def test_agent_env_carries_the_token(self):
        env = agent_env(self.pm.id, relay_token="secret")

        self.assertEqual(env[AGENT_TOKEN_ENV], "secret")


class TestTaskRulesEndpoint(TaskStateMachineCase):
    async def test_defaults_to_warn(self):
        response = await self.get(f"/api/projects/{self.project.id}/task-rules")

        response.assert_ok()
        self.assertEqual(response.json()["data"]["task_rules"], "warn")

    async def test_put_enforce_persists(self):
        response = await self.put(
            f"/api/projects/{self.project.id}/task-rules", json={"task_rules": "enforce"}
        )

        response.assert_ok()
        self.assertEqual(response.json()["data"]["task_rules"], "enforce")
        self.assertEqual((await Project.find(self.project.id)).task_rules, "enforce")

    async def test_unknown_project_is_404(self):
        response = await self.put("/api/projects/999999999/task-rules", json={"task_rules": "warn"})

        self.assertEqual(response.status_code, 404)

    async def test_rejects_unknown_modes(self):
        response = await self.put(
            f"/api/projects/{self.project.id}/task-rules", json={"task_rules": "strict"}
        )

        self.assertEqual(response.status_code, 422)
