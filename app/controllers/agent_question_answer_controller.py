from app.actions.agent_question_answer_action import AgentQuestionAnswerAction
from app.models.Agent import Agent
from app.models.AgentQuestion import AgentQuestion
from app.models.Project import Project
from app.requests.agent_question_request import AgentQuestionAnswerRequest
from app.resources.agent_question_resource import AgentQuestionResource


async def store(body: AgentQuestionAnswerRequest, question_id: int) -> AgentQuestionResource:
    question = await AgentQuestion.find_or_fail(question_id)
    answered = await AgentQuestionAnswerAction.prepare(question, body.choices, body.text).execute()
    agent = await Agent.find(answered.agent_id)
    project = await Project.find(agent.project_id) if agent else None
    return AgentQuestionResource(answered, agent, project)
