"""Jira connection settings, read from the environment.

Configuration lives inside the plugin folder so the plugin is self-contained.
"""

from dataclasses import dataclass

from fastapi_startkit.environment.environment import env


@dataclass
class JiraConfig:
    base_url: str
    email: str
    api_token: str

    @property
    def is_configured(self) -> bool:
        return bool(self.base_url and self.email and self.api_token)


def jira_config() -> JiraConfig:
    return JiraConfig(
        base_url=(env("JIRA_BASE_URL", "") or "").rstrip("/"),
        email=env("JIRA_EMAIL", "") or "",
        api_token=env("JIRA_API_TOKEN", "") or "",
    )
