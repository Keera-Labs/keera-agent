from typing import Annotated

from fastapi import Query
from fastapi_startkit.jsonapi import ResourceCollection

from app.models.Agent import Agent
from app.models.AgentQuestion import AgentQuestion
from app.models.Project import Project
from app.requests.agent_question_request import AgentQuestionIndexRequest
from app.resources.agent_question_resource import AgentQuestionResource

ANSWERED_LIMIT = 50


async def index(query: Annotated[AgentQuestionIndexRequest, Query()]) -> ResourceCollection:
    agents = {agent.id: agent for agent in await Agent.where_null("deleted_at").get()}
    projects = {project.id: project for project in await Project.all()}
    questions = await _questions(query.status, list(agents))
    return ResourceCollection(
        [
            AgentQuestionResource(
                question,
                agents[question.agent_id],
                projects.get(agents[question.agent_id].project_id),
            )
            for question in questions
        ]
    )


async def _questions(status: str, agent_ids: list[int]) -> list[AgentQuestion]:
    if not agent_ids:
        return []
    builder = AgentQuestion.where("status", status).where_in("agent_id", agent_ids)
    if status == "answered":
        return list(await builder.order_by("answered_at", "desc").limit(ANSWERED_LIMIT).get())
    return list(await builder.order_by("created_at", "desc").order_by("position", "asc").get())
