from app.controllers.global_settings_controller import read_global_settings, write_global_setting
from app.requests.global_settings_request import GlobalSettingsUpdateRequest


class GlobalSettingsUpdateAction:
    def __init__(self, request: GlobalSettingsUpdateRequest):
        self.request = request

    @staticmethod
    def prepare(request: GlobalSettingsUpdateRequest) -> "GlobalSettingsUpdateAction":
        return GlobalSettingsUpdateAction(request)

    async def execute(self) -> dict:
        if self.request.max_agents_per_project is not None and not (
            1 <= self.request.max_agents_per_project <= 100
        ):
            raise ValueError("max_agents_per_project must be an integer between 1 and 100")

        settings = await read_global_settings()
        provider_models = self.request.provider_models or settings["provider_models"]
        default_provider = self.request.default_provider or settings["default_provider"]
        complexity_models = self.request.complexity_models

        if complexity_models is not None:
            selected_models = complexity_models.model_dump()
            available_models = provider_models[default_provider]
            invalid = [model for model in selected_models.values() if model not in available_models]
            if invalid:
                raise ValueError(
                    f"Complexity models must be configured for {default_provider}: {invalid[0]}"
                )

        if self.request.max_agents_per_project is not None:
            await write_global_setting(
                "max_agents_per_project", self.request.max_agents_per_project
            )
        if self.request.provider_models is not None:
            await write_global_setting("provider_models", self.request.provider_models)
        if self.request.default_provider is not None:
            await write_global_setting("default_provider", self.request.default_provider)
        if complexity_models is not None:
            await write_global_setting("complexity_models", complexity_models.model_dump())

        return await read_global_settings()
