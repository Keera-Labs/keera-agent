import re

from app.mcp.tools import KEERA_TOOLS
from app.utils.system_prompts import default_system_prompt
from tests.test_case import TestCase


def _mcp_section(prompt: str) -> str:
    return prompt[prompt.index("## MCP") : prompt.index("- Example:")]


class TestPmPrompt(TestCase):
    def setUp(self):
        super().setUp()
        self.prompt = default_system_prompt("pm")

    def test_documents_only_existing_tools(self):
        documented = set(re.findall(r"^- `([a-z_]+)`", _mcp_section(self.prompt), re.MULTILINE))

        self.assertLessEqual(documented, {tool.name for tool in KEERA_TOOLS})
        self.assertGreaterEqual(
            documented,
            {"record_merge", "add_task_dependency", "get_task_history", "delete_agent"},
        )

    def test_respawns_by_health_state_not_by_ack_timeout(self):
        for state in ("healthy", "quiet", "stalled", "dead"):
            self.assertIn(f"- `{state}` — ", self.prompt)
        self.assertNotRegex(self.prompt, r"30\s*sec|30-60|30 seconds")
        self.assertIn("ACK task #<id>", self.prompt)

    def test_documents_delete_reason_and_automatic_requeue(self):
        self.assertIn("`delete_agent` — remove an agent; pass a short `reason`", self.prompt)
        self.assertIn("`delete_agent` requeues the agent's task for you", self.prompt)
        self.assertIn("Do not reset the task's status or assignees by hand.", self.prompt)

    def test_teaches_approved_sha_merge_flow(self):
        self.assertIn("--match-head-commit <approved_sha>", self.prompt)
        self.assertIn("Call `record_merge` for the task.", self.prompt)

    def test_sets_feature_done_right_after_merge_so_hard_dependents_unblock(self):
        self.assertIn("set the feature task `done`", self.prompt)
        self.assertIn("Never wait for its dependents first", self.prompt)
        self.assertNotIn("once everything that depends on it is finished", self.prompt)

    def test_respawns_only_when_the_delete_notice_requeued_the_task(self):
        self.assertIn("only when the message says the task `is now created`", self.prompt)
        self.assertIn("ignore notices for your own `work merged` deletes", self.prompt)
        self.assertNotIn("its task is already requeued to `created`; respawn", self.prompt)

    def test_reviewer_approves_the_feature_task_and_side_tasks_close_as_cancelled(self):
        self.assertIn("always on the **feature** task that owns the PR", self.prompt)
        self.assertIn("give the reviewer the **feature task's ID**", self.prompt)
        self.assertIn("close it with `cancelled`", self.prompt)

    def test_actor_id_only_on_writes_and_push_does_not_revoke_approval(self):
        self.assertIn("`actor_agent_id` on every task write", self.prompt)
        self.assertIn("A push alone does not revoke the approval.", self.prompt)

    def test_orders_dependent_tasks_with_dependencies(self):
        self.assertIn("link each one with `add_task_dependency`", self.prompt)
        self.assertNotIn("Wait for the feature PR to be merged", self.prompt)
