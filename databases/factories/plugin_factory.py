from fastapi_startkit.masoniteorm import Factory

from app.models.Plugin import Plugin


class PluginFactory(Factory):
    model = Plugin

    def definition(self) -> dict:
        slug = self.fake.unique.word()
        return {
            "slug": slug,
            "name": slug.capitalize(),
            "description": self.fake.sentence(),
            "path": f"plugins/{slug}",
            "active": False,
        }
