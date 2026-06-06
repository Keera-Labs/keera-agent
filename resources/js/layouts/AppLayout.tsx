import { useEffect, useRef, useState } from 'react'
import { router, usePage } from '@inertiajs/react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { color } from "@/tokens"
import type { Task, Workspace, Project } from "@/types/type"
import ProjectCreateModal from '@/components/project/ProjectCreateModal'
import ProjectPathEditModal from '@/components/project/ProjectPathEditModal'
import AddWorkspaceModal from '@/components/AddWorkspaceModal'
import Sidebar, { type ProjectView, PROJECT_NAV } from './sidebar/Sidebar'
import { DotsIndicator } from './sidebar/Project'
import { useWorkspace } from './hooks/workspace'
import { useTasks } from './hooks/tasks'
import { useAgents, type ProjectAgent, type AgentFlags } from './hooks/agents'
import AgentEditModal from '@/components/agent/AgentEditModal'
import { useProjects } from './hooks/projects'

// ─── Phase 1 extracted modules ────────────────────────────────────────────────
export { agentColor } from '@/utils/agentColor'
export { labelStyle, inputStyle, cancelBtnStyle, submitBtnStyle, flagRowStyle, toggleStyle } from '@/components/ui/styles'
export type { AgentTemplate } from '@/types/agent'
export { AGENT_TYPE_LABELS, AGENT_TYPE_COLORS, AGENT_TYPE_DEFAULTS } from '@/types/agent'
export { STATUS_CYCLE, STATUS_COLORS, STATUS_LABELS } from '@/types/task'
export { useAudio } from './hooks/useAudio'
export { useAgentTemplates } from './hooks/useAgentTemplates'
export { makeTerminal, useTerminalSessions } from './hooks/useTerminalSessions'
export type { Session } from './hooks/useTerminalSessions'
export { TagInput } from '@/components/ui/TagInput'
export { SystemPromptModal } from '@/components/modals/SystemPromptModal'
export { PermissionsEditor } from '@/components/modals/PermissionsEditor'
export { ProjectPermissionsModal } from '@/components/modals/ProjectPermissionsModal'
export { DefaultPermissionsModal } from '@/components/modals/DefaultPermissionsModal'
export { GlobalSettingsModal } from '@/components/modals/GlobalSettingsModal'
export { ProjectSearchModal } from '@/components/modals/ProjectSearchModal'
export { ConfirmDeleteProjectModal } from '@/components/modals/ConfirmDeleteProjectModal'
export { ConfirmDeleteWorkspaceModal } from '@/components/modals/ConfirmDeleteWorkspaceModal'
export { MoveProjectModal } from '@/components/modals/MoveProjectModal'
export { CreateTaskModal } from '@/components/modals/CreateTaskModal'
export { TaskDetailModal } from '@/components/modals/TaskDetailModal'
export { AddAgentModal } from '@/components/modals/AddAgentModal'

// ─── Local re-imports for use within this file ────────────────────────────────
import { agentColor } from '@/utils/agentColor'
import { labelStyle, inputStyle, cancelBtnStyle, submitBtnStyle, flagRowStyle, toggleStyle } from '@/components/ui/styles'
import type { AgentTemplate } from '@/types/agent'
import { AGENT_TYPE_LABELS, AGENT_TYPE_COLORS, AGENT_TYPE_DEFAULTS } from '@/types/agent'
import { STATUS_CYCLE, STATUS_COLORS, STATUS_LABELS } from '@/types/task'
import { TagInput } from '@/components/ui/TagInput'
import { SystemPromptModal } from '@/components/modals/SystemPromptModal'
import { PermissionsEditor } from '@/components/modals/PermissionsEditor'
import { ProjectPermissionsModal } from '@/components/modals/ProjectPermissionsModal'
import { DefaultPermissionsModal } from '@/components/modals/DefaultPermissionsModal'
import { GlobalSettingsModal } from '@/components/modals/GlobalSettingsModal'
import { ProjectSearchModal } from '@/components/modals/ProjectSearchModal'
import { ConfirmDeleteProjectModal } from '@/components/modals/ConfirmDeleteProjectModal'
import { ConfirmDeleteWorkspaceModal } from '@/components/modals/ConfirmDeleteWorkspaceModal'
import { MoveProjectModal } from '@/components/modals/MoveProjectModal'
import { CreateTaskModal } from '@/components/modals/CreateTaskModal'
import { TaskDetailModal } from '@/components/modals/TaskDetailModal'
import { AddAgentModal } from '@/components/modals/AddAgentModal'
import { makeTerminal } from './hooks/useTerminalSessions'


// ─── Local audio helper (used inline in this file) ────────────────────────────

let _audioCtx: AudioContext | null = null
function getAudioCtx(): AudioContext {
    if (!_audioCtx) _audioCtx = new AudioContext()
    return _audioCtx
}

function playSound(type: 'done' | 'input') {
    try {
        const ctx = getAudioCtx()
        const gain = ctx.createGain()
        gain.connect(ctx.destination)

        if (type === 'done') {
            const freqs = [880, 1100]
            freqs.forEach((freq, i) => {
                const osc = ctx.createOscillator()
                osc.type = 'sine'
                osc.frequency.value = freq
                const g = ctx.createGain()
                g.gain.setValueAtTime(0, ctx.currentTime + i * 0.12)
                g.gain.linearRampToValueAtTime(0.18, ctx.currentTime + i * 0.12 + 0.02)
                g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.28)
                osc.connect(g)
                g.connect(ctx.destination)
                osc.start(ctx.currentTime + i * 0.12)
                osc.stop(ctx.currentTime + i * 0.12 + 0.28)
            })
        } else {
            const freqs = [660, 660]
            freqs.forEach((freq, i) => {
                const osc = ctx.createOscillator()
                osc.type = 'sine'
                osc.frequency.value = freq
                const g = ctx.createGain()
                g.gain.setValueAtTime(0, ctx.currentTime + i * 0.18)
                g.gain.linearRampToValueAtTime(0.14, ctx.currentTime + i * 0.18 + 0.02)
                g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.18)
                osc.connect(g)
                g.connect(ctx.destination)
                osc.start(ctx.currentTime + i * 0.18)
                osc.stop(ctx.currentTime + i * 0.18 + 0.18)
            })
        }
    } catch { /* AudioContext not available */ }
}

// Session type is defined in useTerminalSessions.ts but we use it locally
interface Session {
    term: Terminal
    ws: WebSocket
    fitAddon: FitAddon
    observer: ResizeObserver
}

const LANG_COLORS: Record<string, string> = {
    Python:     color.langPython,
    TypeScript: color.langTypeScript,
    Go:         color.langGo,
    Rust:       color.langRust,
    JavaScript: color.langJavaScript,
}

const LANGUAGES = ['Python', 'TypeScript', 'JavaScript', 'Go', 'Rust', 'Other']
// ─── Project sidebar ─────────────────────────────────────────────────────────

function ProjectSidebar({ view, projectName, onChange, taskCount, newMessageCount }: {
    view: ProjectView
    projectName: string | null
    onChange: (v: ProjectView) => void
    taskCount: number
    newMessageCount: number
}) {
    return (
        <div style={{
            width: '200px', flexShrink: 0, background: color.bgCanvas,
            borderRight: `1px solid ${color.border}`, display: 'flex', flexDirection: 'column',
        }}>
            {/* Project name header */}
            {projectName && (
                <div style={{
                    padding: '10px 14px 9px',
                    borderBottom: `1px solid ${color.border}`,
                }}>
                    <span style={{ color: color.textPrimary, fontSize: '13px', fontWeight: 700, letterSpacing: '0.01em' }}>
                        {projectName}
                    </span>
                </div>
            )}

            {/* Nav items */}
            <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: '2px', paddingTop: projectName ? '8px' : '6px' }}>
                {PROJECT_NAV.map(item => {
                    const active = item.id === view
                    const count = item.id === 'tasks' ? taskCount : item.id === 'messages' ? newMessageCount : 0
                    return (
                        <button
                            key={item.id}
                            onClick={() => {
                                if (item.id === 'tasks' && projectName) {
                                    router.visit(`/${projectName}/tasks`)
                                } else {
                                    onChange(item.id)
                                }
                            }}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '8px',
                                padding: '7px 10px',
                                background: active ? color.accentSubtle : 'transparent',
                                border: `1px solid ${active ? color.accentEmphasis : 'transparent'}`,
                                borderRadius: '6px',
                                color: active ? color.accentMuted : color.textMuted,
                                fontSize: '12px', fontWeight: active ? 600 : 400,
                                cursor: 'pointer', textAlign: 'left', width: '100%',
                                transition: 'all 0.1s',
                            }}
                            onMouseEnter={e => { if (!active) { e.currentTarget.style.background = color.bgSurface; e.currentTarget.style.color = color.textSecondary } }}
                            onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = color.textMuted } }}
                        >
                            {item.icon}
                            <span style={{ flex: 1 }}>{item.label}</span>
                            {count > 0 && (
                                <span style={{
                                    fontSize: '10px', fontWeight: 600,
                                    padding: '1px 6px', borderRadius: '10px',
                                    background: color.bgBase,
                                    color: color.textFaint,
                                    border: `1px solid ${color.border}`,
                                    lineHeight: '16px',
                                }}>
                                    {count}
                                </span>
                            )}
                        </button>
                    )
                })}
            </div>
        </div>
    )
}

// ─── Commands view ────────────────────────────────────────────────────────────

interface Command {
    id: number
    project_id: number
    label: string
    command: string
    description: string
    category: string
    shortcut: string
    status: 'running' | 'stopped'
    pid: number | null
}

interface RunRecord {
    exit_code: number
    duration_ms: number
    created_at: string
}

function fmtDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
}

function timeAgo(isoStr: string): string {
    const diff = Date.now() - new Date(isoStr).getTime()
    const secs = Math.floor(diff / 1000)
    if (secs < 60) return `${secs}s ago`
    const mins = Math.floor(secs / 60)
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    if (hrs < 48) return 'yesterday'
    return `${Math.floor(hrs / 24)}d ago`
}

