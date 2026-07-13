import ProjectCreateModal from "@/components/project/ProjectCreateModal"
import useProjects from "@/queries/useProjects"
import { useWorkspaceStore } from "@/stores/workspaceStore"
import { color } from "@/tokens"
import type { Project } from "@/types/type"
import { router, usePage } from "@inertiajs/react"
import { Info, Terminal, SquareCheckBig, Plus, Settings } from "lucide-react"
import type React from "react"
import { ProjectItem } from "./Project"
import { WorkspacePicker } from "./WorkSpace"
import { AgentAddModal } from "@/pages/agents/AgentAddModal"

export type ProjectView = "agents" | "commands" | "tasks"

export const PROJECT_NAV: { id: ProjectView; label: string; icon: React.ReactNode }[] = [
    {
        id: "agents",
        label: "Agents",
        icon: <Info size={15}/>,
    },
    {
        id: "commands",
        label: "Commands",
        icon: <Terminal size={15}/>,
    },
    {
        id: "tasks",
        label: "Tasks",
        icon: <SquareCheckBig size={15}/>,
    },
]

export default function Sidebar({
                                    activeProject,
                                    projectView,
                                    onChangeView,
                                    taskCount,
                                    activeId,
                                    claudeStatus,
                                    onCreateWorkspace,
                                }: {
    activeProject: Project | null
    projectView: ProjectView
    onChangeView: (v: ProjectView) => void
    taskCount: number
    activeId: number | null
    claudeStatus: Record<number, "running" | "done">
    onCreateWorkspace: () => void
}) {
    const filterWorkspaceId = useWorkspaceStore(s => s.currentWorkspaceId)
    const setFilterWorkspaceId = useWorkspaceStore(s => s.setCurrentWorkspaceId)
    const { component } = usePage()
    const isSettingsPage = component === "Settings"

    const { projects } = useProjects()

    const filteredProjects = filterWorkspaceId !== null
        ? projects.filter(p => Number(p.workspace_id) === filterWorkspaceId)
        : projects

    return (
        <aside style={{
            width: "220px", flexShrink: 0, background: color.bgCanvas,
            borderRight: `1px solid ${color.stroke}`, display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
            <WorkspacePicker
                selected={filterWorkspaceId}
                onSelect={setFilterWorkspaceId}
                onCreateWorkspace={onCreateWorkspace}
            />

            {/* Scrollable middle */}
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", minHeight: 0 }}>

                {/* PROJECTS */}
                <div style={{ padding: "10px 10px 4px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ color: color.textFaint, fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em" }}>
                        Projects
                    </span>
                    <ProjectCreateModal
                        defaultWorkspaceId={filterWorkspaceId}
                        trigger={
                            <button
                                title="Add project"
                                style={{ background: "transparent", border: "none", cursor: "pointer", color: color.textFaint, padding: "0 2px", display: "flex", alignItems: "center" }}
                                onMouseEnter={e => (e.currentTarget.style.color = color.textMuted)}
                                onMouseLeave={e => (e.currentTarget.style.color = color.textFaint)}
                            >
                                <Plus size={11}/>
                            </button>
                        }
                    />
                </div>

                <ul style={{ listStyle: "none", margin: 0, padding: "0 2px" }}>
                    {filteredProjects.length === 0 && (
                        <li style={{ padding: "4px 16px", color: color.textFaint, fontSize: "11px", fontStyle: "italic" }}>
                            No projects
                        </li>
                    )}
                    {filteredProjects.map(project => (
                        <li key={project.id}>
                            <ProjectItem
                                project={project}
                                active={project.id === activeId}
                                status={claudeStatus[project.id]}
                            />
                        </li>
                    ))}
                    {filteredProjects.length === 0 && (
                        <li>
                            <ProjectCreateModal
                                defaultWorkspaceId={filterWorkspaceId}
                                trigger={
                                    <button
                                        style={{
                                            margin: "2px 10px 6px", width: "calc(100% - 20px)",
                                            background: "transparent", border: `1px dashed ${color.borderMuted}`,
                                            borderRadius: "6px", color: color.textFaint, fontSize: "11px", padding: "6px",
                                            cursor: "pointer", textAlign: "center", display: "block",
                                        }}
                                        onMouseEnter={e => {
                                            e.currentTarget.style.color = color.textMuted
                                            e.currentTarget.style.borderColor = color.textMuted
                                        }}
                                        onMouseLeave={e => {
                                            e.currentTarget.style.color = color.textFaint
                                            e.currentTarget.style.borderColor = color.borderMuted
                                        }}
                                    >
                                        + Add project
                                    </button>
                                }
                            />
                        </li>
                    )}
                </ul>

                {/* Active project card */}
                {activeProject && (
                    <div style={{ padding: "8px 8px 4px" }}>
                        <div style={{
                            display: "flex", alignItems: "center", gap: "10px",
                            padding: "9px 12px", borderRadius: "8px",
                            background: color.bgSurface, border: `1px solid ${color.borderMuted}`,
                        }}>
                            {/* Terminal icon in blue square */}
                            <div style={{
                                width: "32px", height: "32px", borderRadius: "8px",
                                background: "#EEF2FF",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                flexShrink: 0,
                            }}>
                                <Terminal size={16} color="#4F46E5"/>
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ color: color.textPrimary, fontSize: "13px", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {activeProject.name}
                                </div>
                                <div style={{ color: color.textMuted, fontSize: "11px", marginTop: "1px" }}>
                                    AI Coding Manager
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* WORKSPACE nav */}
                <div style={{ padding: "10px 16px 4px" }}>
                    <span style={{ color: color.textFaint, fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                        Workspace
                    </span>
                </div>
                <div style={{ padding: "0 8px 8px", display: "flex", flexDirection: "column", gap: "1px" }}>
                    {PROJECT_NAV.map(item => {
                        const active = item.id === projectView
                        const count = item.id === "tasks" ? taskCount : 0
                        return (
                            <button
                                key={item.id}
                                data-tab={item.id}
                                onClick={() => onChangeView(item.id)}
                                style={{
                                    display: "flex", alignItems: "center", gap: "8px",
                                    padding: "7px 10px",
                                    background: active ? color.accentSubtle : "transparent",
                                    border: `1px solid ${active ? color.accentEmphasis : "transparent"}`,
                                    borderRadius: "6px",
                                    color: active ? color.accentMuted : color.textMuted,
                                    fontSize: "12px", fontWeight: active ? 600 : 400,
                                    cursor: "pointer", textAlign: "left", width: "100%",
                                    transition: "all 0.1s",
                                }}
                                onMouseEnter={e => {
                                    if (!active) {
                                        e.currentTarget.style.background = color.bgSurface
                                        e.currentTarget.style.color = color.textSecondary
                                    }
                                }}
                                onMouseLeave={e => {
                                    if (!active) {
                                        e.currentTarget.style.background = "transparent"
                                        e.currentTarget.style.color = color.textMuted
                                    }
                                }}
                            >
                                {item.icon}
                                <span style={{ flex: 1 }}>{item.label}</span>
                                {count > 0 && (
                                    <span style={{
                                        fontSize: "10px", fontWeight: 700,
                                        padding: "1px 6px", borderRadius: "10px",
                                        background: color.accentSubtle, color: color.accent,
                                    }}>
                                        {count}
                                    </span>
                                )}
                            </button>
                        )
                    })}
                </div>
            </div>

            {/* Bottom bar: Settings link + New Agent button */}
            <div style={{ borderTop: `1px solid ${color.stroke}`, display: "flex", flexDirection: "column", gap: "4px", padding: "8px 10px 10px" }}>
                {/* Settings link */}
                <button
                    onClick={() => router.visit("/settings")}
                    style={{
                        display: "flex", alignItems: "center", gap: "8px",
                        padding: "7px 10px", width: "100%",
                        background: isSettingsPage ? color.accentSubtle : "transparent",
                        border: `1px solid ${isSettingsPage ? color.accentEmphasis : "transparent"}`,
                        borderRadius: "6px",
                        color: isSettingsPage ? color.accentMuted : color.textMuted,
                        fontSize: "12px", fontWeight: isSettingsPage ? 600 : 400,
                        cursor: "pointer", textAlign: "left",
                        transition: "all 0.1s",
                    }}
                    onMouseEnter={e => {
                        if (!isSettingsPage) {
                            e.currentTarget.style.background = color.bgSurface
                            e.currentTarget.style.color = color.textSecondary
                        }
                    }}
                    onMouseLeave={e => {
                        if (!isSettingsPage) {
                            e.currentTarget.style.background = "transparent"
                            e.currentTarget.style.color = color.textMuted
                        }
                    }}
                >
                    <Settings size={14}/>
                    <span>Settings</span>
                </button>

                {/* New Agent button — always shown, disabled when no project.
                    AgentAddModal owns the open state and, when there is no active
                    project, renders this button inert (no modal). */}
                <AgentAddModal
                    trigger={
                        <button
                            disabled={!activeProject}
                            style={{
                                width: "100%", padding: "8px 12px",
                                background: activeProject ? color.accentEmphasis : color.bgSurface,
                                border: activeProject ? "none" : `1px solid ${color.stroke}`,
                                borderRadius: "7px",
                                color: activeProject ? "#fff" : color.textFaint,
                                fontSize: "13px", fontWeight: 600,
                                cursor: activeProject ? "pointer" : "default",
                                display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                                transition: "opacity 0.1s",
                                opacity: activeProject ? 1 : 0.5,
                            }}
                            onMouseEnter={e => { if (activeProject) e.currentTarget.style.opacity = "0.88" }}
                            onMouseLeave={e => { if (activeProject) e.currentTarget.style.opacity = "1" }}
                        >
                            <Plus size={12}/>
                            + New Agent
                        </button>
                    }
                />
            </div>
        </aside>
    )
}
