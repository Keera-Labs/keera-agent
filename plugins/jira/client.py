"""Async Jira REST client (Jira Cloud v3) built on httpx."""

from typing import Optional

import httpx

from plugins.jira.config import JiraConfig, jira_config


class JiraConfigError(RuntimeError):
    """Raised when Jira credentials are missing or incomplete."""


def _text_to_adf(text: str) -> dict:
    """Wrap plain text in the Atlassian Document Format the v3 API requires."""
    return {
        "type": "doc",
        "version": 1,
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": text}]}
        ],
    }


class JiraClient:
    def __init__(self, base_url: str, email: str, api_token: str, timeout: float = 30.0):
        if not (base_url and email and api_token):
            raise JiraConfigError(
                "Jira is not configured. Set JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN."
            )
        self._base_url = base_url.rstrip("/")
        self._auth = (email, api_token)
        self._timeout = timeout

    @classmethod
    def from_config(cls, config: Optional[JiraConfig] = None) -> "JiraClient":
        cfg = config or jira_config()
        return cls(cfg.base_url, cfg.email, cfg.api_token)

    def _http(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=self._base_url,
            auth=self._auth,
            timeout=self._timeout,
            headers={"Accept": "application/json", "Content-Type": "application/json"},
        )

    async def search(
        self,
        jql: str,
        max_results: int = 50,
        fields: Optional[list[str]] = None,
    ) -> dict:
        params: dict = {"jql": jql, "maxResults": max_results}
        if fields:
            params["fields"] = ",".join(fields)
        async with self._http() as http:
            response = await http.get("/rest/api/3/search", params=params)
            response.raise_for_status()
            return response.json()

    async def update_issue(self, issue_key: str, fields: dict) -> dict:
        async with self._http() as http:
            response = await http.put(f"/rest/api/3/issue/{issue_key}", json={"fields": fields})
            response.raise_for_status()
            return {"issue": issue_key, "updated": True}

    async def add_worklog(
        self,
        issue_key: str,
        time_spent: str,
        comment: Optional[str] = None,
        started: Optional[str] = None,
    ) -> dict:
        payload: dict = {"timeSpent": time_spent}
        if started:
            payload["started"] = started
        if comment:
            payload["comment"] = _text_to_adf(comment)
        async with self._http() as http:
            response = await http.post(f"/rest/api/3/issue/{issue_key}/worklog", json=payload)
            response.raise_for_status()
            return response.json()
