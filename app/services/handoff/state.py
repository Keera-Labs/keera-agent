agents_in_flight: set[int] = set()


def is_handed_off(agent) -> bool:
    return bool(getattr(agent, "handed_off_at", None)) or agent.id in agents_in_flight
