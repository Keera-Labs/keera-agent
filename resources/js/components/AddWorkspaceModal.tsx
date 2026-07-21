import { useState, type ReactNode } from 'react'
import Modal from '@/components/ui/Modal'
import useWorkspaces from '@/queries/workspacesQuery'

const inputCls = 'bg-canvas border border-stroke rounded-md text-zinc-900 placeholder:text-zinc-500 text-[13px] px-2.5 py-1.5 font-mono outline-none w-full'
const labelSpanCls = 'text-zinc-600 text-[11px] uppercase tracking-[0.05em]'
const cancelCls = 'bg-transparent border border-stroke rounded-md text-zinc-700 text-xs px-3.5 py-1.5 cursor-pointer disabled:opacity-50'
const submitCls = 'bg-success border border-success rounded-md text-white text-xs px-3.5 py-1.5 cursor-pointer disabled:opacity-50'

function AddWorkspaceForm({ onCreated, close }: { onCreated: () => void; close: () => void }) {
    const { create, creating } = useWorkspaces()
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [error, setError] = useState('')

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError('')
        if (!name.trim()) { setError('Name is required'); return }
        create(
            { name: name.trim(), description: description.trim() || undefined },
            () => { onCreated(); close() },
        )
    }

    return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
            <h2 className="m-0 text-zinc-900 text-[15px] font-semibold">New Workspace</h2>
            {error && <span className="text-danger text-xs">{error}</span>}
            <label className="flex flex-col gap-1">
                <span className={labelSpanCls}>Name</span>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="my-workspace" required className={inputCls} />
            </label>
            <label className="flex flex-col gap-1">
                <span className={labelSpanCls}>Description</span>
                <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional description" className={inputCls} />
            </label>
            <div className="flex gap-2 justify-end">
                <button type="button" onClick={close} className={cancelCls}>Cancel</button>
                <button type="submit" disabled={creating} className={submitCls}>
                    {creating ? 'Creating…' : 'Create'}
                </button>
            </div>
        </form>
    )
}

export default function AddWorkspaceModal({ trigger, onCreated }: { trigger: ReactNode; onCreated: () => void }) {
    return (
        <Modal trigger={trigger} ariaLabel="New workspace">
            {close => <AddWorkspaceForm onCreated={onCreated} close={close} />}
        </Modal>
    )
}
