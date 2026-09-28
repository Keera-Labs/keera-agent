from fastapi_startkit.masoniteorm.models.caster import BaseCast


class NullableInt(BaseCast):
    """Int cast for nullable columns: the ORM casts `int | None` as str and a
    bare `int` crashes on NULL."""

    def get(self, value):
        return None if value is None else int(value)

    def set(self, value):
        return self.get(value)
