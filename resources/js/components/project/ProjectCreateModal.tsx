import { useState, type ReactNode } from 'react'
import type { Workspace, Project } from '@/types/type'
import Modal from '@/components/ui/Modal'

const LANGUAGES = ['Python', 'TypeScript', 'JavaScript', 'Go', 'Rust', 'Other']

const inputCls = 'bg-canvas border border-stroke rounded-md text-zinc-900 placeholder:text-zinc-500 text-[13px] px-2.5 py-1.5 font-mono outline-none w-full'
const labelSpanCls = 'text-zinc-600 text-[11px] uppercase tracking-[0.05em]'
const cancelCls = 'bg-transparent border border-stroke rounded-md text-zinc-700 text-xs px-3.5 py-1.5 cursor-pointer disabled:opacity-50'
const submitCls = 'bg-success border border-success rounded-md text-white text-xs px-3.5 py-1.5 cursor-pointer disabled:opacity-50'

const ERROR_MAP: Record<string, string> = {
    path_not_found: 'Path does not exist on disk.',
}

function friendlyError(code: string): string {
    return ERROR_MAP[code] ?? code ?? 'Something went wrong.'
}

export default function ProjectCreateModal({
    trigger,
    workspaces,
    defaultWorkspaceId,
    onCreated,
}: {
    trigger: ReactNode
    workspaces: Workspace[]
    defaultWorkspaceId: number | null
    onCreated: (p: Project) => void
}) {
    const [name, setName] = useState('')
    const [path, setPath] = useState('')
    const [language, setLanguage] = useState('Python')
    const [workspaceId, setWorkspaceId] = useState<number | null>(
        defaultWorkspaceId ?? workspaces[0]?.id ?? null,
    )
    const [processing, setProcessing] = useState(false)
    const [error, setError] = useState('')
    const [confirmCreate, setConfirmCreate] = useState<{ expanded: string } | null>(null)

    // Fresh form each time the modal opens (it stays mounted between opens).
    function resetForm() {
        setName('')
        setPath('')
        setLanguage('Python')
        setWorkspaceId(defaultWorkspaceId ?? workspaces[0]?.id ?? null)
        setProcessing(false)
        setError('')
        setConfirmCreate(null)
    }

    async function submit(close: () => void, createDir = false) {
        setError('')
        setProcessing(true)
        try {
            const res = await fetch('/api/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    path,
                    language,
                    workspace_id: workspaceId,
                    create_dir: createDir,
                }),
            })
            const json = await res.json() as Record<string, unknown>
            if (res.ok) {
                onCreated(json as unknown as Project)
                close()
                return
            }
            const code = (json.error ?? json.detail ?? '') as string
            if (code === 'path_not_found' && !createDir) {
                setConfirmCreate({ expanded: (json.expanded as string | undefined) ?? path })
                return
            }
            setConfirmCreate(null)
            setError(friendlyError(code))
        } catch (_e) {
            setError('Network error. Please try again.')
        } finally {
            setProcessing(false)
        }
    }

    return (
        <Modal
            trigger={trigger}
            ariaLabel="Add project"
            onOpenChange={open => { if (open) resetForm() }}
        >
            {close => (
                confirmCreate ? (
                    <>
                        <h2 className="m-0 text-zinc-900 text-[15px] font-semibold">Directory not found</h2>
                        <p className="m-0 text-zinc-700 text-[13px] leading-relaxed">
                            <span className="text-zinc-900 font-mono text-xs">{confirmCreate.expanded}</span>
                            {' '}does not exist. Create it?
                        </p>
                        {error && <span className="text-danger text-xs">{error}</span>}
                        <div className="flex gap-2 justify-end">
                            <button type="button" onClick={() => setConfirmCreate(null)} className={cancelCls}>Back</button>
                            <button type="button" disabled={processing} onClick={() => submit(close, true)} className={submitCls}>
                                {processing ? 'Creating…' : 'Create & Add'}
                            </button>
                        </div>
                    </>
                ) : (
                    <form onSubmit={e => { e.preventDefault(); void submit(close) }} className="flex flex-col gap-3.5">
                        <h2 className="m-0 text-zinc-900 text-[15px] font-semibold">New Project</h2>
                        {error && <span className="text-danger text-xs">{error}</span>}
                        <label className="flex flex-col gap-1">
                            <span className={labelSpanCls}>Workspace</span>
                            <select
                                value={workspaceId ?? ''}
                                onChange={e => setWorkspaceId(e.target.value ? Number(e.target.value) : null)}
                                className={inputCls}
                            >
                                <option value="">— No workspace —</option>
                                {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                            </select>
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className={labelSpanCls}>Name</span>
                            <input
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="my-project"
                                required
                                className={inputCls}
                            />
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className={labelSpanCls}>Path</span>
                            <input
                                value={path}
                                onChange={e => setPath(e.target.value)}
                                placeholder="~/code/my-project"
                                required
                                className={inputCls}
                            />
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className={labelSpanCls}>Language</span>
                            <select value={language} onChange={e => setLanguage(e.target.value)} className={inputCls}>
                                {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                            </select>
                        </label>
                        <div className="flex gap-2 justify-end">
                            <button type="button" onClick={close} className={cancelCls}>Cancel</button>
                            <button type="submit" disabled={processing} className={submitCls}>
                                {processing ? 'Checking…' : 'Add Project'}
                            </button>
                        </div>
                    </form>
                )
            )}
        </Modal>
    )
}
