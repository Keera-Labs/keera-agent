"""Regression tests for the "first message to a new agent is never submitted" bug.

A CLI that has just booted puts the TTY in raw mode early but stays busy for a
while, so everything written meanwhile is read back in one chunk. When the
message text and the submitting CR arrive in the same read, the CLI treats the
CR as part of a paste and drops it — the text sits unsubmitted in the input box.

These tests run a real process in a real PTY that does exactly that (raw mode,
then a busy "boot" sleep) and records how its stdin reads were chunked.
"""

import asyncio
import os
import stat
import sys
import tempfile
import uuid

from fastapi_startkit.application import app
from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from app.actions.agent_message_send_action import AgentMessageSendAction
from app.actions.relay_delivery import deliver_pending_relay_messages
from app.controllers.agent_trigger_controller import first_message
from app.controllers.claude_hook_controller import _deliver_agent_relay_messages
from app.models.AgentRelayMessage import AgentRelayMessage
from app.terminal.manager import TerminalManager
from app.terminal.readiness import claude_ready, mark_booting
from app.terminal.terminal import PASTE_END, PASTE_START, Terminal
from app.terminal.websocket_terminal import WebsocketTerminal
from databases.factories.agent_factory import AgentFactory
from databases.factories.project_factory import ProjectFactory
from tests.test_case import TestCase

BOOT_SECONDS = 1.5

FAKE_CLI = f"""#!{sys.executable}
import os, termios, time, tty
tty.setraw(0, termios.TCSADRAIN)
os.write(1, os.environ["FAKE_CLI_BANNER"].encode() + b"\\r\\n")
time.sleep(float(os.environ["FAKE_CLI_BOOT"]))
with open(os.environ["FAKE_CLI_LOG"], "ab", buffering=0) as log:
    while True:
        chunk = os.read(0, 65536)
        if not chunk:
            break
        log.write(len(chunk).to_bytes(4, "big") + chunk)
        os.write(1, b"echo " + str(len(chunk)).encode() + b"\\r\\n")
"""


def _read_chunks(path: str) -> list[bytes]:
    if not os.path.exists(path):
        return []
    data = open(path, "rb").read()
    chunks, i = [], 0
    while i + 4 <= len(data):
        size = int.from_bytes(data[i : i + 4], "big")
        chunks.append(data[i + 4 : i + 4 + size])
        i += 4 + size
    return chunks


async def _wait_for_submit(path: str, timeout: float = 10.0) -> list[bytes]:
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        chunks = _read_chunks(path)
        if chunks and b"".join(chunks).endswith(b"\r"):
            return chunks
        await asyncio.sleep(0.05)
    return _read_chunks(path)


class FakeCliSession:
    """A slow-booting CLI in a PTY registered with the app's TerminalManager."""

    def __init__(self):
        self.dir = tempfile.mkdtemp()
        self.log = os.path.join(self.dir, "stdin.log")
        self.script = os.path.join(self.dir, "fake_cli")
        with open(self.script, "w") as f:
            f.write(FAKE_CLI)
        os.chmod(self.script, os.stat(self.script).st_mode | stat.S_IEXEC)
        self.session_id = str(uuid.uuid4())
        self.manager: TerminalManager = app().make("terminal")

    def start(self, banner: str = "fake cli banner"):
        env = dict(
            os.environ,
            FAKE_CLI_LOG=self.log,
            FAKE_CLI_BOOT=str(BOOT_SECONDS),
            FAKE_CLI_BANNER=banner,
        )
        self.manager.create(shell=self.script, cwd=self.dir, env=env, session_id=self.session_id)
        self.terminal = self.manager.get(self.session_id)
        bridge = WebsocketTerminal(None, self.terminal)
        self.reader = asyncio.create_task(bridge.run(stop_on_disconnect=False))
        return self

    async def boot(self):
        # Returns once the banner has rendered and gone quiet — while the fake
        # CLI is still busy, like a real CLI shortly after startup.
        await self.terminal.wait_for_cli_ready(min_wait=0.2, quiet=0.3, timeout=5)

    def mark_ready(self):
        mark_booting(self.session_id).set()

    async def stop(self):
        self.reader.cancel()
        self.manager.close(self.session_id)
        claude_ready.pop(self.session_id, None)


