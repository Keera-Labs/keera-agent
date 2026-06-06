import { useEffect, useRef, useState } from 'react'
import { router, usePage } from '@inertiajs/react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { color } from "@/tokens"
import type { Task, Workspace, Project } from "@/types/type"
import ProjectCreateModal from '@/components/project/ProjectCreateModal'
import ProjectPathEditModal from '@/components/project/ProjectPathEditModal'
import AddWorkspaceModal from '@/components/AddWorkspaceModal'
import Sidebar, { type ProjectView, PROJECT_NAV } from './sidebar/Sidebar'
import { DotsIndicator } from './sidebar/Project'
import { useWorkspace } from './hooks/workspace'
import { useTasks } from './hooks/tasks'
import { useAgents, type ProjectAgent, type AgentFlags } from './hooks/agents'
import AgentEditModal from '@/components/agent/AgentEditModal'
import { useProjects } from './hooks/projects'

// ─── Phase 2 extracted modules ────────────────────────────────────────────────
import { AppLayoutProvider } from './context/AppLayoutContext'
import { ModalLayer } from './ModalLayer'
import { AgentsView } from './views/AgentsView'
import { CommandsView } from './views/CommandsView'
import { TasksView } from './views/TasksView'

// ─── Phase 1 extracted modules ────────────────────────────────────────────────
export { agentColor } from '@/utils/agentColor'
export { labelStyle, inputStyle, cancelBtnStyle, submitBtnStyle, flagRowStyle, toggleStyle } from '@/components/ui/styles'
export type { AgentTemplate } from '@/types/agent'
export { AGENT_TYPE_LABELS, AGENT_TYPE_COLORS, AGENT_TYPE_DEFAULTS } from '@/types/agent'
export { STATUS_CYCLE, STATUS_COLORS, STATUS_LABELS } from '@/types/task'
export { useAudio } from './hooks/useAudio'
export { useAgentTemplates } from './hooks/useAgentTemplates'
export { makeTerminal, useTerminalSessions } from './hooks/useTerminalSessions'
export type { Session } from './hooks/useTerminalSessions'
export { TagInput } from '@/components/ui/TagInput'
export { SystemPromptModal } from '@/components/modals/SystemPromptModal'
export { PermissionsEditor } from '@/components/modals/PermissionsEditor'
export { ProjectPermissionsModal } from '@/components/modals/ProjectPermissionsModal'
export { DefaultPermissionsModal } from '@/components/modals/DefaultPermissionsModal'
export { GlobalSettingsModal } from '@/components/modals/GlobalSettingsModal'
export { ProjectSearchModal } from '@/components/modals/ProjectSearchModal'
export { ConfirmDeleteProjectModal } from '@/components/modals/ConfirmDeleteProjectModal'
export { ConfirmDeleteWorkspaceModal } from '@/components/modals/ConfirmDeleteWorkspaceModal'
export { MoveProjectModal } from '@/components/modals/MoveProjectModal'
export { CreateTaskModal } from '@/components/modals/CreateTaskModal'
export { TaskDetailModal } from '@/components/modals/TaskDetailModal'
export { AddAgentModal } from '@/components/modals/AddAgentModal'

// ─── Local re-imports for use within this file ────────────────────────────────
import { agentColor } from '@/utils/agentColor'
import { labelStyle, inputStyle, cancelBtnStyle, submitBtnStyle, flagRowStyle, toggleStyle } from '@/components/ui/styles'
import type { AgentTemplate } from '@/types/agent'
import { AGENT_TYPE_LABELS, AGENT_TYPE_COLORS, AGENT_TYPE_DEFAULTS } from '@/types/agent'
import { STATUS_CYCLE, STATUS_COLORS, STATUS_LABELS } from '@/types/task'
import { TagInput } from '@/components/ui/TagInput'
import { SystemPromptModal } from '@/components/modals/SystemPromptModal'
import { PermissionsEditor } from '@/components/modals/PermissionsEditor'
import { ProjectPermissionsModal } from '@/components/modals/ProjectPermissionsModal'
import { DefaultPermissionsModal } from '@/components/modals/DefaultPermissionsModal'
import { GlobalSettingsModal } from '@/components/modals/GlobalSettingsModal'
import { ProjectSearchModal } from '@/components/modals/ProjectSearchModal'
import { ConfirmDeleteProjectModal } from '@/components/modals/ConfirmDeleteProjectModal'
import { ConfirmDeleteWorkspaceModal } from '@/components/modals/ConfirmDeleteWorkspaceModal'
import { MoveProjectModal } from '@/components/modals/MoveProjectModal'
import { CreateTaskModal } from '@/components/modals/CreateTaskModal'
import { TaskDetailModal } from '@/components/modals/TaskDetailModal'
import { AddAgentModal } from '@/components/modals/AddAgentModal'
import { makeTerminal } from './hooks/useTerminalSessions'


