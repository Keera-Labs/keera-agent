import { useState } from 'react'
import { color } from '@/tokens'
import type { Project, Workspace } from '@/types/type'
import { labelStyle, inputStyle, cancelBtnStyle, submitBtnStyle } from '@/components/ui/styles'

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

    const selectStyle: React.CSSProperties = {
        ...inputStyle, width: '100%', boxSizing: 'border-box' as const, cursor: 'pointer',
    }

    return (
        <div style={{
            position: 'fixed', inset: 0, background: color.overlay,
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
            <div style={{
                background: color.bgModal, border: `1px solid ${color.borderMuted}`, borderRadius: '8px',
                padding: '24px', width: '420px', display: 'flex', flexDirection: 'column', gap: '16px',
            }}>
                <h2 style={{ margin: 0, color: color.textPrimary, fontSize: '15px', fontWeight: 600 }}>New Task</h2>

                {error && <span style={{ color: color.danger, fontSize: '12px' }}>{error}</span>}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {/* Workspace + Project row */}
                    <div style={{ display: 'flex', gap: '8px' }}>
                        {workspaces.length > 0 && (
                            <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                                <span style={labelStyle}>Workspace</span>
                                <select
                                    value={selectedWorkspaceId ?? ''}
                                    onChange={e => handleWorkspaceChange(e.target.value === '' ? null : parseInt(e.target.value, 10))}
                                    style={selectStyle}
                                >
                                    <option value="">All</option>
                                    {workspaces.map(w => (
                                        <option key={w.id} value={w.id}>{w.name}</option>
                                    ))}
                                </select>
                            </label>
                        )}
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                            <span style={labelStyle}>Project <span style={{ color: color.danger }}>*</span></span>
                            <select
                                value={selectedProjectId ?? ''}
                                onChange={e => handleProjectChange(parseInt(e.target.value, 10))}
                                style={selectStyle}
                            >
                                <option value="" disabled>Select project</option>
                                {visibleProjects.map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                        </label>
                    </div>

                    {/* Title */}
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={labelStyle}>Title <span style={{ color: color.danger }}>*</span></span>
                        <input
                            autoFocus
                            value={title}
                            onChange={e => { setTitle(e.target.value); setError('') }}
                            placeholder="Task title"
                            style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
                        />
                    </label>

                    {/* Description / body */}
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={labelStyle}>Description</span>
                        <textarea
                            value={body}
                            onChange={e => setBody(e.target.value)}
                            placeholder="Optional details…"
                            rows={3}
                            style={{
                                ...inputStyle, width: '100%', boxSizing: 'border-box',
                                resize: 'vertical', lineHeight: 1.5,
                            }}
                        />
                    </label>

                    {/* Assignees */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <span style={labelStyle}>Assignees</span>
                        {assignees.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                {assignees.map(a => (
                                    <span key={a} style={{
                                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                                        background: color.accentSubtle, border: `1px solid ${color.accentEmphasis}`,
                                        borderRadius: '12px', padding: '2px 8px',
                                        color: color.accentMuted, fontSize: '11px',
                                    }}>
                                        {a}
                                        <button
                                            type="button"
                                            onClick={() => removeAssignee(a)}
                                            style={{
                                                background: 'transparent', border: 'none',
                                                color: color.accentMuted, cursor: 'pointer', padding: 0,
                                                lineHeight: 1, fontSize: '13px',
                                            }}
                                        >×</button>
                                    </span>
                                ))}
                            </div>
                        )}
                        <div style={{ display: 'flex', gap: '6px' }}>
                            <input
                                value={assigneeInput}
                                onChange={e => setAssigneeInput(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') { e.preventDefault(); addAssignee() }
                                }}
                                placeholder="Add name and press Enter"
                                style={{ ...inputStyle, flex: 1, boxSizing: 'border-box' }}
                            />
                            <button
                                type="button"
                                onClick={addAssignee}
                                style={{
                                    background: 'transparent', border: `1px solid ${color.borderMuted}`,
                                    borderRadius: '6px', color: color.textMuted, fontSize: '12px',
                                    padding: '6px 10px', cursor: 'pointer',
                                }}
                            >Add</button>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', paddingTop: '4px' }}>
                        <button type="button" onClick={onClose} style={cancelBtnStyle}>Cancel</button>
                        <button type="submit" style={submitBtnStyle}>Create Task</button>
                    </div>
                </form>
            </div>
        </div>
    )
}
