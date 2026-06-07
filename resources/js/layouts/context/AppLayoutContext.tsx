import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type React from 'react'
import { router, usePage } from '@inertiajs/react'
import { FitAddon } from '@xterm/addon-fit'
import type { Project, Workspace, Task } from '@/types/type'
import type { ProjectAgent } from '@/layouts/hooks/agents'
import { useAgents } from '@/layouts/hooks/agents'
import type { AgentTemplate } from '@/types/agent'
import { makeTerminal } from '@/layouts/hooks/useTerminalSessions'
import type { Session } from '@/layouts/hooks/useTerminalSessions'
import type { ProjectView } from '@/layouts/sidebar/Sidebar'
import { useWorkspace } from '@/layouts/hooks/workspace'
import { useProjects } from '@/layouts/hooks/projects'
import { useTasks } from '@/layouts/hooks/tasks'

// ─── Context value interface ──────────────────────────────────────────────────

export interface AppLayoutContextValue {
    // ── Data ─────────────────────────────────────────────────────────────────
    workspaces: Workspace[]
    allProjects: Project[]
    activeProject: Project | null
    tasks: Task[]

    // ── Modal state ───────────────────────────────────────────────────────────
    showWorkspaceModal: boolean
    setShowWorkspaceModal: (v: boolean) => void
    addProjectWorkspaceId: number | null | undefined
    setAddProjectWorkspaceId: (v: number | null | undefined) => void
    movingProject: Project | null
    setMovingProject: (p: Project | null) => void
    editingProject: Project | null
    setEditingProject: (p: Project | null) => void
    systemPromptProject: Project | null
    setSystemPromptProject: (p: Project | null) => void
    permissionsProject: Project | null
    setPermissionsProject: (p: Project | null) => void
    showGlobalSettings: boolean
    setShowGlobalSettings: (v: boolean) => void
    showDefaultPermissions: boolean
    setShowDefaultPermissions: (v: boolean) => void
    deletingProject: Project | null
    setDeletingProject: (p: Project | null) => void
    deletingWorkspace: Workspace | null
    setDeletingWorkspace: (w: Workspace | null) => void
    showAddAgent: boolean
    setShowAddAgent: (v: boolean) => void
    editingAgent: ProjectAgent | null
    setEditingAgent: (a: ProjectAgent | null) => void
    showCreateTask: boolean
    setShowCreateTask: (v: boolean) => void
    showProjectSearch: boolean
    setShowProjectSearch: (v: boolean) => void
    selectedTask: Task | null
    setSelectedTask: (t: Task | null) => void

    // ── View state ────────────────────────────────────────────────────────────
    projectView: ProjectView
    setProjectView: (v: ProjectView) => void
    activeAgentId: number | null
    setActiveAgentId: (id: number | null) => void
    newMessageIds: number[]
    setNewMessageIds: React.Dispatch<React.SetStateAction<number[]>>
    isDraggingOver: boolean
    setIsDraggingOver: (v: boolean) => void

    // ── Terminal state ────────────────────────────────────────────────────────
    sessions: React.MutableRefObject<Map<number, Session>>
    agentSessions: React.MutableRefObject<Map<number, Session>>
    containerRefs: React.MutableRefObject<Map<number, HTMLDivElement | null>>
    agentContainerRefs: React.MutableRefObject<Map<number, HTMLDivElement | null>>
    fileInputRef: React.MutableRefObject<HTMLInputElement | null>
    launchAgentSession: (agentId: number, focus?: boolean) => void
    restartClaude: () => void
    uploadImage: (file: File) => void
    claudeStatus: Record<number, 'running' | 'done'>
    setClaudeStatus: React.Dispatch<React.SetStateAction<Record<number, 'running' | 'done'>>>
    lastActivity: Record<number, string>
    outputChars: Record<number, number>
    sessionStart: Record<number, Date>

    // ── Business handlers ─────────────────────────────────────────────────────
    openAddProject: (workspaceId: number | null) => void
    handleMoveProject: (project: Project, newWorkspaceId: number | null) => Promise<void>
    handleProjectCreated: (project: Project) => void
    handleProjectDeleted: (projectId: number) => void
    handleProjectUpdated: (updated: Project) => void
    handleWorkspaceCreated: () => void
    handleWorkspaceDeleted: () => void

    // ── Task handlers ─────────────────────────────────────────────────────────
    handleAddTask: (title: string, body: string, assignees: string[]) => Promise<Task | null>
    handleUpdateStatus: (task: Task, status: Task['status']) => void
    handleDeleteTask: (task: Task) => void

