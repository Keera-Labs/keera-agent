// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { playQuestionSound } from '@/composables/useAudio'
import { acknowledgeReplay, chimeOnNewQuestion, reportSize, socketMessageHandler, resetChimedQuestions, useTerminalSessions, type Session } from './useTerminalSessions'

vi.mock('@/composables/useAudio', () => ({ playQuestionSound: vi.fn() }))

let visibility: DocumentVisibilityState = 'visible'

function fakeSession(parent: HTMLElement, cols = 120, rows = 30) {
    const element = document.createElement('div')
    parent.append(element)
    const send = vi.fn()
    const session = {
        term: { element, cols, rows },
        ws: { readyState: WebSocket.OPEN, send },
    } as unknown as Session
    return { session, send }
}

function sent(send: ReturnType<typeof vi.fn>) {
    return send.mock.calls.map(([message]) => JSON.parse(message as string))
}

let slot: HTMLElement
let holder: HTMLElement

beforeEach(() => {
    resetChimedQuestions()
    vi.mocked(playQuestionSound).mockClear()
    visibility = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    // happy-dom does no layout; a terminal counts as displayed unless inside a display:none box.
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
        const hidden = this.closest('[style*="display: none"]')
        return (hidden ? [] : [new DOMRect(0, 0, 10, 10)]) as unknown as DOMRectList
    })
    slot = document.createElement('div')
    holder = document.createElement('div')
    holder.setAttribute('data-terminal-holder', '')
    document.body.append(slot, holder)
})

afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
})

describe('reportSize', () => {
    it('reports a terminal shown in a slot as visible', () => {
        const { session, send } = fakeSession(slot)

        reportSize(session)

        expect(sent(send)).toEqual([{ type: 'resize', cols: 120, rows: 30, visible: true }])
    })

    it('reports a terminal parked in the off-screen holder as not visible', () => {
        const { session, send } = fakeSession(holder)

        reportSize(session)

        expect(sent(send)).toEqual([{ type: 'resize', cols: 120, rows: 30, visible: false }])
    })

    it('reports a terminal in a hidden browser tab as not visible', () => {
        visibility = 'hidden'
        const { session, send } = fakeSession(slot)

        reportSize(session)

        expect(sent(send)[0].visible).toBe(false)
    })

    it('reports a terminal inside a display:none slot as not visible', () => {
        slot.style.display = 'none'
        const { session, send } = fakeSession(slot)

        reportSize(session)

        expect(sent(send)[0].visible).toBe(false)
    })

    it('sends only when the size or visibility changed', () => {
        const { session, send } = fakeSession(slot)

        reportSize(session)
        reportSize(session)
        holder.append(session.term.element!)
        reportSize(session)

        expect(sent(send).map(m => m.visible)).toEqual([true, false])
    })

    it('does not send on a socket that is not open', () => {
        const { session, send } = fakeSession(slot)
        ;(session.ws as { readyState: number }).readyState = WebSocket.CONNECTING

        reportSize(session)

        expect(send).not.toHaveBeenCalled()
    })
})

describe('acknowledgeReplay', () => {
    it('confirms the replay only after xterm has parsed the queued output', () => {
        const pending: Array<() => void> = []
        const send = vi.fn()
        const term = { write: vi.fn((_data: string, done: () => void) => pending.push(done)) }
        const session = { term, ws: { readyState: WebSocket.OPEN, send } } as unknown as Session

        acknowledgeReplay(session)
        expect(send).not.toHaveBeenCalled()

        pending.forEach(done => done())
        expect(sent(send)).toEqual([{ type: 'replay_done' }])
    })
})

