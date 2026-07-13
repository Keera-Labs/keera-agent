import unittest

from app.constant.complexity import DEFAULT_MODEL, TaskComplexity


class TestModelForComplexity(unittest.TestCase):
    def test_easy_maps_to_sonnet(self):
        self.assertEqual(TaskComplexity.model_for("easy"), "claude-sonnet-5")

    def test_medium_maps_to_sonnet(self):
        self.assertEqual(TaskComplexity.model_for("medium"), "claude-sonnet-5")

    def test_hard_maps_to_opus(self):
        self.assertEqual(TaskComplexity.model_for("hard"), "claude-opus-4-8")

    def test_none_falls_back_to_default(self):
        self.assertEqual(TaskComplexity.model_for(None), DEFAULT_MODEL)

    def test_unknown_falls_back_to_default(self):
        self.assertEqual(TaskComplexity.model_for("trivial"), DEFAULT_MODEL)

    def test_accepts_enum_member(self):
        self.assertEqual(TaskComplexity.model_for(TaskComplexity.HARD), "claude-opus-4-8")

    def test_member_model_method(self):
        self.assertEqual(TaskComplexity.EASY.model(), "claude-sonnet-5")
        self.assertEqual(TaskComplexity.HARD.model(), "claude-opus-4-8")


class TestAgentRequestComplexity(unittest.TestCase):
    """AgentStoreRequest requires complexity and resolves the model from it."""

    def _req(self, **kwargs):
        from app.requests.agent_requests import AgentStoreRequest

        return AgentStoreRequest(name="Worker", **kwargs)

    def test_easy_selects_sonnet(self):
        self.assertEqual(self._req(complexity="easy").model, "claude-sonnet-5")

    def test_hard_selects_opus(self):
        self.assertEqual(self._req(complexity="hard").model, "claude-opus-4-8")

    def test_complexity_overrides_explicit_model(self):
        req = self._req(complexity="hard", model="claude-sonnet-5")
        self.assertEqual(req.model, "claude-opus-4-8")

    def test_missing_complexity_raises(self):
        from pydantic import ValidationError

        with self.assertRaises(ValidationError):
            self._req()

    def test_invalid_complexity_raises(self):
        from pydantic import ValidationError

        with self.assertRaises(ValidationError):
            self._req(complexity="trivial")
