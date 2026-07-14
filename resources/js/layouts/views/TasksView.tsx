import { useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import type { Task } from '@/types/type'
import { STATUS_CYCLE, STATUS_COLORS, STATUS_LABELS } from '@/types/task'
import { PriorityBadge } from '@/components/ui/PriorityBadge'

// ─── Planning section (collapsible list inside a task card) ───────────────────

function PlanningSection({ label, items, color: dotColor }: { label: string; items: string[]; color: string }) {
    const [open, setOpen] = useState(false)
    return (
        <div className="mt-0.5">
            <button
                onClick={() => setOpen(o => !o)}
                className="bg-transparent border-none cursor-pointer p-0 flex items-center gap-1"
            >
                <ChevronDown
                    size={8} color={dotColor}
                    className="transition-transform duration-150"
                    style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                />
                <span className="text-[10px] font-semibold uppercase tracking-[0.05em]" style={{ color: dotColor }}>
                    {label} ({items.length})
                </span>
            </button>
            {open && (
                <ul className="mt-1 mr-0 mb-0 ml-3 p-0 list-none flex flex-col gap-0.5">
                    {items.map((item, i) => (
                        <li key={i} className="text-[11px] text-zinc-500 leading-[1.5]">
                            <span className="mr-1" style={{ color: dotColor }}>•</span>{item}
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
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="py-3 px-5 border-b border-stroke flex items-center gap-2 shrink-0">
                <span className="text-zinc-900 text-[13px] font-semibold flex-1">Tasks</span>
                <button
                    onClick={onOpenCreateTask}
                    className="bg-success border border-success rounded-[5px] text-white text-[11px] py-1 px-2.5 cursor-pointer"
                >
                    + New task
                </button>
            </div>

            {/* Kanban board */}
            <div className="flex-1 flex flex-row gap-3 p-4 overflow-x-auto overflow-y-hidden items-start">
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
                            className={`w-[240px] shrink-0 flex flex-col border border-stroke rounded-md transition-colors duration-100 max-h-full ${isOver ? 'bg-surface' : 'bg-canvas'}`}
                        >
                            {/* Column header */}
                            <div className="pt-2.5 px-3 pb-2 flex items-center gap-[7px] border-b border-stroke shrink-0">
                                <span
                                    className="w-2 h-2 rounded-full shrink-0 inline-block"
                                    style={{ background: STATUS_COLORS[status] }}
                                />
                                <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-[0.06em] flex-1">
                                    {STATUS_LABELS[status]}
                                </span>
                                <span className="text-[10px] text-zinc-400 bg-canvas rounded-lg py-px px-1.5 border border-stroke">
                                    {col.length}
                                </span>
                            </div>

                            {/* Cards */}
                            <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5">
                                {col.length === 0 && (
                                    <div className="border border-dashed border-stroke rounded py-5 px-2.5 text-center text-zinc-400 text-[11px] italic transition-colors duration-100">
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
                                        className={`bg-canvas border border-stroke hover:border-stroke rounded py-2.5 px-2.5 pb-2 cursor-pointer transition-opacity duration-100 flex flex-col gap-1.5 relative ${dragTaskId === task.id ? 'opacity-35' : 'opacity-100'}`}
                                    >
                                        {/* Title + delete */}
                                        <div className="flex items-start gap-1.5">
                                            <span className={`flex-1 text-[12px] font-medium leading-[1.4] break-words ${task.status === 'completed' || task.status === 'cancelled' ? 'text-zinc-400 line-through' : 'text-zinc-900 no-underline'}`}>
                                                {task.title}
                                            </span>
                                            <button
                                                onClick={e => { e.stopPropagation(); onDeleteTask(task) }}
                                                className="shrink-0 bg-transparent border-none cursor-pointer p-0 text-[14px] leading-none transition-opacity duration-100 opacity-0 hover:opacity-100 text-zinc-400 hover:text-danger"
                                            >
                                                <X size={12}/>
                                            </button>
                                        </div>

                                        {/* Body snippet */}
                                        {task.body && (
                                            <span className="text-[11px] text-zinc-500 leading-[1.4] break-words line-clamp-2">
                                                {task.body}
                                            </span>
                                        )}

                                        {/* Footer: priority + assignees */}
                                        <div className="flex items-center gap-1 flex-wrap">
                                            <PriorityBadge priority={task.priority} />
                                            {task.assignees.map(a => (
                                                <span key={a} className="bg-blue-50 border border-blue-600 rounded-lg py-px px-1.5 text-blue-600 text-[10px]">{a}</span>
                                            ))}
                                        </div>

                                        {/* Planning indicators */}
                                        {(task.acceptance_criteria.length > 0 || task.testing_methods.length > 0 || task.validation_steps.length > 0) && (
                                            <div className="flex gap-1 flex-wrap">
                                                {task.acceptance_criteria.length > 0 && (
                                                    <span className="text-[10px] text-success">
                                                        ✓ {task.acceptance_criteria.length} criteria
                                                    </span>
                                                )}
                                                {task.testing_methods.length > 0 && (
                                                    <span className="text-[10px] text-accent">
                                                        ⬡ {task.testing_methods.length} tests
                                                    </span>
                                                )}
                                                {task.validation_steps.length > 0 && (
                                                    <span className="text-[10px] text-amber-700">
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
                                        className={`bg-transparent border border-dashed border-stroke hover:border-stroke rounded text-zinc-400 hover:text-zinc-500 text-[11px] p-2 cursor-pointer text-center ${col.length > 0 ? 'mt-0.5' : 'mt-0'}`}
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
