from pydantic import BaseModel, Field


class DefaultAgentStoreRequest(BaseModel):
    """Input model for setting a project's default agent."""

    agent_id: int = Field(gt=0)
