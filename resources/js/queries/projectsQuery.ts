import { router, usePage } from "@inertiajs/vue3"
import { useMutation, useQuery, useQueryCache } from "@pinia/colada"
import { storeToRefs } from "pinia"
import { computed } from "vue"
import type { Project } from "@/types/type"
import type { ProjectAgent } from "@/queries/agentQuery"
import { disposeProjectSessions } from "@/composables/useTerminalSessions"
import { useProjectStore } from "@/stores/projectStore"
import { useWorkspaceStore } from "@/stores/workspaceStore"

export const PROJECTS_QUERY_KEY = ["projects"]

// Matches PROJECTS_PER_PAGE_MAX in app/controllers/project_controller.py —
// the API clamps per_page to this value regardless, so requesting more is pointless.
const SIDEBAR_PER_PAGE = 10

async function fetchProjects(workspaceId: number | null): Promise<Project[]> {
    const params = new URLSearchParams({ per_page: String(SIDEBAR_PER_PAGE) })
    if (workspaceId !== null) params.set("workspace_id", String(workspaceId))

    const res = await fetch(`/api/projects?${params}`)
    if (!res.ok) throw new Error("Failed to fetch projects")
    return res.json()
}

export default function useProjects() {
    const queryCache = useQueryCache()
    const page = usePage<{ project?: string; projects?: Project[] }>()
    const projectStore = useProjectStore()
    const { currentWorkspaceId } = storeToRefs(useWorkspaceStore())

    const query = useQuery({
        key: () => [...PROJECTS_QUERY_KEY, currentWorkspaceId.value],
        query: () => fetchProjects(currentWorkspaceId.value),
        // Server-rendered props hold the unfiltered list, so they only seed "All Projects".
        initialData: () => (currentWorkspaceId.value === null ? page.props.projects : undefined),
        staleTime: 1000 * 30,
    })
    const projects = computed(() => query.data.value ?? [])

    function setActiveProject(slug?: string) {
        const list = projects.value
        const active = slug ? list.find(p => p.slug === slug) ?? null : list[0] ?? null
        if (slug && !active) return
        if (projectStore.activeProject?.id !== active?.id) projectStore.setActiveProject(active)
    }

    const invalidate = () => queryCache.invalidateQueries({ key: PROJECTS_QUERY_KEY })

    function handleProjectCreated(project: Project) {
        invalidate()
        router.visit(`/${project.slug}`)
    }

    const moveMutation = useMutation({
        mutation: async ({ project, workspaceId }: { project: Project; workspaceId: number | null }) => {
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
        mutation: async (projectId: number) => {
            const agents = queryCache.getQueryData<ProjectAgent[]>(["agents", projectId]) ?? []
            disposeProjectSessions(projectId, agents.map(a => a.id))
            const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" })
            if (!res.ok) throw new Error("Failed to delete project")
            return projectId
        },
        onSuccess: projectId => {
            invalidate()
            const project = projects.value.find(p => p.id === projectId)
            if (project && page.props.project === project.slug) router.visit("/")
        },
    })

    function handleProjectDeleted(projectId: number) {
        return deleteMutation.mutateAsync(projectId)
    }

    return {
        projects,
        setActiveProject,
        deleting: deleteMutation.isLoading,
        handleProjectCreated,
        handleMoveProject,
        handleProjectUpdated,
        handleProjectDeleted,
    }
}
