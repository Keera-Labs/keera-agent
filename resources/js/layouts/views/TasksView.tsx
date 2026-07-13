import { useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { color } from '@/tokens'
import type { Task } from '@/types/type'
import { STATUS_CYCLE, STATUS_COLORS, STATUS_LABELS } from '@/types/task'
import { PriorityBadge } from '@/components/ui/PriorityBadge'

// ─── Planning section (collapsible list inside a task card) ───────────────────

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
                <ChevronDown
                    size={8} color={dotColor}
                    style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}
                />
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

export function TasksView({
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
                                                <X size={12}/>
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
