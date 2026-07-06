import pathlib


def _prompts_dir() -> pathlib.Path:
    """Resolve the prompts directory from the application base path.

    Anchored to ``base_path`` (the project root) so it stays correct if this
    module moves. Falls back to a path relative to this file when the
    application container is not booted (e.g. isolated unit tests).
    """
    try:
        from fastapi_startkit.application import app

        return app().base_path / "app" / "prompts"
    except Exception:
        return pathlib.Path(__file__).parent.parent / "prompts"


# Fallback used only when the configured app URL cannot be resolved (e.g. the
# config layer is not booted during isolated unit tests).
_DEFAULT_MCP_URL = "http://127.0.0.1:4545/mcp"


def _mcp_url() -> str:
    """Build the MCP endpoint URL from the configured app URL.

    Desktop builds run on a different port (e.g. :14545), so the URL must come
    from ``fastapi.app_url`` rather than being hardcoded in the templates.
    """
    try:
        from fastapi_startkit import Config

        base_url = Config.get("fastapi.app_url")
        if base_url:
            return f"{base_url.rstrip('/')}/mcp"
    except Exception:
        pass
    return _DEFAULT_MCP_URL


# Keep the dict as a hard-coded fallback for environments where the prompts
# directory cannot be found (e.g. during testing without assets).
_SYSTEM_PROMPTS_FALLBACK: dict[str, str] = {
    "pm": "You are the Project Manager (PM). Delegate all work to agents via spawn_agent and send_message_to_agent.",
    "software_engineer": "You are a Software Engineer agent. This is your permanent role — never abandon it.",
    "qa": "You are a QA (Quality Assurance) agent. This is your permanent role — never abandon it.",
    "software_engineer_frontend": "You are a Frontend Software Engineer. Work only on the frontend.",
    "reviewer": "You are a Code Reviewer. Review PRs for correctness, security, performance.",
}


def default_system_prompt(agent_type: str) -> str | None:
    """Return the default system prompt for a given agent type.

    Loads from ``app/prompts/<agent_type>.html`` via Jinja2.  Falls back to
    the in-process ``_SYSTEM_PROMPTS_FALLBACK`` dict if the file is missing.
    Returns ``None`` for unknown types that have no prompt defined.
    """
    prompts_dir = _prompts_dir()
    template_path = prompts_dir / f"{agent_type}.html"
    if template_path.exists():
        try:
            from jinja2 import Environment, FileSystemLoader, select_autoescape

            env = Environment(
                loader=FileSystemLoader(str(prompts_dir)),
                autoescape=select_autoescape([]),  # plain text — no HTML escaping
                keep_trailing_newline=True,
            )
            return env.get_template(f"{agent_type}.html").render(mcp_url=_mcp_url())
        except Exception:
            pass  # fall through to hard-coded fallback

    return _SYSTEM_PROMPTS_FALLBACK.get(agent_type)
