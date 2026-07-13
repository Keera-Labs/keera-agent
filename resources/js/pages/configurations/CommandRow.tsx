import { useState } from 'react'
import { color } from '@/tokens'
import { inputStyle, cancelBtnStyle, submitBtnStyle } from '@/components/ui/styles'
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
                    value={editCmd}
                    onChange={e => setEditCmd(e.target.value)}
                    placeholder="Shell command"
                    required
                    style={{
                        ...inputStyle, boxSizing: 'border-box', width: '100%',
                        fontFamily: '"JetBrains Mono", monospace',
                    }}
                />
                <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                    <button type="button" onClick={() => setEditing(false)} style={cancelBtnStyle}>Cancel</button>
                    <button type="submit" disabled={saving} style={submitBtnStyle}>
                        {saving ? 'Saving…' : 'Save'}
                    </button>
                </div>
            </form>
        )
    }

    return (
        <div
            onClick={onSelect}
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
                onClick={e => { e.stopPropagation(); isRunning ? onStop() : onRun() }}
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
                    /{command.label}
                </div>
                <div style={{
                    fontSize: '10px', color: color.textFaint,
                    fontFamily: '"JetBrains Mono", monospace',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    marginTop: '2px',
                }}>
                    {command.command}
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
                    {command.pid ? `pid ${command.pid}` : 'running'}
                </span>
            )}

            {/* Edit */}
            <button
                onClick={e => { e.stopPropagation(); startEditing() }}
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
                onClick={e => { e.stopPropagation(); onDelete() }}
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
}
