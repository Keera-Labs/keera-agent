from fastapi_startkit.masoniteorm import Factory

from app.models.Project import Project


class ProjectFactory(Factory):
    model = Project

    def definition(self) -> dict:
        slug = self.fake.unique.slug()
        return {
            "name": slug,
            "slug": slug,
            "path": f"~/code/{slug}",
            "language": "Python",
        }
