from fastapi.responses import JSONResponse

from app.models.Student import Student
from app.requests.student_request import StudentRegisterRequest
from app.utils.password import hash_password


async def register(body: StudentRegisterRequest):
    existing = await Student.where("email", body.email).first()
    if existing:
        return JSONResponse({"error": "Email already registered"}, status_code=409)

    student = await Student.create({
        "name": body.name,
        "email": body.email,
        "password": hash_password(body.password),
    })

    return JSONResponse(
        {"message": "Student registered successfully", "user_id": student.id},
        status_code=201,
    )
