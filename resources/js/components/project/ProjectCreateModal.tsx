import { useState } from 'react'
import { useForm } from '@inertiajs/react'
import type { Workspace, Project } from '@/types/type'

const LANGUAGES = ['Python', 'TypeScript', 'JavaScript', 'Go', 'Rust', 'Other']

const inputCls = 'bg-canvas border border-stroke rounded-md text-zinc-200 text-[13px] px-2.5 py-1.5 font-mono outline-none w-full'
const labelSpanCls = 'text-zinc-400 text-[11px] uppercase tracking-[0.05em]'
const cancelCls = 'bg-transparent border border-stroke rounded-md text-zinc-400 text-xs px-3.5 py-1.5 cursor-pointer disabled:opacity-50'
const submitCls = 'bg-success-emphasis border border-success-border rounded-md text-white text-xs px-3.5 py-1.5 cursor-pointer disabled:opacity-50'

export default function ProjectCreateModal({
    workspaces,
    defaultWorkspaceId,
    onClose,
    onCreated,
}: {
    workspaces: Workspace[]
    defaultWorkspaceId: number | null
    onClose: () => void
    onCreated: (p: Project) => void
}) {
    const form = useForm({
        name: '',
        path: '',
        language: 'Python',
        workspace_id: (defaultWorkspaceId ?? workspaces[0]?.id ?? null) as number | null,
        create_dir: false,
    })
    const [error, setError] = useState('')
    const [confirmCreate, setConfirmCreate] = useState<{ expanded: string } | null>(null)

    function submit(createDir = false) {
        setError('')
        form.transform(data => ({ ...data, create_dir: createDir }))
        form.post('/api/projects', {
            onSuccess: (page: { props: Record<string, unknown> }) => {
                onCreated(page.props.new_project as Project)
                onClose()
            },
            onError: (errors: Record<string, string>) => {
                if (errors.path_not_found) {
                    setConfirmCreate({ expanded: errors.path_not_found })
                    return
                }
                setConfirmCreate(null)
                setError(errors._ ?? 'Something went wrong')
            },
        })
    }

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100]">
            <div className="bg-surface border border-stroke rounded-lg p-6 w-[340px] flex flex-col gap-3.5">
                {confirmCreate ? (
                    <>
                        <h2 className="m-0 text-zinc-200 text-[15px] font-semibold">Directory not found</h2>
                        <p className="m-0 text-zinc-400 text-[13px] leading-relaxed">
                            <span className="text-zinc-300 font-mono text-xs">{confirmCreate.expanded}</span>
                            {' '}does not exist. Create it?
                        </p>
                        {error && <span className="text-danger text-xs">{error}</span>}
                        <div className="flex gap-2 justify-end">
                            <button type="button" onClick={() => setConfirmCreate(null)} className={cancelCls}>Back</button>
                            <button type="button" disabled={form.processing} onClick={() => submit(true)} className={submitCls}>
                                {form.processing ? 'Creating…' : 'Create & Add'}
                            </button>
                        </div>
                    </>
                ) : (
                    <form onSubmit={e => { e.preventDefault(); submit() }} className="flex flex-col gap-3.5">
                        <h2 className="m-0 text-zinc-200 text-[15px] font-semibold">New Project</h2>
                        {error && <span className="text-danger text-xs">{error}</span>}
                        <label className="flex flex-col gap-1">
                            <span className={labelSpanCls}>Workspace</span>
                            <select
                                value={form.data.workspace_id ?? ''}
                                onChange={e => form.setData('workspace_id', e.target.value ? Number(e.target.value) : null)}
                                className={inputCls}
                            >
                                <option value="">— No workspace —</option>
                                {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                            </select>
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className={labelSpanCls}>Name</span>
                            <input value={form.data.name} onChange={e => form.setData('name', e.target.value)} placeholder="my-project" required className={inputCls} />
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className={labelSpanCls}>Path</span>
                            <input value={form.data.path} onChange={e => form.setData('path', e.target.value)} placeholder="~/code/my-project" required className={inputCls} />
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className={labelSpanCls}>Language</span>
                            <select value={form.data.language} onChange={e => form.setData('language', e.target.value)} className={inputCls}>
                                {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                            </select>
                        </label>
                        <div className="flex gap-2 justify-end">
                            <button type="button" onClick={onClose} className={cancelCls}>Cancel</button>
                            <button type="submit" disabled={form.processing} className={submitCls}>
                                {form.processing ? 'Checking…' : 'Add Project'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    )
}
