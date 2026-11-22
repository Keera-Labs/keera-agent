from pathlib import Path

ANTIGRAVITY_TOOLS = (
    "read_file",
    "edit_file",
    "write_file",
    "run_command",
    "manage_task",
    "search_web",
    "schedule",
    "generate_image",
    "send_message",
)


def write_antigravity_agent(
    agent_id: int, system_prompt_file: str | None, directory: Path | None = None
) -> str:
    directory = directory or Path.home() / ".gemini" / "config" / "agents"
    directory.mkdir(parents=True, exist_ok=True)
    name = f"keera-agent-{agent_id}"
    prompt = Path(system_prompt_file).read_text() if system_prompt_file else ""
    (directory / f"{name}.md").write_text(
        f"---\nname: {name}\ndescription: Keera agent {agent_id}\n"
        f"tools: [{', '.join(ANTIGRAVITY_TOOLS)}]\n---\n{prompt}"
    )
    return name
