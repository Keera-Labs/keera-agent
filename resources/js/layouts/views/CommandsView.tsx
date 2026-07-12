import { useCallback, useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { color } from '@/tokens'
import type { Project } from '@/types/type'
import { makeTerminal } from '@/hooks/useTerminalSessions'
import type { Session } from '@/hooks/useTerminalSessions'
import { labelStyle, inputStyle, cancelBtnStyle, submitBtnStyle } from '@/components/ui/styles'
import { DotsIndicator } from '@/layouts/sidebar/Project'

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── CommandsView component ───────────────────────────────────────────────────

export function CommandsView({ project }: { project: Project }) {
    const projectId = project.id
    const [commands, setCommands] = useState<Command[]>([])
    const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
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

    const loadCommands = useCallback(async (signal?: AbortSignal) => {
        setLoadState('loading')
        try {
            const r = await fetch(`/api/projects/${projectId}/commands`, { signal })
            if (!r.ok) throw new Error(`HTTP ${r.status}`)
            const data = await r.json()
            setCommands(Array.isArray(data) ? data : [])
            setLoadState('ready')
        } catch (err) {
            if ((err as Error)?.name === 'AbortError') return
            setLoadState('error')
        }
    }, [projectId])

    useEffect(() => {
        const controller = new AbortController()
        loadCommands(controller.signal)
        return () => controller.abort()
    }, [loadCommands])

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
                    {loadState === 'error' ? (
                        <div style={{
                            flex: 1, display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center', gap: '12px',
                            padding: '40px 24px', textAlign: 'center',
                        }}>
                            <div style={{
                                width: '48px', height: '48px', borderRadius: '50%',
                                background: color.dangerCanvas, border: `1px solid ${color.danger}`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <svg width="22" height="22" viewBox="0 0 16 16" fill={color.danger}>
                                    <path d="M8.982 1.566a1.13 1.13 0 00-1.964 0L.165 13.233c-.457.778.091 1.767.982 1.767h13.706c.891 0 1.438-.99.982-1.767L8.982 1.566zM8 5c.535 0 .954.462.9.995l-.35 3.507a.552.552 0 01-1.1 0L7.1 5.995A.905.905 0 018 5zm.002 6a1 1 0 110 2 1 1 0 010-2z"/>
                                </svg>
                            </div>
                            <div>
                                <p style={{ margin: '0 0 4px', color: color.textSecondary, fontSize: '13px', fontWeight: 500 }}>
                                    Couldn’t load commands
                                </p>
                                <p style={{ margin: 0, color: color.textFaint, fontSize: '12px', lineHeight: 1.5 }}>
                                    The request failed. Check your connection<br/>and try again.
                                </p>
                            </div>
                            <button
                                onClick={() => loadCommands()}
                                style={{
                                    background: 'transparent', border: `1px dashed ${color.borderMuted}`,
                                    borderRadius: '6px', color: color.textMuted, fontSize: '12px',
                                    padding: '6px 14px', cursor: 'pointer',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.borderColor = color.accent; e.currentTarget.style.color = color.accent }}
                                onMouseLeave={e => { e.currentTarget.style.borderColor = color.borderMuted; e.currentTarget.style.color = color.textMuted }}
                            >
                                Retry
                            </button>
                        </div>
                    ) : commands.length === 0 ? (
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
