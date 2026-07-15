import { useState } from 'react'
import type { Workspace } from '@/types/type'
import { cancelBtnClass } from '@/components/ui/styles'

export function ConfirmDeleteWorkspaceModal({
    workspace,
    onClose,
    onDeleted,
}: {
    workspace: Workspace
    onClose: () => void
    onDeleted: (workspaceId: number) => void
}) {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    async function handleDelete() {
        setLoading(true)
        setError('')
        try {
            const res = await fetch(`/api/workspaces/${workspace.id}`, { method: 'DELETE' })
            if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                setError(data.error ?? 'Failed to delete workspace')
                return
            }
            onDeleted(workspace.id)
            onClose()
        } catch {
            setError('Network error')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]">
            <div className="bg-modal border border-stroke rounded-md p-6 w-[340px] flex flex-col gap-3.5">
                <h2 className="m-0 text-zinc-900 text-[15px] font-semibold">Delete Workspace</h2>
                <p className="m-0 text-zinc-500 text-[13px] leading-normal">
                    Delete{' '}
                    <span className="text-zinc-700 font-mono text-[12px]">{workspace.name}</span>
                    {' '}? Projects in this workspace will become unassigned.
                </p>
                {error && <span className="text-danger text-[12px]">{error}</span>}
                <div className="flex gap-2 justify-end">
                    <button type="button" onClick={onClose} disabled={loading} className={cancelBtnClass}>Cancel</button>
                    <button
                        type="button"
                        disabled={loading}
                        onClick={handleDelete}
                        className="bg-[#da3633] border border-danger rounded text-white text-[12px] py-1.5 px-3.5 cursor-pointer"
                    >
                        {loading ? 'Deleting…' : 'Delete'}
                    </button>
                </div>
            </div>
        </div>
    )
}