function getCmdIcon(label: string): React.ReactNode {
    const l = label.toLowerCase()
    if (l.includes('build') || l.includes('compile')) return (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M9.504.43a1.516 1.516 0 012.437 1.713L10.415 5.5h2.123c1.57 0 2.454 1.833 1.447 3.04L6.04 15.96a1.516 1.516 0 01-2.437-1.713l1.526-3.356H3.006c-1.57 0-2.454-1.833-1.447-3.04L9.504.43z"/>
        </svg>
    )
    if (l.includes('test') || l.includes('spec') || l.includes('check')) return (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.751.751 0 011.042-1.08l.018.018 2.72 2.72 6.72-6.72a.75.75 0 011.06 0z"/>
        </svg>
    )
    if (l.includes('deploy') || l.includes('ship') || l.includes('release') || l.includes('publish')) return (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M7.47 1.97a.75.75 0 011.06 0l3.75 3.75a.75.75 0 01-1.06 1.06L8.75 4.31v7.94a.75.75 0 01-1.5 0V4.31L4.78 6.78a.75.75 0 01-1.06-1.06l3.75-3.75zM3.75 13a.75.75 0 000 1.5h8.5a.75.75 0 000-1.5h-8.5z"/>
        </svg>
    )
    if (l.includes('lint')) return (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M0 1.75A.75.75 0 01.75 1h4.253c1.227 0 2.317.59 3 1.501A3.744 3.744 0 0111.006 1h3.245a.75.75 0 010 1.5H11.006a2.25 2.25 0 00-2.25 2.25v8.5a.75.75 0 01-1.5 0v-8.5a2.25 2.25 0 00-2.25-2.25H.75A.75.75 0 010 1.75z"/>
        </svg>
    )
    if (l.includes('format') || l.includes('fmt') || l.includes('prettier')) return (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1.5 2.75a.75.75 0 01.75-.75h11.5a.75.75 0 010 1.5H2.25a.75.75 0 01-.75-.75zM1.5 8a.75.75 0 01.75-.75h7.5a.75.75 0 010 1.5h-7.5A.75.75 0 011.5 8zm0 5.25a.75.75 0 01.75-.75h5.5a.75.75 0 010 1.5h-5.5a.75.75 0 01-.75-.75z"/>
        </svg>
    )
    if (l.includes('review') || l.includes('pr') || l.includes('diff')) return (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1.5 2.75a.25.25 0 01.25-.25h8.5a.25.25 0 01.25.25v5.5a.25.25 0 01-.25.25h-3.5a.75.75 0 00-.53.22L3.5 11.44V9.25a.75.75 0 00-.75-.75h-1a.25.25 0 01-.25-.25v-5.5zM1.75 1A1.75 1.75 0 000 2.75v5.5C0 9.216.784 10 1.75 10H2v1.543a1.457 1.457 0 002.487 1.03L7.061 10h3.189A1.75 1.75 0 0012 8.25v-5.5A1.75 1.75 0 0010.25 1h-8.5z"/>
        </svg>
    )
    if (l.includes('db') || l.includes('database') || l.includes('migrate') || l.includes('sql')) return (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1 3.5C1 2.119 3.582 1 7 1s6 1.119 6 2.5v2c0 1.381-2.582 2.5-6 2.5S1 6.881 1 5.5v-2zm6 9C3.582 12.5 1 11.381 1 10V8.5c0-.304.082-.598.27-.867.502.677 1.508 1.247 2.812 1.598C4.74 9.485 5.838 9.6 7 9.6s2.26-.115 3.918-.369c1.304-.351 2.31-.921 2.812-1.598.188.269.27.563.27.867v1.5c0 1.381-2.582 2.5-6 2.5zm0 3c-3.418 0-6-1.119-6-2.5V11.5c0-.304.082-.598.27-.867.502.677 1.508 1.247 2.812 1.598C4.74 12.485 5.838 12.6 7 12.6s2.26-.115 3.918-.369c1.304-.351 2.31-.921 2.812-1.598.188.269.27.563.27.867V13c0 1.381-2.582 2.5-6 2.5z"/>
        </svg>
    )
    if (l.includes('log') || l.includes('tail') || l.includes('monitor') || l.includes('watch')) return (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1.75 2.5a.25.25 0 000 .5h12.5a.25.25 0 000-.5H1.75zM1.5 6a.75.75 0 01.75-.75h12.5a.75.75 0 010 1.5H2.25A.75.75 0 011.5 6zm.75 3.25a.25.25 0 000 .5h12.5a.25.25 0 000-.5H2.25z"/>
        </svg>
    )
    if (l.includes('dev') || l.includes('start') || l.includes('serve')) return (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0a8 8 0 100 16A8 8 0 008 0zM1.5 8a6.5 6.5 0 1113 0 6.5 6.5 0 01-13 0zm4.879-2.773l4.264 2.559a.25.25 0 010 .428l-4.264 2.559A.25.25 0 016 10.559V5.442a.25.25 0 01.379-.215z"/>
        </svg>
    )
    return (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0114.25 15H1.75A1.75 1.75 0 010 13.25V2.75zm1.75-.25a.25.25 0 00-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25V2.75a.25.25 0 00-.25-.25H1.75zM3.5 6.25a.75.75 0 000 1.5h.268l-.01.034L2.76 10.5a.75.75 0 001.44.42l.04-.138H6.76l.04.138a.75.75 0 001.44-.42L7.242 7.784l-.01-.034H7.5a.75.75 0 000-1.5h-4z"/>
        </svg>
    )
}

const cmdPulseStyle = `@keyframes cmd-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`

