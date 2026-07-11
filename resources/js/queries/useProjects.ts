import { router, usePage } from "@inertiajs/react"
import { useContext } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { Project } from "@/types/type"
import { AppLayoutContext } from "@/layouts/context/AppLayoutContext"

export const PROJECTS_QUERY_KEY = ["projects"] as const

async function fetchProjects(): Promise<Project[]> {
    const res = await fetch("/api/projects")
    if (!res.ok) throw new Error("Failed to fetch projects")
    return res.json()
}

// Single source of truth for project data and mutations. It owns the project
// list via its own TanStack query over GET /api/projects and the
// create/move/update/delete handlers. Post-mutation refresh invalidates this
// hook's own query — never the layout — so the sidebar, modals and the derived
// activeProject all update from one place.
export default function useProjects() {
    const queryClient = useQueryClient()
    const props = usePage<{ project?: string; projects?: Project[] }>().props
    const projectName = props.project

    const query = useQuery<Project[]>({
        queryKey: PROJECTS_QUERY_KEY,
        queryFn: fetchProjects,
        initialData: props.projects,
        staleTime: 1000 * 30,
    })
    const projects = query.data ?? []

    const invalidate = () => queryClient.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY })

    function handleProjectCreated(project: Project) {
        invalidate()
        router.visit(`/${project.slug}`)
    }

    async function handleMoveProject(project: Project, newWorkspaceId: number | null) {
        await fetch(`/api/projects/${project.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ workspace_id: newWorkspaceId }),
        })
        await invalidate()
    }

    async function handleProjectUpdated(_updated: Project) {
        await invalidate()
    }

    // Delete is the one project mutation with a legitimate layout coupling: the
    // deleted project's live agent terminals must be torn down, and those PTY
    // sessions/container refs live in the persistent layout. We read ONLY those
    // refs from the layout (nullable — the layout provider itself calls this
    // hook before the context exists); everything else is owned here.
    const layout = useContext(AppLayoutContext)

    function handleProjectDeleted(projectId: number) {
        const project = projects.find(p => p.id === projectId)
        if (layout) {
            for (const agent of layout.agentHook.agents) {
                const session = layout.agentSessions.current.get(agent.id)
                if (session) {
                    session.observer.disconnect()
                    session.term.dispose()
                    session.ws.close()
                    layout.agentSessions.current.delete(agent.id)
                }
                layout.agentContainerRefs.current.delete(agent.id)
            }
        }
        fetch(`/api/projects/${projectId}`, { method: "DELETE" }).then(() => invalidate())
        if (project && projectName === project.slug) router.visit("/")
    }

    return {
        projects,
        handleProjectCreated,
        handleMoveProject,
        handleProjectUpdated,
        handleProjectDeleted,
    }
}
