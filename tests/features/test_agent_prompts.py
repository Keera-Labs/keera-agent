import re

from app.mcp.tools import KEERA_TOOLS
from app.services.task_policy import ALLOWED_TRANSITIONS, ASSIGNEE_TARGETS, REVIEWER_TARGETS
from app.utils.system_prompts import default_system_prompt
from tests.test_case import TestCase

ENGINEER_TYPES = ("software_engineer", "software_engineer_frontend")
TOOL_NAME = re.compile(
    r"`((?:get|list|update|send|record|create|delete|spawn|add|set|approve)_[a-z_]+)`"
)


def _documented_tools(prompt: str) -> set[str]:
    return set(TOOL_NAME.findall(prompt))


class TestEngineerPrompts(TestCase):
    def test_names_only_existing_tools(self):
        for agent_type in ENGINEER_TYPES:
            with self.subTest(agent_type=agent_type):
                documented = _documented_tools(default_system_prompt(agent_type))
                self.assertLessEqual(documented, {tool.name for tool in KEERA_TOOLS})
                self.assertIn("update_task", documented)

    def test_walks_the_assignee_lifecycle(self):
        for agent_type in ENGINEER_TYPES:
            with self.subTest(agent_type=agent_type):
                prompt = default_system_prompt(agent_type)
                self.assertIn("`update_task_status` → `acked`", prompt)
                self.assertIn("→ `in_progress` as you start the work", prompt)
                self.assertIn("`update_task_status` → `in_review`", prompt)
                self.assertIn("`pr_number`, `pr_url`, `branch` and `head_sha`", prompt)
                self.assertIn("`changes_requested`, set `in_progress`", prompt)
                self.assertNotIn("`completed`", prompt)

    def test_sets_only_statuses_an_assignee_may_reach(self):
        self.assertIn(
            "You set only `acked`, `in_progress`, `in_review` and `blocked` on your own task.",
            default_system_prompt("software_engineer"),
        )
        self.assertLessEqual({"acked", "in_progress", "in_review"}, ASSIGNEE_TARGETS)
        self.assertIn("blocked", ALLOWED_TRANSITIONS["in_progress"])
        self.assertIn("in_progress", ALLOWED_TRANSITIONS["blocked"])
        self.assertIn("in_progress", ALLOWED_TRANSITIONS["changes_requested"])

    def test_never_merges_and_reports_head_sha(self):
        for agent_type in ENGINEER_TYPES:
            with self.subTest(agent_type=agent_type):
                prompt = default_system_prompt(agent_type)
                self.assertIn("the PM merges", prompt)
                self.assertIn("head SHA", prompt)
                self.assertIn("`actor_agent_id` on every task write", prompt)


class TestReviewerPrompt(TestCase):
    def setUp(self):
        super().setUp()
        self.prompt = default_system_prompt("reviewer")

    def test_names_only_existing_tools(self):
        documented = _documented_tools(self.prompt)

        self.assertLessEqual(documented, {tool.name for tool in KEERA_TOOLS})
        self.assertGreaterEqual(documented, {"update_task_status", "update_task"})

    def test_approves_a_specific_head_sha_on_the_feature_task(self):
        self.assertIn("`status` = `approved` and `head_sha` = the SHA you reviewed", self.prompt)
        self.assertIn("never on your own review task", self.prompt)
        self.assertIn("`APPROVE at <sha>`", self.prompt)
        self.assertIn("gh pr view <number> --json headRefOid", self.prompt)
        self.assertEqual({"approved", "changes_requested"}, REVIEWER_TARGETS)
        self.assertIn("approved", ALLOWED_TRANSITIONS["in_review"])

    def test_requests_changes_with_specifics(self):
        self.assertIn("`update_task_status` → `changes_requested`", self.prompt)
        self.assertIn("`review_note`", self.prompt)

    def test_falls_back_to_a_comment_when_self_review_is_refused(self):
        self.assertIn("`gh pr comment`", self.prompt)

    def test_never_merges(self):
        self.assertIn("Never merge PRs", self.prompt)
        self.assertIn("never set `merged`, `done` or `cancelled`", self.prompt)
