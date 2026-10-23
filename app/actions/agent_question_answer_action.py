import asyncio
import weakref

from app.actions.agent_question_action import settle_pending_questions
from app.actions.agent_status_action import CLEARED_ATTENTION, notify_agent_status, utc_now
from app.actions.terminal_write_action import TerminalWriteAction
from app.exceptions.agent_question_conflict_error import AgentQuestionConflictError
from app.exceptions.agent_question_invalid_answer_error import AgentQuestionInvalidAnswerError
from app.models.Agent import Agent
from app.models.AgentQuestion import AgentQuestion
from app.terminal.terminal import Terminal

ESCAPE = b"\x1b"
ENTER = b"\r"
DIALOG_CLOSE_DELAY = 0.3
PERMISSION_CHOICES = ("Allow", "Deny")

_agent_locks: "weakref.WeakValueDictionary[int, asyncio.Lock]" = weakref.WeakValueDictionary()


def _lock_for(agent_id: int) -> asyncio.Lock:
    lock = _agent_locks.get(agent_id)
    if lock is None:
        lock = asyncio.Lock()
        _agent_locks[agent_id] = lock
    return lock


class AgentQuestionAnswerAction:
    def __init__(self, question: AgentQuestion, choices: list[str], text: str | None):
        self.question = question
        self.choices = choices
        self.text = (text or "").strip()

    @staticmethod
    def prepare(
        question: AgentQuestion, choices: list[str], text: str | None
    ) -> "AgentQuestionAnswerAction":
        return AgentQuestionAnswerAction(question, choices, text)

    async def execute(self) -> AgentQuestion:
        if self.question.kind == "permission" and not self._permission_choice():
            raise AgentQuestionInvalidAnswerError("Choose Allow or Deny.")
        async with _lock_for(self.question.agent_id):
            return await self._answer_exclusively()

    async def _answer_exclusively(self) -> AgentQuestion:
        self.question = await AgentQuestion.find_or_fail(self.question.id)
        if self.question.status != "pending":
            raise AgentQuestionConflictError("This question has already been answered.")
        agent = await Agent.find_or_fail(self.question.agent_id)
        terminal = TerminalWriteAction.prepare(agent.session_id, "").resolve_terminal()
        if not terminal:
            raise AgentQuestionConflictError("The agent's terminal is not running.")
        if agent.status != "needs_input":
            await self._mark_answered(None)
            raise AgentQuestionConflictError("This question is no longer waiting for an answer.")

        await self._mark_answered(self._answer())

        if self.question.kind == "permission":
            await self._reply_to_permission(terminal)
        elif await self._call_is_fully_answered():
            await self._reply_to_questions(terminal)
        else:
            return await AgentQuestion.find(self.question.id)

        await settle_pending_questions(agent.id)
        await Agent.where("id", agent.id).update(
            {"status": "running", **CLEARED_ATTENTION, "updated_at": utc_now()}
        )
        await notify_agent_status(agent, "running")
        return await AgentQuestion.find(self.question.id)

    async def _mark_answered(self, answer: str | None) -> None:
        await AgentQuestion.where("id", self.question.id).update(
            {
                "status": "answered",
                "answer": answer,
                "answered_at": utc_now(),
                "updated_at": utc_now(),
            }
        )

    def _permission_choice(self) -> str | None:
        return next((choice for choice in self.choices if choice in PERMISSION_CHOICES), None)

    def _answer(self) -> str:
        return " — ".join(part for part in (", ".join(self.choices), self.text) if part)

    async def _call_is_fully_answered(self) -> bool:
        if not self.question.tool_use_id:
            return True
        return not await self._call_questions().where("status", "pending").first()

    def _call_questions(self):
        return AgentQuestion.where("agent_id", self.question.agent_id).where(
            "tool_use_id", self.question.tool_use_id
        )

    async def _reply_to_permission(self, terminal: Terminal) -> None:
        await terminal.write(ENTER if self._permission_choice() == "Allow" else ESCAPE)
        if self.text:
            await asyncio.sleep(DIALOG_CLOSE_DELAY)
            await terminal.send(self.text)

    async def _reply_to_questions(self, terminal: Terminal) -> None:
        if self.question.tool_use_id:
            answered = await self._call_questions().order_by("position", "asc").get()
        else:
            answered = [await AgentQuestion.find(self.question.id)]
        await terminal.write(ESCAPE)
        await asyncio.sleep(DIALOG_CLOSE_DELAY)
        await terminal.send(answer_message(answered))


def answer_message(questions: list[AgentQuestion]) -> str:
    if len(questions) == 1:
        question = questions[0]
        return f'My answer to your question "{question.question}": {question.answer}'
    lines = [f'- "{question.question}": {question.answer}' for question in questions]
    return "My answers to your questions:\n" + "\n".join(lines)
