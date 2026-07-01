"""MCP tools for the Jira plugin — exposed only while the plugin is active."""

import json
from typing import Optional

import httpx
from pydantic import BaseModel, Field

from fastapi_startkit.mcp import Response, Tool

from plugins.jira.client import JiraClient, JiraConfigError


def _client_or_message():
    try:
        return JiraClient.from_config(), None
    except JiraConfigError as exc:
        return None, Response.text(f"Error: {exc}")


def _upstream_message(exc: httpx.HTTPStatusError) -> Response:
    return Response.text(f"Error: Jira returned {exc.response.status_code}: {exc.response.text}")


class JiraSearchInput(BaseModel):
    jql: str = Field(description="Jira Query Language expression, e.g. 'project = ENG AND status = \"In Progress\"'.")
    max_results: int = Field(default=50, ge=1, le=100)
    fields: Optional[list[str]] = Field(default=None, description="Issue fields to return. Omit for defaults.")


class JiraSearchTool(Tool):
    name = "jira_search"
    description = "Search Jira issues with JQL and return the matching issues as JSON."

    def schema(self):
        return JiraSearchInput

    async def handle(self, arguments: dict) -> Response:
        client, message = _client_or_message()
        if message:
            return message
        try:
            data = await client.search(
                arguments["jql"],
                arguments.get("max_results", 50),
                arguments.get("fields"),
            )
        except httpx.HTTPStatusError as exc:
            return _upstream_message(exc)
        return Response.text(json.dumps(data, indent=2))


class JiraUpdateInput(BaseModel):
    issue_key: str = Field(description="The issue key, e.g. 'ENG-123'.")
    fields: dict = Field(description="Fields to set, e.g. {\"summary\": \"New title\"}.")


class JiraUpdateIssueTool(Tool):
    name = "jira_update_issue"
    description = "Update fields on a Jira issue (summary, description, assignee, etc.)."

    def schema(self):
        return JiraUpdateInput

    async def handle(self, arguments: dict) -> Response:
        client, message = _client_or_message()
        if message:
            return message
        try:
            await client.update_issue(arguments["issue_key"], arguments["fields"])
        except httpx.HTTPStatusError as exc:
            return _upstream_message(exc)
        return Response.text(f"Issue {arguments['issue_key']} updated.")


class JiraWorklogInput(BaseModel):
    issue_key: str = Field(description="The issue key, e.g. 'ENG-123'.")
    time_spent: str = Field(description="Time spent, e.g. '1h 30m'.")
    comment: Optional[str] = Field(default=None, description="Optional worklog comment.")
    started: Optional[str] = Field(default=None, description="Optional ISO-8601 start time.")


class JiraAddWorklogTool(Tool):
    name = "jira_add_worklog"
    description = "Log work against a Jira issue."

    def schema(self):
        return JiraWorklogInput

    async def handle(self, arguments: dict) -> Response:
        client, message = _client_or_message()
        if message:
            return message
        try:
            await client.add_worklog(
                arguments["issue_key"],
                arguments["time_spent"],
                arguments.get("comment"),
                arguments.get("started"),
            )
        except httpx.HTTPStatusError as exc:
            return _upstream_message(exc)
        return Response.text(f"Logged {arguments['time_spent']} against {arguments['issue_key']}.")


JIRA_TOOLS = [JiraSearchTool, JiraUpdateIssueTool, JiraAddWorklogTool]
