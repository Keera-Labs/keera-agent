"""Regression test for #1370: concurrent coroutines sharing the ORM's single
cached AsyncConnection interleaved execute/commit and tripped SQLAlchemy's
internal transaction asserts (500s on /api/projects/{id}/agents and /tasks
while the check-in scheduler loop queried the DB in the background).

Deliberately NOT using the DatabaseTransaction mixin: the bug lives in the
autocommit path, which a wrapping transaction would mask.
"""

import asyncio
import warnings

from sqlalchemy.exc import SAWarning

from app.models.Agent import Agent
from app.models.Project import Project
from app.models.Task import Task
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from databases.factories.task_factory import TaskFactory
from tests.test_case import TestCase


class TestDbConcurrency(TestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.project = await ProjectFactory.new().create()
        self.agent = await AgentFactory.new().create(project_id=self.project.id)
        self.task = await TaskFactory.new().create(project_id=self.project.id, status="in_progress")

    async def asyncTearDown(self):
        await Task.where("id", self.task.id).delete()
        await Agent.where("id", self.agent.id).delete()
        await Project.where("id", self.project.id).delete()
        await super().asyncTearDown()

    async def test_concurrent_queries_do_not_corrupt_the_shared_connection(self):
        async def scheduler_tick():
            # Same query shape as checkin_scheduler._has_in_progress
            for _ in range(50):
                await (
                    Task.where("project_id", self.project.id).where("status", "in_progress").count()
                )

        async def request_handler():
            # Same query shape as agent_controller.index
            for _ in range(50):
                await Agent.where("project_id", self.project.id).where_null("deleted_at").get()

        async def task_index():
            # Same query shape as task_controller.index -> paginate()
            for _ in range(50):
                await Task.where("project_id", self.project.id).paginate(15, 1)

        # Interleaved commits on a shared connection surface as SAWarning
        # ("transaction already deassociated") in the lucky case and as an
        # AssertionError 500 in the unlucky one — treat both as failure.
        with warnings.catch_warnings():
            warnings.simplefilter("error", SAWarning)
            await asyncio.gather(
                *(scheduler_tick() for _ in range(5)),
                *(request_handler() for _ in range(5)),
                *(task_index() for _ in range(5)),
            )