// ─── Local audio helper (used inline in this file) ────────────────────────────

let _audioCtx: AudioContext | null = null
function getAudioCtx(): AudioContext {
    if (!_audioCtx) _audioCtx = new AudioContext()
    return _audioCtx
}

function playSound(type: 'done' | 'input') {
    try {
        const ctx = getAudioCtx()
        const gain = ctx.createGain()
        gain.connect(ctx.destination)

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

// Session type is defined in useTerminalSessions.ts but we use it locally
interface Session {
    term: Terminal
    ws: WebSocket
    fitAddon: FitAddon
    observer: ResizeObserver
}

const LANG_COLORS: Record<string, string> = {
    Python:     color.langPython,
    TypeScript: color.langTypeScript,
    Go:         color.langGo,
    Rust:       color.langRust,
    JavaScript: color.langJavaScript,
}

const LANGUAGES = ['Python', 'TypeScript', 'JavaScript', 'Go', 'Rust', 'Other']
// ─── Project sidebar ─────────────────────────────────────────────────────────

function ProjectSidebar({ view, projectName, onChange, taskCount, newMessageCount }: {
    view: ProjectView
    projectName: string | null
    onChange: (v: ProjectView) => void
    taskCount: number
    newMessageCount: number
}) {
    return (
        <div style={{
            width: '200px', flexShrink: 0, background: color.bgCanvas,
            borderRight: `1px solid ${color.border}`, display: 'flex', flexDirection: 'column',
        }}>
            {/* Project name header */}
            {projectName && (
                <div style={{
                    padding: '10px 14px 9px',
                    borderBottom: `1px solid ${color.border}`,
                }}>
                    <span style={{ color: color.textPrimary, fontSize: '13px', fontWeight: 700, letterSpacing: '0.01em' }}>
                        {projectName}
                    </span>
                </div>
            )}

            {/* Nav items */}
            <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: '2px', paddingTop: projectName ? '8px' : '6px' }}>
                {PROJECT_NAV.map(item => {
                    const active = item.id === view
                    const count = item.id === 'tasks' ? taskCount : item.id === 'messages' ? newMessageCount : 0
                    return (
                        <button
                            key={item.id}
                            onClick={() => {
                                if (item.id === 'tasks' && projectName) {
                                    router.visit(`/${projectName}/tasks`)
                                } else {
                                    onChange(item.id)
                                }
                            }}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '8px',
                                padding: '7px 10px',
                                background: active ? color.accentSubtle : 'transparent',
                                border: `1px solid ${active ? color.accentEmphasis : 'transparent'}`,
                                borderRadius: '6px',
                                color: active ? color.accentMuted : color.textMuted,
                                fontSize: '12px', fontWeight: active ? 600 : 400,
                                cursor: 'pointer', textAlign: 'left', width: '100%',
                                transition: 'all 0.1s',
                            }}
                            onMouseEnter={e => { if (!active) { e.currentTarget.style.background = color.bgSurface; e.currentTarget.style.color = color.textSecondary } }}
                            onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = color.textMuted } }}
                        >
                            {item.icon}
                            <span style={{ flex: 1 }}>{item.label}</span>
                            {count > 0 && (
                                <span style={{
                                    fontSize: '10px', fontWeight: 600,
                                    padding: '1px 6px', borderRadius: '10px',
                                    background: color.bgBase,
                                    color: color.textFaint,
                                    border: `1px solid ${color.border}`,
                                    lineHeight: '16px',
                                }}>
                                    {count}
                                </span>
                            )}
                        </button>
                    )
                })}
            </div>
        </div>
    )
}

// CommandsView, TasksView and related helpers have been extracted to separate files.
// See resources/js/layouts/views/CommandsView.tsx and TasksView.tsx

