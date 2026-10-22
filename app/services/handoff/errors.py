class HandoffError(Exception):
    status_code = 500

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class HandoffInvalid(HandoffError):
    status_code = 422


class HandoffSecretsFound(HandoffInvalid):
    def __init__(self, paths: list[str]):
        listed = ", ".join(paths[:20]) + (f" and {len(paths) - 20} more" if len(paths) > 20 else "")
        super().__init__(
            "Refusing to hand off: these changed files look like secrets. Remove them or add "
            f"them to .gitignore first: {listed}"
        )
        self.paths = paths


class HandoffConflict(HandoffError):
    status_code = 409


class HandoffUnauthorized(HandoffError):
    status_code = 401


class HandoffDisabled(HandoffError):
    status_code = 403


class HandoffTooLarge(HandoffError):
    status_code = 413


class HandoffTargetFailed(HandoffError):
    status_code = 502


class HandoffTargetRejected(HandoffTargetFailed):
    pass
