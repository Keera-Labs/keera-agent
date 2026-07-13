import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Plus, Terminal, X } from 'lucide-react'
import { color } from '@/tokens'
import { makeTerminal } from '@/hooks/useTerminalSessions'
import type { Session } from '@/hooks/useTerminalSessions'
import { DotsIndicator } from '@/layouts/sidebar/Project'
import { CommandForm } from './CommandForm'
import { CommandRow } from './CommandRow'
import type { Command } from './types'

const cmdPulseStyle = `@keyframes cmd-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`

// Project-scoped Commands panel: create/edit/delete shell commands and run them
// in an interactive PTY terminal streamed over the command WebSocket. Initial
// commands arrive as server props; live status is driven by socket lifecycle.
export function CommandsPanel({
    projectId,
    projectSlug,
    initialCommands,
}: {
    projectId: number
    projectSlug: string
    initialCommands: Command[]
}) {
    const [commands, setCommands] = useState<Command[]>(initialCommands)
    const [showForm, setShowForm] = useState(false)
    const [outputCmd, setOutputCmd] = useState<Command | null>(null)
    const cmdSessions = useRef<Map<number, Session>>(new Map())
    const cmdContainerRefs = useRef<Map<number, HTMLDivElement | null>>(new Map())

    // Server props are per-visit; re-seed local state when they change so the
    // panel reflects freshly loaded commands after navigation.
    useEffect(() => { setCommands(initialCommands) }, [initialCommands])

    // Tear down every terminal + socket when the panel unmounts.
    useEffect(() => {
        const sessions = cmdSessions.current
        return () => {
            sessions.forEach(({ term, ws, observer }) => {
                observer.disconnect()
                term.dispose()
                ws.close()
            })
        }
    }, [])

    async function handleCreate(label: string, command: string): Promise<string | null> {
        try {
            const res = await fetch(`/api/projects/${projectId}/commands`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label, command }),
            })
            const data = await res.json()
            if (!res.ok) return data.error ?? 'Failed'
            setCommands(prev => [...prev, data as Command])
            setShowForm(false)
            return null
        } catch {
            return 'Network error'
        }
    }

    async function handleUpdate(c: Command, label: string, command: string): Promise<boolean> {
        const res = await fetch(`/api/commands/${c.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label, command }),
        })
        const data = await res.json()
        if (!res.ok) return false
        setCommands(prev => prev.map(x => x.id === c.id ? { ...x, ...data } : x))
        setOutputCmd(prev => prev?.id === c.id ? { ...prev, ...data } : prev)
        return true
    }

    function handleSelect(c: Command) {
        setOutputCmd(c)
        const sess = cmdSessions.current.get(c.id)
        if (sess) requestAnimationFrame(() => { sess.fitAddon.fit(); sess.term.focus() })
    }

    function handleRun(c: Command) {
        setOutputCmd(c)

        requestAnimationFrame(() => {
            const container = cmdContainerRefs.current.get(c.id)
            if (!container) return

            const existing = cmdSessions.current.get(c.id)
            if (existing) {
                if (!container.querySelector('.xterm')) {
                    existing.term.open(container)
                    existing.fitAddon.fit()
                    existing.observer.disconnect()
                    existing.observer.observe(container)
                } else {
                    existing.fitAddon.fit()
                }
                existing.term.focus()
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
            const ws = new WebSocket(`${protocol}//${location.host}/${projectSlug}/command-ws/${c.id}`)
            ws.binaryType = 'arraybuffer'
            ws.onopen = () => {
                ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
                setCommands(prev => prev.map(x => x.id === c.id ? { ...x, status: 'running' } : x))
            }
            ws.onmessage = e => {
                if (typeof e.data !== 'string') term.write(new Uint8Array(e.data as ArrayBuffer))
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
        cmdSessions.current.get(c.id)?.ws.close()
        await fetch(`/api/commands/${c.id}/stop`, { method: 'POST' })
        setCommands(prev => prev.map(x => x.id === c.id ? { ...x, status: 'stopped', pid: null } : x))
        setOutputCmd(prev => prev?.id === c.id ? { ...prev, status: 'stopped', pid: null } : prev)
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
        setOutputCmd(prev => prev?.id === c.id ? null : prev)
    }

    const hasOutput = outputCmd !== null
    const runningCount = commands.filter(c => c.status === 'running').length

    return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <style>{cmdPulseStyle}</style>

            {/* ── Header ── */}
            <div style={{
                padding: '10px 20px', borderBottom: `1px solid ${color.border}`,
                display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0,
                background: color.bgCanvas,
            }}>
                <Terminal size={13} color={color.textMuted} />
                <span style={{ color: color.textPrimary, fontSize: '13px', fontWeight: 600, flex: 1 }}>Commands</span>
                {runningCount > 0 && (
                    <span style={{
                        fontSize: '10px', padding: '1px 7px', borderRadius: '10px',
                        background: 'rgba(63,185,80,0.1)', border: '1px solid rgba(63,185,80,0.3)',
                        color: color.success,
                    }}>
                        {runningCount} running
                    </span>
                )}
                <button
                    onClick={() => setShowForm(s => !s)}
                    style={{
                        background: showForm ? color.bgSurface : color.successEmphasis,
                        border: `1px solid ${showForm ? color.borderMuted : color.successBorder}`,
                        borderRadius: '5px',
                        color: showForm ? color.textMuted : '#fff',
                        fontSize: '11px', padding: '4px 10px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '5px',
                    }}
                >
                    {showForm ? '× Cancel' : (
                        <>
                            <Plus size={10} />
                            New command
                        </>
                    )}
                </button>
            </div>

            {/* ── Add form ── */}
            {showForm && (
                <CommandForm onCancel={() => setShowForm(false)} onCreate={handleCreate} />
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
                                <Terminal size={22} color={color.textFaint} />
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
                            {commands.map(c => (
                                <CommandRow
                                    key={c.id}
                                    command={c}
                                    isSelected={outputCmd?.id === c.id}
                                    onSelect={() => handleSelect(c)}
                                    onRun={() => handleRun(c)}
                                    onStop={() => handleStop(c)}
                                    onDelete={() => handleDelete(c)}
                                    onUpdate={(label, cmd) => handleUpdate(c, label, cmd)}
                                />
                            ))}
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
                                <Plus size={10} />
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
                                        color: color.textFaint, cursor: 'pointer',
                                        padding: '0 2px', lineHeight: 1, borderRadius: '4px',
                                        display: 'flex', alignItems: 'center',
                                    }}
                                    onMouseEnter={e => (e.currentTarget.style.color = color.textSecondary)}
                                    onMouseLeave={e => (e.currentTarget.style.color = color.textFaint)}
                                ><X size={14} /></button>
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

                        {/* xterm containers — one per command, only the selected one visible */}
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