function CommandsView({ project, projectId }: { project: Project; projectId: number }) {
    const [commands, setCommands] = useState<Command[]>([])
    const [showForm, setShowForm] = useState(false)
    const [label, setLabel] = useState('')
    const [cmd, setCmd] = useState('')
    const [formError, setFormError] = useState('')
    const [formLoading, setFormLoading] = useState(false)
    const [outputCmd, setOutputCmd] = useState<Command | null>(null)
    const [editingCmd, setEditingCmd] = useState<Command | null>(null)
    const [editLabel, setEditLabel] = useState('')
    const [editCmdStr, setEditCmdStr] = useState('')
    const [editLoading, setEditLoading] = useState(false)
    const cmdSessions = useRef<Map<number, Session>>(new Map())
    const cmdContainerRefs = useRef<Map<number, HTMLDivElement | null>>(new Map())

    useEffect(() => {
        fetch(`/api/projects/${projectId}/commands`)
            .then(r => r.json())
            .then(setCommands)
            .catch(() => {})
    }, [projectId])

    useEffect(() => {
        return () => {
            cmdSessions.current.forEach(({ term, ws, observer }) => {
                observer.disconnect()
                term.dispose()
                ws.close()
            })
        }
    }, [])

    async function handleCreate(e: React.FormEvent) {
        e.preventDefault()
        setFormError('')
        setFormLoading(true)
        try {
            const res = await fetch(`/api/projects/${projectId}/commands`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label: label.trim(), command: cmd.trim() }),
            })
            const data = await res.json()
            if (!res.ok) { setFormError(data.error ?? 'Failed'); return }
            setCommands(prev => [...prev, data as Command])
            setLabel(''); setCmd(''); setShowForm(false)
        } catch { setFormError('Network error') }
        finally { setFormLoading(false) }
    }

    function handleRun(c: Command) {
        setOutputCmd(c)

        requestAnimationFrame(() => {
            const container = cmdContainerRefs.current.get(c.id)
            if (!container) return

            // If session exists, re-attach to container if needed (panel may have been remounted)
            if (cmdSessions.current.has(c.id)) {
                const sess = cmdSessions.current.get(c.id)!
                if (!container.querySelector('.xterm')) {
                    sess.term.open(container)
                    sess.fitAddon.fit()
                    sess.observer.disconnect()
                    sess.observer.observe(container)
                } else {
                    sess.fitAddon.fit()
                }
                sess.term.focus()
                return
            }

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
                `${protocol}//${location.host}/${project.slug}/command-ws/${c.id}`
            )
            ws.binaryType = 'arraybuffer'
            ws.onopen = () => {
                ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
                setCommands(prev => prev.map(x => x.id === c.id ? { ...x, status: 'running' } : x))
            }
            ws.onmessage = e => {
                if (typeof e.data !== 'string') {
                    term.write(new Uint8Array(e.data as ArrayBuffer))
                    console.log("hello i got message ")
                }
            }
            ws.onclose = () => {
                term.write('\r\n\x1b[31m[exited]\x1b[0m\r\n')
                setCommands(prev => prev.map(x => x.id === c.id ? { ...x, status: 'stopped', pid: null } : x))
                setOutputCmd(prev => prev?.id === c.id ? { ...prev, status: 'stopped', pid: null } : prev)
            }
            term.onData(data => { if (ws.readyState === WebSocket.OPEN) ws.send(data) })
            term.onResize(({ cols, rows }) => {
                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows }))
            })
            container.addEventListener('click', () => term.focus())
            term.focus()

            const observer = new ResizeObserver(() => fitAddon.fit())
            observer.observe(container)

            cmdSessions.current.set(c.id, { term, ws, fitAddon, observer })
        })
    }

    async function handleStop(c: Command) {
        const sess = cmdSessions.current.get(c.id)
        if (sess) sess.ws.close()
        // REST stop also signals the DB in case WS was never opened
        await fetch(`/api/commands/${c.id}/stop`, { method: 'POST' })
        setCommands(prev => prev.map(x => x.id === c.id ? { ...x, status: 'stopped', pid: null } : x))
        if (outputCmd?.id === c.id) setOutputCmd(prev => prev ? { ...prev, status: 'stopped', pid: null } : prev)
    }

    async function handleDelete(c: Command) {
        const sess = cmdSessions.current.get(c.id)
        if (sess) {
            sess.observer.disconnect()
            sess.ws.close()
            sess.term.dispose()
            cmdSessions.current.delete(c.id)
        }
        await fetch(`/api/commands/${c.id}`, { method: 'DELETE' })
        setCommands(prev => prev.filter(x => x.id !== c.id))
        if (outputCmd?.id === c.id) setOutputCmd(null)
    }

    async function handleUpdate(e: React.FormEvent) {
        e.preventDefault()
        if (!editingCmd) return
        setEditLoading(true)
        try {
            const res = await fetch(`/api/commands/${editingCmd.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label: editLabel.trim(), command: editCmdStr.trim() }),
            })
            const data = await res.json()
            if (!res.ok) return
            setCommands(prev => prev.map(x => x.id === editingCmd.id ? { ...x, ...data } : x))
            if (outputCmd?.id === editingCmd.id) setOutputCmd(prev => prev ? { ...prev, ...data } : prev)
            setEditingCmd(null)
        } finally {
            setEditLoading(false)
        }
    }

    const hasOutput = outputCmd !== null

    return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <style>{cmdPulseStyle}</style>

            {/* ── Header ── */}
            <div style={{
                padding: '10px 20px', borderBottom: `1px solid ${color.border}`,
                display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0,
                background: color.bgCanvas,
            }}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill={color.textMuted}>
                    <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0114.25 15H1.75A1.75 1.75 0 010 13.25V2.75zm1.75-.25a.25.25 0 00-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25V2.75a.25.25 0 00-.25-.25H1.75zM3.5 6.25a.75.75 0 000 1.5h.268l-.01.034L2.76 10.5a.75.75 0 001.44.42l.04-.138H6.76l.04.138a.75.75 0 001.44-.42L7.242 7.784l-.01-.034H7.5a.75.75 0 000-1.5h-4zm.751 1.5H6.25l-.609 2.099H4.86L4.251 7.75zm5.5-1.5a.75.75 0 000 1.5h3.5a.75.75 0 000-1.5h-3.5zm0 3a.75.75 0 000 1.5h3.5a.75.75 0 000-1.5h-3.5z"/>
                </svg>
                <span style={{ color: color.textPrimary, fontSize: '13px', fontWeight: 600, flex: 1 }}>Commands</span>
                {commands.filter(c => c.status === 'running').length > 0 && (
                    <span style={{
                        fontSize: '10px', padding: '1px 7px', borderRadius: '10px',
                        background: 'rgba(63,185,80,0.1)', border: '1px solid rgba(63,185,80,0.3)',
                        color: color.success,
                    }}>
                        {commands.filter(c => c.status === 'running').length} running
                    </span>
                )}
                <button
                    onClick={() => { setShowForm(s => !s); setFormError('') }}
                    style={{
                        background: showForm ? color.bgSurface : color.successEmphasis,
                        border: `1px solid ${showForm ? color.borderMuted : color.successBorder}`,
                        borderRadius: '5px',
                        color: showForm ? color.textMuted : '#fff',
                        fontSize: '11px', padding: '4px 10px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '5px',
                    }}
                >
                    {showForm ? (
                        '× Cancel'
                    ) : (
                        <>
                            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                                <path d="M7.75 2a.75.75 0 01.75.75V7h4.25a.75.75 0 010 1.5H8.5v4.25a.75.75 0 01-1.5 0V8.5H2.75a.75.75 0 010-1.5H7V2.75A.75.75 0 017.75 2z"/>
                            </svg>
                            New command
                        </>
                    )}
                </button>
            </div>

            {/* ── Add form ── */}
            {showForm && (
                <div style={{
                    padding: '14px 20px', borderBottom: `1px solid ${color.border}`,
                    background: color.bgSurface, flexShrink: 0,
                }}>
                    <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '0 0 180px' }}>
                                <span style={labelStyle}>Label</span>
                                <input
                                    autoFocus
                                    value={label}
                                    onChange={e => setLabel(e.target.value)}
                                    placeholder="Dev Server"
                                    required
                                    style={{ ...inputStyle, boxSizing: 'border-box', width: '100%' }}
                                />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                                <span style={labelStyle}>Shell command</span>
                                <input
                                    value={cmd}
                                    onChange={e => setCmd(e.target.value)}
                                    placeholder="npm run dev"
                                    required
                                    style={{
                                        ...inputStyle, boxSizing: 'border-box', width: '100%',
                                        fontFamily: '"JetBrains Mono", monospace',
                                    }}
                                />
                            </div>
                        </div>
                        {formError && <span style={{ color: color.danger, fontSize: '12px' }}>{formError}</span>}
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                            <button type="button" onClick={() => setShowForm(false)} style={cancelBtnStyle}>Cancel</button>
                            <button type="submit" disabled={formLoading} style={submitBtnStyle}>
                                {formLoading ? 'Adding…' : 'Add command'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* ── Body ── */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

                {/* Command list */}
                <div style={{
                    width: hasOutput ? '260px' : '100%',
                    flexShrink: 0,
                    overflowY: 'auto',
                    borderRight: hasOutput ? `1px solid ${color.border}` : 'none',
                    display: 'flex', flexDirection: 'column',
                }}>
                    {commands.length === 0 ? (
                        <div style={{
                            flex: 1, display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center', gap: '12px',
                            padding: '40px 24px', textAlign: 'center',
                        }}>
                            <div style={{
                                width: '48px', height: '48px', borderRadius: '50%',
                                background: color.bgSurface, border: `1px solid ${color.borderMuted}`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <svg width="22" height="22" viewBox="0 0 16 16" fill={color.textFaint}>
                                    <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0114.25 15H1.75A1.75 1.75 0 010 13.25V2.75zm1.75-.25a.25.25 0 00-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25V2.75a.25.25 0 00-.25-.25H1.75zM3.5 6.25a.75.75 0 000 1.5h.268l-.01.034L2.76 10.5a.75.75 0 001.44.42l.04-.138H6.76l.04.138a.75.75 0 001.44-.42L7.242 7.784l-.01-.034H7.5a.75.75 0 000-1.5h-4zm.751 1.5H6.25l-.609 2.099H4.86L4.251 7.75zm5.5-1.5a.75.75 0 000 1.5h3.5a.75.75 0 000-1.5h-3.5zm0 3a.75.75 0 000 1.5h3.5a.75.75 0 000-1.5h-3.5z"/>
                                </svg>
                            </div>
                            <div>
                                <p style={{ margin: '0 0 4px', color: color.textSecondary, fontSize: '13px', fontWeight: 500 }}>
                                    No commands yet
                                </p>
                                <p style={{ margin: 0, color: color.textFaint, fontSize: '12px', lineHeight: 1.5 }}>
                                    Add build scripts, dev servers,<br/>or any long-running process.
                                </p>
                            </div>
                            <button
                                onClick={() => setShowForm(true)}
                                style={{
                                    background: 'transparent', border: `1px dashed ${color.borderMuted}`,
                                    borderRadius: '6px', color: color.textMuted, fontSize: '12px',
                                    padding: '6px 14px', cursor: 'pointer',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.borderColor = color.accent; e.currentTarget.style.color = color.accent }}
                                onMouseLeave={e => { e.currentTarget.style.borderColor = color.borderMuted; e.currentTarget.style.color = color.textMuted }}
                            >
                                + Add your first command
                            </button>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            {commands.map(c => {
                                const isSelected = outputCmd?.id === c.id
                                const isRunning = c.status === 'running'
                                const isEditing = editingCmd?.id === c.id
                                if (isEditing) {
                                    return (
                                        <form
                                            key={c.id}
                                            onSubmit={handleUpdate}
                                            style={{
                                                display: 'flex', flexDirection: 'column', gap: '8px',
                                                padding: '10px 14px',
                                                background: color.bgSurface,
                                                borderLeft: `2px solid ${color.accent}`,
                                                borderBottom: `1px solid ${color.border}`,
                                            }}
                                        >
                                            <input
                                                autoFocus
                                                value={editLabel}
                                                onChange={e => setEditLabel(e.target.value)}
                                                placeholder="Label"
                                                required
                                                style={{ ...inputStyle, boxSizing: 'border-box', width: '100%' }}
                                            />
                                            <input
                                                value={editCmdStr}
                                                onChange={e => setEditCmdStr(e.target.value)}
                                                placeholder="Shell command"
                                                required
                                                style={{
                                                    ...inputStyle, boxSizing: 'border-box', width: '100%',
                                                    fontFamily: '"JetBrains Mono", monospace',
                                                }}
                                            />
                                            <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                                                <button
                                                    type="button"
                                                    onClick={() => setEditingCmd(null)}
                                                    style={cancelBtnStyle}
                                                >Cancel</button>
                                                <button
                                                    type="submit"
                                                    disabled={editLoading}
                                                    style={submitBtnStyle}
                                                >{editLoading ? 'Saving…' : 'Save'}</button>
                                            </div>
                                        </form>
                                    )
                                }
                                return (
                                    <div
                                        key={c.id}
                                        onClick={() => {
                                            setOutputCmd(c)
                                            if (cmdSessions.current.has(c.id)) {
                                                const sess = cmdSessions.current.get(c.id)!
                                                requestAnimationFrame(() => { sess.fitAddon.fit(); sess.term.focus() })
                                            }
                                        }}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '10px',
                                            padding: '10px 14px', cursor: 'pointer',
                                            background: isSelected ? color.bgSurface : 'transparent',
                                            borderLeft: `2px solid ${isSelected ? color.accent : 'transparent'}`,
                                            borderBottom: `1px solid ${color.border}`,
                                            transition: 'background 0.1s',
                                        }}
                                        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = color.bgSurface }}
                                        onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
                                    >
                                        {/* Play/Stop circle */}
                                        <button
                                            onClick={e => { e.stopPropagation(); isRunning ? handleStop(c) : handleRun(c) }}
                                            title={isRunning ? 'Stop' : 'Run'}
                                            style={{
                                                width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0,
                                                background: isRunning ? 'rgba(63,185,80,0.1)' : color.bgBase,
                                                border: `1px solid ${isRunning ? 'rgba(63,185,80,0.4)' : color.borderMuted}`,
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                cursor: 'pointer', color: isRunning ? color.success : color.textMuted,
                                                transition: 'all 0.15s',
                                            }}
                                            onMouseEnter={e => {
                                                e.currentTarget.style.borderColor = isRunning ? color.danger : color.success
                                                e.currentTarget.style.color = isRunning ? color.danger : color.success
                                                e.currentTarget.style.background = isRunning ? color.dangerCanvas : 'rgba(63,185,80,0.1)'
                                            }}
                                            onMouseLeave={e => {
                                                e.currentTarget.style.borderColor = isRunning ? 'rgba(63,185,80,0.4)' : color.borderMuted
                                                e.currentTarget.style.color = isRunning ? color.success : color.textMuted
                                                e.currentTarget.style.background = isRunning ? 'rgba(63,185,80,0.1)' : color.bgBase
                                            }}
                                        >
                                            {isRunning ? (
                                                <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor">
                                                    <rect x="1.5" y="1.5" width="7" height="7" rx="1"/>
                                                </svg>
                                            ) : (
                                                <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor">
                                                    <path d="M2 1.5l7 3.5-7 3.5V1.5z"/>
                                                </svg>
                                            )}
                                        </button>

                                        {/* Label and command */}
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{
                                                fontSize: '12px', fontWeight: 600, color: color.textPrimary,
                                                fontFamily: '"JetBrains Mono", monospace',
                                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                            }}>
                                                /{c.label}
                                            </div>
                                            <div style={{
                                                fontSize: '10px', color: color.textFaint,
                                                fontFamily: '"JetBrains Mono", monospace',
                                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                marginTop: '2px',
                                            }}>
                                                {c.command}
                                            </div>
                                        </div>

                                        {/* Running pill */}
                                        {isRunning && (
                                            <span style={{
                                                fontSize: '10px', padding: '1px 6px', borderRadius: '8px',
                                                background: 'rgba(63,185,80,0.08)', border: '1px solid rgba(63,185,80,0.25)',
                                                color: color.success, fontFamily: '"JetBrains Mono", monospace', flexShrink: 0,
                                                animation: 'cmd-pulse 2s infinite',
                                            }}>
                                                {c.pid ? `pid ${c.pid}` : 'running'}
                                            </span>
                                        )}

                                        {/* Edit */}
                                        <button
                                            onClick={e => { e.stopPropagation(); setEditingCmd(c); setEditLabel(c.label); setEditCmdStr(c.command) }}
                                            title="Edit"
                                            style={{
                                                flexShrink: 0, background: 'transparent', border: 'none',
                                                color: color.textFaint, cursor: 'pointer',
                                                padding: '3px 4px', borderRadius: '4px', display: 'flex', alignItems: 'center',
                                            }}
                                            onMouseEnter={e => { e.currentTarget.style.color = color.accent; e.currentTarget.style.background = color.bgBase }}
                                            onMouseLeave={e => { e.currentTarget.style.color = color.textFaint; e.currentTarget.style.background = 'transparent' }}
                                        >
                                            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                                                <path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 01-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61zm1.414 1.06a.25.25 0 00-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 000-.354l-1.086-1.086zM11.189 6.25L9.75 4.81l-6.286 6.287a.25.25 0 00-.064.108l-.558 1.953 1.953-.558a.249.249 0 00.108-.064l6.286-6.286z"/>
                                            </svg>
                                        </button>

                                        {/* Delete */}
                                        <button
                                            onClick={e => { e.stopPropagation(); handleDelete(c) }}
                                            title="Delete"
                                            style={{
                                                flexShrink: 0, background: 'transparent', border: 'none',
                                                color: color.textFaint, cursor: 'pointer',
                                                padding: '3px 4px', fontSize: '14px', lineHeight: 1, borderRadius: '4px',
                                            }}
                                            onMouseEnter={e => { e.currentTarget.style.color = color.danger; e.currentTarget.style.background = color.dangerCanvas }}
                                            onMouseLeave={e => { e.currentTarget.style.color = color.textFaint; e.currentTarget.style.background = 'transparent' }}
                                        >×</button>
                                    </div>
                                )
                            })}
                            {/* Add command footer row */}
                            <button
                                onClick={() => setShowForm(true)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '6px',
                                    padding: '9px 14px',
                                    background: 'transparent', border: 'none',
                                    color: color.textFaint, fontSize: '11px', cursor: 'pointer',
                                    width: '100%', textAlign: 'left',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.color = color.textMuted; e.currentTarget.style.background = color.bgSurface }}
                                onMouseLeave={e => { e.currentTarget.style.color = color.textFaint; e.currentTarget.style.background = 'transparent' }}
                            >
                                <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                                    <path d="M7.75 2a.75.75 0 01.75.75V7h4.25a.75.75 0 010 1.5H8.5v4.25a.75.75 0 01-1.5 0V8.5H2.75a.75.75 0 010-1.5H7V2.75A.75.75 0 017.75 2z"/>
                                </svg>
                                Add command
                            </button>
                        </div>
                    )}
                </div>

                {/* ── Output panel ── */}
                {hasOutput && (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                        {/* Command detail header */}
                        <div style={{
                            padding: '16px 20px 14px',
                            borderBottom: `1px solid ${color.border}`,
                            flexShrink: 0,
                            background: color.bgCanvas,
                        }}>
                            {/* Title row */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                                <h2 style={{
                                    margin: 0, color: color.textPrimary, fontSize: '18px', fontWeight: 700,
                                    fontFamily: '"JetBrains Mono", monospace', letterSpacing: '-0.01em',
                                }}>
                                    /{outputCmd.label}
                                </h2>
                                {outputCmd.status === 'running' && <DotsIndicator />}
                                {outputCmd.status === 'stopped' && (
                                    <span style={{ fontSize: '10px', color: color.textFaint, fontFamily: '"JetBrains Mono", monospace' }}>
                                        exited
                                    </span>
                                )}
                                <div style={{ flex: 1 }} />
                                <button
                                    onClick={() => setOutputCmd(null)}
                                    style={{
                                        background: 'transparent', border: 'none',
                                        color: color.textFaint, fontSize: '18px', cursor: 'pointer',
                                        padding: '0 2px', lineHeight: 1, borderRadius: '4px',
                                    }}
                                    onMouseEnter={e => (e.currentTarget.style.color = color.textSecondary)}
                                    onMouseLeave={e => (e.currentTarget.style.color = color.textFaint)}
                                >×</button>
                            </div>
                            {/* SHELL section */}
                            <div>
                                <div style={{
                                    color: color.textFaint, fontSize: '10px', fontWeight: 700,
                                    textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px',
                                }}>Shell</div>
                                <div style={{
                                    background: color.bgCanvas, borderRadius: '6px', padding: '8px 12px',
                                    border: `1px solid ${color.border}`,
                                    fontFamily: '"JetBrains Mono", monospace', fontSize: '12px',
                                    color: color.textSecondary,
                                    display: 'flex', alignItems: 'center', gap: '8px',
                                    overflow: 'hidden',
                                }}>
                                    <span style={{ color: color.success, flexShrink: 0 }}>$</span>
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {outputCmd.command}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* xterm containers — one per command */}
                        <div style={{ flex: 1, position: 'relative', background: '#0d1117', overflow: 'hidden' }}>
                            {commands.map(c => (
                                <div
                                    key={c.id}
                                    ref={el => { cmdContainerRefs.current.set(c.id, el) }}
                                    style={{
                                        position: 'absolute', inset: 0, padding: '8px', boxSizing: 'border-box',
                                        display: c.id === outputCmd?.id ? 'block' : 'none',
                                    }}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

// ─── Task helper components ───────────────────────────────────────────────────

const PRIORITY_STYLES: Record<string, { bg: string; color: string; border: string }> = {
    low:    { bg: color.bgSurface, color: color.textMuted, border: color.borderMuted },
    medium: { bg: color.priorityMediumBg, color: color.warning, border: color.warningSubtle },
    high:   { bg: color.dangerCanvas, color: color.danger, border: color.dangerSubtle },
}

function PriorityBadge({ priority }: { priority: string }) {
    const s = PRIORITY_STYLES[priority] ?? PRIORITY_STYLES.medium
    return (
        <span style={{
            fontSize: '10px', fontWeight: 600, letterSpacing: '0.04em',
            padding: '1px 6px', borderRadius: '10px',
            background: s.bg, border: `1px solid ${s.border}`, color: s.color,
            textTransform: 'uppercase', flexShrink: 0,
        }}>
            {priority}
        </span>
    )
}

function PlanningSection({ label, items, color: dotColor }: { label: string; items: string[]; color: string }) {
    const [open, setOpen] = useState(false)
    return (
        <div style={{ marginTop: '2px' }}>
            <button
                onClick={() => setOpen(o => !o)}
                style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    padding: 0, display: 'flex', alignItems: 'center', gap: '4px',
                }}
            >
                <svg
                    width="8" height="8" viewBox="0 0 16 16" fill={dotColor}
                    style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}
                >
                    <path d="M4.427 7.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 7H4.604a.25.25 0 00-.177.427z"/>
                </svg>
                <span style={{ fontSize: '10px', color: dotColor, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {label} ({items.length})
                </span>
            </button>
            {open && (
                <ul style={{ margin: '4px 0 0 12px', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {items.map((item, i) => (
                        <li key={i} style={{ fontSize: '11px', color: color.textMuted, lineHeight: 1.5 }}>
                            <span style={{ color: dotColor, marginRight: '4px' }}>•</span>{item}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

// ─── Tasks view (Kanban board) ────────────────────────────────────────────────

function TasksView({
    tasks,
    onOpenCreateTask,
    onUpdateStatus,
    onDeleteTask,
    onOpenTask,
}: {
    tasks: Task[]
    onOpenCreateTask: () => void
    onUpdateStatus: (task: Task, status: Task['status']) => void
    onDeleteTask: (task: Task) => void
    onOpenTask: (task: Task) => void
}) {
    const [dragTaskId, setDragTaskId] = useState<number | null>(null)
    const [dragOverStatus, setDragOverStatus] = useState<Task['status'] | null>(null)

    return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{
                padding: '12px 20px', borderBottom: `1px solid ${color.border}`,
                display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0,
            }}>
                <span style={{ color: color.textPrimary, fontSize: '13px', fontWeight: 600, flex: 1 }}>Tasks</span>
                <button
                    onClick={onOpenCreateTask}
                    style={{
                        background: color.successEmphasis, border: `1px solid ${color.successBorder}`, borderRadius: '5px',
                        color: '#fff', fontSize: '11px', padding: '4px 10px', cursor: 'pointer',
                    }}
                >
                    + New task
                </button>
            </div>

            {/* Kanban board */}
            <div style={{
                flex: 1, display: 'flex', flexDirection: 'row', gap: '12px',
                padding: '16px', overflowX: 'auto', overflowY: 'hidden', alignItems: 'flex-start',
            }}>
                {STATUS_CYCLE.map(status => {
                    const col = tasks.filter(t => t.status === status)
                    const isOver = dragOverStatus === status
                    return (
                        <div
                            key={status}
                            onDragOver={e => { e.preventDefault(); setDragOverStatus(status) }}
                            onDragLeave={e => {
                                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverStatus(null)
                            }}
                            onDrop={e => {
                                e.preventDefault()
                                setDragOverStatus(null)
                                if (dragTaskId !== null) {
                                    const task = tasks.find(t => t.id === dragTaskId)
                                    if (task && task.status !== status) onUpdateStatus(task, status)
                                }
                                setDragTaskId(null)
                            }}
                            style={{
                                width: '240px', flexShrink: 0, display: 'flex', flexDirection: 'column',
                                background: isOver ? color.bgSurface : color.bgCanvas,
                                border: `1px solid ${isOver ? color.borderMuted : color.border}`,
                                borderRadius: '8px', transition: 'background 0.1s, border-color 0.1s',
                                maxHeight: '100%',
                            }}
                        >
                            {/* Column header */}
                            <div style={{
                                padding: '10px 12px 8px', display: 'flex', alignItems: 'center',
                                gap: '7px', borderBottom: `1px solid ${color.border}`, flexShrink: 0,
                            }}>
                                <span style={{
                                    width: '8px', height: '8px', borderRadius: '50%',
                                    background: STATUS_COLORS[status], flexShrink: 0, display: 'inline-block',
                                }} />
                                <span style={{
                                    fontSize: '11px', fontWeight: 600, color: color.textMuted,
                                    textTransform: 'uppercase', letterSpacing: '0.06em', flex: 1,
                                }}>
                                    {STATUS_LABELS[status]}
                                </span>
                                <span style={{
                                    fontSize: '10px', color: color.textFaint,
                                    background: color.bgBase, borderRadius: '10px',
                                    padding: '1px 6px', border: `1px solid ${color.border}`,
                                }}>
                                    {col.length}
                                </span>
                            </div>

                            {/* Cards */}
                            <div style={{ flex: 1, overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {col.length === 0 && (
                                    <div style={{
                                        border: `1px dashed ${isOver ? color.borderMuted : color.border}`,
                                        borderRadius: '6px', padding: '20px 10px',
                                        textAlign: 'center', color: color.textFaint,
                                        fontSize: '11px', fontStyle: 'italic',
                                        transition: 'border-color 0.1s',
                                    }}>
                                        {isOver ? 'Drop here' : 'No tasks'}
                                    </div>
                                )}
                                {col.map(task => (
                                    <div
                                        key={task.id}
                                        draggable
                                        onDragStart={() => setDragTaskId(task.id)}
                                        onDragEnd={() => { setDragTaskId(null); setDragOverStatus(null) }}
                                        onClick={() => { if (dragTaskId === null) onOpenTask(task) }}
                                        style={{
                                            background: color.bgBase,
                                            border: `1px solid ${color.borderMuted}`,
                                            borderRadius: '6px', padding: '10px 10px 8px',
                                            cursor: 'pointer', opacity: dragTaskId === task.id ? 0.35 : 1,
                                            transition: 'opacity 0.1s', display: 'flex',
                                            flexDirection: 'column', gap: '6px',
                                            position: 'relative',
                                        }}
                                        onMouseEnter={e => (e.currentTarget.style.borderColor = color.border)}
                                        onMouseLeave={e => (e.currentTarget.style.borderColor = color.borderMuted)}
                                    >
                                        {/* Title + delete */}
                                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                                            <span style={{
                                                flex: 1, fontSize: '12px', fontWeight: 500,
                                                color: task.status === 'completed' || task.status === 'cancelled' ? color.textFaint : color.textPrimary,
                                                textDecoration: task.status === 'completed' || task.status === 'cancelled' ? 'line-through' : 'none',
                                                lineHeight: 1.4, wordBreak: 'break-word',
                                            }}>
                                                {task.title}
                                            </span>
                                            <button
                                                onClick={e => { e.stopPropagation(); onDeleteTask(task) }}
                                                style={{
                                                    flexShrink: 0, background: 'transparent', border: 'none',
                                                    color: color.textFaint, cursor: 'pointer', padding: 0,
                                                    fontSize: '14px', lineHeight: 1, opacity: 0, transition: 'opacity 0.1s',
                                                }}
                                                onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = color.danger }}
                                                onMouseLeave={e => { e.currentTarget.style.opacity = '0'; e.currentTarget.style.color = color.textFaint }}
                                            >
                                                ×
                                            </button>
                                        </div>

                                        {/* Body snippet */}
                                        {task.body && (
                                            <span style={{
                                                fontSize: '11px', color: color.textMuted,
                                                lineHeight: 1.4, wordBreak: 'break-word',
                                                display: '-webkit-box', WebkitLineClamp: 2,
                                                WebkitBoxOrient: 'vertical', overflow: 'hidden',
                                            }}>
                                                {task.body}
                                            </span>
                                        )}

                                        {/* Footer: priority + assignees */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                                            <PriorityBadge priority={task.priority} />
                                            {task.assignees.map(a => (
                                                <span key={a} style={{
                                                    background: color.accentSubtle, border: `1px solid ${color.accentEmphasis}`,
                                                    borderRadius: '10px', padding: '1px 6px',
                                                    color: color.accentMuted, fontSize: '10px',
                                                }}>{a}</span>
                                            ))}
                                        </div>

                                        {/* Planning indicators */}
                                        {(task.acceptance_criteria.length > 0 || task.testing_methods.length > 0 || task.validation_steps.length > 0) && (
                                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                                {task.acceptance_criteria.length > 0 && (
                                                    <span style={{ fontSize: '10px', color: color.success }}>
                                                        ✓ {task.acceptance_criteria.length} criteria
                                                    </span>
                                                )}
                                                {task.testing_methods.length > 0 && (
                                                    <span style={{ fontSize: '10px', color: color.accent }}>
                                                        ⬡ {task.testing_methods.length} tests
                                                    </span>
                                                )}
                                                {task.validation_steps.length > 0 && (
                                                    <span style={{ fontSize: '10px', color: color.warning }}>
                                                        ◎ {task.validation_steps.length} steps
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ))}

                                {/* Add task shortcut at bottom of column */}
                                {status === 'pending' && (
                                    <button
                                        onClick={onOpenCreateTask}
                                        style={{
                                            background: 'transparent', border: `1px dashed ${color.border}`,
                                            borderRadius: '6px', color: color.textFaint, fontSize: '11px',
                                            padding: '8px', cursor: 'pointer', textAlign: 'center',
                                            marginTop: col.length > 0 ? '2px' : '0',
                                        }}
                                        onMouseEnter={e => { e.currentTarget.style.color = color.textMuted; e.currentTarget.style.borderColor = color.borderMuted }}
                                        onMouseLeave={e => { e.currentTarget.style.color = color.textFaint; e.currentTarget.style.borderColor = color.border }}
                                    >
                                        + Add task
                                    </button>
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

// ─── Messages view ────────────────────────────────────────────────────────────

interface AgentMessage {
    id: number
    sender_project_id: number
    receiver_project_id: number
    sender_name: string
    receiver_name: string
    content: string
    status: 'pending' | 'delivered' | 'read'
    created_at: string
}

function MessagesView({ projectId, projectName, newMessageIds }: { projectId: number; projectName: string; newMessageIds: number[] }) {
    const [messages, setMessages] = useState<AgentMessage[]>([])

    useEffect(() => {
        fetch(`/api/projects/${projectId}/messages`)
            .then(r => r.json())
            .then(setMessages)
            .catch(() => {})
    }, [projectId])

    // Reload when new messages arrive via WS
    useEffect(() => {
        if (newMessageIds.length === 0) return
        fetch(`/api/projects/${projectId}/messages`)
            .then(r => r.json())
            .then(setMessages)
            .catch(() => {})
    }, [newMessageIds.length, projectId])

    async function markRead(msg: AgentMessage) {
        if (msg.status === 'read') return
        await fetch(`/api/messages/${msg.id}/read`, { method: 'PATCH' })
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, status: 'read' } : m))
    }

    const unreadCount = messages.filter(m => m.receiver_project_id === projectId && m.status !== 'read').length

    return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{
                padding: '10px 20px', borderBottom: `1px solid ${color.border}`,
                display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0,
                background: color.bgCanvas,
            }}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill={color.textMuted}>
                    <path d="M1.75 2h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0114.25 14H1.75A1.75 1.75 0 010 12.25v-8.5C0 2.784.784 2 1.75 2zM1.5 12.251c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25V5.06l-5.563 3.516a1.75 1.75 0 01-1.874 0L1.5 5.06v7.19zm13-8.181L8.312 7.512a.25.25 0 01-.264 0L1.5 4.07v-.32a.25.25 0 01.25-.25h12.5a.25.25 0 01.25.25v.32z"/>
                </svg>
                <span style={{ color: color.textPrimary, fontSize: '13px', fontWeight: 600, flex: 1 }}>Agent Messages</span>
                {unreadCount > 0 && (
                    <span style={{
                        fontSize: '10px', padding: '1px 7px', borderRadius: '10px',
                        background: `${color.accent}20`, border: `1px solid ${color.accent}40`,
                        color: color.accent,
                    }}>
                        {unreadCount} unread
                    </span>
                )}
            </div>

            {/* Message thread */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {messages.length === 0 ? (
                    <div style={{
                        flex: 1, display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center', gap: '10px',
                        padding: '60px 24px', textAlign: 'center',
                    }}>
                        <svg width="32" height="32" viewBox="0 0 16 16" fill={color.textFaint}>
                            <path d="M1.75 2h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0114.25 14H1.75A1.75 1.75 0 010 12.25v-8.5C0 2.784.784 2 1.75 2zM1.5 12.251c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25V5.06l-5.563 3.516a1.75 1.75 0 01-1.874 0L1.5 5.06v7.19zm13-8.181L8.312 7.512a.25.25 0 01-.264 0L1.5 4.07v-.32a.25.25 0 01.25-.25h12.5a.25.25 0 01.25.25v.32z"/>
                        </svg>
                        <div>
                            <p style={{ margin: '0 0 4px', color: color.textSecondary, fontSize: '13px', fontWeight: 500 }}>
                                No messages yet
                            </p>
                            <p style={{ margin: 0, color: color.textFaint, fontSize: '11px', lineHeight: 1.5 }}>
                                Agents can communicate using the<br />
                                <code style={{ fontFamily: '"JetBrains Mono", monospace', color: color.accent }}>send_message_to_agent</code> MCP tool
                            </p>
                        </div>
                    </div>
                ) : (
                    messages.map(msg => {
                        const isInbound = msg.receiver_project_id === projectId
                        const isUnread = isInbound && msg.status !== 'read'
                        return (
                            <div
                                key={msg.id}
                                onClick={() => isInbound && markRead(msg)}
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: isInbound ? 'flex-start' : 'flex-end',
                                    gap: '4px',
                                    cursor: isUnread ? 'pointer' : 'default',
                                }}
                            >
                                <div style={{
                                    fontSize: '10px', color: color.textFaint,
                                    display: 'flex', alignItems: 'center', gap: '6px',
                                }}>
                                    {isInbound ? (
                                        <><span style={{ color: color.accent }}>{msg.sender_name}</span> → {projectName}</>
                                    ) : (
                                        <>{projectName} → <span style={{ color: color.accent }}>{msg.receiver_name}</span></>
                                    )}
                                    <span>{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                                <div style={{
                                    maxWidth: '75%',
                                    background: isInbound ? color.bgSurface : color.accentSubtle,
                                    border: `1px solid ${isUnread ? color.accent : isInbound ? color.borderMuted : color.accentEmphasis}`,
                                    borderRadius: '8px',
                                    padding: '8px 12px',
                                    fontSize: '12px',
                                    color: color.textPrimary,
                                    lineHeight: 1.5,
                                    wordBreak: 'break-word',
                                    whiteSpace: 'pre-wrap',
                                    boxShadow: isUnread ? `0 0 0 2px ${color.accent}30` : 'none',
                                }}>
                                    {msg.content}
                                    {isUnread && (
                                        <span style={{
                                            display: 'inline-block', marginLeft: '6px',
                                            width: '6px', height: '6px', borderRadius: '50%',
                                            background: color.accent, verticalAlign: 'middle',
                                        }} />
                                    )}
                                </div>
                                <div style={{ fontSize: '10px', color: color.textFaint }}>
                                    {msg.status}
                                </div>
                            </div>
                        )
                    })
                )}
            </div>
        </div>
    )
}

// makeTerminal is imported from ./hooks/useTerminalSessions

// ─── Claude status badge ──────────────────────────────────────────────────────

// ─── Agent card ──────────────────────────────────────────────────────────────

function AgentCard({
    project, active, status, activity, sessionStart, outputChars, onClick,
}: {
    project: Project; active: boolean; status?: 'running' | 'done'
    activity?: string; sessionStart?: Date; outputChars?: number
    onClick: () => void
}) {
    const [elapsed, setElapsed] = useState('')

    useEffect(() => {
        if (!sessionStart) { setElapsed(''); return }
        const update = () => {
            const secs = Math.floor((Date.now() - sessionStart.getTime()) / 1000)
            if (secs < 60) setElapsed(`${secs}s`)
            else if (secs < 3600) setElapsed(`${Math.floor(secs / 60)}m`)
            else setElapsed(`${Math.floor(secs / 3600)}h`)
        }
        update()
        const id = setInterval(update, 15000)
        return () => clearInterval(id)
    }, [sessionStart])

    const initial = project.name.charAt(0).toUpperCase()
    const avatarBg = agentColor(project.name)
    const isRunning = status === 'running'
    const tokLabel = outputChars && outputChars > 400
        ? (outputChars / 4000 >= 1 ? `${(outputChars / 4000).toFixed(1)}k tok` : `${Math.round(outputChars / 4)} tok`)
        : null

    return (
        <div
            onClick={onClick}
            style={{
                display: 'flex', alignItems: 'flex-start', gap: '10px',
                padding: '12px 14px', cursor: 'pointer', transition: 'background 0.1s',
                background: active ? color.accentSubtle : 'transparent',
                borderLeft: `2px solid ${active ? color.accent : 'transparent'}`,
            }}
            onMouseEnter={e => { if (!active) e.currentTarget.style.background = color.bgCanvas }}
            onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
        >
            <div style={{
                width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0,
                background: avatarBg, display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: '12px', fontWeight: 700, color: '#fff', marginTop: '1px',
            }}>
                {initial}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                    <span style={{ color: color.textPrimary, fontSize: '13px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {project.name}
                    </span>
                    <span style={{
                        width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0,
                        background: isRunning ? '#3fb950' : color.textFaint,
                        boxShadow: isRunning ? '0 0 5px #3fb950' : 'none',
                    }} />
                </div>
                <div style={{ color: color.textMuted, fontSize: '11px', marginTop: '1px' }}>{project.language}</div>
                {activity && (
                    <div style={{
                        color: color.textSecondary, fontSize: '11px', marginTop: '6px', lineHeight: 1.4,
                        overflow: 'hidden', display: '-webkit-box',
                        WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
                    }}>
                        {activity}
                    </div>
                )}
                {(elapsed || tokLabel) && (
                    <div style={{ display: 'flex', gap: '8px', marginTop: '5px', color: color.textFaint, fontSize: '10px', fontFamily: '"JetBrains Mono", monospace' }}>
                        {elapsed && <span>{elapsed} uptime</span>}
                        {tokLabel && <span>{tokLabel}</span>}
                    </div>
                )}
            </div>
        </div>
    )
}

function ClaudeStatusBadge({ status }: { status?: 'running' | 'done' }) {
    if (!status) return null
    if (status === 'running') {
        return (
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '8px' }}>
                <DotsIndicator />
                <span style={{ color: color.warning, fontSize: '11px', fontFamily: '"JetBrains Mono", monospace' }}>running</span>
            </span>
        )
    }
    return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px', marginLeft: '6px' }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: color.success }} />
            <span style={{ color: color.success, fontSize: '11px', fontFamily: '"JetBrains Mono", monospace' }}>done</span>
        </span>
    )
}

// ─── Persistent layout ────────────────────────────────────────────────────────

export default function AppLayout({ children }: { children: React.ReactNode }) {
    const { props, component } = usePage<{ project?: string; agent_id?: number; tasks?: Task[] }>()
    const projectName = props.project
    const agentIdFromUrl = props.agent_id  // set by /{project}/agents/{agent_id} route

    // ── Data hooks ────────────────────────────────────────────────────────────
    const { workspaces, invalidate: invalidateWorkspaces } = useWorkspace()
    const { allProjects, unassigned: unassignedProjects, invalidate: invalidateProjects, update: updateProject, remove: removeProject } = useProjects()

    // Modal/UI state
    const [showWorkspaceModal, setShowWorkspaceModal] = useState(false)
    const [addProjectWorkspaceId, setAddProjectWorkspaceId] = useState<number | null | undefined>(undefined)
    const [movingProject, setMovingProject] = useState<Project | null>(null)
    const [editingProject, setEditingProject] = useState<Project | null>(null)
    const [systemPromptProject, setSystemPromptProject] = useState<Project | null>(null)
    const [permissionsProject, setPermissionsProject] = useState<Project | null>(null)
    const [showGlobalSettings, setShowGlobalSettings] = useState(false)
    const [showDefaultPermissions, setShowDefaultPermissions] = useState(false)
    const [deletingProject, setDeletingProject] = useState<Project | null>(null)
    const [deletingWorkspace, setDeletingWorkspace] = useState<Workspace | null>(null)

    // Terminal / Claude status state (not in react-query — driven by WebSocket events)
    const [claudeStatus, setClaudeStatus] = useState<Record<number, 'running' | 'done'>>({})
    const [lastActivity, setLastActivity] = useState<Record<number, string>>({})
    const [sessionStart, setSessionStart] = useState<Record<number, Date>>({})
    const [outputChars, setOutputChars] = useState<Record<number, number>>({})

    const isTasksPage = component === 'Tasks'
    // Pages that render their own content into the content area via children
    const pageHasContent = new Set(['Settings']).has(component)
    const [projectView, setProjectView] = useState<ProjectView>('agents')
    const activeView: ProjectView = isTasksPage ? 'tasks' : projectView
    const [showCreateTask, setShowCreateTask] = useState(false)
    const [isDraggingOver, setIsDraggingOver] = useState(false)
    const [selectedTask, setSelectedTask] = useState<Task | null>(null)
    const [newMessageIds, setNewMessageIds] = useState<number[]>([])
    const [agentTemplates, setAgentTemplates] = useState<AgentTemplate[]>([])
    const [showAddAgent, setShowAddAgent] = useState(false)
    const [activeAgentId, setActiveAgentId] = useState<number | null>(null)
    const [showProjectSearch, setShowProjectSearch] = useState(false)
    const [editingAgent, setEditingAgent] = useState<ProjectAgent | null>(null)

    const sessions = useRef<Map<number, Session>>(new Map())
    const containerRefs = useRef<Map<number, HTMLDivElement | null>>(new Map())
    const agentSessions = useRef<Map<number, Session>>(new Map())
    const agentContainerRefs = useRef<Map<number, HTMLDivElement | null>>(new Map())
    const fileInputRef = useRef<HTMLInputElement>(null)

    const activeProject = allProjects.find(p => p.slug === projectName) ?? allProjects[0] ?? null

    // Per-project hooks (re-run when active project changes)
    const taskHook = useTasks(activeProject?.id ?? null)
    const agentHook = useAgents(activeProject?.id ?? null)
    const tasks = taskHook.tasks
    const projectAgents = agentHook.agents

    // Derive active agent from URL agent_id (agentIdFromUrl prop from server)
    const activeAgentFromUrl = agentIdFromUrl
        ? projectAgents.find(a => a.id === agentIdFromUrl) ?? null
        : null

    // Seed claudeStatus from fetched project data on first load
    useEffect(() => {
        const initial: Record<number, 'running' | 'done'> = {}
        for (const p of allProjects) {
            if (p.claude_status === 'running') initial[p.id] = 'running'
            else if (p.claude_status === 'idle') initial[p.id] = 'done'
        }
        setClaudeStatus(prev => ({ ...initial, ...prev }))
    }, [allProjects.length])

    // When agents load and URL has a slug, set the active agent ID
    useEffect(() => {
        if (activeAgentFromUrl) {
            setActiveAgentId(activeAgentFromUrl.id)
        }
    }, [activeAgentFromUrl?.id])

    // Reset active agent when switching projects
    useEffect(() => {
        setActiveAgentId(null)
        agentSessions.current.forEach(({ term, ws, observer }) => {
            observer.disconnect(); term.dispose(); ws.close()
        })
        agentSessions.current.clear()
    }, [activeProject?.id])

    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
                e.preventDefault()
                setShowProjectSearch(o => !o)
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [])

    // Fetch agent templates once on mount (global, not project-specific)
    useEffect(() => {
        fetch('/api/agent-templates')
            .then(r => r.json())
            .then(setAgentTemplates)
            .catch(() => {})
    }, [])

    // Launch a terminal session for a single agent (reusable helper)
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
            console.log("WS message: ", e.data)
            if (typeof e.data !== 'string') {
                term.write(new Uint8Array(e.data as ArrayBuffer))
            } else {
                // Handle JSON events (relay messages) from the WebSocket
                try {
                    const event = JSON.parse(e.data)
                    if (event.type === 'agent_created') {
                        agentHook.addAgent(event.agent as ProjectAgent)
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
        }) // requestAnimationFrame
    }

    // When an agent is selected, start ALL agents (so they can communicate)
    // but only focus the selected one
    useEffect(() => {
        if (activeAgentId === null || !activeProject) return

        // Use requestAnimationFrame to ensure containers are rendered
        requestAnimationFrame(() => {
            // Launch all agents so they can all receive relay messages
            for (const agent of projectAgents) {
                launchAgentSession(agent.id, agent.id === activeAgentId)
            }
        })
    }, [activeAgentId, projectAgents.length])


    function handleOpenTask(task: Task) { setSelectedTask(task) }
    function handleCloseTask() { setSelectedTask(null) }

    async function handleAddTask(title: string, body: string, assignees: string[]): Promise<Task | null> {
        try {
            return await taskHook.create.mutateAsync({ title, body, assignees })
        } catch { return null }
    }

    async function handleUpdateStatus(task: Task, status: Task['status']) {
        taskHook.updateStatus.mutate({ taskId: task.id, status })
    }

    async function handleDeleteTask(task: Task) {
        taskHook.remove.mutate(task.id)
    }

    useEffect(() => {
        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            if (sessions.current.size > 0) e.preventDefault()
        }
        window.addEventListener('beforeunload', onBeforeUnload)
        return () => window.removeEventListener('beforeunload', onBeforeUnload)
    }, [])

    useEffect(() => {
        const block = (e: KeyboardEvent) => {
            if (['Enter', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.key)) e.preventDefault()
        }
        document.addEventListener('keydown', block)
        return () => document.removeEventListener('keydown', block)
    }, [])

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
        // Rolling text buffer for input-prompt detection (shared across messages)
        let termTextBuf = ''
        let lastInputSoundAt = 0

        ws.onmessage = e => {
            console.log("WS message: 4", e.data)
            if (typeof e.data === 'string') {
                try {
                    const msg = JSON.parse(e.data)
                    if (msg.type === 'claude_stopped') {
                        setClaudeStatus(prev => ({ ...prev, [activeProject.id]: 'done' }))
                        playSound('done')
                    } else if (msg.type === 'agent_message') {
                        setNewMessageIds(prev => [...prev, msg.message_id])
                        playSound('input')
                    } else if (msg.type === 'agent_created') {
                        agentHook.addAgent(msg.agent as ProjectAgent)
                    }
                } catch { /* ignore */ }
            } else {
                const bytes = new Uint8Array(e.data as ArrayBuffer)
                term.write(bytes)

                // Detect Claude waiting for user input by scanning plain text
                const text = new TextDecoder().decode(bytes).replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
                termTextBuf = (termTextBuf + text).slice(-800)

                // Track last meaningful activity line for agent cards
                const stripped = text.replace(/[^\x20-\x7E\n\r]/g, '')
                const actLines = stripped.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 6 && !/^[$%>#\u276F]/.test(l))
                if (actLines.length) setLastActivity(prev => ({ ...prev, [activeProject.id]: actLines[actLines.length - 1] }))
                setOutputChars(prev => ({ ...prev, [activeProject.id]: (prev[activeProject.id] ?? 0) + bytes.length }))

                const now = Date.now()
                const inputPatterns = [
                    /\?\s*$/m,                       // ends with "?"
                    /\[Y\/n\]/i,                      // yes/no prompt
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
        }) // requestAnimationFrame
    }, [activeProject, projectAgents])

    function handleWorkspaceCreated() { invalidateWorkspaces() }
    function handleWorkspaceDeleted() { invalidateWorkspaces(); invalidateProjects() }

    function handleProjectCreated(project: Project) {
        invalidateProjects()
        router.visit(`/${project.slug}`)
    }

    function openAddProject(workspaceId: number | null) {
        setAddProjectWorkspaceId(workspaceId)
    }

    async function handleMoveProject(project: Project, newWorkspaceId: number | null) {
        await updateProject.mutateAsync({ id: project.id, workspace_id: newWorkspaceId })
        invalidateWorkspaces()
    }

    function handleProjectUpdated(_updated: Project) {
        invalidateProjects()
        invalidateWorkspaces()
    }

    function handleProjectDeleted(projectId: number) {
        const project = allProjects.find(p => p.id === projectId)
        removeProject.mutate(projectId)
        if (project && projectName === project.slug) router.visit('/')
    }

    async function uploadImage(file: File) {
        if (!activeProject) return
        if (!file.type.startsWith('image/')) return
        const formData = new FormData()
        formData.append('file', file)
        const res = await fetch(`/api/projects/${activeProject.id}/upload-image`, {
            method: 'POST',
            body: formData,
        })
        if (!res.ok) return
        const { path } = await res.json()
        const session = sessions.current.get(activeProject.id)
        if (session && session.ws.readyState === WebSocket.OPEN) {
            session.ws.send(path)
        }
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

    return (
        <div className="flex flex-col w-full h-screen overflow-hidden" style={{ background: color.bgCanvas }}>

            {/* ═══════════════════════════════════════════════════════════
                FULL-WIDTH TOP BAR
                Logo (220px) | Nav tabs (flex-1) | Search + icons
            ════════════════════════════════════════════════════════════ */}
            <header className="shrink-0 bg-white flex items-stretch" style={{ height: '48px', borderBottom: `1px solid ${color.stroke}`, zIndex: 20 }}>

                {/* Logo zone — same width as sidebar */}
                <div className="shrink-0 flex items-center gap-2.5 px-4" style={{ width: '220px', borderRight: `1px solid ${color.stroke}` }}>
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: color.accent }}>
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="white">
                            <path d="M0 8a8 8 0 1116 0A8 8 0 010 8zm8-6.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM6.5 7.75A.75.75 0 017.25 7h1a.75.75 0 01.75.75v2.75h.25a.75.75 0 010 1.5h-2a.75.75 0 010-1.5h.25v-2h-.25a.75.75 0 01-.75-.75zM8 6a1 1 0 110-2 1 1 0 010 2z"/>
                        </svg>
                    </div>
                    <span style={{ fontWeight: 700, fontSize: '14px', color: color.textPrimary, letterSpacing: '-0.01em' }}>
                        Keera Agent
                    </span>
                </div>

                {/* Nav tabs — centered */}
                <div className="flex items-stretch flex-1 px-2">
                    {([
                        { id: 'agents' as ProjectView, label: 'Dashboard' },
                        { id: 'commands' as ProjectView, label: 'Configurations' },
                        { id: 'tasks' as ProjectView, label: 'Tasks' },
                        { id: 'messages' as ProjectView, label: 'History' },
                    ] as const).map(tab => {
                        const isActive = activeView === tab.id
                        return (
                            <button
                                key={tab.id}
                                onClick={() => {
                                    if (tab.id === 'tasks' && activeProject) { router.visit(`/${activeProject.slug}/tasks`); return }
                                    setProjectView(tab.id)
                                    if (isTasksPage) router.visit(`/${activeProject?.slug}`)
                                }}
                                className="bg-transparent border-none cursor-pointer px-4 h-full text-[13px] transition-colors duration-100 relative"
                                style={{
                                    color: isActive ? color.textPrimary : color.textMuted,
                                    fontWeight: isActive ? 600 : 400,
                                    borderBottom: isActive ? `2px solid ${color.accent}` : '2px solid transparent',
                                    marginBottom: '-1px',
                                }}
                            >
                                {tab.label}
                            </button>
                        )
                    })}
                    {activeProject && (
                        <>
                            <div className="my-3 mx-1" style={{ width: '1px', background: color.stroke }} />
                            <div className="flex items-center gap-1.5 px-2">
                                <ClaudeStatusBadge status={claudeStatus[activeProject.id]} />
                            </div>
                        </>
                    )}
                </div>

                {/* Right: search + icons */}
                <div className="flex items-center gap-1 pr-3">
                    {/* Search bar */}
                    <div className="flex items-center gap-1.5 rounded-md px-2.5 py-1 mr-1" style={{ background: color.bgCanvas, border: `1px solid ${color.stroke}` }}>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill={color.textFaint} className="shrink-0">
                            <path d="M10.68 11.74a6 6 0 01-7.922-8.982 6 6 0 018.982 7.922l3.04 3.04a.749.749 0 11-1.06 1.06l-3.04-3.04zM11.5 7a4.499 4.499 0 11-8.997 0A4.499 4.499 0 0111.5 7z"/>
                        </svg>
                        <input
                            placeholder="Search..."
                            className="bg-transparent border-none outline-none text-[12px] w-28"
                            style={{ color: color.textPrimary }}
                        />
                    </div>
                    {/* Attach image (agents view) */}
                    {activeView === 'agents' && activeProject && (
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            title="Attach image"
                            className="bg-transparent border-none cursor-pointer p-1.5 flex items-center rounded transition-colors"
                            style={{ color: color.textFaint }}
                            onMouseEnter={e => (e.currentTarget.style.color = color.accent)}
                            onMouseLeave={e => (e.currentTarget.style.color = color.textFaint)}
                        >
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                                <path d="M4.5 3a2.5 2.5 0 015 0v9a1.5 1.5 0 01-3 0V5a.5.5 0 011 0v7a.5.5 0 001 0V3a1.5 1.5 0 10-3 0v9a2.5 2.5 0 005 0V5a.5.5 0 011 0v7a3.5 3.5 0 11-7 0V3z"/>
                            </svg>
                        </button>
                    )}
                    {/* Bell */}
                    <button
                        className="bg-transparent border-none cursor-pointer p-1.5 flex items-center rounded transition-colors"
                        style={{ color: color.textFaint }}
                        onMouseEnter={e => (e.currentTarget.style.color = color.textPrimary)}
                        onMouseLeave={e => (e.currentTarget.style.color = color.textFaint)}
                    >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 16a2 2 0 001.985-1.75c.017-.137-.097-.25-.235-.25h-3.5c-.138 0-.252.113-.235.25A2 2 0 008 16zm.25-14.25A5.25 5.25 0 003 7v2.047c0 .334-.102.656-.29.932L1.55 11.698A1.5 1.5 0 002.8 13.5h10.4a1.5 1.5 0 001.258-2.302l-1.16-1.719A1.625 1.625 0 0113 8.047V7A5.25 5.25 0 008.25 1.75z"/>
                        </svg>
                    </button>
                    {/* Settings */}
                    <button
                        onClick={() => router.visit('/settings')}
                        title="Settings"
                        className="bg-transparent border-none cursor-pointer p-1.5 flex items-center rounded transition-colors"
                        style={{ color: pageHasContent ? color.accent : color.textFaint }}
                        onMouseEnter={e => { if (!pageHasContent) e.currentTarget.style.color = color.textPrimary }}
                        onMouseLeave={e => { if (!pageHasContent) e.currentTarget.style.color = color.textFaint }}
                    >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 0a8.2 8.2 0 01.701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212.224.231.114.454.243.668.386.123.082.233.09.299.071l1.103-.303c.644-.176 1.392.021 1.82.63.27.385.506.792.704 1.218.315.675.111 1.422-.364 1.891l-.814.806c-.049.048-.098.147-.088.294.016.257.016.515 0 .772-.01.147.038.246.087.294l.814.806c.475.469.679 1.216.364 1.891a7.977 7.977 0 01-.704 1.217c-.428.61-1.176.807-1.82.63l-1.103-.303c-.066-.019-.176-.011-.299.071a5.909 5.909 0 01-.668.386c-.133.066-.194.158-.211.224l-.29 1.106c-.168.646-.715 1.196-1.458 1.26a8.006 8.006 0 01-1.402 0c-.743-.064-1.289-.614-1.458-1.26l-.289-1.106c-.018-.066-.079-.158-.212-.224a5.738 5.738 0 01-.668-.386c-.123-.082-.233-.09-.299-.071l-1.103.303c-.644.176-1.392-.021-1.82-.63a8.12 8.12 0 01-.704-1.218c-.315-.675-.111-1.422.363-1.891l.815-.806c.05-.048.098-.147.088-.294a6.214 6.214 0 010-.772c.01-.147-.038-.246-.088-.294l-.815-.806C.635 6.045.431 5.298.746 4.623a7.92 7.92 0 01.704-1.217c.428-.61 1.176-.807 1.82-.63l1.102.302c.067.019.177.011.3-.071a5.659 5.659 0 01.668-.386c.133-.066.194-.158.211-.224l.29-1.106C6.156.421 6.703-.129 7.445.031 7.645.015 7.825 0 8 0zm1.5 8a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"/>
                        </svg>
                    </button>
                    {/* Avatar */}
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white cursor-pointer ml-1 shrink-0" style={{ background: '#7c6af7' }}>
                        B
                    </div>
                </div>
            </header>

            {/* ═══════════════════════════════════════════════════════════
                BODY: Sidebar + Content
            ════════════════════════════════════════════════════════════ */}
            <div className="flex flex-1 overflow-hidden">
                <Sidebar
                    allProjects={allProjects}
                    activeProject={activeProject}
                    projectView={activeView}
                    onChangeView={(view) => {
                        if (view === 'tasks' && activeProject) { router.visit(`/${activeProject.slug}/tasks`); return }
                        setProjectView(view)
                        if (isTasksPage) router.visit(`/${activeProject?.slug}`)
                    }}
                    taskCount={tasks.length}
                    newMessageCount={newMessageIds.length}
                    onAddAgent={() => setShowAddAgent(true)}
                    activeId={activeProject?.id ?? null}
                    onAddProject={openAddProject}
                    onMoveProject={setMovingProject}
                    onEditProject={setEditingProject}
                    onSystemPromptProject={setSystemPromptProject}
                    onPermissionsProject={setPermissionsProject}
                    onDeleteProject={setDeletingProject}
                    claudeStatus={claudeStatus}
                    onCreateWorkspace={() => setShowWorkspaceModal(true)}
                />

                {/* Main content area */}
                <div className="flex-1 flex overflow-hidden bg-white">

                    {pageHasContent ? children : (<>

                    {/* Agents view: agent card list (left) + terminal (right) — always rendered to keep sessions alive */}
                    <div style={{ flex: 1, overflow: 'hidden', display: activeView === 'agents' ? 'flex' : 'none' }}>

                        {/* Agent cards list — left panel */}
                        <div style={{ width: '230px', flexShrink: 0, background: '#fff', borderRight: `1px solid ${color.stroke}`, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
                            {/* Per-project agents */}
                            {activeProject && (
                                <>
                                    {/* Section header */}
                                    <div style={{ padding: '12px 14px 6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <span style={{
                                            fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
                                            letterSpacing: '0.08em', color: color.textFaint, flex: 1,
                                        }}>
                                            Agents
                                        </span>
                                        {projectAgents.length >= 2 && (
                                            <button
                                                onClick={() => {
                                                    if (activeAgentId === null) setActiveAgentId(projectAgents[0].id)
                                                    else requestAnimationFrame(() => {
                                                        for (const agent of projectAgents) launchAgentSession(agent.id, agent.id === activeAgentId)
                                                    })
                                                }}
                                                title="Start all agents"
                                                style={{
                                                    background: 'transparent', border: `1px solid ${color.stroke}`,
                                                    borderRadius: '4px', color: color.textFaint,
                                                    fontSize: '10px', lineHeight: 1, padding: '2px 6px',
                                                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px',
                                                }}
                                                onMouseEnter={e => { e.currentTarget.style.borderColor = '#16a34a'; e.currentTarget.style.color = '#16a34a' }}
                                                onMouseLeave={e => { e.currentTarget.style.borderColor = color.stroke; e.currentTarget.style.color = color.textFaint }}
                                            >
                                                <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor">
                                                    <path d="M2 1.5l7 3.5-7 3.5V1.5z"/>
                                                </svg>
                                                All
                                            </button>
                                        )}
                                        {projectAgents.some(a => !agentSessions.current.has(a.id)) && (
                                            <button
                                                onClick={async () => {
                                                    const idle = projectAgents.filter(a => !agentSessions.current.has(a.id))
                                                    const idleIds = new Set(idle.map(a => a.id))
                                                    if (activeAgentId !== null && idleIds.has(activeAgentId)) {
                                                        const remaining = projectAgents.filter(a => !idleIds.has(a.id))
                                                        setActiveAgentId(remaining.length > 0 ? remaining[0].id : null)
                                                    }
                                                    for (const agent of idle) {
                                                        agentContainerRefs.current.delete(agent.id)
                                                        await agentHook.remove.mutateAsync(agent.id)
                                                    }
                                                }}
                                                title="Delete idle agents"
                                                className="border border-gray-200 rounded text-gray-500 text-[10px] leading-none px-1.5 py-0.5 cursor-pointer bg-transparent hover:border-red-400 hover:text-red-400 transition-colors"
                                            >
                                                ✕ idle
                                            </button>
                                        )}
                                        {projectAgents.length > 0 && (
                                            <button
                                                onClick={async () => {
                                                    setActiveAgentId(null)
                                                    for (const agent of projectAgents) {
                                                        const session = agentSessions.current.get(agent.id)
                                                        if (session) {
                                                            session.observer.disconnect()
                                                            session.term.dispose()
                                                            session.ws.close()
                                                            agentSessions.current.delete(agent.id)
                                                        }
                                                        agentContainerRefs.current.delete(agent.id)
                                                        await agentHook.remove.mutateAsync(agent.id)
                                                    }
                                                }}
                                                title="Delete all agents"
                                                className="border border-gray-200 rounded text-gray-500 text-[10px] leading-none px-1.5 py-0.5 cursor-pointer bg-transparent hover:border-red-500 hover:text-red-500 transition-colors"
                                            >
                                                ✕ all
                                            </button>
                                        )}
                                        <button
                                            onClick={() => setShowAddAgent(true)}
                                            title="Add agent"
                                            style={{
                                                background: 'transparent', border: `1px solid ${color.stroke}`,
                                                borderRadius: '4px', color: color.textFaint,
                                                fontSize: '13px', lineHeight: 1, padding: '1px 6px',
                                                cursor: 'pointer',
                                            }}
                                            onMouseEnter={e => { e.currentTarget.style.borderColor = color.accent; e.currentTarget.style.color = color.accent }}
                                            onMouseLeave={e => { e.currentTarget.style.borderColor = color.stroke; e.currentTarget.style.color = color.textFaint }}
                                        >
                                            +
                                        </button>
                                    </div>
                                    {projectAgents.length === 0 ? (
                                        <div style={{ padding: '16px 14px' }}>
                                            <p style={{ fontSize: '12px', color: color.textFaint, margin: 0, lineHeight: 1.5 }}>
                                                No agents yet. Create one to get started.
                                            </p>
                                        </div>
                                    ) : projectAgents.map(agent => {
                                        const isRunning = agentSessions.current.has(agent.id)
                                        const isSelected = agent.id === activeAgentId
                                        const agentBg = AGENT_TYPE_COLORS[agent.agent_type] ?? color.accent
                                        return (
                                        <div
                                            key={agent.id}
                                            onClick={() => {
                                                if (activeProject) {
                                                    router.visit(`/${activeProject.slug}/agents/${agent.id}`)
                                                } else {
                                                    setActiveAgentId(agent.id)
                                                }
                                            }}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: '10px',
                                                padding: '9px 12px', margin: '0 8px 2px', borderRadius: '8px',
                                                cursor: 'pointer', transition: 'background 0.1s',
                                                background: isSelected ? color.accentSubtle : 'transparent',
                                                border: `1px solid ${isSelected ? '#b6d0f7' : 'transparent'}`,
                                            }}
                                            onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = color.bgCanvas }}
                                            onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
                                        >
                                            {/* Avatar with online indicator */}
                                            <div style={{ position: 'relative', flexShrink: 0 }}>
                                                <div style={{
                                                    width: '32px', height: '32px', borderRadius: '8px',
                                                    background: agentBg, display: 'flex',
                                                    alignItems: 'center', justifyContent: 'center',
                                                    fontSize: '11px', fontWeight: 700, color: '#fff',
                                                    boxShadow: isSelected ? `0 0 0 2px ${'#fff'}, 0 0 0 3px ${agentBg}` : 'none',
                                                }}>
                                                    {agent.name.slice(0, 2).toUpperCase()}
                                                </div>
                                                {isRunning && (
                                                    <span style={{
                                                        position: 'absolute', bottom: '-2px', right: '-2px',
                                                        width: '10px', height: '10px', borderRadius: '50%',
                                                        background: '#22c55e', border: '2px solid #fff',
                                                        display: 'block',
                                                    }} />
                                                )}
                                            </div>

                                            {/* Name + status */}
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{
                                                    fontSize: '13px', fontWeight: isSelected ? 600 : 500,
                                                    color: isSelected ? color.accent : color.textPrimary,
                                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                }}>
                                                    {agent.name}
                                                </div>
                                                <div style={{ fontSize: '11px', color: isRunning ? '#16a34a' : color.textFaint, marginTop: '1px' }}>
                                                    {isRunning ? '● Active' : AGENT_TYPE_LABELS[agent.agent_type] ?? agent.agent_type}
                                                </div>
                                            </div>
                                            {/* Restart button — always visible */}
                                            <button
                                                onClick={e => {
                                                    e.stopPropagation()
                                                    const session = agentSessions.current.get(agent.id)
                                                    if (session) {
                                                        session.observer.disconnect()
                                                        session.term.dispose()
                                                        session.ws.close()
                                                        agentSessions.current.delete(agent.id)
                                                    }
                                                    setTimeout(() => launchAgentSession(agent.id, true), 300)
                                                    setActiveAgentId(agent.id)
                                                }}
                                                title={isRunning ? 'Restart agent' : 'Start agent'}
                                                style={{
                                                    background: 'transparent', border: 'none',
                                                    color: isRunning ? '#ca8a04' : color.textFaint,
                                                    cursor: 'pointer',
                                                    padding: '3px', borderRadius: '4px',
                                                    display: 'flex', alignItems: 'center', flexShrink: 0,
                                                }}
                                                onMouseEnter={e => (e.currentTarget.style.color = '#ca8a04')}
                                                onMouseLeave={e => (e.currentTarget.style.color = isRunning ? '#ca8a04' : color.textFaint)}
                                            >
                                                <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                                                    <path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
                                                    <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
                                                </svg>
                                            </button>

                                            {/* Settings/edit button */}
                                            <button
                                                onClick={e => { e.stopPropagation(); setEditingAgent(agent) }}
                                                title="Edit agent"
                                                style={{
                                                    background: 'transparent', border: 'none',
                                                    color: color.textFaint, cursor: 'pointer',
                                                    padding: '3px', borderRadius: '4px',
                                                    display: 'flex', alignItems: 'center', flexShrink: 0,
                                                }}
                                                onMouseEnter={e => (e.currentTarget.style.color = color.textPrimary)}
                                                onMouseLeave={e => (e.currentTarget.style.color = color.textFaint)}
                                            >
                                                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                                                    <path d="M8 9.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"/>
                                                    <path fillRule="evenodd" d="M8 0a8 8 0 100 16A8 8 0 008 0zM1.5 8a6.5 6.5 0 1113 0 6.5 6.5 0 01-13 0z"/>
                                                </svg>
                                            </button>

                                            {/* Run button (when idle) */}
                                            {!isRunning && (
                                                <button
                                                    onClick={e => { e.stopPropagation(); setActiveAgentId(agent.id) }}
                                                    title="Run"
                                                    style={{
                                                        background: 'transparent', border: 'none',
                                                        color: color.textFaint, cursor: 'pointer',
                                                        padding: '3px', borderRadius: '4px',
                                                        display: 'flex', alignItems: 'center',
                                                        flexShrink: 0,
                                                    }}
                                                    onMouseEnter={e => (e.currentTarget.style.color = '#16a34a')}
                                                    onMouseLeave={e => (e.currentTarget.style.color = color.textFaint)}
                                                >
                                                    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                                                        <path d="M3 2l11 6-11 6V2z"/>
                                                    </svg>
                                                </button>
                                            )}

                                            {/* Delete button */}
                                            <button
                                                onClick={async (e) => {
                                                    e.stopPropagation()
                                                    const session = agentSessions.current.get(agent.id)
                                                    if (session) {
                                                        session.observer.disconnect()
                                                        session.term.dispose()
                                                        session.ws.close()
                                                        agentSessions.current.delete(agent.id)
                                                    }
                                                    agentContainerRefs.current.delete(agent.id)
                                                    if (activeAgentId === agent.id) {
                                                        const remaining = projectAgents.filter(a => a.id !== agent.id)
                                                        setActiveAgentId(remaining.length > 0 ? remaining[0].id : null)
                                                    }
                                                    await agentHook.remove.mutateAsync(agent.id)
                                                }}
                                                title="Remove"
                                                style={{
                                                    background: 'transparent', border: 'none',
                                                    color: color.textFaint, cursor: 'pointer',
                                                    padding: '3px 5px', borderRadius: '4px',
                                                    fontSize: '15px', lineHeight: 1, flexShrink: 0,
                                                }}
                                                onMouseEnter={e => (e.currentTarget.style.color = color.danger)}
                                                onMouseLeave={e => (e.currentTarget.style.color = color.textFaint)}
                                            >
                                                ×
                                            </button>
                                        </div>
                                    )})}
                                </>
                            )}
                        </div>

                        {/* ─── Chat / Terminal Panel ─────────────────────────────────── */}
                        <div
                            style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', background: '#fff' }}
                            onDragOver={e => { e.preventDefault(); setIsDraggingOver(true) }}
                            onDragEnter={e => { e.preventDefault(); setIsDraggingOver(true) }}
                            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDraggingOver(false) }}
                            onDrop={e => {
                                e.preventDefault()
                                setIsDraggingOver(false)
                                const file = e.dataTransfer.files[0]
                                if (file) uploadImage(file)
                            }}
                        >
                            {/* ── Chat panel header ── */}
                            {activeProject && (() => {
                                const activeAgent = activeAgentId !== null ? projectAgents.find(a => a.id === activeAgentId) ?? null : null
                                const agentBg = activeAgent ? (AGENT_TYPE_COLORS[activeAgent.agent_type] ?? color.accent) : agentColor(activeProject.name)
                                const displayName = activeAgent ? activeAgent.name : activeProject.name
                                const displayRole = activeAgent
                                    ? (AGENT_TYPE_LABELS[activeAgent.agent_type] ?? activeAgent.agent_type)
                                    : activeProject.language
                                return (
                                    <div style={{
                                        height: '48px', flexShrink: 0, display: 'flex', alignItems: 'center',
                                        paddingLeft: '16px', paddingRight: '14px', gap: '10px',
                                        borderBottom: `1px solid ${color.stroke}`, background: '#fff',
                                    }}>
                                        {/* Back button (agent view) */}
                                        {activeAgent && (
                                            <button
                                                onClick={() => setActiveAgentId(null)}
                                                title="Back"
                                                style={{
                                                    background: 'transparent', border: 'none',
                                                    color: color.textFaint, cursor: 'pointer',
                                                    padding: '4px', display: 'flex', alignItems: 'center', borderRadius: '4px',
                                                }}
                                                onMouseEnter={e => { e.currentTarget.style.color = color.textPrimary; e.currentTarget.style.background = color.bgCanvas }}
                                                onMouseLeave={e => { e.currentTarget.style.color = color.textFaint; e.currentTarget.style.background = 'transparent' }}
                                            >
                                                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                                                    <path d="M7.78 12.53a.75.75 0 01-1.06 0L2.47 8.28a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 1.06L4.81 7h7.44a.75.75 0 010 1.5H4.81l2.97 2.97a.75.75 0 010 1.06z"/>
                                                </svg>
                                            </button>
                                        )}

                                        {/* Avatar */}
                                        <div style={{
                                            width: '28px', height: '28px',
                                            borderRadius: activeAgent ? '8px' : '50%',
                                            flexShrink: 0, background: agentBg,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: '11px', fontWeight: 700, color: '#fff',
                                        }}>
                                            {displayName.charAt(0).toUpperCase()}
                                        </div>

                                        {/* Name + badge */}
                                        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span style={{ color: color.textPrimary, fontSize: '13px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {displayName}
                                            </span>
                                            {/* AGENT_EXECUTION badge */}
                                            <span style={{
                                                fontSize: '10px', fontWeight: 600, padding: '2px 7px',
                                                borderRadius: '10px', letterSpacing: '0.04em',
                                                background: activeAgent ? `${agentBg}18` : color.bgCanvas,
                                                border: `1px solid ${activeAgent ? agentBg + '40' : color.stroke}`,
                                                color: activeAgent ? agentBg : color.textMuted,
                                                flexShrink: 0,
                                            }}>
                                                {activeAgent ? 'AGENT_EXECUTION' : displayRole.toUpperCase()}
                                            </span>
                                        </div>

                                        {/* Status + Restart */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                                            <ClaudeStatusBadge status={claudeStatus[activeProject.id]} />
                                            {!activeAgent && (
                                                <button
                                                    onClick={restartClaude}
                                                    style={{
                                                        background: 'transparent', border: `1px solid ${color.stroke}`,
                                                        borderRadius: '6px', color: color.textMuted, fontSize: '11px',
                                                        padding: '4px 10px', cursor: 'pointer',
                                                        display: 'flex', alignItems: 'center', gap: '5px',
                                                    }}
                                                    onMouseEnter={e => { e.currentTarget.style.borderColor = color.textMuted; e.currentTarget.style.color = color.textPrimary }}
                                                    onMouseLeave={e => { e.currentTarget.style.borderColor = color.stroke; e.currentTarget.style.color = color.textMuted }}
                                                >
                                                    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                                                        <path d="M8 2.5a5.487 5.487 0 00-4.131 1.869l1.204 1.204A.25.25 0 014.896 6H1.25A.25.25 0 011 5.75V2.104a.25.25 0 01.427-.177l1.38 1.38A7.001 7.001 0 0114.95 7.16a.75.75 0 11-1.49.178A5.501 5.501 0 008 2.5zM1.705 8.005a.75.75 0 01.834.656 5.501 5.501 0 009.592 2.97l-1.204-1.204a.25.25 0 01.177-.427h3.646a.25.25 0 01.25.25v3.646a.25.25 0 01-.427.177l-1.38-1.38A7.001 7.001 0 011.05 8.84a.75.75 0 01.656-.834z"/>
                                                    </svg>
                                                    Restart
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )
                            })()}

                            {/* Drag overlay */}
                            {isDraggingOver && activeProject && (
                                <div style={{
                                    position: 'absolute', inset: 0, zIndex: 10,
                                    background: color.accentGlow,
                                    border: `2px dashed ${color.accent}`, borderRadius: '4px',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    pointerEvents: 'none',
                                }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                                        <svg width="36" height="36" viewBox="0 0 16 16" fill={color.accent} opacity="0.8">
                                            <path d="M1.75 2.5a.25.25 0 00-.25.25v10.5c0 .138.112.25.25.25h.94l.03-.013 4.013-4.013a1.75 1.75 0 012.474 0L13.62 13.5h.63a.25.25 0 00.25-.25V2.75a.25.25 0 00-.25-.25H1.75zM0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0114.25 15H1.75A1.75 1.75 0 010 13.25V2.75zm9.5 3.5a1 1 0 11-2 0 1 1 0 012 0z"/>
                                        </svg>
                                        <span style={{ color: color.accent, fontSize: '13px', fontFamily: '"JetBrains Mono", monospace' }}>
                                            Drop image to attach
                                        </span>
                                    </div>
                                </div>
                            )}

                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                style={{ display: 'none' }}
                                onChange={e => {
                                    const file = e.target.files?.[0]
                                    if (file) uploadImage(file)
                                    e.target.value = ''
                                }}
                            />

                            {/* Terminal body — xterm containers */}
                            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                                {allProjects.map(project => (
                                    <div
                                        key={project.id}
                                        ref={el => { containerRefs.current.set(project.id, el) }}
                                        style={{
                                            position: 'absolute', inset: 0, padding: '8px', boxSizing: 'border-box',
                                            display: project.id === activeProject?.id && activeAgentId === null ? 'block' : 'none',
                                        }}
                                    />
                                ))}
                                {projectAgents.map(agent => {
                                    const isActive = agent.id === activeAgentId
                                    const hasSession = agentSessions.current.has(agent.id)
                                    return (
                                        <div
                                            key={`agent-${agent.id}`}
                                            ref={el => { agentContainerRefs.current.set(agent.id, el) }}
                                            style={{
                                                position: 'absolute', inset: 0, padding: '8px', boxSizing: 'border-box',
                                                ...(isActive
                                                    ? { display: 'block' }
                                                    : hasSession
                                                        ? { display: 'block', visibility: 'hidden' as const, pointerEvents: 'none' as const }
                                                        : { display: 'none' }),
                                            }}
                                        />
                                    )
                                })}
                            </div>

                        </div>

                    </div>

                    {/* Commands view */}
                    {activeView === 'commands' && activeProject && (
                        <CommandsView project={activeProject} projectId={activeProject.id} />
                    )}

                    {/* Tasks view */}
                    {activeView === 'tasks' && activeProject && (
                        <TasksView
                            tasks={tasks}
                            onOpenCreateTask={() => setShowCreateTask(true)}
                            onUpdateStatus={handleUpdateStatus}
                            onDeleteTask={handleDeleteTask}
                            onOpenTask={handleOpenTask}
                        />
                    )}

                    {/* Messages view */}
                    {activeView === 'messages' && activeProject && (
                        <MessagesView
                            projectId={activeProject.id}
                            projectName={activeProject.name}
                            newMessageIds={newMessageIds}
                        />
                    )}

                    {/* Empty state when no project */}
                    {!activeProject && (
                        <div style={{
                            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                            <span style={{ color: color.textFaint, fontSize: '13px' }}>No project selected</span>
                        </div>
                    )}

                    </>)}
                </div>
            </div>

            {selectedTask && (
                <TaskDetailModal task={selectedTask} onClose={handleCloseTask} />
            )}

            {showCreateTask && (
                <CreateTaskModal
                    onClose={() => setShowCreateTask(false)}
                    onCreated={(title, body, assignees) => handleAddTask(title, body, assignees)}
                    projects={allProjects}
                    workspaces={workspaces}
                    defaultProjectId={activeProject?.id ?? null}
                />
            )}

            {showWorkspaceModal && (
                <AddWorkspaceModal
                    onClose={() => setShowWorkspaceModal(false)}
                    onCreated={() => handleWorkspaceCreated()}
                />
            )}

            {addProjectWorkspaceId !== undefined && (
                <ProjectCreateModal
                    workspaces={workspaces}
                    defaultWorkspaceId={addProjectWorkspaceId}
                    onClose={() => setAddProjectWorkspaceId(undefined)}
                    onCreated={handleProjectCreated}
                />
            )}

            {movingProject && (
                <MoveProjectModal
                    project={movingProject}
                    workspaces={workspaces}
                    onClose={() => setMovingProject(null)}
                    onMove={handleMoveProject}
                />
            )}

            {editingProject && (
                <ProjectPathEditModal
                    project={editingProject}
                    onClose={() => setEditingProject(null)}
                    onUpdated={p => { handleProjectUpdated(p); setEditingProject(null) }}
                />
            )}

            {systemPromptProject && (
                <SystemPromptModal
                    project={systemPromptProject}
                    onClose={() => setSystemPromptProject(null)}
                    onUpdated={p => { handleProjectUpdated(p); setSystemPromptProject(null) }}
                />
            )}

            {permissionsProject && (
                <ProjectPermissionsModal
                    project={permissionsProject}
                    onClose={() => setPermissionsProject(null)}
                />
            )}

            {showGlobalSettings && (
                <GlobalSettingsModal
                    onClose={() => setShowGlobalSettings(false)}
                    initialTemplates={agentTemplates}
                    onTemplatesChange={setAgentTemplates}
                />
            )}

            {deletingProject && (
                <ConfirmDeleteProjectModal
                    project={deletingProject}
                    onClose={() => setDeletingProject(null)}
                    onDeleted={id => { handleProjectDeleted(id); setDeletingProject(null) }}
                />
            )}

            {deletingWorkspace && (
                <ConfirmDeleteWorkspaceModal
                    workspace={deletingWorkspace}
                    onClose={() => setDeletingWorkspace(null)}
                    onDeleted={_id => { handleWorkspaceDeleted(); setDeletingWorkspace(null) }}
                />
            )}

            {showAddAgent && activeProject && (
                <AddAgentModal
                    projectId={activeProject.id}
                    templates={agentTemplates}
                    onClose={() => setShowAddAgent(false)}
                    onCreated={agent => { agentHook.addAgent(agent); setShowAddAgent(false) }}
                />
            )}

            {editingAgent && (
                <AgentEditModal
                    agent={editingAgent}
                    onClose={() => setEditingAgent(null)}
                    onSaved={(updated: ProjectAgent) => {
                        agentHook.update.mutate({ agentId: updated.id, ...updated })
                        setEditingAgent(null)
                    }}
                />
            )}

            {showProjectSearch && (
                <ProjectSearchModal
                    projects={allProjects}
                    onClose={() => setShowProjectSearch(false)}
                    onSelect={project => router.visit(`/${project.slug}`)}
                />
            )}

        </div>
    )
}
