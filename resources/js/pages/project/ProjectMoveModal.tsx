import { useState, type ReactNode } from 'react'
import { color } from '@/tokens'
import type { Project, Workspace } from '@/types/type'
import Modal from '@/components/ui/Modal'
import useProjects from '@/queries/useProjects'
import useWorkspaces from '@/queries/useWorkspaces'

// Trigger-based "move project to workspace" modal (see ProjectCreateModal / PR #198).

function MoveForm({
    project, workspaces, onMove, close,
}: {
    project: Project
    workspaces: Workspace[]
    onMove: (project: Project, workspaceId: number | null) => Promise<void>
    close: () => void
}) {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    async function select(workspaceId: number | null) {
        if (workspaceId === project.workspace_id) { close(); return }
        setLoading(true)
        setError('')
        try {
            await onMove(project, workspaceId)
            close()
        } catch {
            setError('Failed to move project')
            setLoading(false)
        }
    }

    const optionStyle = (selected: boolean): React.CSSProperties => ({
        textAlign: 'left', padding: '8px 12px', borderRadius: '6px', background: 'transparent',
        border: `1px solid ${selected ? color.accent : color.stroke}`,
        color: selected ? color.accent : color.textSecondary,
        fontSize: '13px', cursor: loading ? 'default' : 'pointer',
        display: 'flex', alignItems: 'center', gap: '8px',
    })

    return (
        <>
            <h2 style={{ margin: 0, color: color.textPrimary, fontSize: '14px', fontWeight: 600 }}>
                Move{' '}
                <span style={{ fontFamily: '"JetBrains Mono", monospace', color: color.accent }}>{project.name}</span>
            </h2>
            {error && <span style={{ color: color.danger, fontSize: '12px' }}>{error}</span>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <button type="button" onClick={() => select(null)} disabled={loading} style={optionStyle(project.workspace_id === null)}>
                    <span style={{ color: color.textFaint }}>—</span> Unassigned
                    {project.workspace_id === null && <span style={{ marginLeft: 'auto', color: color.textFaint, fontSize: '11px' }}>current</span>}
                </button>
                {workspaces.map(w => (
                    <button key={w.id} type="button" onClick={() => select(w.id)} disabled={loading} style={optionStyle(w.id === project.workspace_id)}>
                        {w.name}
                        {w.id === project.workspace_id && <span style={{ marginLeft: 'auto', color: color.textFaint, fontSize: '11px' }}>current</span>}
                    </button>
                ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                    type="button" onClick={close} disabled={loading}
                    style={{ background: 'transparent', border: `1px solid ${color.stroke}`, borderRadius: '6px', color: color.textSecondary, fontSize: '12px', padding: '6px 14px', cursor: 'pointer' }}
                >Cancel</button>
            </div>
        </>
    )
}

export function ProjectMoveModal({
    project, trigger, onOpenChange,
}: {
    project: Project
    trigger: ReactNode
    onOpenChange?: (open: boolean) => void
}) {
    const { workspaces } = useWorkspaces()
    const { handleMoveProject } = useProjects()
    return (
        <Modal trigger={trigger} ariaLabel="Move project" onOpenChange={onOpenChange}>
            {close => <MoveForm project={project} workspaces={workspaces} onMove={handleMoveProject} close={close} />}
        </Modal>
    )
}
