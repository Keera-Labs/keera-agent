import { useEffect, useRef, useState } from 'react'
import { router, usePage } from '@inertiajs/react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface Project {
    id: number
    name: string
    path: string
    language: string
}

const LANG_COLORS: Record<string, string> = {
    Python:     '#3572A5',
    TypeScript: '#3178c6',
    Go:         '#00ADD8',
    Rust:       '#dea584',
    JavaScript: '#f1e05a',
}

const LANGUAGES = ['Python', 'TypeScript', 'JavaScript', 'Go', 'Rust', 'Other']

function AddProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Project) => void }) {
    const [name, setName] = useState('')
    const [path, setPath] = useState('')
    const [language, setLanguage] = useState('Python')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const [confirmCreate, setConfirmCreate] = useState<{ expanded: string } | null>(null)

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError('')
        setLoading(true)
        try {
            // Validate the path first
            const check = await fetch(`/api/validate-path?path=${encodeURIComponent(path)}`)
            const { exists, expanded } = await check.json()

            if (!exists) {
                setConfirmCreate({ expanded })
                return
            }

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
                body: JSON.stringify({ name, path, language }),
            })
            const data = await res.json()
            if (!res.ok) {
                setConfirmCreate(null)
                setError(data.error ?? 'Something went wrong')
                return
            }
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
                            <span style={{ color: '#c9d1d9', fontFamily: '"JetBrains Mono", monospace', fontSize: '12px' }}>
                                {confirmCreate.expanded}
                            </span>
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

                        {error && (
                            <span style={{ color: '#ff7b72', fontSize: '12px' }}>{error}</span>
                        )}

                        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <span style={{ color: '#7d8590', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Name</span>
                            <input
                                value={name} onChange={e => setName(e.target.value)}
                                placeholder="my-project" required
                                style={inputStyle}
                            />
                        </label>

                        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <span style={{ color: '#7d8590', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Path</span>
                            <input
                                value={path} onChange={e => setPath(e.target.value)}
                                placeholder="~/code/my-project" required
                                style={inputStyle}
                            />
                        </label>

                        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <span style={{ color: '#7d8590', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Language</span>
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

function Sidebar({
    projects,
    activeId,
    onAdd,
}: {
    projects: Project[]
    activeId: number | null
    onAdd: () => void
}) {
    return (
        <aside style={{
            width: '220px',
            flexShrink: 0,
            background: '#010409',
            borderRight: '1px solid #21262d',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
        }}>
            {/* Header */}
            <div style={{
                padding: '14px 16px 10px',
                borderBottom: '1px solid #21262d',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
            }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="#7d8590">
                    <path d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 010-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1V9h-8c-.356 0-.694.074-1 .208V2.5a1 1 0 011-1h8z"/>
                </svg>
                <span style={{ color: '#e6edf3', fontSize: '13px', fontWeight: 600, letterSpacing: '0.01em', flex: 1 }}>
                    Projects
                </span>
                <button
                    onClick={onAdd}
                    title="Add project"
                    style={{
                        background: 'transparent', border: 'none', cursor: 'pointer',
                        color: '#7d8590', padding: '0 2px', lineHeight: 1,
                        display: 'flex', alignItems: 'center',
                    }}
                >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M7.75 2a.75.75 0 01.75.75V7h4.25a.75.75 0 010 1.5H8.5v4.25a.75.75 0 01-1.5 0V8.5H2.75a.75.75 0 010-1.5H7V2.75A.75.75 0 017.75 2z"/>
                    </svg>
                </button>
            </div>

            {/* Project list */}
            <ul style={{ listStyle: 'none', margin: 0, padding: '8px 0', overflowY: 'auto', flex: 1 }}>
                {projects.map(project => {
                    const active = project.id === activeId
                    return (
                        <li key={project.id}>
                            <button
                                onClick={() => router.visit(`/${project.name}`)}
                                style={{
                                    width: '100%',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '3px',
                                    padding: '8px 16px',
                                    background: active ? '#161b22' : 'transparent',
                                    border: 'none',
                                    borderLeft: `2px solid ${active ? '#58a6ff' : 'transparent'}`,
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                }}
                            >
                                <span style={{
                                    color: active ? '#e6edf3' : '#c9d1d9',
                                    fontSize: '13px',
                                    fontWeight: active ? 600 : 400,
                                    fontFamily: '"JetBrains Mono", monospace',
                                }}>
                                    {project.name}
                                </span>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                    <span style={{
                                        width: '8px',
                                        height: '8px',
                                        borderRadius: '50%',
                                        background: LANG_COLORS[project.language] ?? '#7d8590',
                                        flexShrink: 0,
                                    }} />
                                    <span style={{ color: '#7d8590', fontSize: '11px' }}>
                                        {project.language}
                                    </span>
                                </span>
                            </button>
                        </li>
                    )
                })}
            </ul>
        </aside>
    )
}

export default function Home() {
    const containerRef = useRef<HTMLDivElement>(null)
    const { props } = usePage()
    const projectName = (props as any).project as string | undefined

    const [projects, setProjects] = useState<Project[]>([])
    const [showModal, setShowModal] = useState(false)

    useEffect(() => {
        fetch('/api/projects')
            .then(r => r.json())
            .then(setProjects)
            .catch(() => {})
    }, [])

    const activeProject = projects.find(p => p.name === projectName) ?? projects[0] ?? null

    useEffect(() => {
        if (!activeProject || !containerRef.current) return

        const term = new Terminal({
            theme: {
                background: '#0d1117',
                foreground: '#c9d1d9',
                cursor: '#7ee787',
                cursorAccent: '#0d1117',
                selectionBackground: '#264f78',
                black: '#484f58',
                brightBlack: '#6e7681',
                red: '#ff7b72',
                brightRed: '#ffa198',
                green: '#3fb950',
                brightGreen: '#56d364',
                yellow: '#d29922',
                brightYellow: '#e3b341',
                blue: '#58a6ff',
                brightBlue: '#79c0ff',
                magenta: '#bc8cff',
                brightMagenta: '#d2a8ff',
                cyan: '#39c5cf',
                brightCyan: '#56d4dd',
                white: '#b1bac4',
                brightWhite: '#f0f6fc',
            },
            fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
            fontSize: 14,
            lineHeight: 1.2,
            cursorBlink: true,
            scrollback: 5000,
        })

        const fitAddon = new FitAddon()
        term.loadAddon(fitAddon)
        term.open(containerRef.current!)
        fitAddon.fit()

        // Prevent browser from showing passkey / autocomplete suggestions on xterm's hidden textarea
        const xtermTextarea = containerRef.current!.querySelector('textarea')
        if (xtermTextarea) {
            xtermTextarea.setAttribute('autocomplete', 'off')
            xtermTextarea.setAttribute('autocorrect', 'off')
            xtermTextarea.setAttribute('autocapitalize', 'none')
            xtermTextarea.setAttribute('spellcheck', 'false')
        }

        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
        const ws = new WebSocket(`${protocol}//${location.host}/${activeProject.name}/ws?path=${encodeURIComponent(activeProject.path)}`)
        ws.binaryType = 'arraybuffer'

        ws.onopen = () => {
            ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
        }

        ws.onmessage = (e) => {
            term.write(new Uint8Array(e.data as ArrayBuffer))
        }

        ws.onclose = () => {
            term.write('\r\n\x1b[31m[disconnected]\x1b[0m\r\n')
        }

        term.onData((data) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(new TextEncoder().encode(data))
            }
        })

        term.onResize(({ cols, rows }) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'resize', cols, rows }))
            }
        })

        // Keep terminal focused — prevents Enter/arrow keys escaping to the browser
        term.focus()
        const refocus = () => term.focus()
        containerRef.current!.addEventListener('click', refocus)

        // Block keys at the document level so they can't reach the browser even if focus escapes xterm
        const blockEscape = (e: KeyboardEvent) => {
            if (['Enter', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.key)) {
                e.preventDefault()
            }
        }
        document.addEventListener('keydown', blockEscape)

        const observer = new ResizeObserver(() => fitAddon.fit())
        if (containerRef.current) observer.observe(containerRef.current)

        return () => {
            observer.disconnect()
            containerRef.current?.removeEventListener('click', refocus)
            document.removeEventListener('keydown', blockEscape)
            term.dispose()
            ws.close()
        }
    }, [activeProject])

    function handleProjectCreated(project: Project) {
        setProjects(prev => [...prev, project])
        router.visit(`/${project.name}`)
    }

    return (
        <div style={{ display: 'flex', width: '100%', height: '100vh', background: '#0d1117', overflow: 'hidden' }}>
            <Sidebar
                projects={projects}
                activeId={activeProject?.id ?? null}
                onAdd={() => setShowModal(true)}
            />

            {/* Terminal pane */}
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                {/* Tab bar */}
                <div style={{
                    height: '36px',
                    background: '#010409',
                    borderBottom: '1px solid #21262d',
                    display: 'flex',
                    alignItems: 'center',
                    paddingLeft: '12px',
                    gap: '6px',
                    flexShrink: 0,
                }}>
                    {activeProject ? (
                        <>
                            <svg width="13" height="13" viewBox="0 0 16 16" fill="#3fb950">
                                <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0114.25 15H1.75A1.75 1.75 0 010 13.25V2.75zm1.75-.25a.25.25 0 00-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25V2.75a.25.25 0 00-.25-.25H1.75zM8 4a.75.75 0 01.75.75v3.5h3.5a.75.75 0 010 1.5h-4.25a.75.75 0 01-.75-.75v-4.25A.75.75 0 018 4zM5 4a.75.75 0 01.75.75v6.5a.75.75 0 01-1.5 0v-6.5A.75.75 0 015 4z"/>
                            </svg>
                            <span style={{ color: '#c9d1d9', fontSize: '12px', fontFamily: '"JetBrains Mono", monospace' }}>
                                {activeProject.name}
                            </span>
                            <span style={{ color: '#484f58', fontSize: '12px', fontFamily: '"JetBrains Mono", monospace' }}>
                                —
                            </span>
                            <span style={{ color: '#7d8590', fontSize: '12px', fontFamily: '"JetBrains Mono", monospace' }}>
                                {activeProject.path}
                            </span>
                        </>
                    ) : (
                        <span style={{ color: '#484f58', fontSize: '12px', fontFamily: '"JetBrains Mono", monospace' }}>
                            No project selected
                        </span>
                    )}
                </div>

                <div
                    ref={containerRef}
                    style={{ flex: 1, padding: '8px', boxSizing: 'border-box', overflow: 'hidden' }}
                />
            </div>

            {showModal && (
                <AddProjectModal
                    onClose={() => setShowModal(false)}
                    onCreated={handleProjectCreated}
                />
            )}
        </div>
    )
}
