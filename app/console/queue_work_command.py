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
        from taskiq import InMemoryBroker

        from app.providers.queue_provider import broker

        # The default in-memory broker runs tasks in the dispatching process, so
        # a standalone worker has nothing to listen on. Guide the user instead of
        # crashing with taskiq's "Inmemory brokers cannot listen." error.
        if isinstance(broker, InMemoryBroker):
            self.line(
                "<comment>The in-memory broker runs tasks in-process on dispatch "
                "(await task.kiq(...)), so no standalone worker is needed.</comment>"
            )
            self.line(
                "Switch to a networked broker in app/providers/queue_provider.py "
                "to run this worker."
            )
            return

        from taskiq.cli.worker.args import WorkerArgs
        from taskiq.cli.worker.run import run_worker

        workers = int(self.option("workers"))
        args = WorkerArgs(
            broker="app.providers.queue_provider:broker",
            modules=["app.tasks"],
            workers=workers,
        )
        run_worker(args)
