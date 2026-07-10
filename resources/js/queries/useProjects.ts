import { Project } from "@/types/type"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

async function fetchProjects(): Promise<Project[]> {
    const res = await fetch("/api/projects")
    if (!res.ok) throw new Error("Failed to fetch projects")
    return (await res.json()) as Project[]
}

export default function useProjects() {
    const queryClient = useQueryClient()
    const key = ["projects"]

    const query = useQuery<Project[]>({
        queryKey: key,
        queryFn: fetchProjects,
        staleTime: 1000 * 10,
        refetchInterval: 1000 * 10,
    })

    const invalidate = () => queryClient.invalidateQueries({ queryKey: key })

    const deleteMutation = useMutation({
        mutationFn: async (projectId: number) => {
            const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" })
            if (!res.ok) throw new Error("Failed to delete project")
        },
        onSuccess: invalidate,
    })

    const handleProjectDelete = (projectId: number) => deleteMutation.mutate(projectId)

    return {
        projects: query.data ?? [],
        isLoading: query.isLoading,
        invalidate,
        handleProjectDelete,
        deleting: deleteMutation.isPending,
    }
}
