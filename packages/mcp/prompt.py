class Prompt:
    title: str | None = None
    name: str | None = None
    description: str | None = None

    def should_register(self):
        return True

    def arguments(self):
        pass

    def handle(self):
        pass