    // ── Agent hook (mutations used by ModalLayer and AgentsView) ─────────────
    agentHook: ReturnType<typeof useAgents>

    // ── Agent templates ───────────────────────────────────────────────────────
    agentTemplates: AgentTemplate[]
    setAgentTemplates: (templates: AgentTemplate[]) => void
}

// ─── Context + dumb provider ──────────────────────────────────────────────────

const AppLayoutContext = createContext<AppLayoutContextValue | null>(null)

export function AppLayoutProvider({
    value,
    children,
}: {
    value: AppLayoutContextValue
    children: React.ReactNode
}) {
    return (
        <AppLayoutContext.Provider value={value}>
            {children}
        </AppLayoutContext.Provider>
    )
}

export function useAppLayout(): AppLayoutContextValue {
    const ctx = useContext(AppLayoutContext)
    if (!ctx) throw new Error('useAppLayout must be used inside AppLayoutProvider')
    return ctx
}

// ─── Audio helpers ────────────────────────────────────────────────────────────

let _audioCtx: AudioContext | null = null
function getAudioCtx(): AudioContext {
    if (!_audioCtx) _audioCtx = new AudioContext()
    return _audioCtx
}

function playSound(type: 'done' | 'input') {
    try {
        const ctx = getAudioCtx()

        if (type === 'done') {
            const freqs = [880, 1100]
            freqs.forEach((freq, i) => {
                const osc = ctx.createOscillator()
                osc.type = 'sine'
                osc.frequency.value = freq
                const g = ctx.createGain()
                g.gain.setValueAtTime(0, ctx.currentTime + i * 0.12)
                g.gain.linearRampToValueAtTime(0.18, ctx.currentTime + i * 0.12 + 0.02)
                g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.28)
                osc.connect(g)
                g.connect(ctx.destination)
                osc.start(ctx.currentTime + i * 0.12)
                osc.stop(ctx.currentTime + i * 0.12 + 0.28)
            })
        } else {
            const freqs = [660, 660]
            freqs.forEach((freq, i) => {
                const osc = ctx.createOscillator()
                osc.type = 'sine'
                osc.frequency.value = freq
                const g = ctx.createGain()
                g.gain.setValueAtTime(0, ctx.currentTime + i * 0.18)
                g.gain.linearRampToValueAtTime(0.14, ctx.currentTime + i * 0.18 + 0.02)
                g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.18)
                osc.connect(g)
                g.connect(ctx.destination)
                osc.start(ctx.currentTime + i * 0.18)
                osc.stop(ctx.currentTime + i * 0.18 + 0.18)
            })
        }
    } catch { /* AudioContext not available */ }
}

// ─── Smart state provider ─────────────────────────────────────────────────────
// Absorbs all state management from AppLayout so the layout itself is a thin shell.

