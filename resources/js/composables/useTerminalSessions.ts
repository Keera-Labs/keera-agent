import { computed, onScopeDispose, reactive, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { Project } from '@/types/type'
import { normalizeAgent, type AgentResource, type ProjectAgent } from '@/queries/agentQuery'
import { playSound } from '@/composables/useAudio'

export interface Session {
    term: Terminal
    ws: WebSocket
    fitAddon: FitAddon
    observer: ResizeObserver
    /** The last resize message sent, so repeated reports don't reach the server. */
    reportedSize?: string
}

export type ClaudeStatus = 'running' | 'done'

// xterm.js requires raw hex values — CSS variables are not supported.
const XTERM_THEME = {
    background: '#f6f8fa', foreground: '#24292f', cursor: '#24292f', cursorAccent: '#f6f8fa',
    selectionBackground: '#0969da33',
    black: '#24292f', brightBlack: '#57606a',
    red: '#cf222e', brightRed: '#a40e26',
    green: '#116329', brightGreen: '#1a7f37',
    yellow: '#4d2d00', brightYellow: '#633c01',
    blue: '#0969da', brightBlue: '#218bff',
    magenta: '#8250df', brightMagenta: '#a475f9',
    cyan: '#1b7c83', brightCyan: '#3192aa',
    white: '#6e7781', brightWhite: '#8c959f',
}

export interface TerminalFont {
    fontFamily: string
    fontSize: number
}

let terminalFont: TerminalFont = { fontFamily: '"Dank Mono", "Fira Code", "Cascadia Code", monospace', fontSize: 16 }

export function makeTerminal() {
    return new Terminal({
        theme: XTERM_THEME,
        ...terminalFont,
        lineHeight: 1.4, cursorBlink: true, scrollback: 5000,
    })
}

// Attach a terminal to a container, re-parenting it if it is already open.
// xterm's Terminal.open() only mounts on its FIRST call and is a no-op afterwards
// — it never moves an already-open terminal to a new parent. The persistent-layout
// design shuttles a live terminal between its off-screen holder and the visible
// agent-detail slot, so re-parenting must move the terminal's root element itself;
// relying on open() alone silently leaves the terminal in its old parent (blank
// slot) or lets its DOM die with an unmounting container.
export function attachTerminal(term: Terminal, container: HTMLElement) {
    if (term.element) {
        if (term.element.parentElement !== container) container.appendChild(term.element)
    } else {
        term.open(container)
    }
}

// xterm instances, sockets and observers live in plain module-scope Maps, never
// in Vue state: proxying xterm internals breaks it, deep reactivity over a
// scrollback buffer is pure overhead, and module scope lets PTYs outlive any
// component across Inertia navigations. Only the small status records are reactive.
const sessions = new Map<number, Session>()
const agentSessions = new Map<number, Session>()
const containerRefs = new Map<number, HTMLElement | null>()
const agentContainerRefs = new Map<number, HTMLElement | null>()

const claudeStatus = reactive<Record<number, ClaudeStatus>>({})
const lastActivity = reactive<Record<number, string>>({})
const outputChars = reactive<Record<number, number>>({})
const sessionStart = reactive<Record<number, Date>>({})
// Reactive mirror of the Maps' sizes, which Vue cannot track itself.
const liveSessionCount = ref(0)

function syncLiveSessionCount() {
    liveSessionCount.value = sessions.size + agentSessions.size
}

const INPUT_PROMPT_PATTERNS = [
    /\?\s*$/m,
    /\[Y\/n\]/i,
    /\[y\/N\]/i,
    /Do you want to/i,
    /Would you like/i,
    /Press Enter to/i,
    /Type your (message|response|reply)/i,
]

function disposeSession({ term, ws, observer }: Session) {
    observer.disconnect()
    term.dispose()
    ws.close()
}

/**
 * Switch every open terminal (and the ones opened later) to a new font. xterm
 * measures its cell size when the option changes, so the face is loaded first;
 * the resize to the new cell count then goes through the usual fit path.
 */
export async function applyTerminalFont(font: TerminalFont) {
    terminalFont = font
    await document.fonts.load(`${font.fontSize}px ${font.fontFamily}`).catch(() => {})
    // A newer font was applied while this one was loading.
    if (terminalFont !== font) return
    for (const { term, fitAddon } of [...sessions.values(), ...agentSessions.values()]) {
        term.options.fontFamily = font.fontFamily
        term.options.fontSize = font.fontSize
        fitAddon.fit()
    }
}

function disposeAgentSessions() {
    agentSessions.forEach(disposeSession)
    agentSessions.clear()
    syncLiveSessionCount()
}

/** Tear down a project's PM terminal and the given agents' terminals, e.g. when the project is deleted. */
export function disposeProjectSessions(projectId: number, agentIds: number[]) {
    const pm = sessions.get(projectId)
    if (pm) disposeSession(pm)
    sessions.delete(projectId)
    containerRefs.delete(projectId)
    for (const agentId of agentIds) {
        const session = agentSessions.get(agentId)
        if (session) disposeSession(session)
        agentSessions.delete(agentId)
        agentContainerRefs.delete(agentId)
    }
    syncLiveSessionCount()
}

function sendIfOpen(ws: WebSocket, data: string | Uint8Array) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data)
}

