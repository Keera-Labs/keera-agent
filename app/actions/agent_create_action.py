import json as _json
from typing import Optional

from app.models.Agent import Agent


class AgentCreateAction:
    """Centralised agent-creation logic.

    Resolves the default system prompt, normalises flags, sets default
    permissions and plan_mode, then creates and returns the Agent DB record.
    """

    def __init__(
        self,
        *,
        project_id: int,
        name: str,
        agent_type: str,
        model: str = "claude-sonnet-4-6",
        description: Optional[str] = None,
        system_prompt: Optional[str] = None,
        task_id: Optional[int] = None,
        flags: Optional[dict] = None,
        dangerously_skip_permissions: bool = True,
        plan_mode: Optional[bool] = None,
        orchestrator_id: Optional[int] = None,
    ):
        self.project_id = project_id
        self.name = name.strip()
        self.agent_type = agent_type.strip()
        self.model = model.strip() or "claude-sonnet-4-6"
        self.description = (description or "").strip() or None
        self.task_id = task_id
        self.orchestrator_id = orchestrator_id

        # Resolve system prompt: caller-supplied value wins; fall back to type default
        self.system_prompt = (system_prompt or "").strip() or None
        if not self.system_prompt:
            from app.controllers.agent_controller import _default_system_prompt
            self.system_prompt = _default_system_prompt(self.agent_type)

        # Normalise flags: strip out the two fields that have dedicated columns
        raw_flags = dict(flags or {})
        if "dangerously_skip_permissions" in raw_flags:
            dangerously_skip_permissions = bool(raw_flags.pop("dangerously_skip_permissions"))
        if "plan_mode" in raw_flags:
            _pm = raw_flags.pop("plan_mode")
            if plan_mode is None:
                plan_mode = bool(_pm)
        self.flags = raw_flags

        self.dangerously_skip_permissions = dangerously_skip_permissions
        # Default plan_mode: True for PM agents, False for everything else
        self.plan_mode = plan_mode if plan_mode is not None else (self.agent_type == "pm")

    @staticmethod
    def prepare(
        *,
        project_id: int,
        name: str,
        agent_type: str,
        model: str = "claude-sonnet-4-6",
        description: Optional[str] = None,
        system_prompt: Optional[str] = None,
        task_id: Optional[int] = None,
        flags: Optional[dict] = None,
        dangerously_skip_permissions: bool = True,
        plan_mode: Optional[bool] = None,
        orchestrator_id: Optional[int] = None,
    ) -> "AgentCreateAction":
        return AgentCreateAction(
            project_id=project_id,
            name=name,
            agent_type=agent_type,
            model=model,
            description=description,
            system_prompt=system_prompt,
            task_id=task_id,
            flags=flags,
            dangerously_skip_permissions=dangerously_skip_permissions,
            plan_mode=plan_mode,
            orchestrator_id=orchestrator_id,
        )

    async def execute(self) -> Agent:
        """Create and return the new Agent DB record."""
        from app.controllers.agent_controller import _default_permissions

        _perms_allow, _perms_deny = _default_permissions()

        record = {
            "project_id": self.project_id,
            "name": self.name,
            "agent_type": self.agent_type,
            "description": self.description,
            "model": self.model,
            "system_prompt": self.system_prompt,
            "task_id": self.task_id,
            "permissions_allow": _perms_allow,
            "permissions_deny": _perms_deny,
            "flags": _json.dumps(self.flags),
            "dangerously_skip_permissions": self.dangerously_skip_permissions,
            "plan_mode": self.plan_mode,
            "status": "idle",
            "has_session": False,
        }
        if self.orchestrator_id is not None:
            record["orchestrator_id"] = self.orchestrator_id

        return await Agent.create(record)
