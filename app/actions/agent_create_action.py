import datetime
import json as _json

from fastapi_startkit.support import Str

from app.models.Agent import Agent
from app.requests.agent_requests import AgentStoreRequest


class AgentCreateAction:
    def __init__(self, project_id, request: AgentStoreRequest):
        self.request = request
        self.project_id = project_id

    @staticmethod
    def prepare(project_id: int, request: AgentStoreRequest):
        return AgentCreateAction(project_id=project_id, request=request)

    async def execute(self) -> Agent:
        from app.controllers.agent_controller import _default_permissions
        from app.controllers.global_settings_controller import read_global_settings
        from app.utils.system_prompts import default_system_prompt

        # Enforce per-project agent limit
        settings = read_global_settings()
        limit = int(settings.get("max_agents_per_project", 10))
        count = await Agent.where("project_id", self.project_id).where_null("deleted_at").count()
        if count >= limit:
            raise ValueError(
                f"Agent limit ({limit}) reached for this project. "
                "Delete an existing agent before adding a new one."
            )

        req = self.request

        # Resolve system prompt: caller value wins, fall back to type default
        system_prompt = (req.system_prompt or "").strip() or default_system_prompt(req.agent_type)

        # Promote dangerously_skip_permissions / plan_mode out of the flags dict
        # (older frontend nests them) so they live in their own columns instead.
        flags = dict(req.flags or {})
        flags.pop("dangerously_skip_permissions", None)
        dsp = bool(req.dangerously_skip_permissions)

        plan_mode = req.plan_mode
        if plan_mode is None:
            plan_mode = bool(flags.pop("plan_mode")) if "plan_mode" in flags else (req.agent_type == "pm")
        else:
            flags.pop("plan_mode", None)

        perms_allow, perms_deny = _default_permissions()

        now = datetime.datetime.now().isoformat(sep=" ", timespec="seconds")

        record = {
            "project_id": self.project_id,
            "name": req.name.strip(),
            "slug": f"{Str.slugify(req.name)}-{int(datetime.datetime.now().timestamp())}",
            "agent_type": req.agent_type,
            "description": req.description,
            "model": req.model,
            "system_prompt": system_prompt,
            "task_id": req.task_id,
            "permissions_allow": perms_allow,
            "permissions_deny": perms_deny,
            "flags": _json.dumps(flags),
            "dangerously_skip_permissions": dsp,
            "plan_mode": bool(plan_mode),
            "status": "idle",
            "has_session": False,
            "created_at": now,
            "updated_at": now,
        }
        if req.orchestrator_id is not None:
            record["orchestrator_id"] = req.orchestrator_id

        return await Agent.create(record)
