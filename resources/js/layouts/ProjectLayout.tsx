import React from 'react'
import { router, usePage } from '@inertiajs/react'
import { useAppLayout } from './context/AppLayoutContext'
import { AgentsView } from './views/AgentsView'
import { CommandsView } from './views/CommandsView'
import { TasksView } from './views/TasksView'
import type { Task } from '@/types/type'
import { color } from '@/tokens'
import AppLayout from './AppLayout'
import type { ProjectView } from './sidebar/Sidebar'
import { DotsIndicator } from './sidebar/Project'

// ─── Claude status badge ───────────────────────────────────────────────────────

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

// ─── Project-specific inner layout ────────────────────────────────────────────

export function ProjectLayout({ children }: { children: React.ReactNode }) {
    const {
        activeProject, tasks,
        claudeStatus,
        projectView, setProjectView,
        setShowCreateTask, setSelectedTask,
        handleUpdateStatus, handleDeleteTask,
    } = useAppLayout()

    const { component } = usePage()
    const isTasksPage = component === 'Tasks'
    const activeView: ProjectView = isTasksPage ? 'tasks' : projectView

    return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

            {/* ── Nav tabs: Dashboard / Configurations / Tasks + Claude status badge ── */}
            <div className="flex items-stretch px-2 bg-white shrink-0" style={{ borderBottom: `1px solid ${color.stroke}`, height: '40px' }}>
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
                        <div className="my-2 mx-1" style={{ width: '1px', background: color.stroke }} />
                        <div className="flex items-center gap-1.5 px-2">
                            <ClaudeStatusBadge status={claudeStatus[activeProject.id]} />
                        </div>
                    </>
                )}
            </div>

            {/* ── Main content area: routes between views ── */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

                {/* Agents view — always rendered to keep terminal sessions alive */}
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

                {/* Empty state when no project is selected */}
                {!activeProject && (
                    <div style={{
                        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        <span style={{ color: color.textFaint, fontSize: '13px' }}>No project selected</span>
                    </div>
                )}

                {/* Page-supplied content (for pages that render their own children) */}
                {children}
            </div>

        </div>
    )
}

// Wire up Inertia nested persistent layouts:
// ProjectLayout is wrapped by AppLayout so both stay alive across navigations.
ProjectLayout.layout = (page: React.ReactNode) => <AppLayout>{page}</AppLayout>
