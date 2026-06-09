from fastapi_startkit.masoniteorm import Factory

from app.models.Task import Task


class TaskFactory(Factory):
    model = Task

    def definition(self) -> dict:
        return {
            "title": self.fake.sentence(nb_words=4).rstrip("."),
            "body": self.fake.paragraph(),
            "assignees": [self.fake.first_name()],
            "priority": self.fake.random_element(["low", "medium", "high"]),
            "acceptance_criteria": [self.fake.sentence()],
            "testing_methods": [self.fake.sentence()],
            "validation_steps": [self.fake.sentence()],
        }
