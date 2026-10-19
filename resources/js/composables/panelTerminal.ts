import { FitAddon } from '@xterm/addon-fit'
import { attachTerminal, makeTerminal, reportSize, type Session } from '@/composables/useTerminalSessions'

export function createPanelSession(): Session {
    const term = makeTerminal()
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    const session: Session = {
        term,
        fitAddon,
        ws: null as unknown as WebSocket,
        observer: new ResizeObserver(() => {
            fitAddon.fit()
            reportSize(session)
        }),
    }
    term.onData(data => {
        if (session.ws?.readyState === WebSocket.OPEN) session.ws.send(data)
    })
    term.onResize(() => reportSize(session))
    return session
}

export function mountPanelSession(session: Session, host: HTMLElement) {
    attachTerminal(session.term, host)
    session.observer.disconnect()
    session.observer.observe(host)
    session.fitAddon.fit()
    reportSize(session)
}
