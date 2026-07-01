"""Jira connection settings, read from the environment.

Configuration lives inside the plugin folder so the plugin is self-contained.
Env var names match the repo's .env: JIRA_BASE_URL, JIRA_USERNAME, JIRA_TOKEN.
`username` is the Atlassian account email used as the Basic-auth username.
"""

from dataclasses import dataclass

from fastapi_startkit.environment.environment import env


@dataclass
class JiraConfig:
    base_url: str
    username: str
    api_token: str

    @property
    def is_configured(self) -> bool:
        return bool(self.base_url and self.username and self.api_token)


def jira_config() -> JiraConfig:
    return JiraConfig(
        base_url=(env("JIRA_BASE_URL", "") or "").rstrip("/"),
        username=env("JIRA_USERNAME", "") or "",
        api_token=env("JIRA_TOKEN", "") or "",
    )
