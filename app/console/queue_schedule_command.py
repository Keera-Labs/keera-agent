import asyncio

from fastapi_startkit.console.command import Command


class QueueScheduleCommand(Command):
    """
    Start the taskiq scheduler (fires cron-scheduled tasks).

    queue:schedule
    """

    name = "queue:schedule"
    description = "Start the taskiq scheduler that fires cron-scheduled tasks."

    def handle(self):
        from taskiq.cli.scheduler.args import SchedulerArgs
        from taskiq.cli.scheduler.run import run_scheduler

        args = SchedulerArgs(
            scheduler="app.providers.queue_provider:scheduler",
            modules=["app.tasks"],
        )
        asyncio.run(run_scheduler(args))
