from fastapi_startkit.broadcasting import BroadcastEvent, Channel


class TestBroadcastEvent(BroadcastEvent):
    def __init__(self, message: str):
        self.message = message

    def broadcast_on(self):
        return [Channel('test-channel')]

    def broadcast_with(self) -> dict:
        return {'message': self.message}
