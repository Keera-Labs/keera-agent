import React from 'react'
import { router, usePage } from '@inertiajs/react'
import { useAppLayout } from './context/AppLayoutContext'
import AgentsIndex from '@/pages/agents/Index'
import { color } from '@/tokens'
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
        activeProject,
        claudeStatus,
        projectView, setProjectView,
        sessions, agentSessions,
    } = useAppLayout()

    // Live PTY sessions across all projects (PM + agent terminals).
    const runningCount = sessions.current.size + agentSessions.current.size

    const { component } = usePage()
    const isTasksPage = component === 'Tasks'
    const isConfigPage = component === 'Configurations'
    // The agent detail page owns the visible agent view; AgentsIndex then only
    // acts as the hidden terminal holder, so hide its wrapper (keep it mounted).
    const isAgentDetail = component === 'agents/Detail'
    const activeView: ProjectView = isTasksPage ? 'tasks' : isConfigPage ? 'commands' : projectView

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
                                if (!activeProject) { setProjectView(tab.id); return }
                                if (tab.id === 'tasks') { router.visit(`/${activeProject.slug}/tasks`); return }
                                if (tab.id === 'commands') { router.visit(`/${activeProject.slug}/configurations`); return }
                                setProjectView('agents')
                                if (isTasksPage || isConfigPage) router.visit(`/${activeProject.slug}`)
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

                {/* Global running indicator — far right */}
                {runningCount > 0 && (
                    <div className="flex items-center gap-2 pr-3" style={{ marginLeft: 'auto' }}>
                        <DotsIndicator />
                        <span style={{ color: color.warningBright, fontSize: '12.5px', fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>
                            {runningCount} running
                        </span>
                    </div>
                )}
            </div>

            {/* ── Main content area: routes between views ── */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

                {/* Agents view — always rendered to keep terminal sessions alive.
                    The wrapper stays mounted (display-toggled) so terminals never
                    unmount and blank out. It shows the overview when no agent is
                    drilled in; on the agent detail page it's hidden and only holds
                    the parked terminal containers (the page renders the live view). */}
                <div style={{ flex: 1, overflow: 'hidden', display: activeView === 'agents' && !isAgentDetail ? 'flex' : 'none' }}>
                    <AgentsIndex />
                </div>

                {/* The Commands (Configurations) and Tasks views are rendered by their
                    own Inertia pages (pages/Configurations.tsx, pages/Tasks.tsx) and
                    delivered here through {children}. */}

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
