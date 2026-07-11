import { useQuery } from '@tanstack/react-query'

export interface DashboardWorkingAgent {
    id: number
    name: string
    initials: string
    agentType: string
    role: string
    description: string
    project: string
    elapsed: string
}

export interface DashboardProjectAgent {
    initials: string
    agentType: string
}

export interface DashboardProject {
    id: number
    name: string
    online: boolean
    agents: DashboardProjectAgent[]
    extraAgents: number
    activeCount: number
    waitingCount: number
    queuedCount: number
    doneCount: number
    lastActivity: string
}

export interface DashboardData {
    workspaceName: string
    agentCount: number
    projectCount: number
    stats: { projects: number; active: number; waiting: number; queued: number }
    workingNow: DashboardWorkingAgent[]
    projects: DashboardProject[]
}

async function fetchDashboard(workspaceId: number | null): Promise<DashboardData> {
    const query = workspaceId != null ? `?workspace_id=${workspaceId}` : ''
    const res = await fetch(`/api/dashboard${query}`)
    if (!res.ok) throw new Error('Failed to fetch dashboard')
    return res.json()
}

/** Live workspace-aggregation feed for the Dashboard overview. */
export function useDashboard(workspaceId: number | null) {
    const query = useQuery<DashboardData>({
        queryKey: ['dashboard', workspaceId],
        queryFn: () => fetchDashboard(workspaceId),
        staleTime: 1000 * 5,
        refetchInterval: 1000 * 10,
    })

    return {
        data: query.data,
        isLoading: query.isLoading,
        isError: query.isError,
    }
}
