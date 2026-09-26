// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { reportSize, useTerminalSessions, type Session } from './useTerminalSessions'

vi.mock('@/composables/useAudio', () => ({ playSound: vi.fn() }))

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
