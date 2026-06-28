import uuid

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.models.Student import Student
from app.utils.password import verify_password
from databases.factories.student_factory import StudentFactory
from tests.test_case import TestCase

REGISTER_URL = "/students/register"


def _unique_email() -> str:
    # HTTP-app writes commit on a separate connection and are not rolled back by
    # DatabaseTransaction, so each run needs a fresh email to stay rerunnable.
    return f"student-{uuid.uuid4().hex}@example.com"


class TestStudentController(TestCase, DatabaseTransaction):
    async def test_register_creates_student_and_returns_message_and_id(self):
        response = await self.post(REGISTER_URL, json={
            "name": "Ada Lovelace",
            "email": _unique_email(),
            "password": "supersecret",
        })

        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(data["message"], "Student registered successfully")
        self.assertIn("user_id", data)
        self.assertIsInstance(data["user_id"], int)

    async def test_register_persists_hashed_password(self):
        email = _unique_email()
        response = await self.post(REGISTER_URL, json={
            "email": email,
            "password": "supersecret",
        })
        self.assertEqual(response.status_code, 201)

        student = await Student.where("email", email).first()
        self.assertIsNotNone(student)
        self.assertNotEqual(student.password, "supersecret")
        self.assertTrue(verify_password("supersecret", student.password))

    async def test_register_hides_password_in_serialized_output(self):
        student = await StudentFactory.new().create()
        self.assertNotIn("password", student.serialize())

    async def test_register_rejects_duplicate_email(self):
        email = _unique_email()
        first = await self.post(REGISTER_URL, json={
            "email": email,
            "password": "supersecret",
        })
        self.assertEqual(first.status_code, 201)

        response = await self.post(REGISTER_URL, json={
            "email": email,
            "password": "anothersecret",
        })
        self.assertEqual(response.status_code, 409)

    async def test_register_rejects_invalid_email(self):
        response = await self.post(REGISTER_URL, json={
            "email": "not-an-email",
            "password": "supersecret",
        })
        self.assertEqual(response.status_code, 422)

    async def test_register_rejects_short_password(self):
        response = await self.post(REGISTER_URL, json={
            "email": _unique_email(),
            "password": "tiny",
        })
        self.assertEqual(response.status_code, 422)

    async def test_register_rejects_missing_fields(self):
        response = await self.post(REGISTER_URL, json={})
        self.assertEqual(response.status_code, 422)
