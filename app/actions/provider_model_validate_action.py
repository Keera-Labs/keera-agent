from app.controllers.global_settings_controller import provider_model_is_configured


class ProviderModelValidateAction:
    """Validate the database-backed provider/model configuration rule."""

    def __init__(self, provider: str, model: str):
        self.provider = provider
        self.model = model

    async def execute(self) -> None:
        if not await provider_model_is_configured(self.provider, self.model):
            raise ValueError(f"Model '{self.model}' is not configured for {self.provider}")