export function AppLayoutStateProvider({ children }: { children: React.ReactNode }) {
    const { props } = usePage<{ project?: string; agent_id?: number; tasks?: Task[] }>()
    const projectName = props.project
    const agentIdFromUrl = props.agent_id

    // ── Data hooks ────────────────────────────────────────────────────────────
    const { workspaces, invalidate: invalidateWorkspaces } = useWorkspace()
    const { allProjects, invalidate: invalidateProjects, update: updateProject, remove: removeProject } = useProjects()

    // ── Modal / UI state ──────────────────────────────────────────────────────
    const [showWorkspaceModal, setShowWorkspaceModal] = useState(false)
    const [addProjectWorkspaceId, setAddProjectWorkspaceId] = useState<number | null | undefined>(undefined)
    const [movingProject, setMovingProject] = useState<Project | null>(null)
    const [editingProject, setEditingProject] = useState<Project | null>(null)
    const [systemPromptProject, setSystemPromptProject] = useState<Project | null>(null)
    const [permissionsProject, setPermissionsProject] = useState<Project | null>(null)
    const [showGlobalSettings, setShowGlobalSettings] = useState(false)
    const [showDefaultPermissions, setShowDefaultPermissions] = useState(false)
    const [deletingProject, setDeletingProject] = useState<Project | null>(null)
    const [deletingWorkspace, setDeletingWorkspace] = useState<Workspace | null>(null)

    // ── Terminal / Claude status state (driven by WebSocket events) ───────────
    const [claudeStatus, setClaudeStatus] = useState<Record<number, 'running' | 'done'>>({})
    const [lastActivity, setLastActivity] = useState<Record<number, string>>({})
    const [sessionStart, setSessionStart] = useState<Record<number, Date>>({})
    const [outputChars, setOutputChars] = useState<Record<number, number>>({})

    // ── View state ────────────────────────────────────────────────────────────
    const [projectView, setProjectView] = useState<ProjectView>('agents')
    const [showCreateTask, setShowCreateTask] = useState(false)
    const [isDraggingOver, setIsDraggingOver] = useState(false)
    const [selectedTask, setSelectedTask] = useState<Task | null>(null)
    const [newMessageIds, setNewMessageIds] = useState<number[]>([])
    const [agentTemplates, setAgentTemplates] = useState<AgentTemplate[]>([])
    const [showAddAgent, setShowAddAgent] = useState(false)
    const [activeAgentId, setActiveAgentId] = useState<number | null>(null)
    const [showProjectSearch, setShowProjectSearch] = useState(false)
    const [editingAgent, setEditingAgent] = useState<ProjectAgent | null>(null)

    // ── Refs ──────────────────────────────────────────────────────────────────
    const sessions = useRef<Map<number, Session>>(new Map())
    const containerRefs = useRef<Map<number, HTMLDivElement | null>>(new Map())
    const agentSessions = useRef<Map<number, Session>>(new Map())
    const agentContainerRefs = useRef<Map<number, HTMLDivElement | null>>(new Map())
    const fileInputRef = useRef<HTMLInputElement>(null)

    // ── Derived data ──────────────────────────────────────────────────────────
    const activeProject = allProjects.find(p => p.slug === projectName) ?? allProjects[0] ?? null

    const taskHook = useTasks(activeProject?.id ?? null)
    const agentHook = useAgents(activeProject?.id ?? null)
    const tasks = taskHook.tasks
    const projectAgents = agentHook.agents

    const activeAgentFromUrl = agentIdFromUrl
        ? projectAgents.find(a => a.id === agentIdFromUrl) ?? null
        : null

    // ── Effects ───────────────────────────────────────────────────────────────

    // Seed claudeStatus from fetched project data on first load
    useEffect(() => {
        const initial: Record<number, 'running' | 'done'> = {}
        for (const p of allProjects) {
            if (p.claude_status === 'running') initial[p.id] = 'running'
            else if (p.claude_status === 'idle') initial[p.id] = 'done'
        }
        setClaudeStatus(prev => ({ ...initial, ...prev }))
    }, [allProjects.length])

    // Keep systemPromptProject in sync with the React Query cache so the modal
    // always receives the freshest project data (including system_prompt) even
    // when stale data was used at the moment the user clicked "System Instructions".
    useEffect(() => {
        if (systemPromptProject != null) {
            const latest = allProjects.find(p => p.id === systemPromptProject.id)
            if (latest) setSystemPromptProject(latest)
        }
    }, [allProjects])

    // When agents load and URL has an agent_id, set the active agent
    useEffect(() => {
        if (activeAgentFromUrl) {
            setActiveAgentId(activeAgentFromUrl.id)
        }
    }, [activeAgentFromUrl?.id])

    // Reset active agent when switching projects
    useEffect(() => {
        setActiveAgentId(null)
        agentSessions.current.forEach(({ term, ws, observer }) => {
            observer.disconnect(); term.dispose(); ws.close()
        })
        agentSessions.current.clear()
    }, [activeProject?.id])

    // Cmd+P → project search
    useEffect(() => {
        function onKeyDown(e: KeyboardEvent) {
            if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
                e.preventDefault()
                setShowProjectSearch(o => !o)
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [])

    // Fetch agent templates once on mount
    useEffect(() => {
        fetch('/api/agent-templates')
            .then(r => r.json())
            .then(setAgentTemplates)
            .catch(() => {})
    }, [])

    // When an agent is selected, start ALL agents (so they can communicate)
    useEffect(() => {
        if (activeAgentId === null || !activeProject) return
        requestAnimationFrame(() => {
            for (const agent of projectAgents) {
                launchAgentSession(agent.id, agent.id === activeAgentId)
            }
        })
    }, [activeAgentId, projectAgents.length])

    // Warn before navigating away with active sessions
    useEffect(() => {
        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            if (sessions.current.size > 0) e.preventDefault()
        }
        window.addEventListener('beforeunload', onBeforeUnload)
        return () => window.removeEventListener('beforeunload', onBeforeUnload)
    }, [])

    // Block arrow/enter keys globally (terminal navigation)
    useEffect(() => {
        const block = (e: KeyboardEvent) => {
            if (['Enter', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.key)) e.preventDefault()
        }
        document.addEventListener('keydown', block)
        return () => document.removeEventListener('keydown', block)
    }, [])

    // Cleanup all sessions on unmount
    useEffect(() => {
        return () => {
            sessions.current.forEach(({ term, ws, observer }) => {
                observer.disconnect(); term.dispose(); ws.close()
            })
            agentSessions.current.forEach(({ term, ws, observer }) => {
                observer.disconnect(); term.dispose(); ws.close()
            })
        }
    }, [])

    // Launch PM terminal session when activeProject or projectAgents change
    useEffect(() => {
        if (!activeProject) return
        const pmAgent = projectAgents.find(a => a.agent_type === 'pm')
        if (!pmAgent) return
        const container = containerRefs.current.get(activeProject.id)
        if (!container) return

        if (sessions.current.has(activeProject.id)) {
            const { fitAddon, term } = sessions.current.get(activeProject.id)!
            requestAnimationFrame(() => { fitAddon.fit(); term.focus() })
            return
        }

        requestAnimationFrame(() => {
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
            const ws = new WebSocket(`${protocol}//${location.host}/${activeProject.slug}/ws?agent_id=${pmAgent.id}`)
            ws.binaryType = 'arraybuffer'
            ws.onopen = () => {
                ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
                setClaudeStatus(prev => ({ ...prev, [activeProject.id]: 'running' }))
                setSessionStart(prev => ({ ...prev, [activeProject.id]: new Date() }))
            }

            let termTextBuf = ''
            let lastInputSoundAt = 0

            ws.onmessage = e => {
                if (typeof e.data === 'string') {
                    try {
                        const msg = JSON.parse(e.data)
                        if (msg.type === 'claude_stopped') {
                            setClaudeStatus(prev => ({ ...prev, [activeProject.id]: 'done' }))
                            playSound('done')
                        } else if (msg.type === 'agent_message') {
                            setNewMessageIds(prev => [...prev, msg.message_id])
                            playSound('input')
                        } else if (msg.type === 'agent_created') {
                            agentHook.addAgent(msg.agent as ProjectAgent)
                        }
                    } catch { /* ignore */ }
                } else {
                    const bytes = new Uint8Array(e.data as ArrayBuffer)
                    term.write(bytes)

                    const text = new TextDecoder().decode(bytes).replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
                    termTextBuf = (termTextBuf + text).slice(-800)

                    const stripped = text.replace(/[^\x20-\x7E\n\r]/g, '')
                    const actLines = stripped.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 6 && !/^[$%>#❯]/.test(l))
                    if (actLines.length) setLastActivity(prev => ({ ...prev, [activeProject.id]: actLines[actLines.length - 1] }))
                    setOutputChars(prev => ({ ...prev, [activeProject.id]: (prev[activeProject.id] ?? 0) + bytes.length }))

                    const now = Date.now()
                    const inputPatterns = [
                        /\?\s*$/m,
                        /\[Y\/n\]/i,
                        /\[y\/N\]/i,
                        /Do you want to/i,
                        /Would you like/i,
                        /Press Enter to/i,
                        /Type your (message|response|reply)/i,
                    ]
                    if (now - lastInputSoundAt > 3000 && inputPatterns.some(p => p.test(termTextBuf))) {
                        lastInputSoundAt = now
                        playSound('input')
                    }
                }
            }
            ws.onclose = () => term.write('\r\n\x1b[31m[disconnected]\x1b[0m\r\n')

            term.attachCustomKeyEventHandler(e => {
                if (e.key === 'Enter' && e.ctrlKey && e.type === 'keydown') {
                    if (ws.readyState === WebSocket.OPEN) ws.send('\n')
                    return false
                }
                return true
            })
            term.onData(data => { if (ws.readyState === WebSocket.OPEN) ws.send(data) })
            term.onResize(({ cols, rows }) => {
                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows }))
            })

            container.addEventListener('click', () => term.focus())
            term.focus()

            const observer = new ResizeObserver(() => fitAddon.fit())
            observer.observe(container)

            sessions.current.set(activeProject.id, { term, ws, fitAddon, observer })
        })
    }, [activeProject, projectAgents])

    // ── Handlers ──────────────────────────────────────────────────────────────

    function launchAgentSession(agentId: number, focus: boolean = true) {
        if (!activeProject) return
        const container = agentContainerRefs.current.get(agentId)
        if (!container) return

        if (agentSessions.current.has(agentId)) {
            if (focus) {
                const { fitAddon, term } = agentSessions.current.get(agentId)!
                requestAnimationFrame(() => { fitAddon.fit(); term.focus() })
            }
            return
        }

        requestAnimationFrame(() => {
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
            const ws = new WebSocket(
                `${protocol}//${location.host}/${activeProject.slug}/ws?agent_id=${agentId}`
            )
            ws.binaryType = 'arraybuffer'
            ws.onopen = () => ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
            ws.onmessage = e => {
                if (typeof e.data !== 'string') {
                    term.write(new Uint8Array(e.data as ArrayBuffer))
                } else {
                    try {
                        const event = JSON.parse(e.data)
                        if (event.type === 'agent_created') {
                            agentHook.addAgent(event.agent as ProjectAgent)
                        }
                    } catch { /* not JSON, ignore */ }
                }
            }
            ws.onclose = () => term.write('\r\n\x1b[31m[disconnected]\x1b[0m\r\n')
            term.onData(data => { if (ws.readyState === WebSocket.OPEN) ws.send(data) })
            term.onResize(({ cols, rows }) => {
                if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows }))
            })
            container.addEventListener('click', () => term.focus())
            if (focus) term.focus()

            const observer = new ResizeObserver(() => fitAddon.fit())
            observer.observe(container)

            agentSessions.current.set(agentId, { term, ws, fitAddon, observer })
        })
    }

    function restartClaude() {
        if (!activeProject) return
        const session = sessions.current.get(activeProject.id)
        if (!session || session.ws.readyState !== WebSocket.OPEN) return
        session.ws.send(new Uint8Array([0x03]))
        setTimeout(() => {
            if (session.ws.readyState === WebSocket.OPEN) {
                session.ws.send('claude --continue\n')
            }
        }, 800)
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
            session.ws.send(path)
        }
    }

    function handleWorkspaceCreated() { invalidateWorkspaces() }
    function handleWorkspaceDeleted() { invalidateWorkspaces(); invalidateProjects() }

    function handleProjectCreated(project: Project) {
        invalidateProjects()
        router.visit(`/${project.slug}`)
    }

    function openAddProject(workspaceId: number | null) {
        setAddProjectWorkspaceId(workspaceId)
    }

    async function handleMoveProject(project: Project, newWorkspaceId: number | null) {
        await updateProject.mutateAsync({ id: project.id, workspace_id: newWorkspaceId })
        invalidateWorkspaces()
    }

    function handleProjectUpdated(_updated: Project) {
        invalidateProjects()
        invalidateWorkspaces()
    }

    function handleProjectDeleted(projectId: number) {
        const project = allProjects.find(p => p.id === projectId)
        removeProject.mutate(projectId)
        if (project && projectName === project.slug) router.visit('/')
    }

    async function handleAddTask(title: string, body: string, assignees: string[]): Promise<Task | null> {
        try {
            return await taskHook.create.mutateAsync({ title, body, assignees })
        } catch { return null }
    }

    function handleUpdateStatus(task: Task, status: Task['status']) {
        taskHook.updateStatus.mutate({ taskId: task.id, status })
    }

    function handleDeleteTask(task: Task) {
        taskHook.remove.mutate(task.id)
    }

    // ── Context value ─────────────────────────────────────────────────────────

    const value: AppLayoutContextValue = {
        // Data
        workspaces, allProjects, activeProject, tasks,
        // Modal state
        showWorkspaceModal, setShowWorkspaceModal,
        addProjectWorkspaceId, setAddProjectWorkspaceId,
        movingProject, setMovingProject,
        editingProject, setEditingProject,
        systemPromptProject, setSystemPromptProject,
        permissionsProject, setPermissionsProject,
        showGlobalSettings, setShowGlobalSettings,
        showDefaultPermissions, setShowDefaultPermissions,
        deletingProject, setDeletingProject,
        deletingWorkspace, setDeletingWorkspace,
        showAddAgent, setShowAddAgent,
        editingAgent, setEditingAgent,
        showCreateTask, setShowCreateTask,
        showProjectSearch, setShowProjectSearch,
        selectedTask, setSelectedTask,
        // View state
        projectView, setProjectView,
        activeAgentId, setActiveAgentId,
        newMessageIds, setNewMessageIds,
        isDraggingOver, setIsDraggingOver,
        // Terminal state
        sessions, agentSessions, containerRefs, agentContainerRefs, fileInputRef,
        launchAgentSession, restartClaude, uploadImage,
        claudeStatus, setClaudeStatus, lastActivity, outputChars, sessionStart,
        // Business handlers
        openAddProject, handleMoveProject, handleProjectCreated,
        handleProjectDeleted, handleProjectUpdated,
        handleWorkspaceCreated, handleWorkspaceDeleted,
        // Task handlers
        handleAddTask, handleUpdateStatus, handleDeleteTask,
        // Agent hook
        agentHook,
        // Agent templates
        agentTemplates, setAgentTemplates,
    }

    return (
        <AppLayoutContext.Provider value={value}>
            {children}
        </AppLayoutContext.Provider>
    )
}
