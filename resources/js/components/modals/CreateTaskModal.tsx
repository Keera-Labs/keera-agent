import { useState } from 'react'
import type { Project, Workspace } from '@/types/type'
import { labelClass, inputClass, cancelBtnClass, submitBtnClass } from '@/components/ui/styles'

const LS_TASK_PROJECT_ID = 'keera:task_project_id'
const LS_TASK_WORKSPACE_ID = 'keera:task_workspace_id'

export function CreateTaskModal({
    onClose,
    onCreated,
    projects,
    workspaces,
    defaultProjectId,
}: {
    onClose: () => void
    onCreated: (title: string, body: string, assignees: string[], projectId: number) => void
    projects: Project[]
    workspaces: Workspace[]
    defaultProjectId: number | null
}) {
    const [title, setTitle] = useState('')
    const [body, setBody] = useState('')
    const [assigneeInput, setAssigneeInput] = useState('')
    const [assignees, setAssignees] = useState<string[]>([])
    const [error, setError] = useState('')

    const initWorkspaceId = (): number | null => {
        const stored = localStorage.getItem(LS_TASK_WORKSPACE_ID)
        if (stored !== null) {
            const id = parseInt(stored, 10)
            if (workspaces.some(w => w.id === id)) return id
        }
        const proj = projects.find(p => p.id === defaultProjectId)
        return proj?.workspace_id ?? null
    }
    const initProjectId = (): number | null => {
        const stored = localStorage.getItem(LS_TASK_PROJECT_ID)
        if (stored !== null) {
            const id = parseInt(stored, 10)
            if (projects.some(p => p.id === id)) return id
        }
        return defaultProjectId
    }

    const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<number | null>(initWorkspaceId)
    const [selectedProjectId, setSelectedProjectId] = useState<number | null>(initProjectId)

    const visibleProjects = selectedWorkspaceId !== null
        ? projects.filter(p => p.workspace_id === selectedWorkspaceId)
        : projects

    function handleWorkspaceChange(id: number | null) {
        setSelectedWorkspaceId(id)
        if (id !== null) localStorage.setItem(LS_TASK_WORKSPACE_ID, String(id))
        else localStorage.removeItem(LS_TASK_WORKSPACE_ID)
        const first = id !== null ? projects.find(p => p.workspace_id === id) : projects[0]
        const newProjectId = first?.id ?? null
        setSelectedProjectId(newProjectId)
        if (newProjectId !== null) localStorage.setItem(LS_TASK_PROJECT_ID, String(newProjectId))
        else localStorage.removeItem(LS_TASK_PROJECT_ID)
    }

    function handleProjectChange(id: number) {
        setSelectedProjectId(id)
        localStorage.setItem(LS_TASK_PROJECT_ID, String(id))
    }

    function addAssignee() {
        const name = assigneeInput.trim()
        if (!name || assignees.includes(name)) return
        setAssignees(prev => [...prev, name])
        setAssigneeInput('')
    }

    function removeAssignee(name: string) {
        setAssignees(prev => prev.filter(a => a !== name))
    }

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!title.trim()) { setError('Title is required'); return }
        if (!selectedProjectId) { setError('Select a project'); return }
        onCreated(title.trim(), body.trim(), assignees, selectedProjectId)
        onClose()
    }

    const selectClass = `${inputClass} w-full box-border cursor-pointer`

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]">
            <div className="bg-modal border border-stroke rounded-md p-6 w-[420px] flex flex-col gap-4">
                <h2 className="m-0 text-zinc-900 text-[15px] font-semibold">New Task</h2>

                {error && <span className="text-danger text-[12px]">{error}</span>}

                <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
                    {/* Workspace + Project row */}
                    <div className="flex gap-2">
                        {workspaces.length > 0 && (
                            <label className="flex flex-col gap-1 flex-1">
                                <span className={labelClass}>Workspace</span>
                                <select
                                    value={selectedWorkspaceId ?? ''}
                                    onChange={e => handleWorkspaceChange(e.target.value === '' ? null : parseInt(e.target.value, 10))}
                                    className={selectClass}
                                >
                                    <option value="">All</option>
                                    {workspaces.map(w => (
                                        <option key={w.id} value={w.id}>{w.name}</option>
                                    ))}
                                </select>
                            </label>
                        )}
                        <label className="flex flex-col gap-1 flex-1">
                            <span className={labelClass}>Project <span className="text-danger">*</span></span>
                            <select
                                value={selectedProjectId ?? ''}
                                onChange={e => handleProjectChange(parseInt(e.target.value, 10))}
                                className={selectClass}
                            >
                                <option value="" disabled>Select project</option>
                                {visibleProjects.map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                        </label>
                    </div>

                    {/* Title */}
                    <label className="flex flex-col gap-1">
                        <span className={labelClass}>Title <span className="text-danger">*</span></span>
                        <input
                            autoFocus
                            value={title}
                            onChange={e => { setTitle(e.target.value); setError('') }}
                            placeholder="Task title"
                            className={`${inputClass} w-full box-border`}
                        />
                    </label>

                    {/* Description / body */}
                    <label className="flex flex-col gap-1">
                        <span className={labelClass}>Description</span>
                        <textarea
                            value={body}
                            onChange={e => setBody(e.target.value)}
                            placeholder="Optional details…"
                            rows={3}
                            className={`${inputClass} w-full box-border resize-y leading-normal`}
                        />
                    </label>

                    {/* Assignees */}
                    <div className="flex flex-col gap-1.5">
                        <span className={labelClass}>Assignees</span>
                        {assignees.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                                {assignees.map(a => (
                                    <span key={a} className="inline-flex items-center gap-1 bg-blue-50 border border-blue-600 rounded-xl py-0.5 px-2 text-blue-600 text-[11px]">
                                        {a}
                                        <button
                                            type="button"
                                            onClick={() => removeAssignee(a)}
                                            className="bg-transparent border-none text-blue-600 cursor-pointer p-0 leading-none text-[13px]"
                                        >×</button>
                                    </span>
                                ))}
                            </div>
                        )}
                        <div className="flex gap-1.5">
                            <input
                                value={assigneeInput}
                                onChange={e => setAssigneeInput(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') { e.preventDefault(); addAssignee() }
                                }}
                                placeholder="Add name and press Enter"
                                className={`${inputClass} flex-1 box-border`}
                            />
                            <button
                                type="button"
                                onClick={addAssignee}
                                className="bg-transparent border border-stroke rounded text-zinc-500 text-[12px] py-1.5 px-2.5 cursor-pointer"
                            >Add</button>
                        </div>
                    </div>

                    <div className="flex gap-2 justify-end pt-1">
                        <button type="button" onClick={onClose} className={cancelBtnClass}>Cancel</button>
                        <button type="submit" className={submitBtnClass}>Create Task</button>
                    </div>
                </form>
            </div>
        </div>
    )
}
