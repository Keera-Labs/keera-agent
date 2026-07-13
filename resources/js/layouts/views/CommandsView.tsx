import { useCallback, useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import {
    Zap, Check, Upload, Filter, AlignLeft, MessageSquare, Database, List,
    CirclePlay, Terminal, AlertTriangle, Plus, Square, Play, Pencil, X,
} from 'lucide-react'
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
    if (l.includes('build') || l.includes('compile')) return <Zap size={12}/>
    if (l.includes('test') || l.includes('spec') || l.includes('check')) return <Check size={12}/>
    if (l.includes('deploy') || l.includes('ship') || l.includes('release') || l.includes('publish')) return <Upload size={12}/>
    if (l.includes('lint')) return <Filter size={12}/>
    if (l.includes('format') || l.includes('fmt') || l.includes('prettier')) return <AlignLeft size={12}/>
    if (l.includes('review') || l.includes('pr') || l.includes('diff')) return <MessageSquare size={12}/>
    if (l.includes('db') || l.includes('database') || l.includes('migrate') || l.includes('sql')) return <Database size={12}/>
    if (l.includes('log') || l.includes('tail') || l.includes('monitor') || l.includes('watch')) return <List size={12}/>
    if (l.includes('dev') || l.includes('start') || l.includes('serve')) return <CirclePlay size={12}/>
    return <Terminal size={12}/>
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
                <Terminal size={13} color={color.textMuted}/>
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
                            <Plus size={10}/>
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
                                <AlertTriangle size={22} color={color.danger}/>
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
                                <Terminal size={22} color={color.textFaint}/>
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
                                                <Square size={9} fill="currentColor"/>
                                            ) : (
                                                <Play size={9} fill="currentColor"/>
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
                                            <Pencil size={11}/>
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
                                        ><X size={11}/></button>
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
                                <Plus size={10}/>
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
                                ><X size={14}/></button>
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
