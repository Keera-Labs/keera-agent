from fastapi_startkit.jsonapi import JsonResource

from app.terminal.command_runs import CommandRun


class CommandRunResource(JsonResource[CommandRun]):
    type = "command_runs"

    def to_attributes(self) -> dict:
        return {
            "command_id": self.model.command_id,
            "worktree": self.model.cwd,
            "status": self.model.status,
            "exit_code": self.model.exit_code,
            "started_at": self.model.started_at.isoformat(),
        }