describe('socketMessageHandler', () => {
    function setup() {
        const send = vi.fn()
        const term = { write: vi.fn((_data: unknown, done?: () => void) => done?.()) }
        const session = { term, ws: { readyState: WebSocket.OPEN, send } } as unknown as Session
        const onOutput = vi.fn()
        const onEvent = vi.fn()
        const handle = socketMessageHandler(() => session, { onOutput, onEvent })
        const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer
        return { term, send, onOutput, onEvent, handle, bytes }
    }

    it('draws replayed history without counting it as agent activity', () => {
        const { term, send, onOutput, onEvent, handle, bytes } = setup()

        handle(JSON.stringify({ type: 'replay_start' }))
        handle(bytes('old output'))
        handle(JSON.stringify({ type: 'replay_end' }))
        handle(bytes('new output'))

        expect(term.write).toHaveBeenCalledTimes(3)
        expect(onOutput).toHaveBeenCalledTimes(1)
        expect(new TextDecoder().decode(onOutput.mock.calls[0][0])).toBe('new output')
        expect(onEvent).not.toHaveBeenCalled()
        expect(sent(send)).toEqual([{ type: 'replay_done' }])
    })

    it('passes other events and live output through', () => {
        const { onOutput, onEvent, handle, bytes } = setup()

        handle(JSON.stringify({ type: 'claude_stopped' }))
        handle(bytes('live'))

        expect(onEvent).toHaveBeenCalledWith({ type: 'claude_stopped' })
        expect(onOutput).toHaveBeenCalledTimes(1)
    })
})

describe('tab visibility', () => {
    it('re-reports every live terminal when the tab is hidden and shown again', () => {
        const scope = effectScope()
        const terminals = scope.run(() => useTerminalSessions({
            activeProject: null,
            projectAgents: [],
            onAgentCreated: () => {},
            onClaudeStopped: () => {},
            onAgentMessage: () => {},
            onAgentStatus: () => {},
        }))!
        const pm = fakeSession(slot)
        const agent = fakeSession(slot, 90, 20)
        terminals.sessions.set(1, pm.session)
        terminals.agentSessions.set(2, agent.session)

        visibility = 'hidden'
        document.dispatchEvent(new Event('visibilitychange'))
        visibility = 'visible'
        document.dispatchEvent(new Event('visibilitychange'))

        expect(sent(pm.send).map(m => m.visible)).toEqual([false, true])
        expect(sent(agent.send)).toEqual([
            { type: 'resize', cols: 90, rows: 20, visible: false },
            { type: 'resize', cols: 90, rows: 20, visible: true },
        ])
        terminals.sessions.delete(1)
        terminals.agentSessions.delete(2)
        scope.stop()
    })
})

describe('restartClaude', () => {
    function setup() {
        const scope = effectScope()
        const terminals = scope.run(() => useTerminalSessions({
            activeProject: { id: 1 } as never,
            projectAgents: [],
            onAgentCreated: () => {},
            onClaudeStopped: () => {},
            onAgentMessage: () => {},
            onAgentStatus: () => {},
        }))!
        const pm = fakeSession(slot)
        terminals.sessions.set(1, pm.session)
        const cleanup = () => {
            terminals.sessions.delete(1)
            scope.stop()
        }
        return { terminals, pm, cleanup }
    }

    it('asks the server to relaunch the CLI instead of typing a command', () => {
        const { terminals, pm, cleanup } = setup()

        terminals.restartClaude()

        expect(sent(pm.send)).toEqual([{ type: 'restart_cli' }])
        cleanup()
    })

    it('does nothing on a socket that is not open', () => {
        const { terminals, pm, cleanup } = setup()
        ;(pm.session.ws as { readyState: number }).readyState = WebSocket.CLOSED

        terminals.restartClaude()

        expect(pm.send).not.toHaveBeenCalled()
        cleanup()
    })
})

describe('chimeOnNewQuestion', () => {
    const question = { agent_id: 41, status: 'needs_input', attention_kind: 'question' }

    it('stays silent for permission prompts and other statuses', () => {
        chimeOnNewQuestion({ agent_id: 40, status: 'needs_input', attention_kind: 'permission' })
        chimeOnNewQuestion({ agent_id: 40, status: 'running' })
        chimeOnNewQuestion({ agent_id: 40, status: 'waiting' })

        expect(playQuestionSound).not.toHaveBeenCalled()
    })

    it('chimes once per question and again for the next one', () => {
        chimeOnNewQuestion(question)
        chimeOnNewQuestion(question)
        expect(playQuestionSound).toHaveBeenCalledTimes(1)

        chimeOnNewQuestion({ agent_id: 41, status: 'running' })
        chimeOnNewQuestion(question)
        expect(playQuestionSound).toHaveBeenCalledTimes(2)
    })

    it('chimes again for a question asked after the agent stopped waiting', () => {
        chimeOnNewQuestion(question)
        chimeOnNewQuestion({ agent_id: 41, status: 'waiting', attention_kind: null })
        chimeOnNewQuestion(question)

        expect(playQuestionSound).toHaveBeenCalledTimes(2)
    })
})
