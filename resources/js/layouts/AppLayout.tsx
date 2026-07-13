import AppHeader from "@/layouts/app/app-header"
import { color } from "@/tokens"
import { router, usePage } from "@inertiajs/react"
import "@xterm/xterm/css/xterm.css"
import { AppLayoutStateProvider, useAppLayout } from "./context/AppLayoutContext"
import { ModalLayer } from "./ModalLayer"
import Sidebar, { type ProjectView } from "./sidebar/Sidebar"

// ─── Phase 1 re-exports ───────────────────────────────────────────────────────
export { agentColor } from "@/utils/agentColor"
export { labelStyle, inputStyle, cancelBtnStyle, submitBtnStyle, flagRowStyle, toggleStyle } from "@/components/ui/styles"
export type { AgentTemplate } from "@/types/agent"
export { AGENT_TYPE_LABELS, AGENT_TYPE_COLORS } from "@/types/agent"
export { STATUS_CYCLE, STATUS_COLORS, STATUS_LABELS } from "@/types/task"
export { useAudio } from "@/hooks/useAudio"
export { useAgentTemplates } from "@/queries/useAgentTemplates"
export { makeTerminal, useTerminalSessions } from "@/hooks/useTerminalSessions"
export type { Session } from "@/hooks/useTerminalSessions"
export { TagInput } from "@/components/ui/TagInput"
export { SystemPromptModal } from "@/components/modals/SystemPromptModal"
export { PermissionsEditor } from "@/components/modals/PermissionsEditor"
export { ProjectPermissionsModal } from "@/components/modals/ProjectPermissionsModal"
export { DefaultPermissionsModal } from "@/components/modals/DefaultPermissionsModal"
export { GlobalSettingsModal } from "@/components/modals/GlobalSettingsModal"
export { ProjectSearchModal } from "@/components/modals/ProjectSearchModal"
export { ConfirmDeleteWorkspaceModal } from "@/components/modals/ConfirmDeleteWorkspaceModal"
export { CreateTaskModal } from "@/components/modals/CreateTaskModal"
export { TaskDetailModal } from "@/components/modals/TaskDetailModal"

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
        activeProject, tasks,
        claudeStatus,
        projectView, setProjectView,
        setShowWorkspaceModal,
    } = useAppLayout()

    const { component } = usePage()
    const isTasksPage = component === "Tasks"
    const isConfigPage = component === "Configurations"
    const activeView: ProjectView = isTasksPage ? "tasks" : isConfigPage ? "commands" : projectView

    return (
        <div className="flex flex-col w-full h-screen overflow-hidden" style={{ background: color.bgCanvas }}>
            <AppHeader/>
            <div className="flex flex-1 overflow-hidden">
                <Sidebar
                    activeProject={activeProject}
                    projectView={activeView}
                    onChangeView={(view) => {
                        if (!activeProject) { setProjectView(view); return }
                        if (view === "tasks") { router.visit(`/${activeProject.slug}/tasks`); return }
                        if (view === "commands") { router.visit(`/${activeProject.slug}/configurations`); return }
                        setProjectView("agents")
                        if (isTasksPage || isConfigPage) router.visit(`/${activeProject.slug}`)
                    }}
                    taskCount={tasks.length}
                    activeId={activeProject?.id ?? null}
                    claudeStatus={claudeStatus}
                    onCreateWorkspace={() => setShowWorkspaceModal(true)}
                />

                {/* Main content slot — ProjectLayout or page children rendered here */}
                <div className="flex-1 flex overflow-hidden bg-white">
                    {children}
                </div>
            </div>

            <ModalLayer/>

        </div>
    )
}
