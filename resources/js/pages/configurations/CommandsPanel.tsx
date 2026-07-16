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
        <div className="flex-1 flex flex-col overflow-hidden">
            <style>{cmdPulseStyle}</style>

            {/* ── Header ── */}
            <div className="py-2.5 px-5 border-b border-stroke flex items-center gap-2 shrink-0 bg-canvas">
                <Terminal size={13} color={color.textMuted} />
                <span className="text-zinc-900 text-[13px] font-semibold flex-1">Commands</span>
                {runningCount > 0 && (
                    <span className="text-[10px] py-px px-[7px] rounded-lg bg-[rgba(63,185,80,0.1)] border border-[rgba(63,185,80,0.3)] text-success">
                        {runningCount} running
                    </span>
                )}
                <button
                    onClick={() => setShowForm(s => !s)}
                    className={`border rounded-[5px] text-[11px] py-1 px-2.5 cursor-pointer flex items-center gap-[5px] ${showForm ? 'bg-surface border-stroke text-zinc-500' : 'bg-success border-success text-white'}`}
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
            <div className="flex-1 flex overflow-hidden">

                {/* Command list */}
                <div
                    className={`shrink-0 overflow-y-auto flex flex-col ${hasOutput ? 'w-[260px] border-r border-r-stroke' : 'w-full border-r-0'}`}
                >
                    {commands.length === 0 ? (
                        <div className="flex-1 flex flex-col items-center justify-center gap-3 py-10 px-6 text-center">
                            <div className="w-12 h-12 rounded-full bg-surface border border-stroke flex items-center justify-center">
                                <Terminal size={22} color={color.textFaint} />
                            </div>
                            <div>
                                <p className="mt-0 mr-0 mb-1 ml-0 text-zinc-700 text-[13px] font-medium">
                                    No commands yet
                                </p>
                                <p className="m-0 text-zinc-400 text-[12px] leading-normal">
                                    Add build scripts, dev servers,<br/>or any long-running process.
                                </p>
                            </div>
                            <button
                                onClick={() => setShowForm(true)}
                                className="bg-transparent border border-dashed border-stroke rounded text-zinc-500 text-[12px] py-1.5 px-3.5 cursor-pointer hover:border-accent hover:text-accent"
                            >
                                + Add your first command
                            </button>
                        </div>
                    ) : (
                        <div className="flex flex-col">
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
                                className="flex items-center gap-1.5 py-[9px] px-3.5 bg-transparent border-none text-zinc-400 text-[11px] cursor-pointer w-full text-left hover:text-zinc-500 hover:bg-surface"
                            >
                                <Plus size={10} />
                                Add command
                            </button>
                        </div>
                    )}
                </div>

                {/* ── Output panel ── */}
                {hasOutput && (
                    <div className="flex-1 flex flex-col overflow-hidden">
                        {/* Command detail header */}
                        <div className="pt-4 pr-5 pb-3.5 pl-5 border-b border-stroke shrink-0 bg-canvas">
                            {/* Title row */}
                            <div className="flex items-center gap-2.5 mb-3">
                                <h2 className="m-0 text-zinc-900 text-[18px] font-bold font-mono tracking-[-0.01em]">
                                    /{outputCmd.label}
                                </h2>
                                {outputCmd.status === 'running' && <DotsIndicator />}
                                {outputCmd.status === 'stopped' && (
                                    <span className="text-[10px] text-zinc-400 font-mono">
                                        exited
                                    </span>
                                )}
                                <div className="flex-1" />
                                <button
                                    onClick={() => setOutputCmd(null)}
                                    className="bg-transparent border-none text-zinc-400 cursor-pointer py-0 px-0.5 leading-none rounded-sm flex items-center hover:text-zinc-700"
                                ><X size={14} /></button>
                            </div>
                            {/* SHELL section */}
                            <div>
                                <div className="text-zinc-400 text-[10px] font-bold uppercase tracking-[0.08em] mb-1.5">Shell</div>
                                <div className="bg-canvas rounded py-2 px-3 border border-stroke font-mono text-[12px] text-zinc-700 flex items-center gap-2 overflow-hidden">
                                    <span className="text-success shrink-0">$</span>
                                    <span className="truncate">
                                        {outputCmd.command}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* xterm containers — one per command, only the selected one visible.
                            bg-canvas matches XTERM_THEME.background exactly so each container's
                            p-2 padding blends into the xterm canvas with no color seam. */}
                        <div className="flex-1 relative bg-canvas overflow-hidden">
                            {commands.map(c => (
                                <div
                                    key={c.id}
                                    ref={el => { cmdContainerRefs.current.set(c.id, el) }}
                                    className={`absolute inset-0 p-2 box-border ${c.id === outputCmd?.id ? 'block' : 'hidden'}`}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
