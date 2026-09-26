from fastapi_startkit.masoniteorm import Factory

from app.models.Workspace import Workspace


class WorkspaceFactory(Factory):
    model = Workspace

    def definition(self) -> dict:
        return {"name": self.fake.unique.company()}
