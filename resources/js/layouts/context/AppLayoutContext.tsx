import { createContext, useContext } from 'react'
import type React from 'react'
import type { Project, Workspace, Task } from '@/types/type'
import type { ProjectAgent } from '@/layouts/hooks/agents'
import { useAgents } from '@/layouts/hooks/agents'
import type { AgentTemplate } from '@/types/agent'
import type { Session } from '@/layouts/hooks/useTerminalSessions'
import type { ProjectView } from '@/layouts/sidebar/Sidebar'

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
