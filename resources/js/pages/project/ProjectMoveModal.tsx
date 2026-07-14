import { useState, type ReactNode } from 'react'
import type { Project, Workspace } from '@/types/type'
import Modal from '@/components/ui/Modal'
import useProjects from '@/queries/projectsQuery'
import useWorkspaces from '@/queries/workspacesQuery'

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

    const optionClass = (selected: boolean): string =>
        `text-left py-2 px-3 rounded bg-transparent border ${selected ? 'border-accent text-accent' : 'border-stroke text-zinc-700'} text-[13px] ${loading ? 'cursor-default' : 'cursor-pointer'} flex items-center gap-2`

    return (
        <>
            <h2 className="m-0 text-zinc-900 text-[14px] font-semibold">
                Move{' '}
                <span className="font-mono text-accent">{project.name}</span>
            </h2>
            {error && <span className="text-danger text-[12px]">{error}</span>}
            <div className="flex flex-col gap-1.5">
                <button type="button" onClick={() => select(null)} disabled={loading} className={optionClass(project.workspace_id === null)}>
                    <span className="text-zinc-400">—</span> Unassigned
                    {project.workspace_id === null && <span className="ml-auto text-zinc-400 text-[11px]">current</span>}
                </button>
                {workspaces.map(w => (
                    <button key={w.id} type="button" onClick={() => select(w.id)} disabled={loading} className={optionClass(w.id === project.workspace_id)}>
                        {w.name}
                        {w.id === project.workspace_id && <span className="ml-auto text-zinc-400 text-[11px]">current</span>}
                    </button>
                ))}
            </div>
            <div className="flex justify-end">
                <button
                    type="button" onClick={close} disabled={loading}
                    className="bg-transparent border border-stroke rounded text-zinc-700 text-[12px] py-1.5 px-3.5 cursor-pointer"
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
