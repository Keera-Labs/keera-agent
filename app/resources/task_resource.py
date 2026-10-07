import json

from fastapi_startkit.jsonapi import JsonResource

from app.models.Task import REVIEW_FIELDS, Task

_JSON_FIELDS = ("assignees", "acceptance_criteria", "testing_methods", "validation_steps")


def _as_list(value) -> list:
    """Coerce a JSON-column value to a list.

    `Model.serialize()` returns raw attributes, so a JSON column comes back as a
    list right after `create()` (still in memory) but as a JSON string once the
    row has been loaded from the database. Normalise both to a list.
    """
    if isinstance(value, list):
        return value
    if not value:
        return []
    try:
        return json.loads(value)
    except (ValueError, TypeError):
        return []


class TaskResource(JsonResource[Task]):
    def to_attributes(self) -> dict:
        data = self.model.serialize()
        for field in _JSON_FIELDS:
            data[field] = _as_list(data.get(field))
        for field in (*REVIEW_FIELDS, "completed_at"):
            data.setdefault(field, None)
        return data
