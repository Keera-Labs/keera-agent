from fastapi_startkit.jsonapi import JsonResource

from app.models.Command import Command
from app.resources.command_run_resource import CommandRunResource
from app.terminal.command_runs import CommandRun


class CommandResource(JsonResource[Command]):
    type = "commands"

    def __init__(self, model: Command, run: CommandRun | None = None, root: str = "") -> None:
        super().__init__(model)
        self.run = run
        self.root = root

    def to_attributes(self) -> dict:
        return {
            "project_id": self.model.project_id,
            "label": self.model.label,
            "command": self.model.command,
            "description": self.model.description or "",
            "category": self.model.category or "General",
            "shortcut": self.model.shortcut or "",
            "kind": self.model.kind or "run",
            "run": CommandRunResource(self.run, self.root).to_attributes() if self.run else None,
        }
