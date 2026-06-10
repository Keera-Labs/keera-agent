import { router, usePage } from '@inertiajs/react'
import '@xterm/xterm/css/xterm.css'
import { color } from '@/tokens'
import Sidebar, { type ProjectView } from './sidebar/Sidebar'
import { DotsIndicator } from './sidebar/Project'
import { AppLayoutStateProvider, useAppLayout } from './context/AppLayoutContext'
import { ModalLayer } from './ModalLayer'
import { AgentsView } from './views/AgentsView'
import { CommandsView } from './views/CommandsView'
import { TasksView } from './views/TasksView'
import type { Task } from '@/types/type'

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

// ─── Claude status badge (header indicator) ───────────────────────────────────

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

        setShowCreateTask, setSelectedTask,
        openAddProject, setMovingProject, setEditingProject,
        setDeletingProject, setShowWorkspaceModal,
        setShowAddAgent,
        handleUpdateStatus, handleDeleteTask,
    } = useAppLayout()

    const { component } = usePage()
    const isTasksPage = component === 'Tasks'
    const pageHasContent = new Set(['settings/Index']).has(component)
    const activeView: ProjectView = isTasksPage ? 'tasks' : projectView

    return (
        <div className="flex flex-col w-full h-screen overflow-hidden" style={{ background: color.bgCanvas }}>

            {/* ═══════════════════════════════════════════════════════════
                FULL-WIDTH TOP BAR
                Logo (220px) | Nav tabs (flex-1)
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

                {/* Right: icons */}
                <div className="flex items-center gap-1 pr-3">
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
                    onAddAgent={() => setShowAddAgent(true)}
                    activeId={activeProject?.id ?? null}
                    onAddProject={openAddProject}
                    onMoveProject={setMovingProject}
                    onEditProject={setEditingProject}
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
                            onOpenTask={(task: Task) => setSelectedTask(task)}
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
    )
}
