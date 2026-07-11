"""Feature test for the GET /{project}/agents/{agent_id} Inertia page."""

from tests.test_case import TestCase


class TestAgentPage(TestCase):
    async def test_agent_page_renders_agents_detail_component(self):
        """The agent route must render the 'agents/Detail' Inertia component server-side."""
        response = await self.get("/demo/agents/1", headers={"X-Inertia": "true"})
        response.assert_ok().assert_json(lambda j: j.where("component", "agents/Detail").etc())
