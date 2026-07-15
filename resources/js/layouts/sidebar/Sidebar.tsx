import ProjectCreateModal from "@/components/project/ProjectCreateModal"
import useProjects from "@/queries/projectsQuery"
import { useWorkspaceStore } from "@/stores/workspaceStore"
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
        <aside className="w-[220px] shrink-0 bg-canvas border-r border-stroke flex flex-col overflow-hidden">
            <WorkspacePicker
                selected={filterWorkspaceId}
                onSelect={setFilterWorkspaceId}
                onCreateWorkspace={onCreateWorkspace}
            />

            {/* Scrollable middle */}
            <div className="flex-1 overflow-y-auto flex flex-col min-h-0">

                {/* PROJECTS */}
                <div className="pt-2.5 pr-2.5 pb-1 pl-3.5 flex items-center justify-between">
                    <span className="text-zinc-400 text-[10px] font-bold uppercase tracking-[0.12em]">
                        Projects
                    </span>
                    <ProjectCreateModal
                        defaultWorkspaceId={filterWorkspaceId}
                        trigger={
                            <button
                                title="Add project"
                                className="bg-transparent border-0 cursor-pointer text-zinc-400 py-0 px-0.5 flex items-center hover:text-zinc-500"
                            >
                                <Plus size={11}/>
                            </button>
                        }
                    />
                </div>

                <ul className="list-none m-0 py-0 px-0.5">
                    {filteredProjects.length === 0 && (
                        <li className="py-1 px-4 text-zinc-400 text-[11px] italic">
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
                                        className="mt-0.5 mx-2.5 mb-1.5 w-[calc(100%-20px)] bg-transparent border border-dashed border-stroke rounded text-zinc-400 text-[11px] p-1.5 cursor-pointer text-center block hover:text-zinc-500 hover:border-zinc-500"
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
                    <div className="pt-2 px-2 pb-1">
                        <div className="flex items-center gap-2.5 py-[9px] px-3 rounded-md bg-surface border border-stroke">
                            {/* Terminal icon in blue square */}
                            <div className="w-8 h-8 rounded-md bg-[#EEF2FF] flex items-center justify-center shrink-0">
                                <Terminal size={16} color="#4F46E5"/>
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-zinc-900 text-[13px] font-bold truncate">
                                    {activeProject.name}
                                </div>
                                <div className="text-zinc-500 text-[11px] mt-px">
                                    AI Coding Manager
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* WORKSPACE nav */}
                <div className="pt-2.5 px-4 pb-1">
                    <span className="text-zinc-400 text-[10px] font-bold uppercase tracking-[0.08em]">
                        Workspace
                    </span>
                </div>
                <div className="pt-0 px-2 pb-2 flex flex-col gap-px">
                    {PROJECT_NAV.map(item => {
                        const active = item.id === projectView
                        const count = item.id === "tasks" ? taskCount : 0
                        return (
                            <button
                                key={item.id}
                                data-tab={item.id}
                                onClick={() => onChangeView(item.id)}
                                className={`flex items-center gap-2 py-[7px] px-2.5 border rounded text-[12px] cursor-pointer text-left w-full transition-all duration-100 ${active ? "bg-blue-50 border-blue-600 text-blue-600 font-semibold" : "bg-transparent border-transparent text-zinc-500 font-normal hover:bg-surface hover:text-zinc-700"}`}
                            >
                                {item.icon}
                                <span className="flex-1">{item.label}</span>
                                {count > 0 && (
                                    <span className="text-[10px] font-bold py-px px-1.5 rounded-lg bg-blue-50 text-accent">
                                        {count}
                                    </span>
                                )}
                            </button>
                        )
                    })}
                </div>
            </div>

            {/* Bottom bar: Settings link + New Agent button */}
            <div className="border-t border-stroke flex flex-col gap-1 pt-2 px-2.5 pb-2.5">
                {/* Settings link */}
                <button
                    onClick={() => router.visit("/settings")}
                    className={`flex items-center gap-2 py-[7px] px-2.5 w-full border rounded text-[12px] cursor-pointer text-left transition-all duration-100 ${isSettingsPage ? "bg-blue-50 border-blue-600 text-blue-600 font-semibold" : "bg-transparent border-transparent text-zinc-500 font-normal hover:bg-surface hover:text-zinc-700"}`}
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
                            className={`w-full py-2 px-3 rounded-[7px] text-[13px] font-semibold flex items-center justify-center gap-1.5 transition-opacity duration-100 ${activeProject ? "bg-blue-600 border-0 text-white cursor-pointer opacity-100 hover:opacity-[0.88]" : "bg-surface border border-stroke text-zinc-400 cursor-default opacity-50"}`}
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