/** Whether the user can see this terminal: its tab is in front and it sits in a displayed slot. */
export function isTerminalShown(term: Terminal): boolean {
    const el = term.element
    return document.visibilityState === 'visible'
        && !!el?.isConnected
        && !el.closest('[data-terminal-holder]')
        && el.getClientRects().length > 0
}

/**
 * Tell the server this client's size and whether it is on screen. A PTY shared
 * by several clients (e.g. two browser tabs) is sized to the smallest visible
 * one, so a parked terminal or a background tab must not hold it small.
 */
export function reportSize(session: Session) {
    const { term, ws } = session
    const message = JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows, visible: isTerminalShown(term) })
    if (message === session.reportedSize || ws.readyState !== WebSocket.OPEN) return
    session.reportedSize = message
    ws.send(message)
}

type SocketEvent = { type?: string; [key: string]: unknown }

interface ConnectHandlers {
    onOpen?: () => void
    onEvent: (event: SocketEvent) => void
    onOutput?: (bytes: Uint8Array) => void
}

function connectTerminal(container: HTMLElement, project: Project, agentId: number, handlers: ConnectHandlers): Session {
    const term = makeTerminal()
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(container)
    fitAddon.fit()

    const textarea = container.querySelector('textarea')
    if (textarea) {
        textarea.setAttribute('autocomplete', 'off')
        textarea.setAttribute('autocorrect', 'off')
        textarea.setAttribute('autocapitalize', 'none')
        textarea.setAttribute('spellcheck', 'false')
    }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${location.host}/${project.slug}/ws?agent_id=${agentId}`)
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => {
        reportSize(session)
        handlers.onOpen?.()
    }
    ws.onmessage = e => {
        if (typeof e.data === 'string') {
            let event: SocketEvent
            try {
                event = JSON.parse(e.data)
            } catch {
                return
            }
            handlers.onEvent(event)
            return
        }
        const bytes = new Uint8Array(e.data as ArrayBuffer)
        term.write(bytes)
        handlers.onOutput?.(bytes)
    }
    ws.onclose = () => term.write('\r\n\x1b[31m[disconnected]\x1b[0m\r\n')

    term.onData(data => sendIfOpen(ws, data))
    term.onResize(() => reportSize(session))
    container.addEventListener('click', () => term.focus())

    const observer = new ResizeObserver(() => {
        fitAddon.fit()
        reportSize(session)
    })
    observer.observe(container)

    const session: Session = { term, ws, fitAddon, observer }
    return session
}

export interface UseTerminalSessionsParams {
    activeProject: MaybeRefOrGetter<Project | null>
    projectAgents: MaybeRefOrGetter<ProjectAgent[]>
    onAgentCreated: (agent: ProjectAgent) => void
    onClaudeStopped: (projectId: number) => void
    onAgentMessage: (messageId: number) => void
    /** An agent changed status (e.g. started waiting on a question) — refresh agent queries. */
    onAgentStatus: () => void
}

/**
 * Owns the PM and agent PTY sessions. Call it once, from the app layout store:
 * its watchers open the active project's PM session and disposing its scope
 * tears every session down.
 */
export function useTerminalSessions(params: UseTerminalSessionsParams) {
    const activeProject = computed(() => toValue(params.activeProject))
    const pmAgentId = computed(() => toValue(params.projectAgents).find(a => a.agent_type === 'pm')?.id ?? null)

    function agentCreatedFrom(event: SocketEvent) {
        params.onAgentCreated(normalizeAgent((event.agent as { data: AgentResource }).data))
    }

    function launchAgentSession(agentId: number, focus: boolean = true) {
        const project = activeProject.value
        if (!project) return
        if (!agentContainerRefs.get(agentId)) return

        const existing = agentSessions.get(agentId)
        if (existing) {
            if (focus) requestAnimationFrame(() => { existing.fitAddon.fit(); reportSize(existing); existing.term.focus() })
            return
        }

        requestAnimationFrame(() => {
            // Two triggers in the same tick can both pass the guard above; never open a second PTY.
            if (agentSessions.has(agentId)) return
            // Read the slot now: a page may have handed over a new one since this frame was queued.
            const container = agentContainerRefs.get(agentId)
            if (!container) return
            const session = connectTerminal(container, project, agentId, {
                onEvent: event => {
                    if (event.type === 'agent_created') agentCreatedFrom(event)
                },
            })
            if (focus) session.term.focus()
            agentSessions.set(agentId, session)
            syncLiveSessionCount()
        })
    }

    function launchPmSession() {
        const project = activeProject.value
        const pmId = pmAgentId.value
        if (!project || pmId === null) return
        if (!containerRefs.get(project.id)) return

        const existing = sessions.get(project.id)
        if (existing) {
            requestAnimationFrame(() => { existing.fitAddon.fit(); reportSize(existing); existing.term.focus() })
            return
        }

        requestAnimationFrame(() => {
            if (sessions.has(project.id)) return
            // On landing, the layout's hidden slot is registered first and the agent page's visible
            // slot in the same tick the PM id loads; opening in the stale hidden one leaves a 0x0 terminal.
            const container = containerRefs.get(project.id)
            if (!container) return

            let recentText = ''
            let lastInputSoundAt = 0

            const session = connectTerminal(container, project, pmId, {
                onOpen: () => {
                    claudeStatus[project.id] = 'running'
                    sessionStart[project.id] = new Date()
                },
                onEvent: event => {
                    if (event.type === 'claude_stopped') {
                        claudeStatus[project.id] = 'done'
                        params.onClaudeStopped(project.id)
                        params.onAgentStatus()
                        playSound('done')
                    } else if (event.type === 'agent_status') {
                        params.onAgentStatus()
                        if (event.status === 'needs_input') playSound('input')
                    } else if (event.type === 'agent_message') {
                        params.onAgentMessage(event.message_id as number)
                        playSound('input')
                    } else if (event.type === 'agent_created') {
                        agentCreatedFrom(event)
                    }
                },
                onOutput: bytes => {
                    const text = new TextDecoder().decode(bytes).replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
                    recentText = (recentText + text).slice(-800)

                    const lines = text
                        .replace(/[^\x20-\x7E\n\r]/g, '')
                        .split(/\r?\n/)
                        .map(line => line.trim())
                        .filter(line => line.length > 6 && !/^[$%>#❯]/.test(line))
                    if (lines.length) lastActivity[project.id] = lines[lines.length - 1]
                    outputChars[project.id] = (outputChars[project.id] ?? 0) + bytes.length

                    const now = Date.now()
                    if (now - lastInputSoundAt > 3000 && INPUT_PROMPT_PATTERNS.some(p => p.test(recentText))) {
                        lastInputSoundAt = now
                        playSound('input')
                    }
                },
            })

            session.term.attachCustomKeyEventHandler(e => {
                if (e.key === 'Enter' && e.ctrlKey && e.type === 'keydown') {
                    sendIfOpen(session.ws, '\n')
                    return false
                }
                return true
            })
            session.term.focus()
            sessions.set(project.id, session)
            syncLiveSessionCount()
        })
    }

    /** Register a project's PM holder element; launches its session once both exist. */
    function setContainer(projectId: number, el: HTMLElement | null) {
        containerRefs.set(projectId, el)
        if (el && projectId === activeProject.value?.id) launchPmSession()
    }

    function setAgentContainer(agentId: number, el: HTMLElement | null) {
        agentContainerRefs.set(agentId, el)
    }

    async function uploadImage(file: File) {
        const project = activeProject.value
        if (!project || !file.type.startsWith('image/')) return
        const formData = new FormData()
        formData.append('file', file)
        try {
            const res = await fetch(`/api/projects/${project.id}/upload-image`, { method: 'POST', body: formData })
            if (!res.ok) return
            const { path } = await res.json()
            const session = sessions.get(project.id)
            if (session) sendIfOpen(session.ws, path)
        } catch {
            // Upload failures leave the terminal untouched; the user can retry.
        }
    }

    function restartClaude() {
        const project = activeProject.value
        if (!project) return
        const session = sessions.get(project.id)
        if (!session || session.ws.readyState !== WebSocket.OPEN) return
        session.ws.send(new Uint8Array([0x03]))
        setTimeout(() => sendIfOpen(session.ws, 'claude --continue\n'), 800)
    }

    /** Close one agent's terminal; its container stays registered so it can be relaunched. */
    function disposeAgentSession(agentId: number) {
        const session = agentSessions.get(agentId)
        if (!session) return
        disposeSession(session)
        agentSessions.delete(agentId)
        syncLiveSessionCount()
    }

    function setClaudeStatus(projectId: number, status: ClaudeStatus) {
        claudeStatus[projectId] = status
    }

    function reportAllSizes() {
        sessions.forEach(reportSize)
        agentSessions.forEach(reportSize)
    }
    document.addEventListener('visibilitychange', reportAllSizes)

    watch(() => activeProject.value?.id, disposeAgentSessions)
    watch([() => activeProject.value?.id, pmAgentId], launchPmSession, { immediate: true, flush: 'post' })

    onScopeDispose(() => {
        document.removeEventListener('visibilitychange', reportAllSizes)
        sessions.forEach(disposeSession)
        sessions.clear()
        disposeAgentSessions()
    })

    return {
        sessions,
        agentSessions,
        containerRefs,
        agentContainerRefs,
        liveSessionCount,
        setContainer,
        setAgentContainer,
        launchAgentSession,
        disposeAgentSession,
        restartClaude,
        uploadImage,
        claudeStatus,
        setClaudeStatus,
        lastActivity,
        outputChars,
        sessionStart,
    }
}
