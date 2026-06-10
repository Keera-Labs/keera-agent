import { router, usePage } from '@inertiajs/react'
import '@xterm/xterm/css/xterm.css'
import { color } from '@/tokens'
import Sidebar, { type ProjectView } from './sidebar/Sidebar'
import { AppLayoutStateProvider, useAppLayout } from './context/AppLayoutContext'
import { ModalLayer } from './ModalLayer'
import { BroadcastPocPanel } from '@/components/BroadcastPocPanel'

// ─── Phase 1 re-exports ───────────────────────────────────────────────────────
export { agentColor } from '@/utils/agentColor'
export { labelStyle, inputStyle, cancelBtnStyle, submitBtnStyle, flagRowStyle, toggleStyle } from '@/components/ui/styles'
export type { AgentTemplate } from '@/types/agent'
export { AGENT_TYPE_LABELS, AGENT_TYPE_COLORS } from '@/types/agent'
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
export { EditProjectModal } from '@/components/modals/EditProjectModal'
export { CreateTaskModal } from '@/components/modals/CreateTaskModal'
export { TaskDetailModal } from '@/components/modals/TaskDetailModal'
export { AddAgentModal } from '@/components/modals/AddAgentModal'

// ─── Persistent layout ────────────────────────────────────────────────────────

export default function AppLayout({ children }: { children: React.ReactNode }) {
    return (
        <AppLayoutStateProvider>
            <AppLayoutShell>{children}</AppLayoutShell>
        </AppLayoutStateProvider>
    )
}

function AppLayoutShell({ children }: { children: React.ReactNode }) {
    const {
        allProjects, activeProject, tasks,
        claudeStatus,
        projectView, setProjectView,
        setShowAddAgent,
        openAddProject, setMovingProject, setEditingProject,
        setDeletingProject, setShowWorkspaceModal,
    } = useAppLayout()

    const { component } = usePage()
    const isTasksPage = component === 'Tasks'
    const activeView: ProjectView = isTasksPage ? 'tasks' : projectView

    return (
        <div className="flex flex-col w-full h-screen overflow-hidden" style={{ background: color.bgCanvas }}>

            {/* ═══════════════════════════════════════════════════════════
                FULL-WIDTH TOP BAR
                Logo (220px) | center zone (flex-1) | Avatar
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

                {/* Center flex zone — reserved for project-level nav tabs (rendered by ProjectLayout) */}
                <div className="flex items-stretch flex-1" />

                {/* Right: avatar */}
                <div className="flex items-center gap-1 pr-3">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white cursor-pointer ml-1 shrink-0" style={{ background: '#7c6af7' }}>
                        B
                    </div>
                </div>
            </header>

            {/* ═══════════════════════════════════════════════════════════
                BODY: Sidebar + Content slot
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
                    onAddAgent={() => setShowAddAgent(true)}
                    activeId={activeProject?.id ?? null}
                    onAddProject={openAddProject}
                    onMoveProject={setMovingProject}
                    onEditProject={setEditingProject}
                    onDeleteProject={setDeletingProject}
                    claudeStatus={claudeStatus}
                    onCreateWorkspace={() => setShowWorkspaceModal(true)}
                />

                {/* Main content slot — ProjectLayout or page children rendered here */}
                <div className="flex-1 flex overflow-hidden bg-white">
                    {children}
                </div>
            </div>

            <ModalLayer />
            <BroadcastPocPanel />

        </div>
    )
}
