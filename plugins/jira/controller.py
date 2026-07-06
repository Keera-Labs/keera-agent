"""HTTP handlers for the Jira plugin's routes."""

from typing import Optional

import httpx
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from plugins.jira.client import JiraClient, JiraConfigError


class JiraSearchRequest(BaseModel):
    jql: str = Field(min_length=1, description="Jira Query Language expression.")
    max_results: int = Field(default=50, ge=1, le=100)
    fields: Optional[list[str]] = None
    next_page_token: Optional[str] = Field(
        default=None, description="Token from a prior page's nextPageToken."
    )


class JiraUpdateRequest(BaseModel):
    fields: dict = Field(description='Issue fields to set, e.g. {"summary": "New title"}.')


class JiraWorklogRequest(BaseModel):
    time_spent: str = Field(min_length=1, description="e.g. '1h 30m'.")
    comment: Optional[str] = None
    started: Optional[str] = Field(default=None, description="ISO-8601 start time.")


def _client_or_error():
    try:
        return JiraClient.from_config(), None
    except JiraConfigError as exc:
        return None, JSONResponse({"error": str(exc)}, status_code=400)


def _upstream_error(exc: httpx.HTTPStatusError) -> JSONResponse:
    return JSONResponse(
        {"error": "Jira request failed", "detail": exc.response.text},
        status_code=exc.response.status_code,
    )


async def search(body: JiraSearchRequest):
    client, error = _client_or_error()
    if error:
        return error
    try:
        data = await client.search(body.jql, body.max_results, body.fields, body.next_page_token)
    except httpx.HTTPStatusError as exc:
        return _upstream_error(exc)
    return JSONResponse({"data": data})


async def update_issue(issue_key: str, body: JiraUpdateRequest):
    client, error = _client_or_error()
    if error:
        return error
    try:
        data = await client.update_issue(issue_key, body.fields)
    except httpx.HTTPStatusError as exc:
        return _upstream_error(exc)
    return JSONResponse({"data": data})


async def add_worklog(issue_key: str, body: JiraWorklogRequest):
    client, error = _client_or_error()
    if error:
        return error
    try:
        data = await client.add_worklog(issue_key, body.time_spent, body.comment, body.started)
    except httpx.HTTPStatusError as exc:
        return _upstream_error(exc)
    return JSONResponse({"data": data})
