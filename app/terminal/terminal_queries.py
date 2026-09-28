"""Terminal query and response sequences.

Replaying a PTY's output into a fresh xterm re-runs every query in it, and
xterm answers each one as keyboard input. Those answers would reach whatever
now holds the PTY (e.g. a shell prompt), so queries are kept out of the replay
buffer and a replaying client's answers are dropped.
"""

import re

_ST = rb"(?:\x07|\x1b\\)"

QUERIES = re.compile(
    rb"\x1b\["
    rb"(?:[=>]?0?c"  # DA1 / DA2 / DA3
    rb"|(?:[56]|\?\d+)n"  # DSR, CPR, DEC DSR
    rb"|>0?q"  # XTVERSION
    rb"|\??\d+\$p"  # DECRQM
    rb"|\?u"  # kitty keyboard flags
    rb"|(?:1[134-689]|2[01])(?:;\d+)?t"  # XTWINOPS reports
    rb")"
    rb"|\x1b\](?:4;\d+|1\d|52;[a-z0-9]*);\?"
    + _ST  # OSC colour / clipboard queries
    + rb"|\x1bP[$+]q[^\x1b\x07]*"
    + _ST  # DECRQSS, XTGETTCAP
)

# The unfinished escape sequence a chunk may end with; it is held back until the
# next chunk completes it, so a query split across reads is still recognised.
PARTIAL_SEQUENCE = re.compile(rb"\x1b(?:\[[0-?]*[ -/]*|[\]P][^\x07\x1b]*\x1b?)?\Z")

_RESPONSE = (
    rb"\x1b\[[?>=]?[\d;]*\$?[cnRyut]"  # DA, DSR/CPR, DECRPM, kitty flags, window reports
    rb"|\x1b\][^\x07\x1b]*"
    + _ST  # OSC replies
    + rb"|\x1bP[^\x1b]*\x1b\\"  # DCS replies (XTVERSION, DECRQSS, XTGETTCAP)
)
RESPONSES_ONLY = re.compile(rb"(?:" + _RESPONSE + rb")+")


def strip_queries(data: bytes) -> bytes:
    return QUERIES.sub(b"", data)


def is_terminal_response(data: bytes) -> bool:
    return RESPONSES_ONLY.fullmatch(data) is not None
