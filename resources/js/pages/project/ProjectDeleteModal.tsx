import { type ReactNode } from 'react'
import { color } from '@/tokens'
import type { Project } from '@/types/type'
import Modal from '@/components/ui/Modal'
import useProjects from '@/hooks/useProjects'

// Trigger-based delete confirmation. Delegates to useProjects' handleProjectDeleted
// so the deleted project's terminal sessions are torn down and useProjects' own
// query (which feeds the sidebar) is invalidated, dropping it immediately.

export function ProjectDeleteModal({
    project, trigger, onOpenChange,
}: {
    project: Project
    trigger: ReactNode
    onOpenChange?: (open: boolean) => void
}) {
    const { handleProjectDeleted, deleting } = useProjects()

    return (
        <Modal trigger={trigger} ariaLabel="Delete project" onOpenChange={onOpenChange}>
            {close => (
                <>
                    <h2 style={{ margin: 0, color: color.textPrimary, fontSize: '15px', fontWeight: 600 }}>Delete Project</h2>
                    <p style={{ margin: 0, color: color.textSecondary, fontSize: '13px', lineHeight: 1.5 }}>
                        Remove{' '}
                        <span style={{ color: color.textPrimary, fontFamily: '"JetBrains Mono", monospace', fontSize: '12px' }}>{project.name}</span>
                        {' '}from Keera? This only removes it from the app — files on disk are not deleted.
                    </p>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                        <button
                            type="button" onClick={close}
                            style={{ background: 'transparent', border: `1px solid ${color.stroke}`, borderRadius: '6px', color: color.textSecondary, fontSize: '12px', padding: '6px 14px', cursor: 'pointer' }}
                        >Cancel</button>
                        <button
                            type="button" disabled={deleting}
                            onClick={async () => { try { await handleProjectDeleted(project.id); close() } catch { /* keep the modal open on failure */ } }}
                            style={{ background: '#da3633', border: `1px solid ${color.danger}`, borderRadius: '6px', color: '#fff', fontSize: '12px', padding: '6px 14px', cursor: deleting ? 'default' : 'pointer', opacity: deleting ? 0.7 : 1 }}
                        >{deleting ? 'Deleting…' : 'Delete'}</button>
                    </div>
                </>
            )}
        </Modal>
    )
}
