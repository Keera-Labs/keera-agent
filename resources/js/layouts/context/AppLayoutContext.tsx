import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type React from 'react'
import { usePage } from '@inertiajs/react'
import { useQueryClient } from '@tanstack/react-query'
import { FitAddon } from '@xterm/addon-fit'
import type { Project, Workspace, Task } from '@/types/type'
import type { ProjectAgent } from '@/queries/agents'
import { useAgents, normalizeAgent } from '@/queries/agents'
import type { AgentTemplate } from '@/types/agent'
import { makeTerminal } from '@/hooks/useTerminalSessions'
import type { Session } from '@/hooks/useTerminalSessions'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import type { ProjectView } from '@/layouts/sidebar/Sidebar'
import { useTasks } from '@/queries/tasks'
import useProjects, { PROJECTS_QUERY_KEY } from '@/queries/useProjects'

// ─── Context value interface ──────────────────────────────────────────────────

export interface AppLayoutContextValue {
    // ── Data ─────────────────────────────────────────────────────────────────
    // Project data is owned by useProjects (single source); the layout only
    // derives activeProject from it. Consumers that need the full list call
    // useProjects() directly.
    workspaces: Workspace[]
    activeProject: Project | null
    tasks: Task[]

    // ── Modal state ───────────────────────────────────────────────────────────
    showWorkspaceModal: boolean
    setShowWorkspaceModal: (v: boolean) => void
    showGlobalSettings: boolean
    setShowGlobalSettings: (v: boolean) => void
    showDefaultPermissions: boolean
    setShowDefaultPermissions: (v: boolean) => void
    deletingWorkspace: Workspace | null
    setDeletingWorkspace: (w: Workspace | null) => void
    showAddAgent: boolean
    setShowAddAgent: (v: boolean) => void
    editingAgent: ProjectAgent | null
    setEditingAgent: (a: ProjectAgent | null) => void
    showProjectSearch: boolean
    setShowProjectSearch: (v: boolean) => void

    // ── View state ────────────────────────────────────────────────────────────
    // Sidebar workspace filter — shared here (not per-component useLocalStorage)
    // so the sidebar and dashboard read one reactive source and stay in sync
    // within a tab. null = "All Projects".
    selectedWorkspaceId: number | null
    setSelectedWorkspaceId: (id: number | null) => void
    projectView: ProjectView
    setProjectView: (v: ProjectView) => void
    activeAgentId: number | null
    setActiveAgentId: (id: number | null) => void
    isDraggingOver: boolean
    setIsDraggingOver: (v: boolean) => void

    // ── Terminal state ────────────────────────────────────────────────────────
    sessions: React.MutableRefObject<Map<number, Session>>
    agentSessions: React.MutableRefObject<Map<number, Session>>
    containerRefs: React.MutableRefObject<Map<number, HTMLDivElement | null>>
    agentContainerRefs: React.MutableRefObject<Map<number, HTMLDivElement | null>>
    fileInputRef: React.MutableRefObject<HTMLInputElement | null>
    // Where the active agent's live terminal should render — set by the agent
    // detail page (pages/agents/Detail) so its xterm re-parents into the page.
    agentTerminalSlot: React.MutableRefObject<HTMLDivElement | null>
    launchAgentSession: (agentId: number, focus?: boolean) => void
    restartClaude: () => void
    uploadImage: (file: File) => void
    claudeStatus: Record<number, 'running' | 'done'>
    setClaudeStatus: React.Dispatch<React.SetStateAction<Record<number, 'running' | 'done'>>>
    lastActivity: Record<number, string>
    outputChars: Record<number, number>
    sessionStart: Record<number, Date>

    // ── Business handlers ─────────────────────────────────────────────────────
    // Refreshes the layout-owned workspaces and invalidates the projects query
    // (workspace changes can reassign projects). Project mutations refresh
    // themselves via useProjects' own query.
    refreshData: () => Promise<void>
    handleWorkspaceCreated: () => void
    handleWorkspaceDeleted: () => void

    // ── Agent hook (mutations used by ModalLayer and AgentsIndex) ─────────────
    agentHook: ReturnType<typeof useAgents>

    // ── Agent templates ───────────────────────────────────────────────────────
    agentTemplates: AgentTemplate[]
    setAgentTemplates: (templates: AgentTemplate[]) => void
    refetchAgentTemplates: () => void

    // ── Global settings ───────────────────────────────────────────────────────
    maxAgentsPerProject: number
    setMaxAgentsPerProject: (v: number) => void
}

