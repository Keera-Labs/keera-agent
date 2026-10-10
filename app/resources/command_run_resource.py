from fastapi_startkit.jsonapi import JsonResource

from app.terminal.command_runs import CommandRun


class CommandRunResource(JsonResource[CommandRun]):
    type = "command_runs"

    def __init__(self, model: CommandRun, root: str) -> None:
        super().__init__(model)
        self.root = root

    def to_attributes(self) -> dict:
        return {
            "command_id": self.model.command_id,
            "worktree": None if self.model.cwd == self.root else self.model.cwd,
            "status": self.model.status,
            "exit_code": self.model.exit_code,
            "started_at": self.model.started_at.isoformat(),
        }
