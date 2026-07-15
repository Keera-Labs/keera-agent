import { type ReactNode } from 'react'
import type { Project } from '@/types/type'
import Modal from '@/components/ui/Modal'
import useProjects from '@/queries/projectsQuery'

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
                    <h2 className="m-0 text-zinc-900 text-[15px] font-semibold">Delete Project</h2>
                    <p className="m-0 text-zinc-700 text-[13px] leading-normal">
                        Remove{' '}
                        <span className="text-zinc-900 font-mono text-[12px]">{project.name}</span>
                        {' '}from Keera? This only removes it from the app — files on disk are not deleted.
                    </p>
                    <div className="flex gap-2 justify-end">
                        <button
                            type="button" onClick={close}
                            className="bg-transparent border border-stroke rounded text-zinc-700 text-[12px] py-1.5 px-3.5 cursor-pointer"
                        >Cancel</button>
                        <button
                            type="button" disabled={deleting}
                            onClick={async () => { try { await handleProjectDeleted(project.id); close() } catch { /* keep the modal open on failure */ } }}
                            className={`bg-[#da3633] border border-danger rounded text-white text-[12px] py-1.5 px-3.5 ${deleting ? 'cursor-default opacity-70' : 'cursor-pointer opacity-100'}`}
                        >{deleting ? 'Deleting…' : 'Delete'}</button>
                    </div>
                </>
            )}
        </Modal>
    )
}
