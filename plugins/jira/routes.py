"""Jira plugin routes — mounted by the registry only while the plugin is active."""

from fastapi import APIRouter

from plugins.jira import controller


def build_router() -> APIRouter:
    router = APIRouter(prefix="/api/plugins/jira", tags=["jira"])
    router.add_api_route("/search", controller.search, methods=["POST"])
    router.add_api_route("/issues/{issue_key}", controller.update_issue, methods=["PATCH"])
    router.add_api_route("/issues/{issue_key}/worklog", controller.add_worklog, methods=["POST"])
    return router
