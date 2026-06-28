from fastapi_startkit.masoniteorm import Factory

from app.models.Student import Student
from app.utils.password import hash_password


class StudentFactory(Factory):
    model = Student

    def definition(self) -> dict:
        return {
            "name": self.fake.name(),
            "email": self.fake.unique.email(),
            "password": hash_password("password123"),
        }
