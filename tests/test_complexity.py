import unittest

from app.constant.complexity import (
    DEFAULT_MODEL,
    TaskComplexity,
    model_for_complexity,
)


class TestModelForComplexity(unittest.TestCase):
    def test_easy_maps_to_sonnet(self):
        self.assertEqual(model_for_complexity("easy"), "claude-sonnet-5")

    def test_medium_maps_to_sonnet(self):
        self.assertEqual(model_for_complexity("medium"), "claude-sonnet-5")

    def test_hard_maps_to_opus(self):
        self.assertEqual(model_for_complexity("hard"), "claude-opus-4-8")

    def test_none_falls_back_to_default(self):
        self.assertEqual(model_for_complexity(None), DEFAULT_MODEL)

    def test_unknown_falls_back_to_default(self):
        self.assertEqual(model_for_complexity("trivial"), DEFAULT_MODEL)

    def test_accepts_enum_member(self):
        self.assertEqual(model_for_complexity(TaskComplexity.HARD), "claude-opus-4-8")
