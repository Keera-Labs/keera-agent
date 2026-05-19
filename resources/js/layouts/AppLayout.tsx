import { useEffect, useRef, useState } from 'react'
import { router, usePage } from '@inertiajs/react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

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
    description: string
    status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
    created_at: string
}

const STATUS_CYCLE: Task['status'][] = ['pending', 'in_progress', 'completed', 'cancelled']
const STATUS_COLORS: Record<Task['status'], string> = {
    pending:     '#7d8590',
    in_progress: '#d29922',
    completed:   '#3fb950',
    cancelled:   '#484f58',
}

const LANG_COLORS: Record<string, string> = {
    Python:     '#3572A5',
    TypeScript: '#3178c6',
    Go:         '#00ADD8',
    Rust:       '#dea584',
    JavaScript: '#f1e05a',
}

const LANGUAGES = ['Python', 'TypeScript', 'JavaScript', 'Go', 'Rust', 'Other']

// ─── Shared styles ────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = { color: '#7d8590', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }
const inputStyle: React.CSSProperties = {
    background: '#0d1117', border: '1px solid #30363d', borderRadius: '6px',
    color: '#e6edf3', fontSize: '13px', padding: '6px 10px',
    fontFamily: '"JetBrains Mono", monospace', outline: 'none',
}
const cancelBtnStyle: React.CSSProperties = {
    background: 'transparent', border: '1px solid #30363d', borderRadius: '6px',
    color: '#7d8590', fontSize: '12px', padding: '6px 14px', cursor: 'pointer',
}
const submitBtnStyle: React.CSSProperties = {
    background: '#238636', border: '1px solid #2ea043', borderRadius: '6px',
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
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
            <div style={{
                background: '#161b22', border: '1px solid #30363d', borderRadius: '8px',
                padding: '24px', width: '340px', display: 'flex', flexDirection: 'column', gap: '14px',
            }}>
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <h2 style={{ margin: 0, color: '#e6edf3', fontSize: '15px', fontWeight: 600 }}>New Workspace</h2>
                    {error && <span style={{ color: '#ff7b72', fontSize: '12px' }}>{error}</span>}
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
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
            <div style={{
                background: '#161b22', border: '1px solid #30363d', borderRadius: '8px',
                padding: '24px', width: '340px', display: 'flex', flexDirection: 'column', gap: '14px',
            }}>
                {confirmCreate ? (
                    <>
                        <h2 style={{ margin: 0, color: '#e6edf3', fontSize: '15px', fontWeight: 600 }}>Directory not found</h2>
                        <p style={{ margin: 0, color: '#7d8590', fontSize: '13px', lineHeight: 1.5 }}>
                            <span style={{ color: '#c9d1d9', fontFamily: '"JetBrains Mono", monospace', fontSize: '12px' }}>{confirmCreate.expanded}</span>
                            {' '}does not exist. Create it?
                        </p>
                        {error && <span style={{ color: '#ff7b72', fontSize: '12px' }}>{error}</span>}
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                            <button type="button" onClick={() => setConfirmCreate(null)} style={cancelBtnStyle}>Back</button>
                            <button type="button" disabled={loading} onClick={createProject} style={submitBtnStyle}>
                                {loading ? 'Creating…' : 'Create & Add'}
                            </button>
                        </div>
                    </>
                ) : (
                    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        <h2 style={{ margin: 0, color: '#e6edf3', fontSize: '15px', fontWeight: 600 }}>New Project</h2>
                        {error && <span style={{ color: '#ff7b72', fontSize: '12px' }}>{error}</span>}
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

// ─── Sidebar ──────────────────────────────────────────────────────────────────

function SectionHeader({ label, onAdd }: { label: string; onAdd?: () => void }) {
    return (
        <div style={{
            padding: '10px 16px 6px', display: 'flex', alignItems: 'center', gap: '6px',
        }}>
            <span style={{ color: '#7d8590', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', flex: 1 }}>
                {label}
            </span>
            {onAdd && (
                <button onClick={onAdd} title={`Add ${label.toLowerCase()}`} style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: '#7d8590', padding: '0', lineHeight: 1, display: 'flex', alignItems: 'center',
                }}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M7.75 2a.75.75 0 01.75.75V7h4.25a.75.75 0 010 1.5H8.5v4.25a.75.75 0 01-1.5 0V8.5H2.75a.75.75 0 010-1.5H7V2.75A.75.75 0 017.75 2z"/>
                    </svg>
                </button>
            )}
        </div>
    )
}

function ProjectItem({ project, active }: { project: Project; active: boolean }) {
    return (
        <button
            onClick={() => router.visit(`/${project.name}`)}
            style={{
                width: '100%', display: 'flex', flexDirection: 'column', gap: '2px',
                padding: '5px 16px 5px 24px', background: active ? '#161b22' : 'transparent',
                border: 'none', borderLeft: `2px solid ${active ? '#58a6ff' : 'transparent'}`,
                cursor: 'pointer', textAlign: 'left',
            }}
        >
            <span style={{
                color: active ? '#e6edf3' : '#c9d1d9', fontSize: '12px',
                fontWeight: active ? 600 : 400, fontFamily: '"JetBrains Mono", monospace',
            }}>
                {project.name}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{
                    width: '6px', height: '6px', borderRadius: '50%',
                    background: LANG_COLORS[project.language] ?? '#7d8590', flexShrink: 0,
                }} />
                <span style={{ color: '#7d8590', fontSize: '11px' }}>{project.language}</span>
            </span>
        </button>
    )
}

function WorkspaceSection({
    workspace,
    activeId,
    onAddProject,
}: {
    workspace: Workspace
    activeId: number | null
    onAddProject: (workspaceId: number) => void
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
                        width="10" height="10" viewBox="0 0 16 16" fill="#7d8590"
                        style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', flexShrink: 0 }}
                    >
                        <path d="M4.427 7.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 7H4.604a.25.25 0 00-.177.427z"/>
                    </svg>
                    <span style={{
                        color: '#8b949e', fontSize: '11px', fontWeight: 600,
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
                        color: '#484f58', padding: '0 2px', lineHeight: 1,
                        display: 'flex', alignItems: 'center', flexShrink: 0,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#7d8590')}
                    onMouseLeave={e => (e.currentTarget.style.color = '#484f58')}
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
                        <li style={{ padding: '4px 16px 4px 28px', color: '#484f58', fontSize: '11px', fontStyle: 'italic' }}>
                            No projects
                        </li>
                    )}
                    {workspace.projects.map(project => (
                        <li key={project.id}>
                            <ProjectItem project={project} active={project.id === activeId} />
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}

function Sidebar({
    workspaces,
    unassignedProjects,
    activeId,
    onAddWorkspace,
    onAddProject,
    tasks,
    onAddTask,
    onCycleStatus,
    onDeleteTask,
}: {
    workspaces: Workspace[]
    unassignedProjects: Project[]
    activeId: number | null
    onAddWorkspace: () => void
    onAddProject: (workspaceId: number | null) => void
    tasks: Task[]
    onAddTask: (desc: string) => void
    onCycleStatus: (task: Task) => void
    onDeleteTask: (task: Task) => void
}) {
    const [newTask, setNewTask] = useState('')
    const [addingTask, setAddingTask] = useState(false)

    function submitTask(e: React.FormEvent) {
        e.preventDefault()
        const desc = newTask.trim()
        if (!desc) return
        onAddTask(desc)
        setNewTask('')
        setAddingTask(false)
    }

    return (
        <aside style={{
            width: '240px', flexShrink: 0, background: '#010409',
            borderRight: '1px solid #21262d', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}>
            {/* App header */}
            <div style={{
                padding: '14px 16px 12px', borderBottom: '1px solid #21262d',
                display: 'flex', alignItems: 'center', gap: '8px',
            }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="#58a6ff">
                    <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0114.25 15H1.75A1.75 1.75 0 010 13.25V2.75zm1.75-.25a.25.25 0 00-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25V2.75a.25.25 0 00-.25-.25H1.75zM8 4a.75.75 0 01.75.75v3.5h3.5a.75.75 0 010 1.5h-4.25a.75.75 0 01-.75-.75v-4.25A.75.75 0 018 4zM5 4a.75.75 0 01.75.75v6.5a.75.75 0 01-1.5 0v-6.5A.75.75 0 015 4z"/>
                </svg>
                <span style={{ color: '#e6edf3', fontSize: '14px', fontWeight: 700, letterSpacing: '0.01em' }}>
                    Keera
                </span>
            </div>

            {/* Workspaces + Projects section */}
            <div style={{ overflowY: 'auto', maxHeight: '55%', display: 'flex', flexDirection: 'column' }}>
                <SectionHeader label="Workspaces" onAdd={onAddWorkspace} />

                {workspaces.length === 0 && (
                    <p style={{ margin: '0 16px 8px', color: '#484f58', fontSize: '11px', fontStyle: 'italic' }}>
                        No workspaces yet
                    </p>
                )}

                {workspaces.map(workspace => (
                    <WorkspaceSection
                        key={workspace.id}
                        workspace={workspace}
                        activeId={activeId}
                        onAddProject={onAddProject}
                    />
                ))}

                {/* Unassigned projects */}
                {unassignedProjects.length > 0 && (
                    <>
                        <div style={{ height: '1px', background: '#21262d', margin: '4px 0' }} />
                        <div style={{ padding: '5px 16px 4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ color: '#484f58', fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', flex: 1 }}>
                                Unassigned
                            </span>
                            <button
                                onClick={() => onAddProject(null)}
                                title="Add project"
                                style={{
                                    background: 'transparent', border: 'none', cursor: 'pointer',
                                    color: '#484f58', padding: '0 2px', lineHeight: 1, display: 'flex', alignItems: 'center',
                                }}
                                onMouseEnter={e => (e.currentTarget.style.color = '#7d8590')}
                                onMouseLeave={e => (e.currentTarget.style.color = '#484f58')}
                            >
                                <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                                    <path d="M7.75 2a.75.75 0 01.75.75V7h4.25a.75.75 0 010 1.5H8.5v4.25a.75.75 0 01-1.5 0V8.5H2.75a.75.75 0 010-1.5H7V2.75A.75.75 0 017.75 2z"/>
                                </svg>
                            </button>
                        </div>
                        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                            {unassignedProjects.map(project => (
                                <li key={project.id}>
                                    <ProjectItem project={project} active={project.id === activeId} />
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
                            margin: '0 16px 8px', background: 'transparent', border: '1px dashed #30363d',
                            borderRadius: '6px', color: '#484f58', fontSize: '11px', padding: '6px',
                            cursor: 'pointer', textAlign: 'center',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#7d8590'; e.currentTarget.style.borderColor = '#7d8590' }}
                        onMouseLeave={e => { e.currentTarget.style.color = '#484f58'; e.currentTarget.style.borderColor = '#30363d' }}
                    >
                        + Add project
                    </button>
                )}
            </div>

            {/* Divider */}
            <div style={{ height: '1px', background: '#21262d', margin: '4px 0' }} />

            {/* Tasks section */}
            <SectionHeader label="Tasks" onAdd={() => setAddingTask(true)} />
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                <ul style={{ listStyle: 'none', margin: 0, padding: '0 0 4px', flex: 1 }}>
                    {tasks.length === 0 && !addingTask && (
                        <li style={{ padding: '6px 16px', color: '#484f58', fontSize: '12px', fontStyle: 'italic' }}>
                            No tasks yet
                        </li>
                    )}
                    {tasks.map(task => (
                        <li key={task.id} style={{ display: 'flex', alignItems: 'flex-start', padding: '5px 12px 5px 16px', gap: '8px' }}>
                            <button
                                onClick={() => onCycleStatus(task)}
                                title={task.status}
                                style={{
                                    flexShrink: 0, marginTop: '3px',
                                    width: '10px', height: '10px', borderRadius: '50%',
                                    background: STATUS_COLORS[task.status],
                                    border: 'none', cursor: 'pointer', padding: 0,
                                }}
                            />
                            <span style={{
                                flex: 1, fontSize: '12px', color: task.status === 'completed' ? '#484f58' : '#c9d1d9',
                                textDecoration: task.status === 'completed' ? 'line-through' : 'none',
                                lineHeight: 1.4, wordBreak: 'break-word',
                            }}>
                                {task.description}
                            </span>
                            <button
                                onClick={() => onDeleteTask(task)}
                                style={{
                                    flexShrink: 0, background: 'transparent', border: 'none',
                                    color: '#484f58', cursor: 'pointer', padding: '0 2px', lineHeight: 1,
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

                {addingTask && (
                    <form onSubmit={submitTask} style={{ padding: '4px 12px 8px 16px', display: 'flex', gap: '6px' }}>
                        <input
                            autoFocus
                            value={newTask}
                            onChange={e => setNewTask(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Escape') setAddingTask(false) }}
                            placeholder="Task description…"
                            style={{
                                flex: 1, background: '#0d1117', border: '1px solid #30363d',
                                borderRadius: '4px', color: '#e6edf3', fontSize: '12px',
                                padding: '4px 8px', outline: 'none',
                            }}
                        />
                        <button type="submit" style={{
                            background: '#238636', border: 'none', borderRadius: '4px',
                            color: '#fff', fontSize: '11px', padding: '4px 8px', cursor: 'pointer',
                        }}>Add</button>
                    </form>
                )}
            </div>
        </aside>
    )
}

// ─── Terminal factory ─────────────────────────────────────────────────────────

function makeTerminal() {
    return new Terminal({
        theme: {
            background: '#0d1117', foreground: '#c9d1d9', cursor: '#7ee787', cursorAccent: '#0d1117',
            selectionBackground: '#264f78', black: '#484f58', brightBlack: '#6e7681',
            red: '#ff7b72', brightRed: '#ffa198', green: '#3fb950', brightGreen: '#56d364',
            yellow: '#d29922', brightYellow: '#e3b341', blue: '#58a6ff', brightBlue: '#79c0ff',
            magenta: '#bc8cff', brightMagenta: '#d2a8ff', cyan: '#39c5cf', brightCyan: '#56d4dd',
            white: '#b1bac4', brightWhite: '#f0f6fc',
        },
        fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
        fontSize: 14, lineHeight: 1.2, cursorBlink: true, scrollback: 5000,
    })
}

// ─── Persistent layout ────────────────────────────────────────────────────────

export default function AppLayout({ children }: { children: React.ReactNode }) {
    const { props } = usePage<{ project?: string }>()
    const projectName = props.project

    const [workspaces, setWorkspaces] = useState<Workspace[]>([])
    const [allProjects, setAllProjects] = useState<Project[]>([])
    const [showWorkspaceModal, setShowWorkspaceModal] = useState(false)
    const [addProjectWorkspaceId, setAddProjectWorkspaceId] = useState<number | null | undefined>(undefined)
    const [tasks, setTasks] = useState<Task[]>([])

    const sessions = useRef<Map<number, Session>>(new Map())
    const containerRefs = useRef<Map<number, HTMLDivElement | null>>(new Map())

    const activeProject = allProjects.find(p => p.name === projectName) ?? allProjects[0] ?? null

    // Flatten all projects from workspaces for terminal management
    const workspaceProjects = workspaces.flatMap(w => w.projects)
    const unassignedProjects = allProjects.filter(p => p.workspace_id === null || p.workspace_id === undefined)

    useEffect(() => {
        Promise.all([
            fetch('/api/workspaces').then(r => r.json()),
            fetch('/api/projects').then(r => r.json()),
        ]).then(([ws, ps]) => {
            setWorkspaces(ws)
            setAllProjects(ps)
        }).catch(() => {})
    }, [])

    useEffect(() => {
        if (!activeProject) { setTasks([]); return }
        fetch(`/api/projects/${activeProject.id}/tasks`)
            .then(r => r.json())
            .then(setTasks)
            .catch(() => {})
    }, [activeProject?.id])

    async function handleAddTask(description: string) {
        if (!activeProject) return
        const res = await fetch(`/api/projects/${activeProject.id}/tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description }),
        })
        if (res.ok) { const task = await res.json(); setTasks(prev => [...prev, task]) }
    }

    async function handleCycleStatus(task: Task) {
        const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(task.status) + 1) % STATUS_CYCLE.length]
        const res = await fetch(`/api/tasks/${task.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: next }),
        })
        if (res.ok) setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: next } : t))
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
        ws.onopen = () => ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
        ws.onmessage = e => term.write(new Uint8Array(e.data as ArrayBuffer))
        ws.onclose = () => term.write('\r\n\x1b[31m[disconnected]\x1b[0m\r\n')

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

    return (
        <div style={{ display: 'flex', width: '100%', height: '100vh', background: '#0d1117', overflow: 'hidden' }}>
            <Sidebar
                workspaces={workspaces}
                unassignedProjects={unassignedProjects}
                activeId={activeProject?.id ?? null}
                onAddWorkspace={() => setShowWorkspaceModal(true)}
                onAddProject={openAddProject}
                tasks={tasks}
                onAddTask={handleAddTask}
                onCycleStatus={handleCycleStatus}
                onDeleteTask={handleDeleteTask}
            />

            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                {/* Tab bar */}
                <div style={{
                    height: '36px', background: '#010409', borderBottom: '1px solid #21262d',
                    display: 'flex', alignItems: 'center', paddingLeft: '12px', gap: '6px', flexShrink: 0,
                }}>
                    {activeProject ? (
                        <>
                            <svg width="13" height="13" viewBox="0 0 16 16" fill="#3fb950">
                                <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0114.25 15H1.75A1.75 1.75 0 010 13.25V2.75zm1.75-.25a.25.25 0 00-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25V2.75a.25.25 0 00-.25-.25H1.75zM8 4a.75.75 0 01.75.75v3.5h3.5a.75.75 0 010 1.5h-4.25a.75.75 0 01-.75-.75v-4.25A.75.75 0 018 4zM5 4a.75.75 0 01.75.75v6.5a.75.75 0 01-1.5 0v-6.5A.75.75 0 015 4z"/>
                            </svg>
                            <span style={{ color: '#c9d1d9', fontSize: '12px', fontFamily: '"JetBrains Mono", monospace' }}>{activeProject.name}</span>
                            <span style={{ color: '#484f58', fontSize: '12px', fontFamily: '"JetBrains Mono", monospace' }}>—</span>
                            <span style={{ color: '#7d8590', fontSize: '12px', fontFamily: '"JetBrains Mono", monospace' }}>{activeProject.path}</span>
                        </>
                    ) : (
                        <span style={{ color: '#484f58', fontSize: '12px', fontFamily: '"JetBrains Mono", monospace' }}>No project selected</span>
                    )}
                </div>

                {/* Terminal containers — one per project, hidden when inactive */}
                <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
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
            </div>

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

            {children}
        </div>
    )
}
