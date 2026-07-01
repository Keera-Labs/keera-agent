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
    next_page_token: Optional[str] = Field(default=None, description="Token from a prior page's nextPageToken to fetch the next page.")


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
                arguments.get("next_page_token"),
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


class JiraCreateIssueInput(BaseModel):
    project_key: str = Field(description="The project key the issue belongs to, e.g. 'ENG'.")
    summary: str = Field(description="Issue summary / title.")
    description: Optional[str] = Field(default=None, description="Issue description as plain text.")
    issue_type: str = Field(default="Task", description="Issue type name, e.g. 'Task', 'Bug', 'Story'.")
    assignee: Optional[str] = Field(default=None, description="Assignee accountId.")
    extra_fields: Optional[dict] = Field(default=None, description="Additional issue fields merged into the request.")


class JiraCreateIssueTool(Tool):
    name = "jira_create_issue"
    description = "Create a new Jira issue and return the created issue as JSON."

    def schema(self):
        return JiraCreateIssueInput

    async def handle(self, arguments: dict) -> Response:
        client, message = _client_or_message()
        if message:
            return message
        try:
            data = await client.create_issue(
                arguments["project_key"],
                arguments["summary"],
                arguments.get("description"),
                arguments.get("issue_type", "Task"),
                arguments.get("assignee"),
                arguments.get("extra_fields"),
            )
        except httpx.HTTPStatusError as exc:
            return _upstream_message(exc)
        return Response.text(json.dumps(data, indent=2))


class JiraAddCommentInput(BaseModel):
    issue_key: str = Field(description="The issue key, e.g. 'ENG-123'.")
    body: str = Field(description="Comment text as plain text.")


class JiraAddCommentTool(Tool):
    name = "jira_add_comment"
    description = "Add a comment to a Jira issue."

    def schema(self):
        return JiraAddCommentInput

    async def handle(self, arguments: dict) -> Response:
        client, message = _client_or_message()
        if message:
            return message
        try:
            await client.add_comment(arguments["issue_key"], arguments["body"])
        except httpx.HTTPStatusError as exc:
            return _upstream_message(exc)
        return Response.text(f"Comment added to {arguments['issue_key']}.")


JIRA_TOOLS = [
    JiraSearchTool,
    JiraUpdateIssueTool,
    JiraAddWorklogTool,
    JiraCreateIssueTool,
    JiraAddCommentTool,
]
