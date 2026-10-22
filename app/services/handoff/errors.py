class HandoffError(Exception):
    status_code = 500

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class HandoffInvalid(HandoffError):
    status_code = 422


class HandoffConflict(HandoffError):
    status_code = 409


class HandoffUnauthorized(HandoffError):
    status_code = 401


class HandoffDisabled(HandoffError):
    status_code = 403


class HandoffTargetFailed(HandoffError):
    status_code = 502
