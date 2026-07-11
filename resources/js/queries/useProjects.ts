import { router, usePage } from "@inertiajs/react"
import { useContext } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { Project } from "@/types/type"
import { AppLayoutContext } from "@/layouts/context/AppLayoutContext"

export const PROJECTS_QUERY_KEY = ["projects"] as const

async function fetchProjects(): Promise<Project[]> {
    const res = await fetch("/api/projects")
    if (!res.ok) throw new Error("Failed to fetch projects")
    return res.json()
}

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

    // Nullable: the layout provider calls this hook before the context exists.
    // Delete reads only the layout's agent-terminal refs to tear them down.
    const layout = useContext(AppLayoutContext)

    function handleProjectCreated(project: Project) {
        invalidate()
        router.visit(`/${project.slug}`)
    }

    const moveMutation = useMutation({
        mutationFn: async ({ project, workspaceId }: { project: Project; workspaceId: number | null }) => {
            const res = await fetch(`/api/projects/${project.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ workspace_id: workspaceId }),
            })
            if (!res.ok) throw new Error("Failed to move project")
            return res.json() as Promise<Project>
        },
        onSuccess: invalidate,
    })

    async function handleMoveProject(project: Project, newWorkspaceId: number | null) {
        await moveMutation.mutateAsync({ project, workspaceId: newWorkspaceId })
    }

    async function handleProjectUpdated(_updated: Project) {
        await invalidate()
    }

    const deleteMutation = useMutation({
        mutationFn: async (projectId: number) => {
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
            const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" })
            if (!res.ok) throw new Error("Failed to delete project")
            return projectId
        },
        onSuccess: (projectId) => {
            invalidate()
            const project = projects.find(p => p.id === projectId)
            if (project && projectName === project.slug) router.visit("/")
        },
    })

    function handleProjectDeleted(projectId: number) {
        return deleteMutation.mutateAsync(projectId)
    }

    return {
        projects,
        deleting: deleteMutation.isPending,
        handleProjectCreated,
        handleMoveProject,
        handleProjectUpdated,
        handleProjectDeleted,
    }
}
