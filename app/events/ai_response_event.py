from fastapi_startkit.broadcasting import BroadcastEvent, Channel


class AiResponseEvent(BroadcastEvent):
    def __init__(self, prompt: str, response: str):
        self.prompt = prompt
        self.response = response

    def broadcast_on(self):
        return [Channel("ai-responses")]

    def broadcast_with(self) -> dict:
        return {"prompt": self.prompt, "response": self.response}
