from fastapi_startkit.broadcasting import BroadcastEvent, Channel


class PingEvent(BroadcastEvent):
    def __init__(self, message: str = "ping"):
        self.message = message

    def broadcast_on(self):
        return [Channel("broadcasting-poc")]

    def broadcast_with(self) -> dict:
        return {"message": self.message}
