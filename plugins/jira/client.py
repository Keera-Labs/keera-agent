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
    def __init__(
        self,
        base_url: str,
        username: str,
        api_token: str,
        timeout: float = 30.0,
        transport: Optional[httpx.BaseTransport] = None,
    ):
        if not (base_url and username and api_token):
            raise JiraConfigError(
                "Jira is not configured. Set JIRA_BASE_URL, JIRA_USERNAME and JIRA_TOKEN."
            )
        self._base_url = base_url.rstrip("/")
        self._auth = (username, api_token)
        self._timeout = timeout
        # Optional injected transport — used by tests to mock outbound requests.
        self._transport = transport

    @classmethod
    def from_config(cls, config: Optional[JiraConfig] = None) -> "JiraClient":
        cfg = config or jira_config()
        return cls(cfg.base_url, cfg.username, cfg.api_token)

    def _http(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=self._base_url,
            auth=self._auth,
            timeout=self._timeout,
            transport=self._transport,
            headers={"Accept": "application/json", "Content-Type": "application/json"},
        )

    async def search(
        self,
        jql: str,
        max_results: int = 50,
        fields: Optional[list[str]] = None,
        next_page_token: Optional[str] = None,
    ) -> dict:
        # Jira Cloud removed GET /rest/api/3/search in 2025; the enhanced
        # endpoint is POST /rest/api/3/search/jql with body params and
        # token-based pagination (nextPageToken, no startAt/total).
        payload: dict = {"jql": jql, "maxResults": max_results}
        if fields:
            payload["fields"] = fields
        if next_page_token:
            payload["nextPageToken"] = next_page_token
        async with self._http() as http:
            response = await http.post("/rest/api/3/search/jql", json=payload)
            response.raise_for_status()
            return response.json()

    async def create_issue(
        self,
        project_key: str,
        summary: str,
        description: Optional[str] = None,
        issue_type: str = "Task",
        assignee: Optional[str] = None,
        extra_fields: Optional[dict] = None,
    ) -> dict:
        fields: dict = {
            "project": {"key": project_key},
            "summary": summary,
            "issuetype": {"name": issue_type},
        }
        if description:
            fields["description"] = _text_to_adf(description)
        if assignee:
            fields["assignee"] = {"accountId": assignee}
        if extra_fields:
            fields.update(extra_fields)
        async with self._http() as http:
            response = await http.post("/rest/api/3/issue", json={"fields": fields})
            response.raise_for_status()
            return response.json()

    async def add_comment(self, issue_key: str, body: str) -> dict:
        async with self._http() as http:
            response = await http.post(
                f"/rest/api/3/issue/{issue_key}/comment",
                json={"body": _text_to_adf(body)},
            )
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
