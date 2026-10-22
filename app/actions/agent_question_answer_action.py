import asyncio

from app.actions.agent_status_action import CLEARED_ATTENTION, notify_agent_status, utc_now
from app.actions.terminal_write_action import TerminalWriteAction
from app.exceptions.agent_question_conflict_error import AgentQuestionConflictError
from app.models.Agent import Agent
from app.models.AgentQuestion import AgentQuestion
from app.terminal.terminal import Terminal

ESCAPE = b"\x1b"
ENTER = b"\r"
DIALOG_CLOSE_DELAY = 0.3


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
        if self.question.status != "pending":
            raise AgentQuestionConflictError("This question has already been answered.")
        agent = await Agent.find_or_fail(self.question.agent_id)
        terminal = TerminalWriteAction.prepare(agent.session_id, "").resolve_terminal()
        if not terminal:
            raise AgentQuestionConflictError("The agent's terminal is not running.")

        await AgentQuestion.where("id", self.question.id).update(
            {
                "status": "answered",
                "answer": self._answer(),
                "answered_at": utc_now(),
                "updated_at": utc_now(),
            }
        )

        if self.question.kind == "permission":
            await self._reply_to_permission(terminal)
        elif await self._call_is_fully_answered():
            await self._reply_to_questions(terminal)
        else:
            return await AgentQuestion.find(self.question.id)

        await Agent.where("id", agent.id).update(
            {"status": "running", **CLEARED_ATTENTION, "updated_at": utc_now()}
        )
        await notify_agent_status(agent, "running")
        return await AgentQuestion.find(self.question.id)

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
        await terminal.write(ENTER if "Allow" in self.choices else ESCAPE)
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
