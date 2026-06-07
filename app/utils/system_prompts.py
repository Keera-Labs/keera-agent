import pathlib as _pathlib

_PROMPTS_DIR = _pathlib.Path(__file__).parent.parent / "prompts"

# Keep the dict as a hard-coded fallback for environments where the prompts
# directory cannot be found (e.g. during testing without assets).
_SYSTEM_PROMPTS_FALLBACK: dict[str, str] = {
    "pm": "You are the Project Manager (PM). Delegate all work to agents via spawn_agent and relay_to_agent.",
    "software_engineer": "You are a Software Engineer agent. This is your permanent role — never abandon it.",
    "qa": "You are a QA (Quality Assurance) agent. This is your permanent role — never abandon it.",
    "software_engineer_frontend": "You are a Frontend Software Engineer. Work only on the frontend.",
    "reviewer": "You are a Code Reviewer. Review PRs for correctness, security, performance.",
}


def default_system_prompt(agent_type: str) -> str | None:
    """Return the default system prompt for a given agent type, or None for custom.

    Loads from ``app/prompts/<agent_type>.html`` via Jinja2.  Falls back to
    the in-process ``_SYSTEM_PROMPTS_FALLBACK`` dict if the file is missing.
    Returns ``None`` for the ``custom`` type (no default prompt).
    """
    if agent_type == "custom":
        return None

    template_path = _PROMPTS_DIR / f"{agent_type}.html"
    if template_path.exists():
        try:
            from jinja2 import Environment, FileSystemLoader, select_autoescape
            env = Environment(
                loader=FileSystemLoader(str(_PROMPTS_DIR)),
                autoescape=select_autoescape([]),  # plain text — no HTML escaping
                keep_trailing_newline=True,
            )
            return env.get_template(f"{agent_type}.html").render()
        except Exception:
            pass  # fall through to hard-coded fallback

    return _SYSTEM_PROMPTS_FALLBACK.get(agent_type)