// ─── Messages view ────────────────────────────────────────────────────────────

interface AgentMessage {
    id: number
    sender_project_id: number
    receiver_project_id: number
    sender_name: string
    receiver_name: string
    content: string
    status: 'pending' | 'delivered' | 'read'
    created_at: string
}

function MessagesView({ projectId, projectName, newMessageIds }: { projectId: number; projectName: string; newMessageIds: number[] }) {
    const [messages, setMessages] = useState<AgentMessage[]>([])

    useEffect(() => {
        fetch(`/api/projects/${projectId}/messages`)
            .then(r => r.json())
            .then(setMessages)
            .catch(() => {})
    }, [projectId])

    // Reload when new messages arrive via WS
    useEffect(() => {
        if (newMessageIds.length === 0) return
        fetch(`/api/projects/${projectId}/messages`)
            .then(r => r.json())
            .then(setMessages)
            .catch(() => {})
    }, [newMessageIds.length, projectId])

    async function markRead(msg: AgentMessage) {
        if (msg.status === 'read') return
        await fetch(`/api/messages/${msg.id}/read`, { method: 'PATCH' })
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, status: 'read' } : m))
    }

    const unreadCount = messages.filter(m => m.receiver_project_id === projectId && m.status !== 'read').length

    return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{
                padding: '10px 20px', borderBottom: `1px solid ${color.border}`,
                display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0,
                background: color.bgCanvas,
            }}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill={color.textMuted}>
                    <path d="M1.75 2h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0114.25 14H1.75A1.75 1.75 0 010 12.25v-8.5C0 2.784.784 2 1.75 2zM1.5 12.251c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25V5.06l-5.563 3.516a1.75 1.75 0 01-1.874 0L1.5 5.06v7.19zm13-8.181L8.312 7.512a.25.25 0 01-.264 0L1.5 4.07v-.32a.25.25 0 01.25-.25h12.5a.25.25 0 01.25.25v.32z"/>
                </svg>
                <span style={{ color: color.textPrimary, fontSize: '13px', fontWeight: 600, flex: 1 }}>Agent Messages</span>
                {unreadCount > 0 && (
                    <span style={{
                        fontSize: '10px', padding: '1px 7px', borderRadius: '10px',
                        background: `${color.accent}20`, border: `1px solid ${color.accent}40`,
                        color: color.accent,
                    }}>
                        {unreadCount} unread
                    </span>
                )}
            </div>

            {/* Message thread */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {messages.length === 0 ? (
                    <div style={{
                        flex: 1, display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center', gap: '10px',
                        padding: '60px 24px', textAlign: 'center',
                    }}>
                        <svg width="32" height="32" viewBox="0 0 16 16" fill={color.textFaint}>
                            <path d="M1.75 2h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0114.25 14H1.75A1.75 1.75 0 010 12.25v-8.5C0 2.784.784 2 1.75 2zM1.5 12.251c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25V5.06l-5.563 3.516a1.75 1.75 0 01-1.874 0L1.5 5.06v7.19zm13-8.181L8.312 7.512a.25.25 0 01-.264 0L1.5 4.07v-.32a.25.25 0 01.25-.25h12.5a.25.25 0 01.25.25v.32z"/>
                        </svg>
                        <div>
                            <p style={{ margin: '0 0 4px', color: color.textSecondary, fontSize: '13px', fontWeight: 500 }}>
                                No messages yet
                            </p>
                            <p style={{ margin: 0, color: color.textFaint, fontSize: '11px', lineHeight: 1.5 }}>
                                Agents can communicate using the<br />
                                <code style={{ fontFamily: '"JetBrains Mono", monospace', color: color.accent }}>send_message_to_agent</code> MCP tool
                            </p>
                        </div>
                    </div>
                ) : (
                    messages.map(msg => {
                        const isInbound = msg.receiver_project_id === projectId
                        const isUnread = isInbound && msg.status !== 'read'
                        return (
                            <div
                                key={msg.id}
                                onClick={() => isInbound && markRead(msg)}
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: isInbound ? 'flex-start' : 'flex-end',
                                    gap: '4px',
                                    cursor: isUnread ? 'pointer' : 'default',
                                }}
                            >
                                <div style={{
                                    fontSize: '10px', color: color.textFaint,
                                    display: 'flex', alignItems: 'center', gap: '6px',
                                }}>
                                    {isInbound ? (
                                        <><span style={{ color: color.accent }}>{msg.sender_name}</span> → {projectName}</>
                                    ) : (
                                        <>{projectName} → <span style={{ color: color.accent }}>{msg.receiver_name}</span></>
                                    )}
                                    <span>{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                                <div style={{
                                    maxWidth: '75%',
                                    background: isInbound ? color.bgSurface : color.accentSubtle,
                                    border: `1px solid ${isUnread ? color.accent : isInbound ? color.borderMuted : color.accentEmphasis}`,
                                    borderRadius: '8px',
                                    padding: '8px 12px',
                                    fontSize: '12px',
                                    color: color.textPrimary,
                                    lineHeight: 1.5,
                                    wordBreak: 'break-word',
                                    whiteSpace: 'pre-wrap',
                                    boxShadow: isUnread ? `0 0 0 2px ${color.accent}30` : 'none',
                                }}>
                                    {msg.content}
                                    {isUnread && (
                                        <span style={{
                                            display: 'inline-block', marginLeft: '6px',
                                            width: '6px', height: '6px', borderRadius: '50%',
                                            background: color.accent, verticalAlign: 'middle',
                                        }} />
                                    )}
                                </div>
                                <div style={{ fontSize: '10px', color: color.textFaint }}>
                                    {msg.status}
                                </div>
                            </div>
                        )
                    })
                )}
            </div>
        </div>
    )
}

