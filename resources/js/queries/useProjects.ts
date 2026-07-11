import { router, usePage } from "@inertiajs/react"
import type { Project } from "@/types/type"
import { useAppLayout } from "@/layouts/context/AppLayoutContext"

// Single source for project data and mutations. It surfaces the layout-owned
// project list (allProjects) and the create/move/update/delete handlers used by
// the sidebar and the project modals. The handlers are deliberately
// layout-coupled: they refresh the persistent layout's own state via
// refreshData and tear down a deleted project's terminal sessions, and they
// avoid any TanStack query cache — a cache refetch would re-trigger the
// terminal-launch effect and disturb live PTYs.
export default function useProjects() {
    const { allProjects, refreshData, agentHook, agentSessions, agentContainerRefs } = useAppLayout()
    const projectName = usePage<{ project?: string }>().props.project

    function handleProjectCreated(project: Project) {
        refreshData()
        router.visit(`/${project.slug}`)
    }

    async function handleMoveProject(project: Project, newWorkspaceId: number | null) {
        await fetch(`/api/projects/${project.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ workspace_id: newWorkspaceId }),
        })
        await refreshData()
    }

    async function handleProjectUpdated(_updated: Project) {
        await refreshData()
    }

    function handleProjectDeleted(projectId: number) {
        const project = allProjects.find(p => p.id === projectId)
        // Clean up agent sessions for the deleted project
        for (const agent of agentHook.agents) {
            const session = agentSessions.current.get(agent.id)
            if (session) {
                session.observer.disconnect()
                session.term.dispose()
                session.ws.close()
                agentSessions.current.delete(agent.id)
            }
            agentContainerRefs.current.delete(agent.id)
        }
        fetch(`/api/projects/${projectId}`, { method: "DELETE" })
            .then(() => refreshData())
        if (project && projectName === project.slug) router.visit("/")
    }

    return {
        allProjects,
        handleProjectCreated,
        handleMoveProject,
        handleProjectUpdated,
        handleProjectDeleted,
    }
}
