from fastapi_startkit.ai.agent import Agent
from fastapi_startkit.ai import decorators


@decorators.provider("anthropic")
@decorators.model("claude-haiku-4-5")
@decorators.max_tokens(1024)
class ChatAgent(Agent):
    def messages(self):
        return [
            {"role": "system", "content": "You are Keera, a helpful AI assistant embedded in the Keera project management tool. Be concise and helpful."}
        ]
