import { useState } from 'react'
import { useForm } from '@inertiajs/react'
import type { Project } from '@/types/type'

const inputCls = 'bg-bg-base border border-border-muted rounded-md text-text-primary text-[13px] px-2.5 py-1.5 font-mono outline-none w-full'
const labelSpanCls = 'text-text-muted text-[11px] uppercase tracking-[0.05em]'
const cancelCls = 'bg-transparent border border-border-muted rounded-md text-text-muted text-xs px-3.5 py-1.5 cursor-pointer disabled:opacity-50'
const submitCls = 'bg-success-emphasis border border-success-border rounded-md text-white text-xs px-3.5 py-1.5 cursor-pointer disabled:opacity-50'

export default function ProjectPathEditModal({
    project,
    onClose,
    onUpdated,
}: {
    project: Project
    onClose: () => void
    onUpdated: (p: Project) => void
}) {
    const form = useForm({ path: project.path })
    const [error, setError] = useState('')

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError('')
        form.transform(data => ({ ...data, path: data.path.trim() }))
        form.patch(`/api/projects/${project.id}`, {
            onSuccess: (page: { props: Record<string, unknown> }) => {
                onUpdated(page.props.updated_project as Project)
                onClose()
            },
            onError: (errors: Record<string, string>) => {
                setError(errors._ ?? 'Something went wrong')
            },
        })
    }

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100]">
            <div className="bg-bg-surface border border-border-muted rounded-lg p-6 w-[340px] flex flex-col gap-3.5">
                <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
                    <h2 className="m-0 text-text-primary text-[15px] font-semibold">
                        Change Directory —{' '}
                        <span className="font-mono text-accent">{project.name}</span>
                    </h2>
                    {error && <span className="text-danger text-xs">{error}</span>}
                    <label className="flex flex-col gap-1">
                        <span className={labelSpanCls}>Path</span>
                        <input value={form.data.path} onChange={e => form.setData('path', e.target.value)} placeholder="~/code/my-project" required className={inputCls} />
                    </label>
                    <div className="flex gap-2 justify-end">
                        <button type="button" onClick={onClose} className={cancelCls}>Cancel</button>
                        <button type="submit" disabled={form.processing} className={submitCls}>
                            {form.processing ? 'Saving…' : 'Save'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}
