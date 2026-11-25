import datetime
import types
from unittest.mock import patch


def freeze_now(module: str, now: datetime.datetime):
    class FrozenDatetime(datetime.datetime):
        @classmethod
        def now(cls, tz=None):
            return now

    frozen_module = types.ModuleType("datetime")
    frozen_module.__dict__.update(vars(datetime))
    frozen_module.datetime = FrozenDatetime
    return patch(f"{module}.datetime", frozen_module)
