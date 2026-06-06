import { useState } from 'react'
import { color } from '@/tokens'
import type { Project, Workspace } from '@/types/type'
import { cancelBtnStyle } from '@/components/ui/styles'

export function MoveProjectModal({
    project,
    workspaces,
    onClose,
    onMove,
}: {
    project: Project
    workspaces: Workspace[]
    onClose: () => void
    onMove: (project: Project, workspaceId: number | null) => Promise<void>
}) {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    async function handleSelect(workspaceId: number | null) {
        if (workspaceId === project.workspace_id) { onClose(); return }
        setLoading(true)
        setError('')
        try {
            await onMove(project, workspaceId)
            onClose()
        } catch {
            setError('Failed to move project')
            setLoading(false)
        }
    }

    return (
        <div style={{
            position: 'fixed', inset: 0, background: color.overlay,
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
            <div style={{
                background: color.bgModal, border: `1px solid ${color.borderMuted}`, borderRadius: '8px',
                padding: '20px', width: '300px', display: 'flex', flexDirection: 'column', gap: '12px',
            }}>
                <h2 style={{ margin: 0, color: color.textPrimary, fontSize: '14px', fontWeight: 600 }}>
                    Move{' '}
                    <span style={{ fontFamily: '"JetBrains Mono", monospace', color: color.accent }}>
                        {project.name}
                    </span>
                </h2>
                {error && <span style={{ color: color.danger, fontSize: '12px' }}>{error}</span>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <button
                        onClick={() => handleSelect(null)}
                        disabled={loading}
                        style={{
                            textAlign: 'left', padding: '8px 12px', borderRadius: '6px',
                            background: 'transparent',
                            border: `1px solid ${project.workspace_id === null ? color.accent : color.borderMuted}`,
                            color: project.workspace_id === null ? color.accent : color.textSecondary,
                            fontSize: '13px', cursor: loading ? 'default' : 'pointer',
                            display: 'flex', alignItems: 'center', gap: '8px',
                        }}
                    >
                        <span style={{ color: color.textFaint }}>—</span> Unassigned
                        {project.workspace_id === null && (
                            <span style={{ marginLeft: 'auto', color: color.textFaint, fontSize: '11px' }}>current</span>
                        )}
                    </button>
                    {workspaces.map(w => (
                        <button
                            key={w.id}
                            onClick={() => handleSelect(w.id)}
                            disabled={loading}
                            style={{
                                textAlign: 'left', padding: '8px 12px', borderRadius: '6px',
                                background: 'transparent',
                                border: `1px solid ${w.id === project.workspace_id ? color.accent : color.borderMuted}`,
                                color: w.id === project.workspace_id ? color.accent : color.textSecondary,
                                fontSize: '13px', cursor: loading ? 'default' : 'pointer',
                                display: 'flex', alignItems: 'center',
                            }}
                        >
                            {w.name}
                            {w.id === project.workspace_id && (
                                <span style={{ marginLeft: 'auto', color: color.textFaint, fontSize: '11px' }}>current</span>
                            )}
                        </button>
                    ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button onClick={onClose} disabled={loading} style={cancelBtnStyle}>Cancel</button>
                </div>
            </div>
        </div>
    )
}
