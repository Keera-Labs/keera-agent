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
import { MessagesView } from './views/MessagesView'
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
        claudeStatus, newMessageIds,
        projectView, setProjectView,
        fileInputRef, uploadImage,
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
    )
}
