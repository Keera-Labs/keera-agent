from pathlib import Path


def write_antigravity_rules(
    agent_id: int, system_prompt_file: str | None, storage: Path | None = None
) -> str | None:
    if not system_prompt_file:
        return None
    storage = storage or Path(__file__).resolve().parents[2] / "storage" / "antigravity"
    directory = storage / f"agent-{agent_id}"
    rules = directory / ".agents" / "rules"
    rules.mkdir(parents=True, exist_ok=True)
    prompt = Path(system_prompt_file).read_text()
    (rules / "keera-agent.md").write_text(f"---\ntrigger: always_on\n---\n{prompt}")
    return str(directory)
