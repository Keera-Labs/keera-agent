from fastapi_startkit.masoniteorm import Model


class Student(Model):
    __table__ = "students"

    id: int
    name: str | None
    email: str | None
    password: str | None
    created_at: str | None
    updated_at: str | None

    def serialize(self) -> dict:
        # `password` is a hash, never plaintext, but it should still never leave
        # the application — drop it from any serialized representation.
        data = dict(super().serialize())
        data.pop("password", None)
        return data
