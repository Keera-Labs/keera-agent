class Tool:
    name: str | None = None
    description: str | None = None

    def schema(self):
        pass

    def output_schema(self):
        return

    def handle(self):
        pass