// ─── Context + dumb provider ──────────────────────────────────────────────────

// Exported so useProjects can read the layout's PTY session refs (nullable) for
// delete teardown without the throw-on-missing behaviour of useAppLayout.
export const AppLayoutContext = createContext<AppLayoutContextValue | null>(null)

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
    const { props } = usePage<{
        project?: string
        agent_id?: number
        tasks?: Task[]
        global_settings?: { max_agents_per_project?: number }
        workspaces?: Workspace[]
    }>()
    const projectName = props.project
    const agentIdFromUrl = props.agent_id
    const queryClient = useQueryClient()

    // ── Data — workspaces are layout-owned (seeded from Inertia props, refreshed
    //    via targeted fetch). Projects are owned by useProjects; the layout only
    //    reads that single source to derive activeProject and seed claudeStatus.
    const [workspaces, setWorkspaces] = useState<Workspace[]>(() => props.workspaces ?? [])
    const { projects } = useProjects()

    async function refreshData() {
        const wsRes = await fetch('/api/workspaces').then(r => r.json())
        setWorkspaces(wsRes)
        // Workspace changes can reassign projects (e.g. deleting a workspace
        // unassigns its projects), so refresh useProjects' query too.
        queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY })
    }

    // ── Modal / UI state ──────────────────────────────────────────────────────
    const [showWorkspaceModal, setShowWorkspaceModal] = useState(false)
    const [showGlobalSettings, setShowGlobalSettings] = useState(false)
    const [showDefaultPermissions, setShowDefaultPermissions] = useState(false)
    const [deletingWorkspace, setDeletingWorkspace] = useState<Workspace | null>(null)

    // ── Terminal / Claude status state (driven by WebSocket events) ───────────
    const [claudeStatus, setClaudeStatus] = useState<Record<number, 'running' | 'done'>>({})
    const [lastActivity, setLastActivity] = useState<Record<number, string>>({})
    const [sessionStart, setSessionStart] = useState<Record<number, Date>>({})
    const [outputChars, setOutputChars] = useState<Record<number, number>>({})

    // ── View state ────────────────────────────────────────────────────────────
    const [selectedWorkspaceId, setSelectedWorkspaceId] =
        useLocalStorage<number | null>('keera:selectedWorkspaceId', null)
    const [projectView, setProjectView] = useState<ProjectView>('agents')
    const [isDraggingOver, setIsDraggingOver] = useState(false)
    const [agentTemplates, setAgentTemplates] = useState<AgentTemplate[]>([])
    const [showAddAgent, setShowAddAgent] = useState(false)

    // Initialise from Inertia props; updated immediately after a successful
    // PATCH /api/global-settings save so UI shows the new value without waiting
    // for router.reload() to complete.
    const [maxAgentsPerProject, setMaxAgentsPerProject] = useState<number>(
        props.global_settings?.max_agents_per_project ?? 10
    )
    // Keep in sync whenever Inertia reloads the page props (e.g. router.reload)
    useEffect(() => {
        const v = props.global_settings?.max_agents_per_project
        if (v !== undefined) setMaxAgentsPerProject(v)
    }, [props.global_settings?.max_agents_per_project])
    // Raw selection — may refer to an agent from a previous project after switching.
    const [_activeAgentId, setActiveAgentId] = useState<number | null>(null)
    const [showProjectSearch, setShowProjectSearch] = useState(false)
    const [editingAgent, setEditingAgent] = useState<ProjectAgent | null>(null)

    // ── Refs ──────────────────────────────────────────────────────────────────
    const sessions = useRef<Map<number, Session>>(new Map())
    const containerRefs = useRef<Map<number, HTMLDivElement | null>>(new Map())
    const agentSessions = useRef<Map<number, Session>>(new Map())
    const agentContainerRefs = useRef<Map<number, HTMLDivElement | null>>(new Map())
    const fileInputRef = useRef<HTMLInputElement>(null)
    const agentTerminalSlot = useRef<HTMLDivElement | null>(null)

    // ── Derived data ──────────────────────────────────────────────────────────
    const activeProject = projects.find(p => p.slug === projectName) ?? projects[0] ?? null

    const taskHook = useTasks(activeProject?.id ?? null)
    const agentHook = useAgents(activeProject?.id ?? null)
    const tasks = taskHook.tasks
    const projectAgents = agentHook.agents

    // Null out the selected agent immediately (same render) if it doesn't belong
    // to the current project. This avoids the one-frame blank flash that the
    // async useEffect reset caused on project switch.
    const activeAgentId = _activeAgentId !== null && projectAgents.some(a => a.id === _activeAgentId)
        ? _activeAgentId
        : null

    const activeAgentFromUrl = agentIdFromUrl
        ? projectAgents.find(a => a.id === agentIdFromUrl) ?? null
        : null

    // ── Effects ───────────────────────────────────────────────────────────────

    // Seed claudeStatus from fetched project data on first load
    useEffect(() => {
        const initial: Record<number, 'running' | 'done'> = {}
        for (const p of projects) {
            if (p.claude_status === 'running') initial[p.id] = 'running'
            else if (p.claude_status === 'idle') initial[p.id] = 'done'
        }
        setClaudeStatus(prev => ({ ...initial, ...prev }))
    }, [projects.length])

    // When agents load and URL has an agent_id, set the active agent
    useEffect(() => {
        if (activeAgentFromUrl) {
            setActiveAgentId(activeAgentFromUrl.id)
        }
    }, [activeAgentFromUrl?.id])

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

    // Fetch the EFFECTIVE template list for the active project (project overrides
    // resolved over globals). Falls back to the global list when no project is
    // active. Re-fetches on project switch and after edits/sync/reset.
    const refetchAgentTemplates = useCallback(() => {
        const url = activeProject
            ? `/api/projects/${activeProject.id}/agent-templates`
            : '/api/agent-templates'
        fetch(url)
            .then(r => r.json())
            .then(setAgentTemplates)
            .catch(() => {})
    }, [activeProject?.id])

    useEffect(() => {
        refetchAgentTemplates()
    }, [refetchAgentTemplates])


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
            // Don't call fitAddon.fit() here — the ResizeObserver already fires
            // when the container flips from display:none → display:block and
            // handles the refit. Calling it here too causes a double-resize that
            // makes xterm scroll to the top and flash blank.
            const { term } = sessions.current.get(activeProject.id)!
            requestAnimationFrame(() => term.focus())
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
                            playSound('input')
                        } else if (msg.type === 'agent_created') {
                            agentHook.addAgent(normalizeAgent(msg.agent.data))
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
        // Attach to the agent detail page's slot when it's the active agent and
        // the page is mounted; otherwise the persistent holder container.
        const container = (agentId === activeAgentId ? agentTerminalSlot.current : null)
            ?? agentContainerRefs.current.get(agentId)
        if (!container) return

        if (agentSessions.current.has(agentId)) {
            if (focus) {
                const { fitAddon, term } = agentSessions.current.get(agentId)!
                requestAnimationFrame(() => { fitAddon.fit(); term.focus() })
            }
            return
        }

        requestAnimationFrame(() => {
            // A concurrent trigger (the select-all-agents effect and the detail page
            // can both fire in the same tick) may have created this session between
            // the has() guard above and this frame — never open a second PTY.
            if (agentSessions.current.has(agentId)) return

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
                            agentHook.addAgent(normalizeAgent(event.agent.data))
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

    async function handleWorkspaceCreated() { await refreshData() }
    async function handleWorkspaceDeleted() { await refreshData() }

    // ── Context value ─────────────────────────────────────────────────────────

    const value: AppLayoutContextValue = {
        // Data
        workspaces, activeProject, tasks,
        // Modal state
        showWorkspaceModal, setShowWorkspaceModal,
        showGlobalSettings, setShowGlobalSettings,
        showDefaultPermissions, setShowDefaultPermissions,
        deletingWorkspace, setDeletingWorkspace,
        showAddAgent, setShowAddAgent,
        editingAgent, setEditingAgent,
        showProjectSearch, setShowProjectSearch,
        // View state
        selectedWorkspaceId, setSelectedWorkspaceId,
        projectView, setProjectView,
        activeAgentId, setActiveAgentId,
        isDraggingOver, setIsDraggingOver,
        // Terminal state
        sessions, agentSessions, containerRefs, agentContainerRefs, fileInputRef, agentTerminalSlot,
        launchAgentSession, restartClaude, uploadImage,
        claudeStatus, setClaudeStatus, lastActivity, outputChars, sessionStart,
        // Business handlers
        refreshData,
        handleWorkspaceCreated, handleWorkspaceDeleted,
        // Agent hook
        agentHook,
        // Agent templates
        agentTemplates, setAgentTemplates, refetchAgentTemplates,
        // Global settings
        maxAgentsPerProject, setMaxAgentsPerProject,
    }

    return (
        <AppLayoutContext.Provider value={value}>
            {children}
        </AppLayoutContext.Provider>
    )
}
