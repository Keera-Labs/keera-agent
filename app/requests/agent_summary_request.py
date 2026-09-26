from pydantic import BaseModel, Field


class AgentSummaryIndexRequest(BaseModel):
    """Query for the sidebar's agent summaries: one request for every visible project."""

    project_ids: list[int] = Field(default_factory=list, max_length=100)
