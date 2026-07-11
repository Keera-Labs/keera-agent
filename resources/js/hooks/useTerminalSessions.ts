import { useRef, useEffect, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { Project } from '@/types/type'
import type { ProjectAgent } from './agents'
import { normalizeAgent } from './agents'

export interface Session {
    term: Terminal
    ws: WebSocket
    fitAddon: FitAddon
    observer: ResizeObserver
}

// ─── Terminal factory ─────────────────────────────────────────────────────────
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

export function makeTerminal() {
    return new Terminal({
        theme: XTERM_THEME,
        fontFamily: '"Dank Mono", "Fira Code", "Cascadia Code", monospace',
        fontSize: 16, lineHeight: 1.4, cursorBlink: true, scrollback: 5000,
    })
}

export interface UseTerminalSessionsParams {
    activeProject: Project | null
    projectAgents: ProjectAgent[]
    onAgentCreated: (agent: ProjectAgent) => void
    onClaudeStopped: (projectId: number) => void
    onAgentMessage: (messageId: number) => void
    playSound: (type: 'done' | 'input') => void
}

export function useTerminalSessions({
    activeProject,
    projectAgents,
    onAgentCreated,
    onClaudeStopped,
    onAgentMessage,
    playSound,
}: UseTerminalSessionsParams) {
    const sessions = useRef<Map<number, Session>>(new Map())
    const containerRefs = useRef<Map<number, HTMLDivElement | null>>(new Map())
    const agentSessions = useRef<Map<number, Session>>(new Map())
    const agentContainerRefs = useRef<Map<number, HTMLDivElement | null>>(new Map())

    const [claudeStatus, setClaudeStatus] = useState<Record<number, 'running' | 'done'>>({})
    const [lastActivity, setLastActivity] = useState<Record<number, string>>({})
    const [sessionStart, setSessionStart] = useState<Record<number, Date>>({})
    const [outputChars, setOutputChars] = useState<Record<number, number>>({})

    // Launch a terminal session for a single agent
    function launchAgentSession(agentId: number, focus: boolean = true) {
        if (!activeProject) return
        const container = agentContainerRefs.current.get(agentId)
        if (!container) return

        if (agentSessions.current.has(agentId)) {
            if (focus) {
                const { fitAddon, term } = agentSessions.current.get(agentId)!
                requestAnimationFrame(() => { fitAddon.fit(); term.focus() })
            }
            return
        }

        requestAnimationFrame(() => {
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
            const ws = new WebSocket(
                `${protocol}//${location.host}/${activeProject.slug}/ws?agent_id=${agentId}`
            )
            ws.binaryType = 'arraybuffer'
            ws.onopen = () => ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
            ws.onmessage = e => {
                if (typeof e.data !== 'string') {
                    term.write(new Uint8Array(e.data as ArrayBuffer))
                } else {
                    try {
                        const event = JSON.parse(e.data)
                        if (event.type === 'agent_created') {
                            onAgentCreated(normalizeAgent(event.agent.data))
                        }
                    } catch { /* not JSON, ignore */ }
                }
            }
            ws.onclose = () => term.write('\r\n\x1b[31m[disconnected]\x1b[0m\r\n')
            term.onData(data => { if (ws.readyState === WebSocket.OPEN) ws.send(data) })
            term.onResize(({ cols, rows }) => {
                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows }))
            })
            container.addEventListener('click', () => term.focus())
            if (focus) term.focus()

            const observer = new ResizeObserver(() => fitAddon.fit())
            observer.observe(container)

            agentSessions.current.set(agentId, { term, ws, fitAddon, observer })
        })
    }

    // Reset agent sessions when switching projects
    useEffect(() => {
        agentSessions.current.forEach(({ term, ws, observer }) => {
            observer.disconnect(); term.dispose(); ws.close()
        })
        agentSessions.current.clear()
    }, [activeProject?.id])

    // Set up PM agent WebSocket on activeProject change
    useEffect(() => {
        if (!activeProject) return
        const pmAgent = projectAgents.find(a => a.agent_type === 'pm')
        if (!pmAgent) return
        const container = containerRefs.current.get(activeProject.id)
        if (!container) return

        if (sessions.current.has(activeProject.id)) {
            const { fitAddon, term } = sessions.current.get(activeProject.id)!
            requestAnimationFrame(() => { fitAddon.fit(); term.focus() })
            return
        }

        requestAnimationFrame(() => {
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
            const ws = new WebSocket(`${protocol}//${location.host}/${activeProject.slug}/ws?agent_id=${pmAgent.id}`)
            ws.binaryType = 'arraybuffer'
            ws.onopen = () => {
                ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
                setClaudeStatus(prev => ({ ...prev, [activeProject.id]: 'running' }))
                setSessionStart(prev => ({ ...prev, [activeProject.id]: new Date() }))
            }

            let termTextBuf = ''
            let lastInputSoundAt = 0

            ws.onmessage = e => {
                if (typeof e.data === 'string') {
                    try {
                        const msg = JSON.parse(e.data)
                        if (msg.type === 'claude_stopped') {
                            setClaudeStatus(prev => ({ ...prev, [activeProject.id]: 'done' }))
                            onClaudeStopped(activeProject.id)
                            playSound('done')
                        } else if (msg.type === 'agent_message') {
                            onAgentMessage(msg.message_id)
                            playSound('input')
                        } else if (msg.type === 'agent_created') {
                            onAgentCreated(normalizeAgent(msg.agent.data))
                        }
                    } catch { /* ignore */ }
                } else {
                    const bytes = new Uint8Array(e.data as ArrayBuffer)
                    term.write(bytes)

                    const text = new TextDecoder().decode(bytes).replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
                    termTextBuf = (termTextBuf + text).slice(-800)

                    const stripped = text.replace(/[^\x20-\x7E\n\r]/g, '')
                    const actLines = stripped.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 6 && !/^[$%>#❯]/.test(l))
                    if (actLines.length) setLastActivity(prev => ({ ...prev, [activeProject.id]: actLines[actLines.length - 1] }))
                    setOutputChars(prev => ({ ...prev, [activeProject.id]: (prev[activeProject.id] ?? 0) + bytes.length }))

                    const now = Date.now()
                    const inputPatterns = [
                        /\?\s*$/m,
                        /\[Y\/n\]/i,
                        /\[y\/N\]/i,
                        /Do you want to/i,
                        /Would you like/i,
                        /Press Enter to/i,
                        /Type your (message|response|reply)/i,
                    ]
                    if (now - lastInputSoundAt > 3000 && inputPatterns.some(p => p.test(termTextBuf))) {
                        lastInputSoundAt = now
                        playSound('input')
                    }
                }
            }
            ws.onclose = () => term.write('\r\n\x1b[31m[disconnected]\x1b[0m\r\n')

            term.attachCustomKeyEventHandler(e => {
                if (e.key === 'Enter' && e.ctrlKey && e.type === 'keydown') {
                    if (ws.readyState === WebSocket.OPEN) ws.send('\n')
                    return false
                }
                return true
            })
            term.onData(data => { if (ws.readyState === WebSocket.OPEN) ws.send(data) })
            term.onResize(({ cols, rows }) => {
                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows }))
            })

            container.addEventListener('click', () => term.focus())
            term.focus()

            const observer = new ResizeObserver(() => fitAddon.fit())
            observer.observe(container)

            sessions.current.set(activeProject.id, { term, ws, fitAddon, observer })
        })
    }, [activeProject, projectAgents])

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            sessions.current.forEach(({ term, ws, observer }) => {
                observer.disconnect()
                term.dispose()
                ws.close()
            })
            agentSessions.current.forEach(({ term, ws, observer }) => {
                observer.disconnect()
                term.dispose()
                ws.close()
            })
        }
    }, [])

    function uploadImage(file: File) {
        if (!activeProject) return
        if (!file.type.startsWith('image/')) return
        const formData = new FormData()
        formData.append('file', file)
        fetch(`/api/projects/${activeProject.id}/upload-image`, {
            method: 'POST',
            body: formData,
        }).then(async res => {
            if (!res.ok) return
            const { path } = await res.json()
            const session = sessions.current.get(activeProject.id)
            if (session && session.ws.readyState === WebSocket.OPEN) {
                session.ws.send(path)
            }
        }).catch(() => {})
    }

    function restartClaude() {
        if (!activeProject) return
        const session = sessions.current.get(activeProject.id)
        if (!session || session.ws.readyState !== WebSocket.OPEN) return
        session.ws.send(new Uint8Array([0x03]))
        setTimeout(() => {
            if (session.ws.readyState === WebSocket.OPEN) {
                session.ws.send('claude --continue\n')
            }
        }, 800)
    }

    return {
        sessions,
        agentSessions,
        containerRefs,
        agentContainerRefs,
        launchAgentSession,
        restartClaude,
        uploadImage,
        claudeStatus,
        setClaudeStatus,
        lastActivity,
        outputChars,
        sessionStart,
    }
}
