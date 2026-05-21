import { useEffect, useRef, useState } from 'react'
import { router, usePage } from '@inertiajs/react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { color } from '../tokens'

interface Workspace {
    id: number
    name: string
    description: string | null
    projects: Project[]
}

interface Project {
    id: number
    name: string
    path: string
    language: string
    workspace_id: number | null
    claude_status: 'running' | 'idle' | null
}

interface Session {
    term: Terminal
    ws: WebSocket
    fitAddon: FitAddon
    observer: ResizeObserver
}

interface Task {
    id: number
    project_id: number
    title: string
    description: string
    body: string | null
    priority: 'low' | 'medium' | 'high'
    assignees: string[]
    acceptance_criteria: string[]
    testing_methods: string[]
    validation_steps: string[]
    status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
    created_at: string
}

const STATUS_CYCLE: Task['status'][] = ['pending', 'in_progress', 'completed', 'cancelled']
const STATUS_COLORS: Record<Task['status'], string> = {
    pending:     color.textMuted,
    in_progress: color.warning,
    completed:   color.success,
    cancelled:   color.textFaint,
}
const STATUS_LABELS: Record<Task['status'], string> = {
    pending:     'To Do',
    in_progress: 'In Progress',
    completed:   'Done',
    cancelled:   'Cancelled',
}

const LANG_COLORS: Record<string, string> = {
    Python:     color.langPython,
    TypeScript: color.langTypeScript,
    Go:         color.langGo,
    Rust:       color.langRust,
    JavaScript: color.langJavaScript,
}

const LANGUAGES = ['Python', 'TypeScript', 'JavaScript', 'Go', 'Rust', 'Other']

// ─── Shared styles ────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = { color: color.textMuted, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }
const inputStyle: React.CSSProperties = {
    background: color.bgBase, border: `1px solid ${color.borderMuted}`, borderRadius: '6px',
    color: color.textPrimary, fontSize: '13px', padding: '6px 10px',
    fontFamily: '"JetBrains Mono", monospace', outline: 'none',
}
const cancelBtnStyle: React.CSSProperties = {
    background: 'transparent', border: `1px solid ${color.borderMuted}`, borderRadius: '6px',
    color: color.textMuted, fontSize: '12px', padding: '6px 14px', cursor: 'pointer',
}
const submitBtnStyle: React.CSSProperties = {
    background: color.successEmphasis, border: `1px solid ${color.successBorder}`, borderRadius: '6px',
    color: '#fff', fontSize: '12px', padding: '6px 14px', cursor: 'pointer',
}

// ─── Add Workspace Modal ──────────────────────────────────────────────────────

