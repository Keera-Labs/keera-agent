import { useQuery } from "@tanstack/react-query"
import type { Project } from "@/types/type"

// Matches PROJECTS_PER_PAGE_MAX in app/controllers/project_controller.py —
// the API clamps per_page to this value regardless, so a single request
// only ever returns a page's worth. Page through until a short page tells
// us we've reached the end.
const PAGE_SIZE = 10

async function fetchAllProjects(): Promise<Project[]> {
    const all: Project[] = []
    let page = 1
    while (true) {
        const res = await fetch(`/api/projects?per_page=${PAGE_SIZE}&page=${page}`)
        if (!res.ok) throw new Error("Failed to fetch projects")
        const batch: Project[] = await res.json()
        all.push(...batch)
        if (batch.length < PAGE_SIZE) break
        page++
    }
    return all
}

// Full, unpaginated project list — for surfaces like the Cmd+P search
// palette that must be able to reach every project, unlike the sidebar's
// capped recent-projects list.
export default function useAllProjects(enabled: boolean) {
    const query = useQuery<Project[]>({
        queryKey: ["projects", "all"],
        queryFn: fetchAllProjects,
        enabled,
        staleTime: 1000 * 30,
    })
    return query.data ?? []
}
