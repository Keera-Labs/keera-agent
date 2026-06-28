import unittest

from app.models.Agent import Agent


def _agent(plan_mode: bool) -> Agent:
    agent = Agent()
    agent.id = 99
    agent.flags = None
    agent.model = None
    agent.system_prompt = None
    agent.plan_mode = plan_mode
    agent.dangerously_skip_permissions = True
    agent.use_worktree = False
    return agent


class TestPlanModeCommand(unittest.TestCase):
    def test_plan_mode_uses_cli_flag_not_skip_permissions(self):
        cmd = _agent(plan_mode=True).to_command()
        self.assertIn("--permission-mode plan", cmd)
        self.assertNotIn("--dangerously-skip-permissions", cmd)

    def test_non_plan_mode_skips_permissions_without_plan_flag(self):
        cmd = _agent(plan_mode=False).to_command()
        self.assertIn("--dangerously-skip-permissions", cmd)
        self.assertNotIn("--permission-mode", cmd)

    def test_plan_mode_does_not_inject_prompt_text(self):
        cmd = _agent(plan_mode=True).to_command()
        self.assertNotIn("PLAN-ONLY", cmd)


if __name__ == "__main__":
    unittest.main()
