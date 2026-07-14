import { useEffect } from 'react'
import { color } from '@/tokens'
import type { Task } from '@/types/type'
import { STATUS_COLORS, STATUS_LABELS } from '@/types/task'
import { labelClass } from '@/components/ui/styles'

function PriorityBadge({ priority }: { priority: string }) {
    const PRIORITY_STYLES: Record<string, { bg: string; color: string; border: string }> = {
        low:    { bg: color.bgSurface, color: color.textMuted, border: color.borderMuted },
        medium: { bg: color.priorityMediumBg, color: color.warning, border: color.warningSubtle },
        high:   { bg: color.dangerCanvas, color: color.danger, border: color.dangerSubtle },
    }
    const s = PRIORITY_STYLES[priority] ?? PRIORITY_STYLES.medium
    return (
        <span
            className="text-[10px] font-semibold tracking-[0.04em] py-px px-1.5 rounded-lg uppercase shrink-0"
            style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.color }}
        >
            {priority}
        </span>
    )
}

export function TaskDetailModal({ task, onClose }: { task: Task; onClose: () => void }) {
    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') onClose()
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    }, [onClose])

    const statusColor = STATUS_COLORS[task.status]

    return (
        <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]"
            onClick={onClose}
        >
            <div
                className="bg-modal border border-stroke rounded-md w-[540px] max-h-[80vh] flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="py-4 px-5 border-b border-stroke flex items-start gap-2.5 shrink-0">
                    <div className="flex-1 min-w-0">
                        <div className="text-[15px] font-semibold text-zinc-900 leading-[1.4] break-words">
                            {task.title}
                        </div>
                        <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                            <span
                                className="text-[10px] font-semibold py-0.5 px-2 rounded-lg uppercase tracking-[0.05em]"
                                style={{
                                    background: `${statusColor}20`, border: `1px solid ${statusColor}40`,
                                    color: statusColor,
                                }}
                            >
                                {STATUS_LABELS[task.status]}
                            </span>
                            <PriorityBadge priority={task.priority} />
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="shrink-0 bg-transparent border-none text-zinc-400 cursor-pointer p-0.5 text-[20px] leading-none hover:text-zinc-900"
                    >
                        ×
                    </button>
                </div>

                {/* Scrollable body */}
                <div className="flex-1 overflow-y-auto py-4 px-5 flex flex-col gap-4">
                    {/* Description */}
                    {task.body ? (
                        <div>
                            <div className={`${labelClass} mb-1.5`}>Description</div>
                            <div className="text-[13px] text-zinc-500 leading-[1.6] whitespace-pre-wrap break-words">
                                {task.body}
                            </div>
                        </div>
                    ) : (
                        <div className="text-[12px] text-zinc-400 italic">No description</div>
                    )}

                    {/* Assignees */}
                    {task.assignees.length > 0 && (
                        <div>
                            <div className={`${labelClass} mb-1.5`}>Assignees</div>
                            <div className="flex flex-wrap gap-1.5">
                                {task.assignees.map(a => (
                                    <span key={a} className="bg-blue-50 border border-blue-600 rounded-lg py-0.5 px-2 text-blue-600 text-[11px]">{a}</span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Acceptance criteria */}
                    {task.acceptance_criteria.length > 0 && (
                        <div>
                            <div className={`${labelClass} mb-1.5`} style={{ color: color.success }}>Acceptance Criteria</div>
                            <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
                                {task.acceptance_criteria.map((c, i) => (
                                    <li key={i} className="flex gap-2 text-[12px] text-zinc-500 leading-normal">
                                        <span className="text-success shrink-0">✓</span>
                                        <span>{c}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Testing methods */}
                    {task.testing_methods.length > 0 && (
                        <div>
                            <div className={`${labelClass} mb-1.5`} style={{ color: color.accent }}>Testing Methods</div>
                            <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
                                {task.testing_methods.map((m, i) => (
                                    <li key={i} className="flex gap-2 text-[12px] text-zinc-500 leading-normal">
                                        <span className="text-accent shrink-0">⬡</span>
                                        <span>{m}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Validation steps */}
                    {task.validation_steps.length > 0 && (
                        <div>
                            <div className={`${labelClass} mb-1.5`} style={{ color: color.warning }}>Validation Steps</div>
                            <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
                                {task.validation_steps.map((s, i) => (
                                    <li key={i} className="flex gap-2 text-[12px] text-zinc-500 leading-normal">
                                        <span className="text-warning shrink-0">◎</span>
                                        <span>{s}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