class TestTerminalSendToBootingCli(TestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.cli = FakeCliSession().start()
        await self.cli.boot()

    async def asyncTearDown(self):
        await self.cli.stop()
        await super().asyncTearDown()

    async def _send_and_collect(self, message: str) -> list[bytes]:
        await self.cli.terminal.send(message)
        return await _wait_for_submit(self.cli.log)

    async def test_enter_arrives_in_its_own_read_after_the_text(self):
        chunks = await self._send_and_collect("[Message from Agent 'PM']: do the task\n")

        self.assertEqual(chunks[-1], b"\r", f"CR was merged into the text read: {chunks!r}")
        self.assertEqual(
            b"".join(chunks),
            PASTE_START + b"[Message from Agent 'PM']: do the task" + PASTE_END + b"\r",
        )

    async def test_multiline_special_characters_are_delivered_intact(self):
        message = 'line one\nline "two" with `ticks`, $HOME and \\ backslash\n\tline three'

        chunks = await self._send_and_collect(message)

        self.assertEqual(chunks[-1], b"\r")
        self.assertEqual(b"".join(chunks), PASTE_START + message.encode() + PASTE_END + b"\r")

    async def test_long_message_is_delivered_intact_and_submitted_once(self):
        message = "\n".join(f"line {i}: " + "x" * 60 for i in range(60))
        self.assertGreater(len(message), 2000)

        chunks = await self._send_and_collect(message)

        self.assertEqual(chunks[-1], b"\r")
        self.assertEqual(b"".join(chunks).count(b"\r"), 1)
        self.assertEqual(b"".join(chunks), PASTE_START + message.encode() + PASTE_END + b"\r")

    async def test_content_cannot_close_the_paste_early(self):
        chunks = await self._send_and_collect("before" + PASTE_END.decode() + "after")

        self.assertEqual(b"".join(chunks), PASTE_START + b"beforeafter" + PASTE_END + b"\r")


class TestRelayMessageToNewAgent(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.cli = FakeCliSession().start()
        await self.cli.boot()
        self.project = project = await ProjectFactory.new().create(path=self.cli.dir)
        self.pm = await AgentFactory.new().create(project_id=project.id, name="PM")
        self.agent = await AgentFactory.new().create(
            project_id=project.id, session_id=self.cli.session_id
        )

    async def asyncTearDown(self):
        await self.cli.stop()
        await super().asyncTearDown()

    async def _queue(self, content: str) -> int:
        msg = await AgentRelayMessage.create(
            {
                "from_agent_id": self.pm.id,
                "to_agent_id": self.agent.id,
                "content": content,
                "status": "pending",
            }
        )
        return msg.id

    async def test_message_to_booting_agent_is_queued_then_flushed_once_ready(self):
        mark_booting(self.cli.session_id)

        msg_id, delivered = await AgentMessageSendAction.prepare(
            self.pm, self.agent, "first task\nwith two lines"
        ).execute()

        self.assertFalse(delivered)
        self.assertEqual((await AgentRelayMessage.find(msg_id)).status, "pending")

        claude_ready[self.cli.session_id].set()
        await deliver_pending_relay_messages(self.agent.id)
        await deliver_pending_relay_messages(self.agent.id)

        chunks = await _wait_for_submit(self.cli.log)
        received = b"".join(chunks)
        self.assertEqual((await AgentRelayMessage.find(msg_id)).status, "delivered")
        self.assertEqual(chunks[-1], b"\r")
        self.assertEqual(received.count(b"first task\nwith two lines"), 1)
        self.assertIn(b"[Message from Agent 'PM']: first task", received)

    async def test_concurrent_flushes_deliver_each_message_once(self):
        ids = [await self._queue(f"queued message {i}") for i in range(3)]
        self.cli.mark_ready()

        counts = await asyncio.gather(
            deliver_pending_relay_messages(self.agent.id),
            deliver_pending_relay_messages(self.agent.id),
        )

        received = b"".join(await _wait_for_submit(self.cli.log))
        self.assertEqual(sum(counts), 3)
        for i, msg_id in enumerate(ids):
            self.assertEqual(received.count(f"queued message {i}".encode()), 1, received)
            self.assertEqual((await AgentRelayMessage.find(msg_id)).status, "delivered")

    async def test_stop_hook_leaves_messages_for_a_booting_agent_pending(self):
        mark_booting(self.cli.session_id)
        msg_id = await self._queue("wait for my first task")

        await _deliver_agent_relay_messages(self.project, self.cli.dir)

        self.assertEqual((await AgentRelayMessage.find(msg_id)).status, "pending")
        self.assertEqual(_read_chunks(self.cli.log), [])

    async def test_stop_hook_flushes_messages_for_a_ready_agent(self):
        self.cli.mark_ready()
        msg_id = await self._queue("next step")

        await _deliver_agent_relay_messages(self.project, self.cli.dir)

        received = b"".join(await _wait_for_submit(self.cli.log))
        self.assertEqual((await AgentRelayMessage.find(msg_id)).status, "delivered")
        self.assertEqual(received.count(b"next step"), 1)

    async def test_live_session_without_ready_event_is_treated_as_booting(self):
        claude_ready.pop(self.cli.session_id, None)

        msg_id, delivered = await AgentMessageSendAction.prepare(
            self.pm, self.agent, "too early"
        ).execute()

        self.assertFalse(delivered)
        self.assertEqual((await AgentRelayMessage.find(msg_id)).status, "pending")
        self.assertEqual(_read_chunks(self.cli.log), [])

    async def test_message_to_ready_agent_is_delivered_and_submitted(self):
        self.cli.mark_ready()

        msg_id, delivered = await AgentMessageSendAction.prepare(
            self.pm, self.agent, "hello"
        ).execute()

        chunks = await _wait_for_submit(self.cli.log)
        self.assertTrue(delivered)
        self.assertEqual((await AgentRelayMessage.find(msg_id)).status, "delivered")
        self.assertEqual(
            b"".join(chunks),
            PASTE_START + b"[Message from Agent 'PM']: hello" + PASTE_END + b"\r",
        )


class TestFirstMessage(TestCase):
    def test_relay_instructions_and_task_form_one_message(self):
        message = first_message("\n\n---\nPROTOCOL\nYour agent ID is: 7", "Do task #1")

        self.assertEqual(message, "---\nPROTOCOL\nYour agent ID is: 7\n\nDo task #1")


class TestStartupDialog(TestCase):
    def test_known_dialogs_are_detected_even_when_split_across_reads(self):
        term = Terminal()
        term.mark_output(b"\x1b[1mQuick safety\x1b[0m")
        term.mark_output(b" check: Is this a project you created or one you trust?")
        self.assertEqual(term.startup_prompt, "Quick safety check")

        term.mark_input()
        self.assertIsNone(term.startup_prompt)

        term.mark_output(b"  1. Update now\r\n  2. Skip\r\n\x1b[3C3. Skip until next version")
        self.assertEqual(term.startup_prompt, "Skip until next version")

    def test_ordinary_output_is_not_a_dialog(self):
        term = Terminal()
        term.mark_output(b"Welcome to the CLI\r\n> ")
        self.assertIsNone(term.startup_prompt)

    async def test_dialog_text_after_boot_is_ignored(self):
        term = Terminal()
        await term.wait_for_cli_ready(min_wait=0, quiet=0.05, timeout=1)

        term.mark_output(b"the trust dialog shows 'Yes, I trust this folder'")

        self.assertIsNone(term.startup_prompt)


class TestNoEnterIntoStartupDialog(TestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.cli = FakeCliSession().start(
            banner="Quick safety check: Is this a project you trust? 1. Yes, I trust this folder"
        )

    async def asyncTearDown(self):
        await self.cli.stop()
        await super().asyncTearDown()

    async def test_first_message_is_held_until_the_dialog_is_answered(self):
        ready = asyncio.create_task(self.cli.boot())

        await asyncio.sleep(1.0)
        self.assertFalse(ready.done(), "boot finished while a startup dialog was on screen")
        self.assertEqual(_read_chunks(self.cli.log), [])

        self.cli.terminal.mark_input()
        await asyncio.wait_for(ready, timeout=3)
        self.assertIsNone(self.cli.terminal.startup_prompt)
