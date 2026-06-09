import { useEffect } from 'react'
import { color } from '@/tokens'
import type { Task } from '@/types/type'
import { STATUS_COLORS, STATUS_LABELS } from '@/types/task'
import { labelStyle } from '@/components/ui/styles'

function PriorityBadge({ priority }: { priority: string }) {
    const PRIORITY_STYLES: Record<string, { bg: string; color: string; border: string }> = {
        low:    { bg: color.bgSurface, color: color.textMuted, border: color.borderMuted },
        medium: { bg: color.priorityMediumBg, color: color.warning, border: color.warningSubtle },
        high:   { bg: color.dangerCanvas, color: color.danger, border: color.dangerSubtle },
    }
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
            style={{
                position: 'fixed', inset: 0, background: color.overlay,
                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
            }}
            onClick={onClose}
        >
            <div
                style={{
                    background: color.bgModal, border: `1px solid ${color.borderMuted}`, borderRadius: '8px',
                    width: '540px', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
                    overflow: 'hidden',
                }}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{
                    padding: '16px 20px', borderBottom: `1px solid ${color.border}`,
                    display: 'flex', alignItems: 'flex-start', gap: '10px', flexShrink: 0,
                }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '15px', fontWeight: 600, color: color.textPrimary, lineHeight: 1.4, wordBreak: 'break-word' }}>
                            {task.title}
                        </div>
                        <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{
                                fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '10px',
                                background: `${statusColor}20`, border: `1px solid ${statusColor}40`,
                                color: statusColor, textTransform: 'uppercase', letterSpacing: '0.05em',
                            }}>
                                {STATUS_LABELS[task.status]}
                            </span>
                            <PriorityBadge priority={task.priority} />
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            flexShrink: 0, background: 'transparent', border: 'none',
                            color: color.textFaint, cursor: 'pointer', padding: '2px',
                            fontSize: '20px', lineHeight: 1,
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = color.textPrimary }}
                        onMouseLeave={e => { e.currentTarget.style.color = color.textFaint }}
                    >
                        ×
                    </button>
                </div>

                {/* Scrollable body */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {/* Description */}
                    {task.body ? (
                        <div>
                            <div style={{ ...labelStyle, marginBottom: '6px' }}>Description</div>
                            <div style={{ fontSize: '13px', color: color.textMuted, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                {task.body}
                            </div>
                        </div>
                    ) : (
                        <div style={{ fontSize: '12px', color: color.textFaint, fontStyle: 'italic' }}>No description</div>
                    )}

                    {/* Assignees */}
                    {task.assignees.length > 0 && (
                        <div>
                            <div style={{ ...labelStyle, marginBottom: '6px' }}>Assignees</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                {task.assignees.map(a => (
                                    <span key={a} style={{
                                        background: color.accentSubtle, border: `1px solid ${color.accentEmphasis}`,
                                        borderRadius: '10px', padding: '2px 8px',
                                        color: color.accentMuted, fontSize: '11px',
                                    }}>{a}</span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Acceptance criteria */}
                    {task.acceptance_criteria.length > 0 && (
                        <div>
                            <div style={{ ...labelStyle, marginBottom: '6px', color: color.success }}>Acceptance Criteria</div>
                            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {task.acceptance_criteria.map((c, i) => (
                                    <li key={i} style={{ display: 'flex', gap: '8px', fontSize: '12px', color: color.textMuted, lineHeight: 1.5 }}>
                                        <span style={{ color: color.success, flexShrink: 0 }}>✓</span>
                                        <span>{c}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Testing methods */}
                    {task.testing_methods.length > 0 && (
                        <div>
                            <div style={{ ...labelStyle, marginBottom: '6px', color: color.accent }}>Testing Methods</div>
                            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {task.testing_methods.map((m, i) => (
                                    <li key={i} style={{ display: 'flex', gap: '8px', fontSize: '12px', color: color.textMuted, lineHeight: 1.5 }}>
                                        <span style={{ color: color.accent, flexShrink: 0 }}>⬡</span>
                                        <span>{m}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Validation steps */}
                    {task.validation_steps.length > 0 && (
                        <div>
                            <div style={{ ...labelStyle, marginBottom: '6px', color: color.warning }}>Validation Steps</div>
                            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {task.validation_steps.map((s, i) => (
                                    <li key={i} style={{ display: 'flex', gap: '8px', fontSize: '12px', color: color.textMuted, lineHeight: 1.5 }}>
                                        <span style={{ color: color.warning, flexShrink: 0 }}>◎</span>
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
