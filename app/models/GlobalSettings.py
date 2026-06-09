from fastapi_startkit.masoniteorm import Model


class GlobalSettings(Model):
    __table__ = "global_settings"