// makeTerminal is imported from ./hooks/useTerminalSessions

// ─── Claude status badge ──────────────────────────────────────────────────────

// ─── Agent card ──────────────────────────────────────────────────────────────

function AgentCard({
    project, active, status, activity, sessionStart, outputChars, onClick,
}: {
    project: Project; active: boolean; status?: 'running' | 'done'
    activity?: string; sessionStart?: Date; outputChars?: number
    onClick: () => void
}) {
    const [elapsed, setElapsed] = useState('')

    useEffect(() => {
        if (!sessionStart) { setElapsed(''); return }
        const update = () => {
            const secs = Math.floor((Date.now() - sessionStart.getTime()) / 1000)
            if (secs < 60) setElapsed(`${secs}s`)
            else if (secs < 3600) setElapsed(`${Math.floor(secs / 60)}m`)
            else setElapsed(`${Math.floor(secs / 3600)}h`)
        }
        update()
        const id = setInterval(update, 15000)
        return () => clearInterval(id)
    }, [sessionStart])

    const initial = project.name.charAt(0).toUpperCase()
    const avatarBg = agentColor(project.name)
    const isRunning = status === 'running'
    const tokLabel = outputChars && outputChars > 400
        ? (outputChars / 4000 >= 1 ? `${(outputChars / 4000).toFixed(1)}k tok` : `${Math.round(outputChars / 4)} tok`)
        : null

    return (
        <div
            onClick={onClick}
            style={{
                display: 'flex', alignItems: 'flex-start', gap: '10px',
                padding: '12px 14px', cursor: 'pointer', transition: 'background 0.1s',
                background: active ? color.accentSubtle : 'transparent',
                borderLeft: `2px solid ${active ? color.accent : 'transparent'}`,
            }}
            onMouseEnter={e => { if (!active) e.currentTarget.style.background = color.bgCanvas }}
            onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
        >
            <div style={{
                width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0,
                background: avatarBg, display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: '12px', fontWeight: 700, color: '#fff', marginTop: '1px',
            }}>
                {initial}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                    <span style={{ color: color.textPrimary, fontSize: '13px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {project.name}
                    </span>
                    <span style={{
                        width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0,
                        background: isRunning ? '#3fb950' : color.textFaint,
                        boxShadow: isRunning ? '0 0 5px #3fb950' : 'none',
                    }} />
                </div>
                <div style={{ color: color.textMuted, fontSize: '11px', marginTop: '1px' }}>{project.language}</div>
                {activity && (
                    <div style={{
                        color: color.textSecondary, fontSize: '11px', marginTop: '6px', lineHeight: 1.4,
                        overflow: 'hidden', display: '-webkit-box',
                        WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
                    }}>
                        {activity}
                    </div>
                )}
                {(elapsed || tokLabel) && (
                    <div style={{ display: 'flex', gap: '8px', marginTop: '5px', color: color.textFaint, fontSize: '10px', fontFamily: '"JetBrains Mono", monospace' }}>
                        {elapsed && <span>{elapsed} uptime</span>}
                        {tokLabel && <span>{tokLabel}</span>}
                    </div>
                )}
            </div>
        </div>
    )
}

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
    const { props, component } = usePage<{ project?: string; agent_id?: number; tasks?: Task[] }>()
    const projectName = props.project
    const agentIdFromUrl = props.agent_id  // set by /{project}/agents/{agent_id} route

    // ── Data hooks ────────────────────────────────────────────────────────────
    const { workspaces, invalidate: invalidateWorkspaces } = useWorkspace()
    const { allProjects, unassigned: unassignedProjects, invalidate: invalidateProjects, update: updateProject, remove: removeProject } = useProjects()

    // Modal/UI state
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

    // Terminal / Claude status state (not in react-query — driven by WebSocket events)
    const [claudeStatus, setClaudeStatus] = useState<Record<number, 'running' | 'done'>>({})
    const [lastActivity, setLastActivity] = useState<Record<number, string>>({})
    const [sessionStart, setSessionStart] = useState<Record<number, Date>>({})
    const [outputChars, setOutputChars] = useState<Record<number, number>>({})

    const isTasksPage = component === 'Tasks'
    // Pages that render their own content into the content area via children
    const pageHasContent = new Set(['Settings']).has(component)
    const [projectView, setProjectView] = useState<ProjectView>('agents')
    const activeView: ProjectView = isTasksPage ? 'tasks' : projectView
    const [showCreateTask, setShowCreateTask] = useState(false)
    const [isDraggingOver, setIsDraggingOver] = useState(false)
    const [selectedTask, setSelectedTask] = useState<Task | null>(null)
    const [newMessageIds, setNewMessageIds] = useState<number[]>([])
    const [agentTemplates, setAgentTemplates] = useState<AgentTemplate[]>([])
    const [showAddAgent, setShowAddAgent] = useState(false)
    const [activeAgentId, setActiveAgentId] = useState<number | null>(null)
    const [showProjectSearch, setShowProjectSearch] = useState(false)
    const [editingAgent, setEditingAgent] = useState<ProjectAgent | null>(null)

    const sessions = useRef<Map<number, Session>>(new Map())
    const containerRefs = useRef<Map<number, HTMLDivElement | null>>(new Map())
    const agentSessions = useRef<Map<number, Session>>(new Map())
    const agentContainerRefs = useRef<Map<number, HTMLDivElement | null>>(new Map())
    const fileInputRef = useRef<HTMLInputElement>(null)

    const activeProject = allProjects.find(p => p.slug === projectName) ?? allProjects[0] ?? null

    // Per-project hooks (re-run when active project changes)
    const taskHook = useTasks(activeProject?.id ?? null)
    const agentHook = useAgents(activeProject?.id ?? null)
    const tasks = taskHook.tasks
    const projectAgents = agentHook.agents

    // Derive active agent from URL agent_id (agentIdFromUrl prop from server)
    const activeAgentFromUrl = agentIdFromUrl
        ? projectAgents.find(a => a.id === agentIdFromUrl) ?? null
        : null

    // Seed claudeStatus from fetched project data on first load
    useEffect(() => {
        const initial: Record<number, 'running' | 'done'> = {}
        for (const p of allProjects) {
            if (p.claude_status === 'running') initial[p.id] = 'running'
            else if (p.claude_status === 'idle') initial[p.id] = 'done'
        }
        setClaudeStatus(prev => ({ ...initial, ...prev }))
    }, [allProjects.length])

    // When agents load and URL has a slug, set the active agent ID
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

    // Fetch agent templates once on mount (global, not project-specific)
    useEffect(() => {
        fetch('/api/agent-templates')
            .then(r => r.json())
            .then(setAgentTemplates)
            .catch(() => {})
    }, [])

    // Launch a terminal session for a single agent (reusable helper)
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
            console.log("WS message: ", e.data)
            if (typeof e.data !== 'string') {
                term.write(new Uint8Array(e.data as ArrayBuffer))
            } else {
                // Handle JSON events (relay messages) from the WebSocket
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
        }) // requestAnimationFrame
    }

    // When an agent is selected, start ALL agents (so they can communicate)
    // but only focus the selected one
    useEffect(() => {
        if (activeAgentId === null || !activeProject) return

        // Use requestAnimationFrame to ensure containers are rendered
        requestAnimationFrame(() => {
            // Launch all agents so they can all receive relay messages
            for (const agent of projectAgents) {
                launchAgentSession(agent.id, agent.id === activeAgentId)
            }
        })
    }, [activeAgentId, projectAgents.length])


    function handleOpenTask(task: Task) { setSelectedTask(task) }
    function handleCloseTask() { setSelectedTask(null) }

    async function handleAddTask(title: string, body: string, assignees: string[]): Promise<Task | null> {
        try {
            return await taskHook.create.mutateAsync({ title, body, assignees })
        } catch { return null }
    }

    async function handleUpdateStatus(task: Task, status: Task['status']) {
        taskHook.updateStatus.mutate({ taskId: task.id, status })
    }

    async function handleDeleteTask(task: Task) {
        taskHook.remove.mutate(task.id)
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
            agentSessions.current.forEach(({ term, ws, observer }) => {
                observer.disconnect()
                term.dispose()
                ws.close()
            })
        }
    }, [])

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
        // Rolling text buffer for input-prompt detection (shared across messages)
        let termTextBuf = ''
        let lastInputSoundAt = 0

        ws.onmessage = e => {
            console.log("WS message: 4", e.data)
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

                // Detect Claude waiting for user input by scanning plain text
                const text = new TextDecoder().decode(bytes).replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
                termTextBuf = (termTextBuf + text).slice(-800)

                // Track last meaningful activity line for agent cards
                const stripped = text.replace(/[^\x20-\x7E\n\r]/g, '')
                const actLines = stripped.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 6 && !/^[$%>#\u276F]/.test(l))
                if (actLines.length) setLastActivity(prev => ({ ...prev, [activeProject.id]: actLines[actLines.length - 1] }))
                setOutputChars(prev => ({ ...prev, [activeProject.id]: (prev[activeProject.id] ?? 0) + bytes.length }))

                const now = Date.now()
                const inputPatterns = [
                    /\?\s*$/m,                       // ends with "?"
                    /\[Y\/n\]/i,                      // yes/no prompt
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
        }) // requestAnimationFrame
    }, [activeProject, projectAgents])

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

    // ── Context value ─────────────────────────────────────────────────────────
    const ctxValue = {
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
        <AppLayoutProvider value={ctxValue}>
        <div className="flex flex-col w-full h-screen overflow-hidden" style={{ background: color.bgCanvas }}>

            {/* ═══════════════════════════════════════════════════════════
                FULL-WIDTH TOP BAR
                Logo (220px) | Nav tabs (flex-1) | Search + icons
            ════════════════════════════════════════════════════════════ */}
            <header className="shrink-0 bg-white flex items-stretch" style={{ height: '48px', borderBottom: `1px solid ${color.stroke}`, zIndex: 20 }}>

                {/* Logo zone — same width as sidebar */}
                <div className="shrink-0 flex items-center gap-2.5 px-4" style={{ width: '220px', borderRight: `1px solid ${color.stroke}` }}>
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: color.accent }}>
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="white">
                            <path d="M0 8a8 8 0 1116 0A8 8 0 010 8zm8-6.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM6.5 7.75A.75.75 0 017.25 7h1a.75.75 0 01.75.75v2.75h.25a.75.75 0 010 1.5h-2a.75.75 0 010-1.5h.25v-2h-.25a.75.75 0 01-.75-.75zM8 6a1 1 0 110-2 1 1 0 010 2z"/>
                        </svg>
                    </div>
                    <span style={{ fontWeight: 700, fontSize: '14px', color: color.textPrimary, letterSpacing: '-0.01em' }}>
                        Keera Agent
                    </span>
                </div>

                {/* Nav tabs — centered */}
                <div className="flex items-stretch flex-1 px-2">
                    {([
                        { id: 'agents' as ProjectView, label: 'Dashboard' },
                        { id: 'commands' as ProjectView, label: 'Configurations' },
                        { id: 'tasks' as ProjectView, label: 'Tasks' },
                        { id: 'messages' as ProjectView, label: 'History' },
                    ] as const).map(tab => {
                        const isActive = activeView === tab.id
                        return (
                            <button
                                key={tab.id}
                                onClick={() => {
                                    if (tab.id === 'tasks' && activeProject) { router.visit(`/${activeProject.slug}/tasks`); return }
                                    setProjectView(tab.id)
                                    if (isTasksPage) router.visit(`/${activeProject?.slug}`)
                                }}
                                className="bg-transparent border-none cursor-pointer px-4 h-full text-[13px] transition-colors duration-100 relative"
                                style={{
                                    color: isActive ? color.textPrimary : color.textMuted,
                                    fontWeight: isActive ? 600 : 400,
                                    borderBottom: isActive ? `2px solid ${color.accent}` : '2px solid transparent',
                                    marginBottom: '-1px',
                                }}
                            >
                                {tab.label}
                            </button>
                        )
                    })}
                    {activeProject && (
                        <>
                            <div className="my-3 mx-1" style={{ width: '1px', background: color.stroke }} />
                            <div className="flex items-center gap-1.5 px-2">
                                <ClaudeStatusBadge status={claudeStatus[activeProject.id]} />
                            </div>
                        </>
                    )}
                </div>

                {/* Right: search + icons */}
                <div className="flex items-center gap-1 pr-3">
                    {/* Search bar */}
                    <div className="flex items-center gap-1.5 rounded-md px-2.5 py-1 mr-1" style={{ background: color.bgCanvas, border: `1px solid ${color.stroke}` }}>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill={color.textFaint} className="shrink-0">
                            <path d="M10.68 11.74a6 6 0 01-7.922-8.982 6 6 0 018.982 7.922l3.04 3.04a.749.749 0 11-1.06 1.06l-3.04-3.04zM11.5 7a4.499 4.499 0 11-8.997 0A4.499 4.499 0 0111.5 7z"/>
                        </svg>
                        <input
                            placeholder="Search..."
                            className="bg-transparent border-none outline-none text-[12px] w-28"
                            style={{ color: color.textPrimary }}
                        />
                    </div>
                    {/* Attach image (agents view) */}
                    {activeView === 'agents' && activeProject && (
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            title="Attach image"
                            className="bg-transparent border-none cursor-pointer p-1.5 flex items-center rounded transition-colors"
                            style={{ color: color.textFaint }}
                            onMouseEnter={e => (e.currentTarget.style.color = color.accent)}
                            onMouseLeave={e => (e.currentTarget.style.color = color.textFaint)}
                        >
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                                <path d="M4.5 3a2.5 2.5 0 015 0v9a1.5 1.5 0 01-3 0V5a.5.5 0 011 0v7a.5.5 0 001 0V3a1.5 1.5 0 10-3 0v9a2.5 2.5 0 005 0V5a.5.5 0 011 0v7a3.5 3.5 0 11-7 0V3z"/>
                            </svg>
                        </button>
                    )}
                    {/* Bell */}
                    <button
                        className="bg-transparent border-none cursor-pointer p-1.5 flex items-center rounded transition-colors"
                        style={{ color: color.textFaint }}
                        onMouseEnter={e => (e.currentTarget.style.color = color.textPrimary)}
                        onMouseLeave={e => (e.currentTarget.style.color = color.textFaint)}
                    >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 16a2 2 0 001.985-1.75c.017-.137-.097-.25-.235-.25h-3.5c-.138 0-.252.113-.235.25A2 2 0 008 16zm.25-14.25A5.25 5.25 0 003 7v2.047c0 .334-.102.656-.29.932L1.55 11.698A1.5 1.5 0 002.8 13.5h10.4a1.5 1.5 0 001.258-2.302l-1.16-1.719A1.625 1.625 0 0113 8.047V7A5.25 5.25 0 008.25 1.75z"/>
                        </svg>
                    </button>
                    {/* Settings */}
                    <button
                        onClick={() => router.visit('/settings')}
                        title="Settings"
                        className="bg-transparent border-none cursor-pointer p-1.5 flex items-center rounded transition-colors"
                        style={{ color: pageHasContent ? color.accent : color.textFaint }}
                        onMouseEnter={e => { if (!pageHasContent) e.currentTarget.style.color = color.textPrimary }}
                        onMouseLeave={e => { if (!pageHasContent) e.currentTarget.style.color = color.textFaint }}
                    >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 0a8.2 8.2 0 01.701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212.224.231.114.454.243.668.386.123.082.233.09.299.071l1.103-.303c.644-.176 1.392.021 1.82.63.27.385.506.792.704 1.218.315.675.111 1.422-.364 1.891l-.814.806c-.049.048-.098.147-.088.294.016.257.016.515 0 .772-.01.147.038.246.087.294l.814.806c.475.469.679 1.216.364 1.891a7.977 7.977 0 01-.704 1.217c-.428.61-1.176.807-1.82.63l-1.103-.303c-.066-.019-.176-.011-.299.071a5.909 5.909 0 01-.668.386c-.133.066-.194.158-.211.224l-.29 1.106c-.168.646-.715 1.196-1.458 1.26a8.006 8.006 0 01-1.402 0c-.743-.064-1.289-.614-1.458-1.26l-.289-1.106c-.018-.066-.079-.158-.212-.224a5.738 5.738 0 01-.668-.386c-.123-.082-.233-.09-.299-.071l-1.103.303c-.644.176-1.392-.021-1.82-.63a8.12 8.12 0 01-.704-1.218c-.315-.675-.111-1.422.363-1.891l.815-.806c.05-.048.098-.147.088-.294a6.214 6.214 0 010-.772c.01-.147-.038-.246-.088-.294l-.815-.806C.635 6.045.431 5.298.746 4.623a7.92 7.92 0 01.704-1.217c.428-.61 1.176-.807 1.82-.63l1.102.302c.067.019.177.011.3-.071a5.659 5.659 0 01.668-.386c.133-.066.194-.158.211-.224l.29-1.106C6.156.421 6.703-.129 7.445.031 7.645.015 7.825 0 8 0zm1.5 8a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"/>
                        </svg>
                    </button>
                    {/* Avatar */}
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white cursor-pointer ml-1 shrink-0" style={{ background: '#7c6af7' }}>
                        B
                    </div>
                </div>
            </header>

            {/* ═══════════════════════════════════════════════════════════
                BODY: Sidebar + Content
            ════════════════════════════════════════════════════════════ */}
            <div className="flex flex-1 overflow-hidden">
                <Sidebar
                    allProjects={allProjects}
                    activeProject={activeProject}
                    projectView={activeView}
                    onChangeView={(view) => {
                        if (view === 'tasks' && activeProject) { router.visit(`/${activeProject.slug}/tasks`); return }
                        setProjectView(view)
                        if (isTasksPage) router.visit(`/${activeProject?.slug}`)
                    }}
                    taskCount={tasks.length}
                    newMessageCount={newMessageIds.length}
                    onAddAgent={() => setShowAddAgent(true)}
                    activeId={activeProject?.id ?? null}
                    onAddProject={openAddProject}
                    onMoveProject={setMovingProject}
                    onEditProject={setEditingProject}
                    onSystemPromptProject={setSystemPromptProject}
                    onPermissionsProject={setPermissionsProject}
                    onDeleteProject={setDeletingProject}
                    claudeStatus={claudeStatus}
                    onCreateWorkspace={() => setShowWorkspaceModal(true)}
                />

                {/* Main content area */}
                <div className="flex-1 flex overflow-hidden bg-white">

                    {pageHasContent ? children : (<>

                    {/* Agents view — always rendered to keep sessions alive */}
                    <div style={{ flex: 1, overflow: 'hidden', display: activeView === 'agents' ? 'flex' : 'none' }}>
                        <AgentsView />
                    </div>

                    {/* Commands view */}
                    {activeView === 'commands' && activeProject && (
                        <CommandsView project={activeProject} />
                    )}

                    {/* Tasks view */}
                    {activeView === 'tasks' && activeProject && (
                        <TasksView
                            tasks={tasks}
                            onOpenCreateTask={() => setShowCreateTask(true)}
                            onUpdateStatus={handleUpdateStatus}
                            onDeleteTask={handleDeleteTask}
                            onOpenTask={handleOpenTask}
                        />
                    )}

                    {/* Messages view */}
                    {activeView === 'messages' && activeProject && (
                        <MessagesView
                            projectId={activeProject.id}
                            projectName={activeProject.name}
                            newMessageIds={newMessageIds}
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

                    </>)}
                </div>
            </div>

            <ModalLayer />

        </div>
        </AppLayoutProvider>
    )
}
