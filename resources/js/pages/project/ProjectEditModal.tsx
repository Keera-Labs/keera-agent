import { useState, type ReactNode } from 'react'
import type { Project } from '@/types/type'
import Modal from '@/components/ui/Modal'
import useProjects from '@/queries/projectsQuery'
import { ProjectTemplatesModal } from '@/components/modals/ProjectTemplatesModal'

const inputClass = 'bg-canvas border border-stroke rounded text-zinc-900 text-[13px] py-[7px] px-2.5 outline-none w-full box-border font-mono'
const labelClass = 'text-zinc-700 text-[11px] uppercase tracking-[0.05em]'
const cancelClass = 'bg-transparent border border-stroke rounded text-zinc-700 text-[12px] py-1.5 px-3.5 cursor-pointer'

function EditProjectForm({
    project, onUpdated, close,
}: {
    project: Project
    onUpdated: (p: Project) => void
    close: () => void
}) {
    const [path, setPath] = useState(project.path)
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)
    const [error, setError] = useState('')
    const [showTemplates, setShowTemplates] = useState(false)

    async function save(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true); setError('')
        try {
            const res = await fetch(`/api/projects/${project.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: path.trim() }),
            })
            if (!res.ok) { setError('Something went wrong'); return }
            onUpdated(await res.json())
            setSaved(true)
            setTimeout(close, 1000)
        } catch { setError('Network error') } finally { setSaving(false) }
    }

    return (
        <form onSubmit={save} className="flex flex-col gap-[18px]">
            <div>
                <h2 className="m-0 text-zinc-900 text-[15px] font-bold">Edit project</h2>
                <p className="mt-[3px] mx-0 mb-0 text-accent text-[12px] font-mono">
                    {project.name}
                </p>
            </div>

            {error && <span className="text-danger text-[12px]">{error}</span>}

            <label className="flex flex-col gap-1.5">
                <span className={labelClass}>Path</span>
                <span className="text-zinc-500 text-[12px] leading-normal">
                    Local filesystem path. Claude Code will run from this directory.
                </span>
                <input value={path} onChange={e => setPath(e.target.value)} placeholder="~/code/my-project" required className={inputClass} />
            </label>

            <div className="flex flex-col gap-2 border-t border-stroke pt-4">
                <span className={labelClass}>Agent templates</span>
                <span className="text-zinc-500 text-[12px] leading-normal">
                    Customise templates for this project. Edits are copy-on-write — they create project overrides and never change the global defaults.
                </span>
                <button type="button" onClick={() => setShowTemplates(true)} className={`${cancelClass} self-start`}>
                    Manage agent templates
                </button>
            </div>

            <div className="flex gap-2 justify-end">
                <button type="button" onClick={close} className={cancelClass}>Cancel</button>
                <button
                    type="submit" disabled={saving}
                    className={`${saved ? 'bg-success' : 'bg-accent'} border-0 rounded text-white text-[12px] font-semibold py-1.5 px-3.5 ${saving ? 'cursor-default opacity-70' : 'cursor-pointer opacity-100'}`}
                >
                    {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save'}
                </button>
            </div>

            {showTemplates && (
                <ProjectTemplatesModal projectId={project.id} projectName={project.name} onClose={() => setShowTemplates(false)} />
            )}
        </form>
    )
}

export function ProjectEditModal({
    project, trigger, onOpenChange,
}: {
    project: Project
    trigger: ReactNode
    onOpenChange?: (open: boolean) => void
}) {
    const { handleProjectUpdated } = useProjects()
    return (
        <Modal
            trigger={trigger}
            ariaLabel="Edit project"
            onOpenChange={onOpenChange}
            panelClassName="bg-modal border border-stroke rounded-lg p-6 w-[480px] flex flex-col"
        >
            {close => <EditProjectForm project={project} onUpdated={handleProjectUpdated} close={close} />}
        </Modal>
    )
}
