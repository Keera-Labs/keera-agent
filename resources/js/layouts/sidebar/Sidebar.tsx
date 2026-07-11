import ProjectCreateModal from "@/components/project/ProjectCreateModal"
import { useAppLayout } from "@/layouts/context/AppLayoutContext"
import { useLocalStorage } from "@/layouts/hooks/useLocalStorage"
import useProjects from "@/queries/useProjects"
import { color } from "@/tokens"
import type { Project } from "@/types/type"
import { router, usePage } from "@inertiajs/react"
import type React from "react"
import { ProjectItem } from "./Project"
import { WorkspacePicker } from "./WorkSpace"

export type ProjectView = "agents" | "commands" | "tasks"

export const PROJECT_NAV: { id: ProjectView; label: string; icon: React.ReactNode }[] = [
    {
        id: "agents",
        label: "Agents",
        icon: (
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
                <path d="M0 8a8 8 0 1116 0A8 8 0 010 8zm8-6.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM6.5 7.75A.75.75 0 017.25 7h1a.75.75 0 01.75.75v2.75h.25a.75.75 0 010 1.5h-2a.75.75 0 010-1.5h.25v-2h-.25a.75.75 0 01-.75-.75zM8 6a1 1 0 110-2 1 1 0 010 2z"/>
            </svg>
        ),
    },
    {
        id: "commands",
        label: "Commands",
        icon: (
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
                <path d="M0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0114.25 15H1.75A1.75 1.75 0 010 13.25V2.75zm1.75-.25a.25.25 0 00-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25V2.75a.25.25 0 00-.25-.25H1.75zM3.5 6.25a.75.75 0 000 1.5h.268l-.01.034L2.76 10.5a.75.75 0 001.44.42l.04-.138H6.76l.04.138a.75.75 0 001.44-.42L7.242 7.784l-.01-.034H7.5a.75.75 0 000-1.5h-4zm.751 1.5H6.25l-.609 2.099H4.86L4.251 7.75zm5.5-1.5a.75.75 0 000 1.5h3.5a.75.75 0 000-1.5h-3.5zm0 3a.75.75 0 000 1.5h3.5a.75.75 0 000-1.5h-3.5z"/>
            </svg>
        ),
    },
    {
        id: "tasks",
        label: "Tasks",
        icon: (
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2.5 1.75v11.5c0 .138.112.25.25.25h10.5a.25.25 0 00.25-.25V1.75a.25.25 0 00-.25-.25H2.75a.25.25 0 00-.25.25zM2.75 0h10.5c.966 0 1.75.784 1.75 1.75v11.5A1.75 1.75 0 0113.25 15H2.75A1.75 1.75 0 011 13.25V1.75C1 .784 1.784 0 2.75 0zM11.78 6.28a.75.75 0 00-1.06-1.06L7.25 8.69 5.28 6.72a.75.75 0 00-1.06 1.06l2.5 2.5a.75.75 0 001.06 0l4-4z"/>
            </svg>
        ),
    },
]

export default function Sidebar({
                                    activeProject,
                                    projectView,
                                    onChangeView,
                                    taskCount,
                                    onAddAgent,
                                    activeId,
                                    claudeStatus,
                                    onCreateWorkspace,
                                }: {
    activeProject: Project | null
    projectView: ProjectView
    onChangeView: (v: ProjectView) => void
    taskCount: number
    onAddAgent: () => void
    activeId: number | null
    claudeStatus: Record<number, "running" | "done">
    onCreateWorkspace: () => void
}) {
    const [filterWorkspaceId, setFilterWorkspaceId] = useLocalStorage<number | null>("keera:selectedWorkspaceId", null)
    const { component } = usePage()
    const isSettingsPage = component === "Settings"

    const { allProjects, handleProjectCreated } = useProjects()
    const { workspaces } = useAppLayout()

    const filteredProjects = filterWorkspaceId !== null
        ? allProjects.filter(p => Number(p.workspace_id) === filterWorkspaceId)
        : allProjects

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
                        workspaces={workspaces}
                        defaultWorkspaceId={filterWorkspaceId}
                        onCreated={handleProjectCreated}
                        trigger={
                            <button
                                title="Add project"
                                style={{ background: "transparent", border: "none", cursor: "pointer", color: color.textFaint, padding: "0 2px", display: "flex", alignItems: "center" }}
                                onMouseEnter={e => (e.currentTarget.style.color = color.textMuted)}
                                onMouseLeave={e => (e.currentTarget.style.color = color.textFaint)}
                            >
                                <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                                    <path d="M7.75 2a.75.75 0 01.75.75V7h4.25a.75.75 0 010 1.5H8.5v4.25a.75.75 0 01-1.5 0V8.5H2.75a.75.75 0 010-1.5H7V2.75A.75.75 0 017.75 2z"/>
                                </svg>
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
                                workspaces={workspaces}
                                defaultWorkspaceId={filterWorkspaceId}
                                onCreated={handleProjectCreated}
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
                            {/* Terminal/arrow icon in blue square */}
                            <div style={{
                                width: "32px", height: "32px", borderRadius: "8px",
                                background: "#EEF2FF",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                flexShrink: 0,
                            }}>
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                    <path d="M2 4.5L6 8L2 11.5" stroke="#4F46E5" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M8 12H14" stroke="#4F46E5" strokeWidth="1.75" strokeLinecap="round"/>
                                </svg>
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
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 0a8.2 8.2 0 01.701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212.224.231.114.454.243.668.386.123.082.233.09.299.071l1.103-.303c.644-.176 1.392.021 1.82.63.27.385.506.792.704 1.218.315.675.111 1.422-.364 1.891l-.814.806c-.049.048-.098.147-.088.294.016.257.016.515 0 .772-.01.147.038.246.087.294l.814.806c.475.469.679 1.216.364 1.891a7.977 7.977 0 01-.704 1.217c-.428.61-1.176.807-1.82.63l-1.103-.303c-.066-.019-.176-.011-.299.071a5.909 5.909 0 01-.668.386c-.133.066-.194.158-.211.224l-.29 1.106c-.168.646-.715 1.196-1.458 1.26a8.006 8.006 0 01-1.402 0c-.743-.064-1.289-.614-1.458-1.26l-.289-1.106c-.018-.066-.079-.158-.212-.224a5.738 5.738 0 01-.668-.386c-.123-.082-.233-.09-.299-.071l-1.103.303c-.644.176-1.392-.021-1.82-.63a8.12 8.12 0 01-.704-1.218c-.315-.675-.111-1.422.363-1.891l.815-.806c.05-.048.098-.147.088-.294a6.214 6.214 0 010-.772c.01-.147-.038-.246-.088-.294l-.815-.806C.635 6.045.431 5.298.746 4.623a7.92 7.92 0 01.704-1.217c.428-.61 1.176-.807 1.82-.63l1.102.302c.067.019.177.011.3-.071a5.659 5.659 0 01.668-.386c.133-.066.194-.158.211-.224l.29-1.106C6.156.421 6.703-.129 7.445.031 7.645.015 7.825 0 8 0zm1.5 8a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"/>
                    </svg>
                    <span>Settings</span>
                </button>

                {/* New Agent button — always shown, disabled when no project */}
                <button
                    onClick={activeProject ? onAddAgent : undefined}
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
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M7.75 2a.75.75 0 01.75.75V7h4.25a.75.75 0 010 1.5H8.5v4.25a.75.75 0 01-1.5 0V8.5H2.75a.75.75 0 010-1.5H7V2.75A.75.75 0 017.75 2z"/>
                    </svg>
                    + New Agent
                </button>
            </div>
        </aside>
    )
}
