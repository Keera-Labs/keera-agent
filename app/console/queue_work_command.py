from cleo.helpers import option
from fastapi_startkit.console.command import Command


class QueueWorkCommand(Command):
    """
    Start the Taskiq queue worker.

    queue:work
    """

    name = "queue:work"
    description = "Start the taskiq queue worker."
    options = [
        option("workers", "w", "Number of worker processes to spawn.", flag=False, default=1)
    ]

    def handle(self):
        from taskiq.cli.worker.args import WorkerArgs
        from taskiq.cli.worker.run import run_worker

        workers = int(self.option("workers"))
        args = WorkerArgs(
            broker="worker:broker",
            modules=[
                "app.tasks.example_task",
                "app.tasks.research_company_task",
                "app.tasks.research_people_task",
                "app.tasks.research_jobs_task",
                "app.tasks.embed_company_candidate_profile_task",
                "app.tasks.profile_company_task",
                "app.tasks.compute_suggestions_task",
            ],
            workers=workers,
        )
        run_worker(args)
