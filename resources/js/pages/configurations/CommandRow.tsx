import { useState } from 'react'
import { Pencil, Play, Square, X } from 'lucide-react'
import { inputClass, cancelBtnClass, submitBtnClass } from '@/components/ui/styles'
import type { Command } from './types'

// A single command in the list. Owns its own inline-edit state; all process and
// persistence actions are delegated to the parent panel.
export function CommandRow({
    command,
    isSelected,
    onSelect,
    onRun,
    onStop,
    onDelete,
    onUpdate,
}: {
    command: Command
    isSelected: boolean
    onSelect: () => void
    onRun: () => void
    onStop: () => void
    onDelete: () => void
    onUpdate: (label: string, cmd: string) => Promise<boolean>
}) {
    const isRunning = command.status === 'running'
    const [editing, setEditing] = useState(false)
    const [editLabel, setEditLabel] = useState(command.label)
    const [editCmd, setEditCmd] = useState(command.command)
    const [saving, setSaving] = useState(false)

    function startEditing() {
        setEditLabel(command.label)
        setEditCmd(command.command)
        setEditing(true)
    }

    async function handleSave(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        const ok = await onUpdate(editLabel.trim(), editCmd.trim())
        setSaving(false)
        if (ok) setEditing(false)
    }

    if (editing) {
        return (
            <form
                onSubmit={handleSave}
                className="flex flex-col gap-2 py-2.5 px-3.5 bg-surface border-l-2 border-l-accent border-b border-b-stroke"
            >
                <input
                    autoFocus
                    value={editLabel}
                    onChange={e => setEditLabel(e.target.value)}
                    placeholder="Label"
                    required
                    className={`${inputClass} box-border w-full`}
                />
                <input
                    value={editCmd}
                    onChange={e => setEditCmd(e.target.value)}
                    placeholder="Shell command"
                    required
                    className={`${inputClass} box-border w-full font-mono`}
                />
                <div className="flex gap-1.5 justify-end">
                    <button type="button" onClick={() => setEditing(false)} className={cancelBtnClass}>Cancel</button>
                    <button type="submit" disabled={saving} className={submitBtnClass}>
                        {saving ? 'Saving…' : 'Save'}
                    </button>
                </div>
            </form>
        )
    }

    return (
        <div
            onClick={onSelect}
            className={`flex items-center gap-2.5 py-2.5 px-3.5 cursor-pointer border-l-2 border-b border-b-stroke transition-colors duration-100 hover:bg-surface ${isSelected ? 'bg-surface border-l-accent' : 'bg-transparent border-l-transparent'}`}
        >
            {/* Play/Stop circle */}
            <button
                onClick={e => { e.stopPropagation(); isRunning ? onStop() : onRun() }}
                title={isRunning ? 'Stop' : 'Run'}
                className={`w-[30px] h-[30px] rounded-full shrink-0 border flex items-center justify-center cursor-pointer transition-all duration-150 ${
                    isRunning
                        ? 'bg-[rgba(63,185,80,0.1)] border-[rgba(63,185,80,0.4)] text-success hover:border-danger hover:text-danger hover:bg-red-50'
                        : 'bg-canvas border-stroke text-zinc-500 hover:border-success hover:text-success hover:bg-[rgba(63,185,80,0.1)]'
                }`}
            >
                {isRunning ? (
                    <Square size={9} fill="currentColor" />
                ) : (
                    <Play size={9} fill="currentColor" />
                )}
            </button>

            {/* Label and command */}
            <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-zinc-900 font-mono truncate">
                    /{command.label}
                </div>
                <div className="text-[10px] text-zinc-400 font-mono truncate mt-0.5">
                    {command.command}
                </div>
            </div>

            {/* Running pill */}
            {isRunning && (
                <span
                    className="text-[10px] py-px px-1.5 rounded-md bg-[rgba(63,185,80,0.08)] border border-[rgba(63,185,80,0.25)] text-success font-mono shrink-0"
                    style={{ animation: 'cmd-pulse 2s infinite' }}
                >
                    {command.pid ? `pid ${command.pid}` : 'running'}
                </span>
            )}

            {/* Edit */}
            <button
                onClick={e => { e.stopPropagation(); startEditing() }}
                title="Edit"
                className="shrink-0 bg-transparent border-none text-zinc-400 cursor-pointer py-[3px] px-1 rounded-sm flex items-center hover:text-accent hover:bg-canvas"
            >
                <Pencil size={11} />
            </button>

            {/* Delete */}
            <button
                onClick={e => { e.stopPropagation(); onDelete() }}
                title="Delete"
                className="shrink-0 bg-transparent border-none text-zinc-400 cursor-pointer py-[3px] px-1 leading-none rounded-sm flex items-center hover:text-danger hover:bg-red-50"
            ><X size={11} /></button>
        </div>
    )
}
