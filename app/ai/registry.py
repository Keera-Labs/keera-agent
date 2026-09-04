from collections.abc import Iterable

from app.ai.provider import Provider
from app.ai.providers import ClaudeProvider, CodexProvider


class ProviderRegistry:
    def __init__(self, registered: Iterable[Provider] = ()) -> None:
        self._providers: dict[str, Provider] = {}
        for provider in registered:
            self.register(provider)

    def register(self, provider: Provider) -> None:
        self._providers[provider.slug] = provider

    def get(self, slug: str) -> Provider:
        try:
            return self._providers[slug]
        except KeyError as exc:
            raise ValueError(f"Unknown AI provider: {slug}") from exc

    def all(self) -> list[Provider]:
        return list(self._providers.values())


providers = ProviderRegistry((ClaudeProvider(), CodexProvider()))
