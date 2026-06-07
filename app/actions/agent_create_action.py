from app.models.Agent import Agent
from requests.agent_requests import AgentStoreRequest


class AgentCreateAction:
    def __init__(self, project_id, request: AgentStoreRequest):  # noqa: A002
        self.request = request
        self.project_id = project_id

    @staticmethod
    def prepare(project_id: int, request: AgentStoreRequest):
        return AgentCreateAction(project_id=project_id, request=request)

    async def execute(self) -> Agent:
        attributes = self.request.model_dump()
        attributes.update({
            "project_id": self.project_id,
            "status": "idle",
            "has_session": False,
        })

        return await Agent.create(attributes)
