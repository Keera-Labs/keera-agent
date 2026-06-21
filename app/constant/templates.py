from pydantic import BaseModel, Field


class AgentTemplateSeed(BaseModel):
    """A built-in agent template definition seeded into the agent_templates table."""
    name: str
    description: str
    agent_type: str
    model: str = "claude-opus-4-8"
    dangerously_skip_permissions: bool = True
    plan_mode: bool = False
    flags: dict = Field(default_factory=dict)


AGENT_TEMPLATES: list[AgentTemplateSeed] = [
    AgentTemplateSeed(
        name="PM",
        description="Project Manager — coordinates work, delegates tasks, never touches code.",
        agent_type="pm",
        plan_mode=True,
        dangerously_skip_permissions=True,
        model="claude-opus-4-8"
    ),
    AgentTemplateSeed(
        name="Software Engineer",
        description="Creates worktrees, implements features, opens PRs, reports back to PM.",
        agent_type="software_engineer",
        dangerously_skip_permissions=True,
        model="claude-opus-4-6"
    ),
    AgentTemplateSeed(
        name="QA",
        description="Checks out branches, runs tests, browser tests, reports pass/fail and bugs to PM.",
        agent_type="qa",
        dangerously_skip_permissions=True,
        model="claude-opus-4-6"
    ),
    AgentTemplateSeed(
        name="Full Auto",
        description="Software Engineer with --dangerously-skip-permissions — no permission prompts.",
        agent_type="software_engineer",
        dangerously_skip_permissions=True,
        model="claude-opus-4-6"
    ),
]
