from pydantic import BaseModel, Field

from app.constant.complexity import DEFAULT_MODEL


class AgentTemplateSeed(BaseModel):
    """A built-in agent template definition seeded into the agent_templates table."""

    name: str
    description: str
    agent_type: str
    model: str = DEFAULT_MODEL
    dangerously_skip_permissions: bool = True
    plan_mode: bool = False
    flags: dict = Field(default_factory=dict)


# All built-ins seed on DEFAULT_MODEL (the "Opus 5" tier); omit `model` to inherit it.
AGENT_TEMPLATES: list[AgentTemplateSeed] = [
    AgentTemplateSeed(
        name="PM",
        description="Project Manager — coordinates work, delegates tasks, never touches code.",
        agent_type="pm",
        # PM dispatches tasks and spawns agents (write ops via MCP); plan mode
        # would restrict it to read-only tools. See the reset_pm_plan_mode migration.
        plan_mode=False,
        dangerously_skip_permissions=True,
    ),
    AgentTemplateSeed(
        name="Software Engineer",
        description="Creates worktrees, implements features, opens PRs, reports back to PM.",
        agent_type="software_engineer",
        dangerously_skip_permissions=True,
    ),
    AgentTemplateSeed(
        name="QA",
        description="Checks out branches, runs tests, browser tests, reports pass/fail and bugs to PM.",
        agent_type="qa",
        dangerously_skip_permissions=True,
    ),
    AgentTemplateSeed(
        name="Full Auto",
        description="Software Engineer with --dangerously-skip-permissions — no permission prompts.",
        agent_type="software_engineer",
        dangerously_skip_permissions=True,
    ),
]
