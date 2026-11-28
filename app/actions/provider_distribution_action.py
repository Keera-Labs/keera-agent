from app.ai import providers
from app.models.Agent import Agent


class ProviderDistributionAction:
    def __init__(self, project_id: int, enabled: list[str]):
        self.project_id = project_id
        self.candidates = [
            provider.slug for provider in providers.all() if provider.slug in enabled
        ]

    async def execute(self) -> str:
        loads = {slug: await self._active_agent_count(slug) for slug in self.candidates}
        return min(self.candidates, key=lambda slug: (loads[slug], self.candidates.index(slug)))

    async def _active_agent_count(self, provider: str) -> int:
        return (
            await Agent.where("project_id", self.project_id)
            .where("provider", provider)
            .where_null("deleted_at")
            .count()
        )
