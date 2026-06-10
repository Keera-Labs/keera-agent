from fastapi_startkit.broadcasting import BroadcastEvent, Channel


class AIChatResponseEvent(BroadcastEvent):
    def __init__(self, response: str, error: bool = False):
        self.response = response
        self.error = error

    def broadcast_on(self):
        return [Channel('test-channel')]

    def broadcast_with(self) -> dict:
        return {'response': self.response, 'error': self.error}
