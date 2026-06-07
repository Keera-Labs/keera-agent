import json as _json
from typing import Optional

from fastapi import Request

from app.models.Agent import Agent
from app.requests.agent_requests import AgentCreateInput


class AgentCreateAction:
    def __init__(self, request: Optional[Request], *, project_id: int, input: AgentCreateInput):  # noqa: A002
        self.request = request
        self.project_id = project_id
        self.input = input

    @staticmethod
    async def from_request(request: Request, *, project_id: int) -> "AgentCreateAction":
        """Parse the request body into AgentCreateInput and return an action."""
        body = await request.json()
        return AgentCreateAction(
            request,
            project_id=project_id,
            input=AgentCreateInput.model_validate(body),
        )

    async def execute(self) -> Agent:
        from app.controllers.agent_controller import _default_permissions, _default_system_prompt

        inp = self.input

        # Resolve system prompt: caller value wins, fall back to type default
        system_prompt = (inp.system_prompt or "").strip() or _default_system_prompt(inp.agent_type)

        # Extract plan_mode / dangerously_skip_permissions from flags dict if
        # not set at the top level (older frontend sends them inside flags)
        flags = dict(inp.flags or {})
        dsp = inp.dangerously_skip_permissions
        if dsp is None:
            dsp = bool(flags.pop("dangerously_skip_permissions", True))
        else:
            flags.pop("dangerously_skip_permissions", None)

        plan_mode = inp.plan_mode
        if plan_mode is None:
            plan_mode = bool(flags.pop("plan_mode")) if "plan_mode" in flags else (inp.agent_type == "pm")
        else:
            flags.pop("plan_mode", None)

        perms_allow, perms_deny = _default_permissions()

        record = {
            "project_id": self.project_id,
            "name": inp.name.strip(),
            "agent_type": inp.agent_type,
            "description": inp.description,
            "model": inp.model,
            "system_prompt": system_prompt,
            "task_id": inp.task_id,
            "permissions_allow": perms_allow,
            "permissions_deny": perms_deny,
            "flags": _json.dumps(flags),
            "dangerously_skip_permissions": bool(dsp),
            "plan_mode": bool(plan_mode),
            "status": "idle",
            "has_session": False,
        }
        if inp.orchestrator_id is not None:
            record["orchestrator_id"] = inp.orchestrator_id

        return await Agent.create(record)
