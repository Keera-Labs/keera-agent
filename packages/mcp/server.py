from typing import List


class Server:
    name: str | None = None
    description: str | None = None
    instructions: str | None = None
    def tools(self) -> List[str] | None:
        return None

    def schema(self) -> None:
        return None

    def middleware(self) -> None:
        return None