function AddWorkspaceModal({ onClose, onCreated }: { onClose: () => void; onCreated: (w: Workspace) => void }) {
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError('')
        setLoading(true)
        try {
            const res = await fetch('/api/workspaces', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description }),
            })
            const data = await res.json()
            if (!res.ok) { setError(data.error ?? 'Something went wrong'); return }
            onCreated(data as Workspace)
            onClose()
        } catch {
            setError('Network error')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div style={{
            position: 'fixed', inset: 0, background: color.overlay,
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
            <div style={{
                background: color.bgSurface, border: `1px solid ${color.borderMuted}`, borderRadius: '8px',
                padding: '24px', width: '340px', display: 'flex', flexDirection: 'column', gap: '14px',
            }}>
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <h2 style={{ margin: 0, color: color.textPrimary, fontSize: '15px', fontWeight: 600 }}>New Workspace</h2>
                    {error && <span style={{ color: color.danger, fontSize: '12px' }}>{error}</span>}
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={labelStyle}>Name</span>
                        <input value={name} onChange={e => setName(e.target.value)} placeholder="my-workspace" required style={inputStyle} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={labelStyle}>Description</span>
                        <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional description" style={inputStyle} />
                    </label>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                        <button type="button" onClick={onClose} style={cancelBtnStyle}>Cancel</button>
                        <button type="submit" disabled={loading} style={submitBtnStyle}>
                            {loading ? 'Creating…' : 'Create'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}

// ─── Add Project Modal ────────────────────────────────────────────────────────

function AddProjectModal({
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
    const [name, setName] = useState('')
    const [path, setPath] = useState('')
    const [language, setLanguage] = useState('Python')
    const [workspaceId, setWorkspaceId] = useState<number | null>(defaultWorkspaceId ?? workspaces[0]?.id ?? null)
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const [confirmCreate, setConfirmCreate] = useState<{ expanded: string } | null>(null)

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError('')
        setLoading(true)
        try {
            const check = await fetch(`/api/validate-path?path=${encodeURIComponent(path)}`)
            const { exists, expanded } = await check.json()
            if (!exists) { setConfirmCreate({ expanded }); return }
            await createProject()
        } catch {
            setError('Network error')
        } finally {
            setLoading(false)
        }
    }

    async function createProject() {
        setLoading(true)
        try {
            const res = await fetch('/api/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, path, language, workspace_id: workspaceId }),
            })
            const data = await res.json()
            if (!res.ok) { setConfirmCreate(null); setError(data.error ?? 'Something went wrong'); return }
            onCreated(data as Project)
            onClose()
        } catch {
            setError('Network error')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div style={{
            position: 'fixed', inset: 0, background: color.overlay,
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
            <div style={{
                background: color.bgSurface, border: `1px solid ${color.borderMuted}`, borderRadius: '8px',
                padding: '24px', width: '340px', display: 'flex', flexDirection: 'column', gap: '14px',
            }}>
                {confirmCreate ? (
                    <>
                        <h2 style={{ margin: 0, color: color.textPrimary, fontSize: '15px', fontWeight: 600 }}>Directory not found</h2>
                        <p style={{ margin: 0, color: color.textMuted, fontSize: '13px', lineHeight: 1.5 }}>
                            <span style={{ color: color.textSecondary, fontFamily: '"JetBrains Mono", monospace', fontSize: '12px' }}>{confirmCreate.expanded}</span>
                            {' '}does not exist. Create it?
                        </p>
                        {error && <span style={{ color: color.danger, fontSize: '12px' }}>{error}</span>}
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                            <button type="button" onClick={() => setConfirmCreate(null)} style={cancelBtnStyle}>Back</button>
                            <button type="button" disabled={loading} onClick={createProject} style={submitBtnStyle}>
                                {loading ? 'Creating…' : 'Create & Add'}
                            </button>
                        </div>
                    </>
                ) : (
                    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        <h2 style={{ margin: 0, color: color.textPrimary, fontSize: '15px', fontWeight: 600 }}>New Project</h2>
                        {error && <span style={{ color: color.danger, fontSize: '12px' }}>{error}</span>}
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <span style={labelStyle}>Workspace</span>
                            <select
                                value={workspaceId ?? ''}
                                onChange={e => setWorkspaceId(e.target.value ? Number(e.target.value) : null)}
                                style={inputStyle}
                            >
                                <option value="">— No workspace —</option>
                                {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                            </select>
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <span style={labelStyle}>Name</span>
                            <input value={name} onChange={e => setName(e.target.value)} placeholder="my-project" required style={inputStyle} />
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <span style={labelStyle}>Path</span>
                            <input value={path} onChange={e => setPath(e.target.value)} placeholder="~/code/my-project" required style={inputStyle} />
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <span style={labelStyle}>Language</span>
                            <select value={language} onChange={e => setLanguage(e.target.value)} style={inputStyle}>
                                {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                            </select>
                        </label>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                            <button type="button" onClick={onClose} style={cancelBtnStyle}>Cancel</button>
                            <button type="submit" disabled={loading} style={submitBtnStyle}>
                                {loading ? 'Checking…' : 'Add Project'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    )
}

// ─── Move Project Modal ───────────────────────────────────────────────────────

function MoveProjectModal({
    project,
    workspaces,
    onClose,
    onMove,
}: {
    project: Project
    workspaces: Workspace[]
    onClose: () => void
    onMove: (project: Project, workspaceId: number | null) => Promise<void>
}) {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    async function handleSelect(workspaceId: number | null) {
        if (workspaceId === project.workspace_id) { onClose(); return }
        setLoading(true)
        setError('')
        try {
            await onMove(project, workspaceId)
            onClose()
        } catch {
            setError('Failed to move project')
            setLoading(false)
        }
    }

    return (
        <div style={{
            position: 'fixed', inset: 0, background: color.overlay,
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
            <div style={{
                background: color.bgSurface, border: `1px solid ${color.borderMuted}`, borderRadius: '8px',
                padding: '20px', width: '300px', display: 'flex', flexDirection: 'column', gap: '12px',
            }}>
                <h2 style={{ margin: 0, color: color.textPrimary, fontSize: '14px', fontWeight: 600 }}>
                    Move{' '}
                    <span style={{ fontFamily: '"JetBrains Mono", monospace', color: color.accent }}>
                        {project.name}
                    </span>
                </h2>
                {error && <span style={{ color: color.danger, fontSize: '12px' }}>{error}</span>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <button
                        onClick={() => handleSelect(null)}
                        disabled={loading}
                        style={{
                            textAlign: 'left', padding: '8px 12px', borderRadius: '6px',
                            background: 'transparent',
                            border: `1px solid ${project.workspace_id === null ? color.accent : color.borderMuted}`,
                            color: project.workspace_id === null ? color.accent : color.textSecondary,
                            fontSize: '13px', cursor: loading ? 'default' : 'pointer',
                            display: 'flex', alignItems: 'center', gap: '8px',
                        }}
                    >
                        <span style={{ color: color.textFaint }}>—</span> Unassigned
                        {project.workspace_id === null && (
                            <span style={{ marginLeft: 'auto', color: color.textFaint, fontSize: '11px' }}>current</span>
                        )}
                    </button>
                    {workspaces.map(w => (
                        <button
                            key={w.id}
                            onClick={() => handleSelect(w.id)}
                            disabled={loading}
                            style={{
                                textAlign: 'left', padding: '8px 12px', borderRadius: '6px',
                                background: 'transparent',
                                border: `1px solid ${w.id === project.workspace_id ? color.accent : color.borderMuted}`,
                                color: w.id === project.workspace_id ? color.accent : color.textSecondary,
                                fontSize: '13px', cursor: loading ? 'default' : 'pointer',
                                display: 'flex', alignItems: 'center',
                            }}
                        >
                            {w.name}
                            {w.id === project.workspace_id && (
                                <span style={{ marginLeft: 'auto', color: color.textFaint, fontSize: '11px' }}>current</span>
                            )}
                        </button>
                    ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button onClick={onClose} disabled={loading} style={cancelBtnStyle}>Cancel</button>
                </div>
            </div>
        </div>
    )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function SectionHeader({ label, onAdd }: { label: string; onAdd?: () => void }) {
    return (
        <div style={{
            padding: '10px 16px 6px', display: 'flex', alignItems: 'center', gap: '6px',
        }}>
            <span style={{ color: color.textMuted, fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', flex: 1 }}>
                {label}
            </span>
            {onAdd && (
                <button onClick={onAdd} title={`Add ${label.toLowerCase()}`} style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: color.textMuted, padding: '0', lineHeight: 1, display: 'flex', alignItems: 'center',
                }}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M7.75 2a.75.75 0 01.75.75V7h4.25a.75.75 0 010 1.5H8.5v4.25a.75.75 0 01-1.5 0V8.5H2.75a.75.75 0 010-1.5H7V2.75A.75.75 0 017.75 2z"/>
                    </svg>
                </button>
            )}
        </div>
    )
}

const dotsStyle = `
@keyframes bounce1 { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-4px)} }
@keyframes bounce2 { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-4px)} }
@keyframes bounce3 { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-4px)} }
@keyframes traveler {
  0%   { left: 0px;   opacity: 0;   }
  10%  { opacity: 1;               }
  90%  { opacity: 1;               }
  100% { left: 18px;  opacity: 0;  }
}
`

function DotsIndicator() {
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', flexShrink: 0, position: 'relative' }}>
            <style>{dotsStyle}</style>
            {/* Track: 3 dim dots */}
            <span style={{ width: '3px', height: '3px', borderRadius: '50%', background: color.warningSubtle, animation: 'bounce1 1.0s ease-in-out infinite 0.0s' }} />
            <span style={{ width: '3px', height: '3px', borderRadius: '50%', background: color.warningSubtle, animation: 'bounce2 1.0s ease-in-out infinite 0.15s' }} />
            <span style={{ width: '3px', height: '3px', borderRadius: '50%', background: color.warningSubtle, animation: 'bounce3 1.0s ease-in-out infinite 0.3s' }} />
            {/* Traveling bright dot */}
            <span style={{
                position: 'absolute', top: '50%', marginTop: '-2px',
                width: '4px', height: '4px', borderRadius: '50%',
                background: color.warningBright,
                boxShadow: `0 0 5px 2px ${color.warningGlow}`,
                animation: 'traveler 1.0s linear infinite',
            }} />
        </span>
    )
}

function ProjectItem({ project, active, status, onMove }: { project: Project; active: boolean; status?: 'running' | 'done'; onMove: (p: Project) => void }) {
    const [hovered, setHovered] = useState(false)

    return (
        <div
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{ position: 'relative', display: 'flex' }}
        >
            <div
                role="button"
                tabIndex={0}
                onClick={() => router.visit(`/${project.name}`)}
                onKeyDown={e => e.key === 'Enter' && router.visit(`/${project.name}`)}
                style={{
                    flex: 1, display: 'flex', flexDirection: 'column', gap: '2px',
                    padding: '5px 28px 5px 24px', background: active ? color.bgSurface : 'transparent',
                    borderLeft: `2px solid ${active ? color.accent : 'transparent'}`,
                    cursor: 'pointer', textAlign: 'left',
                }}
            >
                <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{
                        color: active ? color.textPrimary : color.textSecondary, fontSize: '12px',
                        fontWeight: active ? 600 : 400, fontFamily: '"JetBrains Mono", monospace',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                        {project.name}
                    </span>
                    {status === 'running' && <DotsIndicator />}
                    {status === 'done' && (
                        <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: color.success, flexShrink: 0 }} />
                    )}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{
                        width: '6px', height: '6px', borderRadius: '50%',
                        background: LANG_COLORS[project.language] ?? color.textMuted, flexShrink: 0,
                    }} />
                    <span style={{ color: color.textMuted, fontSize: '11px' }}>{project.language}</span>
                </span>
            </div>
            <button
                onClick={e => { e.stopPropagation(); onMove(project) }}
                title="Move to workspace"
                style={{
                    position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: hovered ? color.textMuted : 'transparent',
                    padding: '2px 3px', lineHeight: 1, display: 'flex', alignItems: 'center',
                    transition: 'color 0.1s',
                }}
            >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M7.47 1.97a.75.75 0 011.06 0l4.5 4.5a.75.75 0 010 1.06l-4.5 4.5a.75.75 0 11-1.06-1.06L11.44 7H3a.75.75 0 010-1.5h8.44L7.47 3.03a.75.75 0 010-1.06z"/>
                </svg>
            </button>
        </div>
    )
}

function WorkspaceSection({
    workspace,
    activeId,
    onAddProject,
    onMoveProject,
    claudeStatus,
}: {
    workspace: Workspace
    activeId: number | null
    onAddProject: (workspaceId: number) => void
    onMoveProject: (project: Project) => void
    claudeStatus: Record<number, 'running' | 'done'>
}) {
    const [collapsed, setCollapsed] = useState(false)

    return (
        <div>
            {/* Workspace header */}
            <div style={{
                display: 'flex', alignItems: 'center', padding: '5px 10px 5px 16px',
                gap: '4px', cursor: 'pointer',
            }}>
                <button
                    onClick={() => setCollapsed(c => !c)}
                    style={{
                        flex: 1, display: 'flex', alignItems: 'center', gap: '5px',
                        background: 'transparent', border: 'none', cursor: 'pointer',
                        textAlign: 'left', padding: 0,
                    }}
                >
                    <svg
                        width="10" height="10" viewBox="0 0 16 16" fill={color.textMuted}
                        style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', flexShrink: 0 }}
                    >
                        <path d="M4.427 7.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 7H4.604a.25.25 0 00-.177.427z"/>
                    </svg>
                    <span style={{
                        color: color.textTertiary, fontSize: '11px', fontWeight: 600,
                        textTransform: 'uppercase', letterSpacing: '0.05em',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                        {workspace.name}
                    </span>
                </button>
                <button
                    onClick={() => onAddProject(workspace.id)}
                    title="Add project"
                    style={{
                        background: 'transparent', border: 'none', cursor: 'pointer',
                        color: color.textFaint, padding: '0 2px', lineHeight: 1,
                        display: 'flex', alignItems: 'center', flexShrink: 0,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = color.textMuted)}
                    onMouseLeave={e => (e.currentTarget.style.color = color.textFaint)}
                >
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M7.75 2a.75.75 0 01.75.75V7h4.25a.75.75 0 010 1.5H8.5v4.25a.75.75 0 01-1.5 0V8.5H2.75a.75.75 0 010-1.5H7V2.75A.75.75 0 017.75 2z"/>
                    </svg>
                </button>
            </div>

            {/* Projects list */}
            {!collapsed && (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {workspace.projects.length === 0 && (
                        <li style={{ padding: '4px 16px 4px 28px', color: color.textFaint, fontSize: '11px', fontStyle: 'italic' }}>
                            No projects
                        </li>
                    )}
                    {workspace.projects.map(project => (
                        <li key={project.id}>
                            <ProjectItem project={project} active={project.id === activeId} status={claudeStatus[project.id]} onMove={onMoveProject} />
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

function WorkspaceDropdown({
    workspaces,
    selected,
    onChange,
}: {
    workspaces: Workspace[]
    selected: number | null
    onChange: (id: number | null) => void
}) {
    if (workspaces.length === 0) return null
    return (
        <select
            value={selected ?? ''}
            onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
            style={{
                marginLeft: 'auto',
                background: color.bgBase,
                border: `1px solid ${color.borderMuted}`,
                borderRadius: '5px',
                color: selected !== null ? color.textSecondary : color.textFaint,
                fontSize: '11px',
                padding: '2px 20px 2px 6px',
                cursor: 'pointer',
                outline: 'none',
                maxWidth: '90px',
                appearance: 'none',
                WebkitAppearance: 'none',
                backgroundImage: `url("data:image/svg+xml,%3Csvg width='8' height='5' viewBox='0 0 8 5' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L4 4L7 1' stroke='%237d8590' stroke-width='1.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 5px center',
            }}
        >
            <option value="">All</option>
            {workspaces.map(w => (
                <option key={w.id} value={w.id}>{w.name}</option>
            ))}
        </select>
    )
}

function Sidebar({
    workspaces,
    unassignedProjects,
    activeId,
    onAddWorkspace,
    onAddProject,
    onMoveProject,
    tasks,
    onOpenCreateTask,
    onUpdateStatus,
    onDeleteTask,
    claudeStatus,
}: {
    workspaces: Workspace[]
    unassignedProjects: Project[]
    activeId: number | null
    onAddWorkspace: () => void
    onAddProject: (workspaceId: number | null) => void
    onMoveProject: (project: Project) => void
    tasks: Task[]
    onOpenCreateTask: () => void
    onUpdateStatus: (task: Task, status: Task['status']) => void
    onDeleteTask: (task: Task) => void
    claudeStatus: Record<number, 'running' | 'done'>
}) {
    const [filterWorkspaceId, setFilterWorkspaceId] = useState<number | null>(null)
    const [dragTaskId, setDragTaskId] = useState<number | null>(null)
    const [dragOverStatus, setDragOverStatus] = useState<Task['status'] | null>(null)

    return (
        <aside style={{
            width: '240px', flexShrink: 0, background: color.bgCanvas,
            borderRight: '1px solid #21262d', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
            {/* App header */}
            <div style={{
                padding: '10px 12px 10px 16px', borderBottom: '1px solid #21262d',
                display: 'flex', alignItems: 'center', gap: '8px',
            }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill={color.accent} style={{ flexShrink: 0 }}>
                    <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0114.25 15H1.75A1.75 1.75 0 010 13.25V2.75zm1.75-.25a.25.25 0 00-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25V2.75a.25.25 0 00-.25-.25H1.75zM8 4a.75.75 0 01.75.75v3.5h3.5a.75.75 0 010 1.5h-4.25a.75.75 0 01-.75-.75v-4.25A.75.75 0 018 4zM5 4a.75.75 0 01.75.75v6.5a.75.75 0 01-1.5 0v-6.5A.75.75 0 015 4z"/>
                </svg>
                <span style={{ color: color.textPrimary, fontSize: '13px', fontWeight: 700, letterSpacing: '0.01em', whiteSpace: 'nowrap' }}>
                    Keera Agent
                </span>
                <WorkspaceDropdown
                    workspaces={workspaces}
                    selected={filterWorkspaceId}
                    onChange={setFilterWorkspaceId}
                />
            </div>

            {/* Workspaces + Projects section */}
            <div style={{ overflowY: 'auto', maxHeight: '55%', display: 'flex', flexDirection: 'column' }}>
                {filterWorkspaceId !== null ? (
                    // ── Filtered view: just the selected workspace's projects ──
                    (() => {
                        const ws = workspaces.find(w => w.id === filterWorkspaceId)
                        if (!ws) return null
                        return (
                            <>
                                <SectionHeader
                                    label={ws.name}
                                    onAdd={() => onAddProject(ws.id)}
                                />
                                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                                    {ws.projects.length === 0 && (
                                        <li style={{ padding: '4px 16px 4px 24px', color: color.textFaint, fontSize: '11px', fontStyle: 'italic' }}>
                                            No projects
                                        </li>
                                    )}
                                    {ws.projects.map(project => (
                                        <li key={project.id}>
                                            <ProjectItem project={project} active={project.id === activeId} status={claudeStatus[project.id]} onMove={onMoveProject} />
                                        </li>
                                    ))}
                                </ul>
                            </>
                        )
                    })()
                ) : (
                    // ── Unfiltered view: all workspaces + unassigned ──
                    <>
                        <SectionHeader label="Workspaces" onAdd={onAddWorkspace} />

                        {workspaces.length === 0 && (
                            <p style={{ margin: '0 16px 8px', color: color.textFaint, fontSize: '11px', fontStyle: 'italic' }}>
                                No workspaces yet
                            </p>
                        )}

                        {workspaces.map(workspace => (
                            <WorkspaceSection
                                key={workspace.id}
                                workspace={workspace}
                                activeId={activeId}
                                onAddProject={onAddProject}
                                onMoveProject={onMoveProject}
                                claudeStatus={claudeStatus}
                            />
                        ))}

                        {/* Unassigned projects */}
                        {unassignedProjects.length > 0 && (
                            <>
                                <div style={{ height: '1px', background: color.border, margin: '4px 0' }} />
                                <div style={{ padding: '5px 16px 4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ color: color.textFaint, fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', flex: 1 }}>
                                        Unassigned
                                    </span>
                                    <button
                                        onClick={() => onAddProject(null)}
                                        title="Add project"
                                        style={{
                                            background: 'transparent', border: 'none', cursor: 'pointer',
                                            color: color.textFaint, padding: '0 2px', lineHeight: 1, display: 'flex', alignItems: 'center',
                                        }}
                                        onMouseEnter={e => (e.currentTarget.style.color = color.textMuted)}
                                        onMouseLeave={e => (e.currentTarget.style.color = color.textFaint)}
                                    >
                                        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                                            <path d="M7.75 2a.75.75 0 01.75.75V7h4.25a.75.75 0 010 1.5H8.5v4.25a.75.75 0 01-1.5 0V8.5H2.75a.75.75 0 010-1.5H7V2.75A.75.75 0 017.75 2z"/>
                                        </svg>
                                    </button>
                                </div>
                                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                                    {unassignedProjects.map(project => (
                                        <li key={project.id}>
                                            <ProjectItem project={project} active={project.id === activeId} status={claudeStatus[project.id]} onMove={onMoveProject} />
                                        </li>
                                    ))}
                                </ul>
                            </>
                        )}

                        {/* Add project shortcut when no workspaces */}
                        {workspaces.length === 0 && unassignedProjects.length === 0 && (
                            <button
                                onClick={() => onAddProject(null)}
                                style={{
                                    margin: '0 16px 8px', background: 'transparent', border: `1px dashed ${color.borderMuted}`,
                                    borderRadius: '6px', color: color.textFaint, fontSize: '11px', padding: '6px',
                                    cursor: 'pointer', textAlign: 'center',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.color = color.textMuted; e.currentTarget.style.borderColor = color.textMuted }}
                                onMouseLeave={e => { e.currentTarget.style.color = color.textFaint; e.currentTarget.style.borderColor = color.borderMuted }}
                            >
                                + Add project
                            </button>
                        )}
                    </>
                )}
            </div>

            {/* Divider */}
            <div style={{ height: '1px', background: color.border, margin: '4px 0' }} />

            {/* Tasks section */}
            <SectionHeader label="Tasks" onAdd={onOpenCreateTask} />
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', paddingBottom: '8px' }}>
                {tasks.length === 0 ? (
                    <p style={{ padding: '6px 16px', color: color.textFaint, fontSize: '12px', fontStyle: 'italic', margin: 0 }}>
                        No tasks yet
                    </p>
                ) : (
                    STATUS_CYCLE.map(status => {
                        const groupTasks = tasks.filter(t => t.status === status)
                        const isOver = dragOverStatus === status
                        return (
                            <div
                                key={status}
                                onDragOver={e => { e.preventDefault(); setDragOverStatus(status) }}
                                onDragLeave={e => {
                                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                        setDragOverStatus(null)
                                    }
                                }}
                                onDrop={e => {
                                    e.preventDefault()
                                    setDragOverStatus(null)
                                    if (dragTaskId !== null) {
                                        const task = tasks.find(t => t.id === dragTaskId)
                                        if (task && task.status !== status) onUpdateStatus(task, status)
                                    }
                                    setDragTaskId(null)
                                }}
                                style={{
                                    margin: '2px 6px',
                                    borderRadius: '6px',
                                    background: isOver ? color.bgSurface : 'transparent',
                                    border: isOver ? `1px solid ${color.borderMuted}` : '1px solid transparent',
                                    transition: 'background 0.1s, border-color 0.1s',
                                    minHeight: '36px',
                                }}
                            >
                                {/* Status group header */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 8px 3px' }}>
                                    <span style={{
                                        width: '7px', height: '7px', borderRadius: '50%',
                                        background: STATUS_COLORS[status], flexShrink: 0, display: 'inline-block',
                                    }} />
                                    <span style={{
                                        fontSize: '10px', color: color.textFaint, fontWeight: 600,
                                        textTransform: 'uppercase', letterSpacing: '0.06em', flex: 1,
                                    }}>
                                        {STATUS_LABELS[status]}
                                    </span>
                                    {groupTasks.length > 0 && (
                                        <span style={{ fontSize: '10px', color: color.textFaint }}>
                                            {groupTasks.length}
                                        </span>
                                    )}
                                </div>
                                {/* Tasks in this status */}
                                <ul style={{ listStyle: 'none', margin: 0, padding: '0 0 4px' }}>
                                    {groupTasks.length === 0 && isOver && (
                                        <li style={{
                                            padding: '4px 8px 4px 20px',
                                            fontSize: '11px', color: color.textFaint, fontStyle: 'italic',
                                        }}>
                                            Drop here
                                        </li>
                                    )}
                                    {groupTasks.map(task => (
                                        <li
                                            key={task.id}
                                            draggable
                                            onDragStart={() => setDragTaskId(task.id)}
                                            onDragEnd={() => { setDragTaskId(null); setDragOverStatus(null) }}
                                            style={{
                                                display: 'flex', alignItems: 'flex-start',
                                                padding: '3px 6px 3px 20px', gap: '6px',
                                                opacity: dragTaskId === task.id ? 0.35 : 1,
                                                cursor: 'grab',
                                                borderRadius: '4px',
                                            }}
                                        >
                                            <span style={{
                                                flex: 1, fontSize: '12px',
                                                color: task.status === 'completed' || task.status === 'cancelled' ? color.textFaint : color.textSecondary,
                                                textDecoration: task.status === 'completed' || task.status === 'cancelled' ? 'line-through' : 'none',
                                                lineHeight: 1.4, wordBreak: 'break-word',
                                            }}>
                                                {task.title}
                                            </span>
                                            <button
                                                onClick={() => onDeleteTask(task)}
                                                style={{
                                                    flexShrink: 0, background: 'transparent', border: 'none',
                                                    color: color.textFaint, cursor: 'pointer', padding: '0 2px', lineHeight: 1,
                                                    opacity: 0, transition: 'opacity 0.1s',
                                                }}
                                                onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                                                onMouseLeave={e => (e.currentTarget.style.opacity = '0')}
                                            >
                                                ×
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )
                    })
                )}
            </div>
        </aside>
    )
}

// ─── Create Task Modal ────────────────────────────────────────────────────────

function CreateTaskModal({
    onClose,
    onCreated,
}: {
    onClose: () => void
    onCreated: (title: string, body: string, assignees: string[]) => void
}) {
    const [title, setTitle] = useState('')
    const [body, setBody] = useState('')
    const [assigneeInput, setAssigneeInput] = useState('')
    const [assignees, setAssignees] = useState<string[]>([])
    const [error, setError] = useState('')

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
        onCreated(title.trim(), body.trim(), assignees)
        onClose()
    }

    return (
        <div style={{
            position: 'fixed', inset: 0, background: color.overlay,
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
            <div style={{
                background: color.bgSurface, border: `1px solid ${color.borderMuted}`, borderRadius: '8px',
                padding: '24px', width: '420px', display: 'flex', flexDirection: 'column', gap: '16px',
            }}>
                <h2 style={{ margin: 0, color: color.textPrimary, fontSize: '15px', fontWeight: 600 }}>New Task</h2>

                {error && <span style={{ color: color.danger, fontSize: '12px' }}>{error}</span>}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
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
                        {/* Tags */}
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
                        {/* Input row */}
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

// ─── Project sidebar ─────────────────────────────────────────────────────────

type ProjectView = 'agents' | 'commands' | 'tasks'

const PROJECT_NAV: { id: ProjectView; label: string; icon: React.ReactNode }[] = [
    {
        id: 'agents',
        label: 'Agents',
        icon: (
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
                <path d="M0 8a8 8 0 1116 0A8 8 0 010 8zm8-6.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM6.5 7.75A.75.75 0 017.25 7h1a.75.75 0 01.75.75v2.75h.25a.75.75 0 010 1.5h-2a.75.75 0 010-1.5h.25v-2h-.25a.75.75 0 01-.75-.75zM8 6a1 1 0 110-2 1 1 0 010 2z"/>
            </svg>
        ),
    },
    {
        id: 'commands',
        label: 'Commands',
        icon: (
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
                <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0114.25 15H1.75A1.75 1.75 0 010 13.25V2.75zm1.75-.25a.25.25 0 00-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25V2.75a.25.25 0 00-.25-.25H1.75zM3.5 6.25a.75.75 0 000 1.5h.268l-.01.034L2.76 10.5a.75.75 0 001.44.42l.04-.138H6.76l.04.138a.75.75 0 001.44-.42L7.242 7.784l-.01-.034H7.5a.75.75 0 000-1.5h-4zm.751 1.5H6.25l-.609 2.099H4.86L4.251 7.75zm5.5-1.5a.75.75 0 000 1.5h3.5a.75.75 0 000-1.5h-3.5zm0 3a.75.75 0 000 1.5h3.5a.75.75 0 000-1.5h-3.5z"/>
            </svg>
        ),
    },
    {
        id: 'tasks',
        label: 'Tasks',
        icon: (
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2.5 1.75v11.5c0 .138.112.25.25.25h10.5a.25.25 0 00.25-.25V1.75a.25.25 0 00-.25-.25H2.75a.25.25 0 00-.25.25zM2.75 0h10.5c.966 0 1.75.784 1.75 1.75v11.5A1.75 1.75 0 0113.25 15H2.75A1.75 1.75 0 011 13.25V1.75C1 .784 1.784 0 2.75 0zM11.78 6.28a.75.75 0 00-1.06-1.06L7.25 8.69 5.28 6.72a.75.75 0 00-1.06 1.06l2.5 2.5a.75.75 0 001.06 0l4-4z"/>
            </svg>
        ),
    },
]

function ProjectSidebar({ view, onChange }: { view: ProjectView; onChange: (v: ProjectView) => void }) {
    return (
        <div style={{
            width: '140px', flexShrink: 0, background: color.bgCanvas,
            borderRight: '1px solid #21262d', display: 'flex', flexDirection: 'column',
            paddingTop: '6px',
        }}>
            {PROJECT_NAV.map(item => {
                const active = item.id === view
                return (
                    <button
                        key={item.id}
                        onClick={() => onChange(item.id)}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            padding: '8px 14px',
                            background: active ? color.bgSurface : 'transparent',
                            borderLeft: `2px solid ${active ? color.accent : 'transparent'}`,
                            border: 'none',
                            borderLeftWidth: '2px',
                            borderLeftStyle: 'solid',
                            borderLeftColor: active ? color.accent : 'transparent',
                            color: active ? color.textPrimary : color.textMuted,
                            fontSize: '12px', fontWeight: active ? 600 : 400,
                            cursor: 'pointer', textAlign: 'left',
                            transition: 'color 0.1s, background 0.1s',
                        }}
                        onMouseEnter={e => { if (!active) e.currentTarget.style.color = color.textSecondary }}
                        onMouseLeave={e => { if (!active) e.currentTarget.style.color = color.textMuted }}
                    >
                        {item.icon}
                        {item.label}
                    </button>
                )
            })}
        </div>
    )
}

// ─── Commands view ────────────────────────────────────────────────────────────

const cmdPulseStyle = `
@keyframes cmd-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(63,185,80,0.6); }
  70%  { box-shadow: 0 0 0 5px rgba(63,185,80,0); }
  100% { box-shadow: 0 0 0 0 rgba(63,185,80,0);   }
}
`

interface Command {
    id: number
    project_id: number
    label: string
    command: string
    status: 'running' | 'stopped'
    pid: number | null
}

function CommandsView({ projectId }: { projectId: number }) {
    const [commands, setCommands] = useState<Command[]>([])
    const [showForm, setShowForm] = useState(false)
    const [label, setLabel] = useState('')
    const [cmd, setCmd] = useState('')
    const [formError, setFormError] = useState('')
    const [formLoading, setFormLoading] = useState(false)
    const [outputCmd, setOutputCmd] = useState<Command | null>(null)
    const [outputLines, setOutputLines] = useState<string[]>([])
    const [autoScroll, setAutoScroll] = useState(true)
    const outputRef = useRef<HTMLDivElement>(null)
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

    useEffect(() => {
        fetch(`/api/projects/${projectId}/commands`)
            .then(r => r.json())
            .then(setCommands)
            .catch(() => {})
    }, [projectId])

    useEffect(() => {
        if (pollRef.current) clearInterval(pollRef.current)
        if (!outputCmd) return
        const poll = () => {
            fetch(`/api/commands/${outputCmd.id}/output`)
                .then(r => r.json())
                .then(d => setOutputLines(d.lines ?? []))
                .catch(() => {})
        }
        poll()
        pollRef.current = setInterval(poll, 1000)
        return () => { if (pollRef.current) clearInterval(pollRef.current) }
    }, [outputCmd?.id])

    useEffect(() => {
        if (autoScroll && outputRef.current) {
            outputRef.current.scrollTop = outputRef.current.scrollHeight
        }
    }, [outputLines, autoScroll])

    async function handleCreate(e: React.FormEvent) {
        e.preventDefault()
        setFormError('')
        setFormLoading(true)
        try {
            const res = await fetch(`/api/projects/${projectId}/commands`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label: label.trim(), command: cmd.trim() }),
            })
            const data = await res.json()
            if (!res.ok) { setFormError(data.error ?? 'Failed'); return }
            setCommands(prev => [...prev, data as Command])
            setLabel(''); setCmd(''); setShowForm(false)
        } catch { setFormError('Network error') }
        finally { setFormLoading(false) }
    }

    async function handleRun(c: Command) {
        const res = await fetch(`/api/commands/${c.id}/run`, { method: 'POST' })
        if (res.ok) {
            const updated = await res.json()
            setCommands(prev => prev.map(x => x.id === c.id ? updated : x))
            setOutputCmd(updated)
            setOutputLines([])
            setAutoScroll(true)
        }
    }

    async function handleStop(c: Command) {
        const res = await fetch(`/api/commands/${c.id}/stop`, { method: 'POST' })
        if (res.ok) {
            const updated = await res.json()
            setCommands(prev => prev.map(x => x.id === c.id ? updated : x))
            if (outputCmd?.id === c.id) setOutputCmd(updated)
        }
    }

    async function handleDelete(c: Command) {
        await fetch(`/api/commands/${c.id}`, { method: 'DELETE' })
        setCommands(prev => prev.filter(x => x.id !== c.id))
        if (outputCmd?.id === c.id) { setOutputCmd(null); setOutputLines([]) }
    }

    const hasOutput = outputCmd !== null

    return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <style>{cmdPulseStyle}</style>

            {/* ── Header ── */}
            <div style={{
                padding: '10px 20px', borderBottom: `1px solid ${color.border}`,
                display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0,
                background: color.bgCanvas,
            }}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill={color.textMuted}>
                    <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0114.25 15H1.75A1.75 1.75 0 010 13.25V2.75zm1.75-.25a.25.25 0 00-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25V2.75a.25.25 0 00-.25-.25H1.75zM3.5 6.25a.75.75 0 000 1.5h.268l-.01.034L2.76 10.5a.75.75 0 001.44.42l.04-.138H6.76l.04.138a.75.75 0 001.44-.42L7.242 7.784l-.01-.034H7.5a.75.75 0 000-1.5h-4zm.751 1.5H6.25l-.609 2.099H4.86L4.251 7.75zm5.5-1.5a.75.75 0 000 1.5h3.5a.75.75 0 000-1.5h-3.5zm0 3a.75.75 0 000 1.5h3.5a.75.75 0 000-1.5h-3.5z"/>
                </svg>
                <span style={{ color: color.textPrimary, fontSize: '13px', fontWeight: 600, flex: 1 }}>Commands</span>
                {commands.filter(c => c.status === 'running').length > 0 && (
                    <span style={{
                        fontSize: '10px', padding: '1px 7px', borderRadius: '10px',
                        background: 'rgba(63,185,80,0.1)', border: '1px solid rgba(63,185,80,0.3)',
                        color: color.success,
                    }}>
                        {commands.filter(c => c.status === 'running').length} running
                    </span>
                )}
                <button
                    onClick={() => { setShowForm(s => !s); setFormError('') }}
                    style={{
                        background: showForm ? color.bgSurface : color.successEmphasis,
                        border: `1px solid ${showForm ? color.borderMuted : color.successBorder}`,
                        borderRadius: '5px',
                        color: showForm ? color.textMuted : '#fff',
                        fontSize: '11px', padding: '4px 10px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '5px',
                    }}
                >
                    {showForm ? (
                        '× Cancel'
                    ) : (
                        <>
                            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                                <path d="M7.75 2a.75.75 0 01.75.75V7h4.25a.75.75 0 010 1.5H8.5v4.25a.75.75 0 01-1.5 0V8.5H2.75a.75.75 0 010-1.5H7V2.75A.75.75 0 017.75 2z"/>
                            </svg>
                            New command
                        </>
                    )}
                </button>
            </div>

            {/* ── Add form ── */}
            {showForm && (
                <div style={{
                    padding: '14px 20px', borderBottom: `1px solid ${color.border}`,
                    background: color.bgSurface, flexShrink: 0,
                }}>
                    <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '0 0 180px' }}>
                                <span style={labelStyle}>Label</span>
                                <input
                                    autoFocus
                                    value={label}
                                    onChange={e => setLabel(e.target.value)}
                                    placeholder="Dev Server"
                                    required
                                    style={{ ...inputStyle, boxSizing: 'border-box', width: '100%' }}
                                />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                                <span style={labelStyle}>Shell command</span>
                                <input
                                    value={cmd}
                                    onChange={e => setCmd(e.target.value)}
                                    placeholder="npm run dev"
                                    required
                                    style={{
                                        ...inputStyle, boxSizing: 'border-box', width: '100%',
                                        fontFamily: '"JetBrains Mono", monospace',
                                    }}
                                />
                            </div>
                        </div>
                        {formError && <span style={{ color: color.danger, fontSize: '12px' }}>{formError}</span>}
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                            <button type="button" onClick={() => setShowForm(false)} style={cancelBtnStyle}>Cancel</button>
                            <button type="submit" disabled={formLoading} style={submitBtnStyle}>
                                {formLoading ? 'Adding…' : 'Add command'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* ── Body ── */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

                {/* Command list / cards */}
                <div style={{
                    width: hasOutput ? '300px' : '100%',
                    flexShrink: 0,
                    overflowY: 'auto',
                    borderRight: hasOutput ? `1px solid ${color.border}` : 'none',
                    display: 'flex', flexDirection: 'column',
                }}>
                    {commands.length === 0 ? (
                        <div style={{
                            flex: 1, display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center', gap: '12px',
                            padding: '40px 24px', textAlign: 'center',
                        }}>
                            <div style={{
                                width: '48px', height: '48px', borderRadius: '12px',
                                background: color.bgSurface, border: `1px solid ${color.borderMuted}`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <svg width="22" height="22" viewBox="0 0 16 16" fill={color.textFaint}>
                                    <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0114.25 15H1.75A1.75 1.75 0 010 13.25V2.75zm1.75-.25a.25.25 0 00-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25V2.75a.25.25 0 00-.25-.25H1.75zM3.5 6.25a.75.75 0 000 1.5h.268l-.01.034L2.76 10.5a.75.75 0 001.44.42l.04-.138H6.76l.04.138a.75.75 0 001.44-.42L7.242 7.784l-.01-.034H7.5a.75.75 0 000-1.5h-4zm.751 1.5H6.25l-.609 2.099H4.86L4.251 7.75zm5.5-1.5a.75.75 0 000 1.5h3.5a.75.75 0 000-1.5h-3.5zm0 3a.75.75 0 000 1.5h3.5a.75.75 0 000-1.5h-3.5z"/>
                                </svg>
                            </div>
                            <div>
                                <p style={{ margin: '0 0 4px', color: color.textSecondary, fontSize: '13px', fontWeight: 500 }}>
                                    No commands yet
                                </p>
                                <p style={{ margin: 0, color: color.textFaint, fontSize: '12px', lineHeight: 1.5 }}>
                                    Add server commands, build scripts,<br/>or any long-running process.
                                </p>
                            </div>
                            <button
                                onClick={() => setShowForm(true)}
                                style={{
                                    background: 'transparent', border: `1px dashed ${color.borderMuted}`,
                                    borderRadius: '6px', color: color.textMuted, fontSize: '12px',
                                    padding: '6px 14px', cursor: 'pointer',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.borderColor = color.accent; e.currentTarget.style.color = color.accent }}
                                onMouseLeave={e => { e.currentTarget.style.borderColor = color.borderMuted; e.currentTarget.style.color = color.textMuted }}
                            >
                                + Add your first command
                            </button>
                        </div>
                    ) : (
                        <div style={{ padding: hasOutput ? '8px 0' : '12px', display: 'flex', flexDirection: 'column', gap: hasOutput ? '0' : '6px' }}>
                            {commands.map(c => {
                                const isSelected = outputCmd?.id === c.id
                                const isRunning = c.status === 'running'

                                // Compact list mode when output panel is open
                                if (hasOutput) {
                                    return (
                                        <div
                                            key={c.id}
                                            onClick={() => { setOutputCmd(c); setOutputLines([]) }}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: '8px',
                                                padding: '7px 12px', cursor: 'pointer',
                                                background: isSelected ? color.bgSurface : 'transparent',
                                                borderLeft: `2px solid ${isSelected ? color.accent : 'transparent'}`,
                                            }}
                                            onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = color.bgCanvas }}
                                            onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
                                        >
                                            <span style={{
                                                width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
                                                background: isRunning ? color.success : color.textFaint,
                                                animation: isRunning ? 'cmd-pulse 2s infinite' : 'none',
                                            }} />
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontSize: '12px', fontWeight: 600, color: color.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {c.label}
                                                </div>
                                                <div style={{ fontSize: '10px', color: color.textFaint, fontFamily: '"JetBrains Mono", monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {c.command}
                                                </div>
                                            </div>
                                            {isRunning ? (
                                                <button
                                                    onClick={e => { e.stopPropagation(); handleStop(c) }}
                                                    style={{
                                                        flexShrink: 0, background: color.dangerCanvas,
                                                        border: `1px solid ${color.dangerSubtle}`, borderRadius: '4px',
                                                        color: color.danger, fontSize: '10px', padding: '2px 6px', cursor: 'pointer',
                                                    }}
                                                >■</button>
                                            ) : (
                                                <button
                                                    onClick={e => { e.stopPropagation(); handleRun(c) }}
                                                    style={{
                                                        flexShrink: 0, background: color.successEmphasis,
                                                        border: `1px solid ${color.successBorder}`, borderRadius: '4px',
                                                        color: '#fff', fontSize: '10px', padding: '2px 6px', cursor: 'pointer',
                                                    }}
                                                >▶</button>
                                            )}
                                        </div>
                                    )
                                }

                                // Card mode (no output panel open)
                                return (
                                    <div
                                        key={c.id}
                                        onClick={() => { setOutputCmd(c); setOutputLines([]) }}
                                        style={{
                                            background: color.bgSurface,
                                            border: `1px solid ${isRunning ? 'rgba(63,185,80,0.25)' : color.borderMuted}`,
                                            borderRadius: '8px', padding: '12px 14px',
                                            cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '8px',
                                            transition: 'border-color 0.15s',
                                        }}
                                        onMouseEnter={e => {
                                            e.currentTarget.style.borderColor = isRunning ? 'rgba(63,185,80,0.5)' : color.accent
                                        }}
                                        onMouseLeave={e => {
                                            e.currentTarget.style.borderColor = isRunning ? 'rgba(63,185,80,0.25)' : color.borderMuted
                                        }}
                                    >
                                        {/* Card top: label + status + actions */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            {/* Pulse dot */}
                                            <span style={{
                                                width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
                                                background: isRunning ? color.success : color.textFaint,
                                                animation: isRunning ? 'cmd-pulse 2s infinite' : 'none',
                                            }} />
                                            <span style={{ flex: 1, fontSize: '13px', fontWeight: 600, color: color.textPrimary }}>
                                                {c.label}
                                            </span>
                                            {/* PID badge when running */}
                                            {isRunning && c.pid && (
                                                <span style={{
                                                    fontSize: '10px', color: color.success, fontFamily: '"JetBrains Mono", monospace',
                                                    background: 'rgba(63,185,80,0.08)', border: '1px solid rgba(63,185,80,0.2)',
                                                    borderRadius: '4px', padding: '1px 6px',
                                                }}>
                                                    pid {c.pid}
                                                </span>
                                            )}
                                            {/* Run / Stop */}
                                            {isRunning ? (
                                                <button
                                                    onClick={e => { e.stopPropagation(); handleStop(c) }}
                                                    style={{
                                                        background: color.dangerCanvas, border: `1px solid ${color.dangerSubtle}`,
                                                        borderRadius: '5px', color: color.danger,
                                                        fontSize: '11px', padding: '3px 10px', cursor: 'pointer',
                                                        display: 'flex', alignItems: 'center', gap: '4px',
                                                    }}
                                                >
                                                    <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor">
                                                        <rect x="1" y="1" width="8" height="8" rx="1"/>
                                                    </svg>
                                                    Stop
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={e => { e.stopPropagation(); handleRun(c) }}
                                                    style={{
                                                        background: color.successEmphasis, border: `1px solid ${color.successBorder}`,
                                                        borderRadius: '5px', color: '#fff',
                                                        fontSize: '11px', padding: '3px 10px', cursor: 'pointer',
                                                        display: 'flex', alignItems: 'center', gap: '4px',
                                                    }}
                                                >
                                                    <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor">
                                                        <path d="M2 1.5l7 3.5-7 3.5V1.5z"/>
                                                    </svg>
                                                    Run
                                                </button>
                                            )}
                                            {/* Delete */}
                                            <button
                                                onClick={e => { e.stopPropagation(); handleDelete(c) }}
                                                style={{
                                                    background: 'transparent', border: 'none',
                                                    color: color.textFaint, cursor: 'pointer',
                                                    padding: '3px 4px', fontSize: '14px', lineHeight: 1,
                                                    borderRadius: '4px',
                                                }}
                                                onMouseEnter={e => { e.currentTarget.style.color = color.danger; e.currentTarget.style.background = color.dangerCanvas }}
                                                onMouseLeave={e => { e.currentTarget.style.color = color.textFaint; e.currentTarget.style.background = 'transparent' }}
                                            >×</button>
                                        </div>

                                        {/* Command string */}
                                        <div style={{
                                            display: 'flex', alignItems: 'center', gap: '6px',
                                            background: color.bgBase, borderRadius: '5px',
                                            padding: '5px 8px',
                                            border: `1px solid ${color.border}`,
                                        }}>
                                            <span style={{ color: color.textFaint, fontSize: '11px', fontFamily: '"JetBrains Mono", monospace', flexShrink: 0 }}>$</span>
                                            <span style={{
                                                fontSize: '11px', color: color.textSecondary,
                                                fontFamily: '"JetBrains Mono", monospace',
                                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                            }}>{c.command}</span>
                                        </div>

                                        {/* View output hint */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <span style={{ fontSize: '10px', color: color.textFaint }}>
                                                {isRunning ? 'Click to view output' : 'Click to view log'}
                                            </span>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>

                {/* ── Output panel ── */}
                {hasOutput && (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                        {/* Terminal chrome header */}
                        <div style={{
                            padding: '7px 12px', borderBottom: `1px solid ${color.border}`,
                            display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0,
                            background: color.bgCanvas,
                        }}>
                            {/* Traffic lights */}
                            <div style={{ display: 'flex', gap: '5px', flexShrink: 0 }}>
                                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ff5f57' }} />
                                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#febc2e' }} />
                                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#28c840' }} />
                            </div>
                            <span style={{ color: color.borderMuted, fontSize: '11px' }}>|</span>
                            <span style={{
                                fontSize: '11px', color: color.textMuted,
                                fontFamily: '"JetBrains Mono", monospace',
                                flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                                {outputCmd.label}
                                {outputCmd.pid && outputCmd.status === 'running' && (
                                    <span style={{ color: color.textFaint }}> · pid {outputCmd.pid}</span>
                                )}
                            </span>
                            {outputCmd.status === 'running' && <DotsIndicator />}
                            {outputCmd.status === 'stopped' && (
                                <span style={{ fontSize: '10px', color: color.textFaint, fontFamily: '"JetBrains Mono", monospace' }}>
                                    exited
                                </span>
                            )}
                            <button
                                onClick={() => setAutoScroll(s => !s)}
                                title={autoScroll ? 'Auto-scroll on' : 'Auto-scroll off'}
                                style={{
                                    background: autoScroll ? 'rgba(88,166,255,0.1)' : 'transparent',
                                    border: `1px solid ${autoScroll ? color.accentEmphasis : color.borderMuted}`,
                                    borderRadius: '4px', color: autoScroll ? color.accent : color.textFaint,
                                    fontSize: '10px', padding: '1px 6px', cursor: 'pointer',
                                }}
                            >
                                ↓ scroll
                            </button>
                            <button
                                onClick={() => setOutputLines([])}
                                style={{
                                    background: 'transparent', border: 'none',
                                    color: color.textFaint, fontSize: '11px', cursor: 'pointer', padding: '2px 4px',
                                }}
                                onMouseEnter={e => (e.currentTarget.style.color = color.textMuted)}
                                onMouseLeave={e => (e.currentTarget.style.color = color.textFaint)}
                            >
                                Clear
                            </button>
                            <button
                                onClick={() => { setOutputCmd(null); setOutputLines([]) }}
                                style={{
                                    background: 'transparent', border: 'none',
                                    color: color.textFaint, fontSize: '16px', cursor: 'pointer',
                                    padding: '0 2px', lineHeight: 1,
                                }}
                                onMouseEnter={e => (e.currentTarget.style.color = color.textSecondary)}
                                onMouseLeave={e => (e.currentTarget.style.color = color.textFaint)}
                            >×</button>
                        </div>

                        {/* Terminal body */}
                        <div
                            ref={outputRef}
                            onScroll={e => {
                                const el = e.currentTarget
                                const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32
                                if (!atBottom) setAutoScroll(false)
                            }}
                            style={{
                                flex: 1, overflowY: 'auto', background: '#0d1117',
                                fontFamily: '"JetBrains Mono", monospace', fontSize: '12px',
                                lineHeight: 1.6, padding: '10px 0',
                            }}
                        >
                            {outputLines.length === 0 ? (
                                <div style={{ padding: '6px 16px', color: '#484f58', fontStyle: 'italic' }}>
                                    {outputCmd.status === 'running' ? 'Waiting for output…' : 'No output captured.'}
                                </div>
                            ) : (
                                outputLines.map((line, i) => (
                                    <div
                                        key={i}
                                        style={{ display: 'flex', minHeight: '19px' }}
                                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                    >
                                        {/* Line number gutter */}
                                        <span style={{
                                            flexShrink: 0, width: '44px', textAlign: 'right',
                                            paddingRight: '12px', color: '#3d444d',
                                            userSelect: 'none', fontSize: '11px',
                                        }}>
                                            {i + 1}
                                        </span>
                                        {/* Line content */}
                                        <span style={{
                                            flex: 1, color: '#c9d1d9',
                                            paddingRight: '16px', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                                        }}>
                                            {line || '\u00a0'}
                                        </span>
                                    </div>
                                ))
                            )}
                            {/* Blinking cursor when running */}
                            {outputCmd.status === 'running' && (
                                <div style={{ padding: '0 0 0 56px', color: color.success, fontSize: '12px' }}>
                                    <span style={{ animation: 'blink 1s step-end infinite' }}>▌</span>
                                </div>
                            )}
                        </div>
                        <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
                    </div>
                )}
            </div>
        </div>
    )
}

// ─── Task helper components ───────────────────────────────────────────────────

const PRIORITY_STYLES: Record<string, { bg: string; color: string; border: string }> = {
    low:    { bg: color.bgSurface, color: color.textMuted, border: color.borderMuted },
    medium: { bg: color.priorityMediumBg, color: color.warning, border: color.warningSubtle },
    high:   { bg: color.dangerCanvas, color: color.danger, border: color.dangerSubtle },
}

function PriorityBadge({ priority }: { priority: string }) {
    const s = PRIORITY_STYLES[priority] ?? PRIORITY_STYLES.medium
    return (
        <span style={{
            fontSize: '10px', fontWeight: 600, letterSpacing: '0.04em',
            padding: '1px 6px', borderRadius: '10px',
            background: s.bg, border: `1px solid ${s.border}`, color: s.color,
            textTransform: 'uppercase', flexShrink: 0,
        }}>
            {priority}
        </span>
    )
}

function PlanningSection({ label, items, color: dotColor }: { label: string; items: string[]; color: string }) {
    const [open, setOpen] = useState(false)
    return (
        <div style={{ marginTop: '2px' }}>
            <button
                onClick={() => setOpen(o => !o)}
                style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    padding: 0, display: 'flex', alignItems: 'center', gap: '4px',
                }}
            >
                <svg
                    width="8" height="8" viewBox="0 0 16 16" fill={dotColor}
                    style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}
                >
                    <path d="M4.427 7.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 7H4.604a.25.25 0 00-.177.427z"/>
                </svg>
                <span style={{ fontSize: '10px', color: dotColor, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {label} ({items.length})
                </span>
            </button>
            {open && (
                <ul style={{ margin: '4px 0 0 12px', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    {items.map((item, i) => (
                        <li key={i} style={{ fontSize: '11px', color: color.textMuted, lineHeight: 1.5 }}>
                            <span style={{ color: dotColor, marginRight: '4px' }}>•</span>{item}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

// ─── Tasks view (Kanban board) ────────────────────────────────────────────────

function TasksView({
    tasks,
    onOpenCreateTask,
    onUpdateStatus,
    onDeleteTask,
}: {
    tasks: Task[]
    onOpenCreateTask: () => void
    onUpdateStatus: (task: Task, status: Task['status']) => void
    onDeleteTask: (task: Task) => void
}) {
    const [dragTaskId, setDragTaskId] = useState<number | null>(null)
    const [dragOverStatus, setDragOverStatus] = useState<Task['status'] | null>(null)

    return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{
                padding: '12px 20px', borderBottom: '1px solid #21262d',
                display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0,
            }}>
                <span style={{ color: color.textPrimary, fontSize: '13px', fontWeight: 600, flex: 1 }}>Tasks</span>
                <button
                    onClick={onOpenCreateTask}
                    style={{
                        background: color.successEmphasis, border: `1px solid ${color.successBorder}`, borderRadius: '5px',
                        color: '#fff', fontSize: '11px', padding: '4px 10px', cursor: 'pointer',
                    }}
                >
                    + New task
                </button>
            </div>

            {/* Kanban board */}
            <div style={{
                flex: 1, display: 'flex', flexDirection: 'row', gap: '12px',
                padding: '16px', overflowX: 'auto', overflowY: 'hidden', alignItems: 'flex-start',
            }}>
                {STATUS_CYCLE.map(status => {
                    const col = tasks.filter(t => t.status === status)
                    const isOver = dragOverStatus === status
                    return (
                        <div
                            key={status}
                            onDragOver={e => { e.preventDefault(); setDragOverStatus(status) }}
                            onDragLeave={e => {
                                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverStatus(null)
                            }}
                            onDrop={e => {
                                e.preventDefault()
                                setDragOverStatus(null)
                                if (dragTaskId !== null) {
                                    const task = tasks.find(t => t.id === dragTaskId)
                                    if (task && task.status !== status) onUpdateStatus(task, status)
                                }
                                setDragTaskId(null)
                            }}
                            style={{
                                width: '240px', flexShrink: 0, display: 'flex', flexDirection: 'column',
                                background: isOver ? color.bgSurface : color.bgCanvas,
                                border: `1px solid ${isOver ? color.borderMuted : color.border}`,
                                borderRadius: '8px', transition: 'background 0.1s, border-color 0.1s',
                                maxHeight: '100%',
                            }}
                        >
                            {/* Column header */}
                            <div style={{
                                padding: '10px 12px 8px', display: 'flex', alignItems: 'center',
                                gap: '7px', borderBottom: `1px solid ${color.border}`, flexShrink: 0,
                            }}>
                                <span style={{
                                    width: '8px', height: '8px', borderRadius: '50%',
                                    background: STATUS_COLORS[status], flexShrink: 0, display: 'inline-block',
                                }} />
                                <span style={{
                                    fontSize: '11px', fontWeight: 600, color: color.textMuted,
                                    textTransform: 'uppercase', letterSpacing: '0.06em', flex: 1,
                                }}>
                                    {STATUS_LABELS[status]}
                                </span>
                                <span style={{
                                    fontSize: '10px', color: color.textFaint,
                                    background: color.bgBase, borderRadius: '10px',
                                    padding: '1px 6px', border: `1px solid ${color.border}`,
                                }}>
                                    {col.length}
                                </span>
                            </div>

                            {/* Cards */}
                            <div style={{ flex: 1, overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {col.length === 0 && (
                                    <div style={{
                                        border: `1px dashed ${isOver ? color.borderMuted : color.border}`,
                                        borderRadius: '6px', padding: '20px 10px',
                                        textAlign: 'center', color: color.textFaint,
                                        fontSize: '11px', fontStyle: 'italic',
                                        transition: 'border-color 0.1s',
                                    }}>
                                        {isOver ? 'Drop here' : 'No tasks'}
                                    </div>
                                )}
                                {col.map(task => (
                                    <div
                                        key={task.id}
                                        draggable
                                        onDragStart={() => setDragTaskId(task.id)}
                                        onDragEnd={() => { setDragTaskId(null); setDragOverStatus(null) }}
                                        style={{
                                            background: color.bgBase,
                                            border: `1px solid ${color.borderMuted}`,
                                            borderRadius: '6px', padding: '10px 10px 8px',
                                            cursor: 'grab', opacity: dragTaskId === task.id ? 0.35 : 1,
                                            transition: 'opacity 0.1s', display: 'flex',
                                            flexDirection: 'column', gap: '6px',
                                            position: 'relative',
                                        }}
                                        onMouseEnter={e => (e.currentTarget.style.borderColor = color.border)}
                                        onMouseLeave={e => (e.currentTarget.style.borderColor = color.borderMuted)}
                                    >
                                        {/* Title + delete */}
                                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                                            <span style={{
                                                flex: 1, fontSize: '12px', fontWeight: 500,
                                                color: task.status === 'completed' || task.status === 'cancelled' ? color.textFaint : color.textPrimary,
                                                textDecoration: task.status === 'completed' || task.status === 'cancelled' ? 'line-through' : 'none',
                                                lineHeight: 1.4, wordBreak: 'break-word',
                                            }}>
                                                {task.title}
                                            </span>
                                            <button
                                                onClick={() => onDeleteTask(task)}
                                                style={{
                                                    flexShrink: 0, background: 'transparent', border: 'none',
                                                    color: color.textFaint, cursor: 'pointer', padding: 0,
                                                    fontSize: '14px', lineHeight: 1, opacity: 0, transition: 'opacity 0.1s',
                                                }}
                                                onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = color.danger }}
                                                onMouseLeave={e => { e.currentTarget.style.opacity = '0'; e.currentTarget.style.color = color.textFaint }}
                                            >
                                                ×
                                            </button>
                                        </div>

                                        {/* Body snippet */}
                                        {task.body && (
                                            <span style={{
                                                fontSize: '11px', color: color.textMuted,
                                                lineHeight: 1.4, wordBreak: 'break-word',
                                                display: '-webkit-box', WebkitLineClamp: 2,
                                                WebkitBoxOrient: 'vertical', overflow: 'hidden',
                                            }}>
                                                {task.body}
                                            </span>
                                        )}

                                        {/* Footer: priority + assignees */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                                            <PriorityBadge priority={task.priority} />
                                            {task.assignees.map(a => (
                                                <span key={a} style={{
                                                    background: color.accentSubtle, border: `1px solid ${color.accentEmphasis}`,
                                                    borderRadius: '10px', padding: '1px 6px',
                                                    color: color.accentMuted, fontSize: '10px',
                                                }}>{a}</span>
                                            ))}
                                        </div>

                                        {/* Planning indicators */}
                                        {(task.acceptance_criteria.length > 0 || task.testing_methods.length > 0 || task.validation_steps.length > 0) && (
                                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                                {task.acceptance_criteria.length > 0 && (
                                                    <span style={{ fontSize: '10px', color: color.success }}>
                                                        ✓ {task.acceptance_criteria.length} criteria
                                                    </span>
                                                )}
                                                {task.testing_methods.length > 0 && (
                                                    <span style={{ fontSize: '10px', color: color.accent }}>
                                                        ⬡ {task.testing_methods.length} tests
                                                    </span>
                                                )}
                                                {task.validation_steps.length > 0 && (
                                                    <span style={{ fontSize: '10px', color: color.warning }}>
                                                        ◎ {task.validation_steps.length} steps
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ))}

                                {/* Add task shortcut at bottom of column */}
                                {status === 'pending' && (
                                    <button
                                        onClick={onOpenCreateTask}
                                        style={{
                                            background: 'transparent', border: `1px dashed ${color.border}`,
                                            borderRadius: '6px', color: color.textFaint, fontSize: '11px',
                                            padding: '8px', cursor: 'pointer', textAlign: 'center',
                                            marginTop: col.length > 0 ? '2px' : '0',
                                        }}
                                        onMouseEnter={e => { e.currentTarget.style.color = color.textMuted; e.currentTarget.style.borderColor = color.borderMuted }}
                                        onMouseLeave={e => { e.currentTarget.style.color = color.textFaint; e.currentTarget.style.borderColor = color.border }}
                                    >
                                        + Add task
                                    </button>
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

// ─── Terminal factory ─────────────────────────────────────────────────────────
// xterm.js requires raw hex values — CSS variables are not supported.
// These intentionally mirror the design tokens but must stay as hex strings.
const XTERM_THEME = {
    background: '#0d1117', foreground: '#c9d1d9', cursor: '#7ee787', cursorAccent: '#0d1117',
    selectionBackground: '#264f78', black: '#484f58', brightBlack: '#6e7681',
    red: '#ff7b72', brightRed: '#ffa198', green: '#3fb950', brightGreen: '#56d364',
    yellow: '#d29922', brightYellow: '#e3b341', blue: '#58a6ff', brightBlue: '#79c0ff',
    magenta: '#bc8cff', brightMagenta: '#d2a8ff', cyan: '#39c5cf', brightCyan: '#56d4dd',
    white: '#b1bac4', brightWhite: '#f0f6fc',
}

function makeTerminal() {
    return new Terminal({
        theme: XTERM_THEME,
        fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
        fontSize: 14, lineHeight: 1.2, cursorBlink: true, scrollback: 5000,
    })
}

// ─── Claude status badge ──────────────────────────────────────────────────────

function ClaudeStatusBadge({ status }: { status?: 'running' | 'done' }) {
    if (!status) return null
    if (status === 'running') {
        return (
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '8px' }}>
                <DotsIndicator />
                <span style={{ color: color.warning, fontSize: '11px', fontFamily: '"JetBrains Mono", monospace' }}>running</span>
            </span>
        )
    }
    return (
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px', marginLeft: '6px' }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: color.success }} />
            <span style={{ color: color.success, fontSize: '11px', fontFamily: '"JetBrains Mono", monospace' }}>done</span>
        </span>
    )
}

// ─── Persistent layout ────────────────────────────────────────────────────────

export default function AppLayout({ children }: { children: React.ReactNode }) {
    const { props } = usePage<{ project?: string }>()
    const projectName = props.project

    const [workspaces, setWorkspaces] = useState<Workspace[]>([])
    const [allProjects, setAllProjects] = useState<Project[]>([])
    const [showWorkspaceModal, setShowWorkspaceModal] = useState(false)
    const [addProjectWorkspaceId, setAddProjectWorkspaceId] = useState<number | null | undefined>(undefined)
    const [movingProject, setMovingProject] = useState<Project | null>(null)
    const [tasks, setTasks] = useState<Task[]>([])
    // 'running' = Claude is working, 'done' = Claude finished (Stop hook received)
    const [claudeStatus, setClaudeStatus] = useState<Record<number, 'running' | 'done'>>({})

    const [projectView, setProjectView] = useState<ProjectView>('agents')
    const [showCreateTask, setShowCreateTask] = useState(false)
    const [isDraggingOver, setIsDraggingOver] = useState(false)

    const sessions = useRef<Map<number, Session>>(new Map())
    const containerRefs = useRef<Map<number, HTMLDivElement | null>>(new Map())
    const fileInputRef = useRef<HTMLInputElement>(null)

    const activeProject = allProjects.find(p => p.name === projectName) ?? allProjects[0] ?? null

    // Flatten all projects from workspaces for terminal management
    const workspaceProjects = workspaces.flatMap(w => w.projects)
    const unassignedProjects = allProjects.filter(p => p.workspace_id === null || p.workspace_id === undefined)

    useEffect(() => {
        Promise.all([
            fetch('/api/workspaces').then(r => r.json()),
            fetch('/api/projects').then(r => r.json()),
        ]).then(([ws, ps]: [Workspace[], Project[]]) => {
            setWorkspaces(ws)
            setAllProjects(ps)
            // Restore status from DB — map 'idle' → 'done' for the frontend
            const initial: Record<number, 'running' | 'done'> = {}
            for (const p of ps) {
                if (p.claude_status === 'running') initial[p.id] = 'running'
                else if (p.claude_status === 'idle') initial[p.id] = 'done'
            }
            setClaudeStatus(initial)
        }).catch(() => {})
    }, [])

    useEffect(() => {
        if (!activeProject) { setTasks([]); return }
        fetch(`/api/projects/${activeProject.id}/tasks`)
            .then(r => r.json())
            .then(setTasks)
            .catch(() => {})
    }, [activeProject?.id])

    async function handleAddTask(title: string, body: string, assignees: string[]) {
        if (!activeProject) return
        const res = await fetch(`/api/projects/${activeProject.id}/tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, body, assignees }),
        })
        if (res.ok) { const task = await res.json(); setTasks(prev => [...prev, task]) }
    }

    async function handleUpdateStatus(task: Task, status: Task['status']) {
        const res = await fetch(`/api/tasks/${task.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
        })
        if (res.ok) setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status } : t))
    }

    async function handleDeleteTask(task: Task) {
        await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' })
        setTasks(prev => prev.filter(t => t.id !== task.id))
    }

    useEffect(() => {
        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            if (sessions.current.size > 0) e.preventDefault()
        }
        window.addEventListener('beforeunload', onBeforeUnload)
        return () => window.removeEventListener('beforeunload', onBeforeUnload)
    }, [])

    useEffect(() => {
        const block = (e: KeyboardEvent) => {
            if (['Enter', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.key)) e.preventDefault()
        }
        document.addEventListener('keydown', block)
        return () => document.removeEventListener('keydown', block)
    }, [])

    useEffect(() => {
        return () => {
            sessions.current.forEach(({ term, ws, observer }) => {
                observer.disconnect()
                term.dispose()
                ws.close()
            })
        }
    }, [])

    useEffect(() => {
        if (!activeProject) return
        const container = containerRefs.current.get(activeProject.id)
        if (!container) return

        if (sessions.current.has(activeProject.id)) {
            const { fitAddon, term } = sessions.current.get(activeProject.id)!
            requestAnimationFrame(() => { fitAddon.fit(); term.focus() })
            return
        }

        const term = makeTerminal()
        const fitAddon = new FitAddon()
        term.loadAddon(fitAddon)
        term.open(container)
        fitAddon.fit()

        const textarea = container.querySelector('textarea')
        if (textarea) {
            textarea.setAttribute('autocomplete', 'off')
            textarea.setAttribute('autocorrect', 'off')
            textarea.setAttribute('autocapitalize', 'none')
            textarea.setAttribute('spellcheck', 'false')
        }

        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
        const ws = new WebSocket(`${protocol}//${location.host}/${activeProject.name}/ws?path=${encodeURIComponent(activeProject.path)}`)
        ws.binaryType = 'arraybuffer'
        ws.onopen = () => {
            ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
            setClaudeStatus(prev => ({ ...prev, [activeProject.id]: 'running' }))
        }
        ws.onmessage = e => {
            if (typeof e.data === 'string') {
                try {
                    const msg = JSON.parse(e.data)
                    if (msg.type === 'claude_stopped') {
                        setClaudeStatus(prev => ({ ...prev, [activeProject.id]: 'done' }))
                    }
                } catch { /* ignore */ }
            } else {
                term.write(new Uint8Array(e.data as ArrayBuffer))
            }
        }
        ws.onclose = () => term.write('\r\n\x1b[31m[disconnected]\x1b[0m\r\n')

        term.attachCustomKeyEventHandler(e => {
            if (e.key === 'Enter' && e.ctrlKey && e.type === 'keydown') {
                if (ws.readyState === WebSocket.OPEN) ws.send(new TextEncoder().encode('\n'))
                return false
            }
            return true
        })
        term.onData(data => { if (ws.readyState === WebSocket.OPEN) ws.send(new TextEncoder().encode(data)) })
        term.onResize(({ cols, rows }) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows }))
        })

        container.addEventListener('click', () => term.focus())
        term.focus()

        const observer = new ResizeObserver(() => fitAddon.fit())
        observer.observe(container)

        sessions.current.set(activeProject.id, { term, ws, fitAddon, observer })
    }, [activeProject])

    function handleWorkspaceCreated(workspace: Workspace) {
        setWorkspaces(prev => [...prev, workspace])
    }

    function handleProjectCreated(project: Project) {
        setAllProjects(prev => [...prev, project])
        // Also update workspace's project list if it belongs to one
        if (project.workspace_id !== null && project.workspace_id !== undefined) {
            setWorkspaces(prev => prev.map(w =>
                w.id === project.workspace_id
                    ? { ...w, projects: [...w.projects, project] }
                    : w
            ))
        }
        router.visit(`/${project.name}`)
    }

    function openAddProject(workspaceId: number | null) {
        setAddProjectWorkspaceId(workspaceId)
    }

    async function handleMoveProject(project: Project, newWorkspaceId: number | null) {
        const res = await fetch(`/api/projects/${project.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workspace_id: newWorkspaceId }),
        })
        if (!res.ok) throw new Error('Failed to move project')
        const updated: Project = await res.json()

        setAllProjects(prev => prev.map(p => p.id === project.id ? updated : p))
        setWorkspaces(prev => prev.map(w => {
            // Remove from old workspace
            if (w.id === project.workspace_id) {
                return { ...w, projects: w.projects.filter(p => p.id !== project.id) }
            }
            // Add to new workspace
            if (w.id === newWorkspaceId) {
                return { ...w, projects: [...w.projects, updated] }
            }
            return w
        }))
    }

    async function uploadImage(file: File) {
        if (!activeProject) return
        if (!file.type.startsWith('image/')) return
        const formData = new FormData()
        formData.append('file', file)
        const res = await fetch(`/api/projects/${activeProject.id}/upload-image`, {
            method: 'POST',
            body: formData,
        })
        if (!res.ok) return
        const { path } = await res.json()
        const session = sessions.current.get(activeProject.id)
        if (session && session.ws.readyState === WebSocket.OPEN) {
            session.ws.send(new TextEncoder().encode(path))
        }
    }

    return (
        <div style={{ display: 'flex', width: '100%', height: '100vh', background: color.bgBase, overflow: 'hidden' }}>
            <Sidebar
                workspaces={workspaces}
                unassignedProjects={unassignedProjects}
                activeId={activeProject?.id ?? null}
                onAddWorkspace={() => setShowWorkspaceModal(true)}
                onAddProject={openAddProject}
                onMoveProject={setMovingProject}
                tasks={tasks}
                onOpenCreateTask={() => setShowCreateTask(true)}
                onUpdateStatus={handleUpdateStatus}
                onDeleteTask={handleDeleteTask}
                claudeStatus={claudeStatus}
            />

            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                {/* Tab bar */}
                <div style={{
                    height: '36px', background: color.bgCanvas, borderBottom: '1px solid #21262d',
                    display: 'flex', alignItems: 'center', paddingLeft: '12px', gap: '6px', flexShrink: 0,
                }}>
                    {activeProject ? (
                        <>
                            <svg width="13" height="13" viewBox="0 0 16 16" fill={color.success}>
                                <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0114.25 15H1.75A1.75 1.75 0 010 13.25V2.75zm1.75-.25a.25.25 0 00-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25V2.75a.25.25 0 00-.25-.25H1.75zM8 4a.75.75 0 01.75.75v3.5h3.5a.75.75 0 010 1.5h-4.25a.75.75 0 01-.75-.75v-4.25A.75.75 0 018 4zM5 4a.75.75 0 01.75.75v6.5a.75.75 0 01-1.5 0v-6.5A.75.75 0 015 4z"/>
                            </svg>
                            <span style={{ color: color.textSecondary, fontSize: '12px', fontFamily: '"JetBrains Mono", monospace' }}>{activeProject.name}</span>
                            <span style={{ color: color.textFaint, fontSize: '12px', fontFamily: '"JetBrains Mono", monospace' }}>—</span>
                            <span style={{ color: color.textMuted, fontSize: '12px', fontFamily: '"JetBrains Mono", monospace' }}>{activeProject.path}</span>
                            <ClaudeStatusBadge status={claudeStatus[activeProject.id]} />
                            {projectView === 'agents' && (
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    title="Attach image"
                                    style={{
                                        marginLeft: 'auto', marginRight: '8px',
                                        background: 'transparent', border: 'none',
                                        color: color.textFaint, padding: '4px', cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', borderRadius: '4px',
                                        transition: 'color 0.15s',
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.color = color.accent }}
                                    onMouseLeave={e => { e.currentTarget.style.color = color.textFaint }}
                                >
                                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M4.5 3a2.5 2.5 0 015 0v9a1.5 1.5 0 01-3 0V5a.5.5 0 011 0v7a.5.5 0 001 0V3a1.5 1.5 0 10-3 0v9a2.5 2.5 0 005 0V5a.5.5 0 011 0v7a3.5 3.5 0 11-7 0V3z"/>
                                    </svg>
                                </button>
                            )}
                        </>
                    ) : (
                        <span style={{ color: color.textFaint, fontSize: '12px', fontFamily: '"JetBrains Mono", monospace' }}>No project selected</span>
                    )}
                </div>

                {/* Body: project sidebar + content */}
                <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                    {activeProject && (
                        <ProjectSidebar view={projectView} onChange={setProjectView} />
                    )}

                    {/* Agents (terminal) — always rendered to keep sessions alive, hidden when inactive */}
                    <div
                        style={{
                            flex: 1, position: 'relative', overflow: 'hidden',
                            display: projectView === 'agents' ? 'flex' : 'none', flexDirection: 'column',
                        }}
                        onDragOver={e => { e.preventDefault(); setIsDraggingOver(true) }}
                        onDragEnter={e => { e.preventDefault(); setIsDraggingOver(true) }}
                        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDraggingOver(false) }}
                        onDrop={e => {
                            e.preventDefault()
                            setIsDraggingOver(false)
                            const file = e.dataTransfer.files[0]
                            if (file) uploadImage(file)
                        }}
                    >
                        {isDraggingOver && activeProject && (
                            <div style={{
                                position: 'absolute', inset: 0, zIndex: 10,
                                background: color.accentGlow,
                                border: `2px dashed ${color.accent}`, borderRadius: '4px',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                pointerEvents: 'none',
                            }}>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                                    <svg width="36" height="36" viewBox="0 0 16 16" fill={color.accent} opacity="0.8">
                                        <path d="M1.75 2.5a.25.25 0 00-.25.25v10.5c0 .138.112.25.25.25h.94l.03-.013 4.013-4.013a1.75 1.75 0 012.474 0L13.62 13.5h.63a.25.25 0 00.25-.25V2.75a.25.25 0 00-.25-.25H1.75zM0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0114.25 15H1.75A1.75 1.75 0 010 13.25V2.75zm9.5 3.5a1 1 0 11-2 0 1 1 0 012 0z"/>
                                    </svg>
                                    <span style={{ color: color.accent, fontSize: '13px', fontFamily: '"JetBrains Mono", monospace' }}>
                                        Drop image to attach
                                    </span>
                                </div>
                            </div>
                        )}

                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            style={{ display: 'none' }}
                            onChange={e => {
                                const file = e.target.files?.[0]
                                if (file) uploadImage(file)
                                e.target.value = ''
                            }}
                        />

                        {allProjects.map(project => (
                            <div
                                key={project.id}
                                ref={el => containerRefs.current.set(project.id, el)}
                                style={{
                                    position: 'absolute', inset: 0, padding: '8px', boxSizing: 'border-box',
                                    display: project.id === activeProject?.id ? 'block' : 'none',
                                }}
                            />
                        ))}
                    </div>

                    {/* Commands view */}
                    {projectView === 'commands' && activeProject && (
                        <CommandsView projectId={activeProject.id} />
                    )}

                    {/* Tasks view */}
                    {projectView === 'tasks' && activeProject && (
                        <TasksView
                            tasks={tasks}
                            onOpenCreateTask={() => setShowCreateTask(true)}
                            onUpdateStatus={handleUpdateStatus}
                            onDeleteTask={handleDeleteTask}
                        />
                    )}

                    {/* Empty state when no project */}
                    {!activeProject && (
                        <div style={{
                            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                            <span style={{ color: color.textFaint, fontSize: '13px' }}>No project selected</span>
                        </div>
                    )}
                </div>
            </div>

            {showCreateTask && (
                <CreateTaskModal
                    onClose={() => setShowCreateTask(false)}
                    onCreated={(title, body, assignees) => handleAddTask(title, body, assignees)}
                />
            )}

            {showWorkspaceModal && (
                <AddWorkspaceModal
                    onClose={() => setShowWorkspaceModal(false)}
                    onCreated={handleWorkspaceCreated}
                />
            )}

            {addProjectWorkspaceId !== undefined && (
                <AddProjectModal
                    workspaces={workspaces}
                    defaultWorkspaceId={addProjectWorkspaceId}
                    onClose={() => setAddProjectWorkspaceId(undefined)}
                    onCreated={handleProjectCreated}
                />
            )}

            {movingProject && (
                <MoveProjectModal
                    project={movingProject}
                    workspaces={workspaces}
                    onClose={() => setMovingProject(null)}
                    onMove={handleMoveProject}
                />
            )}

            {children}
        </div>
    )
}
