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

    def test_orders_dependent_tasks_with_dependencies(self):
        self.assertIn("link each one with `add_task_dependency`", self.prompt)
        self.assertNotIn("Wait for the feature PR to be merged", self.prompt)
