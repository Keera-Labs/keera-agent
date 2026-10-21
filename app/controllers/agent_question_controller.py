from fastapi_startkit.jsonapi import ResourceCollection

from app.models.Agent import Agent
from app.models.AgentQuestion import AgentQuestion
from app.resources.agent_question_resource import AgentQuestionResource


async def index(agent_id: int) -> ResourceCollection:
    await Agent.find_or_fail(agent_id)
    questions = await AgentQuestion.where("agent_id", agent_id).order_by("id", "asc").get()
    return AgentQuestionResource.collection(questions)
