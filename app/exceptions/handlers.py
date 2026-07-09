from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi_startkit.masoniteorm.exceptions import ModelNotFoundException


async def model_not_found_handler(request: Request, exc: ModelNotFoundException) -> JSONResponse:
    """Map a failed find_or_fail() lookup to a 404 instead of an unhandled 500.

    Controllers standardize on find_or_fail() for existence checks; without this
    handler the raised ModelNotFoundException falls through to the generic 500
    path. Registering it globally keeps the "missing record → 404" contract in
    one place so individual controllers don't each re-implement the check.
    """
    return JSONResponse({"error": str(exc)}, status_code=404)


def register_exception_handlers(app) -> None:
    app.add_exception_handler(ModelNotFoundException, model_not_found_handler)
