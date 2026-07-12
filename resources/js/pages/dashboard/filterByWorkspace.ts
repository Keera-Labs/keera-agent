import type { Project } from '@/types/type'
import type { DashboardData } from './types'

// The dashboard payload is a server-computed snapshot for ALL projects; it has
// no per-project workspace_id. We scope it client-side by cross-referencing the
// reactive project list (which carries workspace_id) and re-aggregating the
// totals from the per-project counts already in the payload — so a selected
// workspace narrows the view without a page reload. A null selection ("All
// Projects") returns the payload untouched, matching the server's own scope.
export function filterDashboardByWorkspace(
    data: DashboardData,
    workspaceId: number | null,
    projects: Project[],
    workspaceName?: string,
): DashboardData {
    if (workspaceId === null) return data

    const allowedIds = new Set(
        projects.filter(p => Number(p.workspace_id) === workspaceId).map(p => p.id),
    )
    const filteredProjects = data.projects.filter(p => allowedIds.has(p.id))
    const allowedNames = new Set(filteredProjects.map(p => p.name))
    const workingNow = data.workingNow.filter(a => allowedNames.has(a.project))

    const stats = { projects: filteredProjects.length, active: 0, waiting: 0, queued: 0 }
    let agentCount = 0
    for (const p of filteredProjects) {
        stats.active += p.activeCount
        stats.waiting += p.waitingCount
        stats.queued += p.queuedCount
        // Every agent lands in exactly one bucket, so their sum is the project's
        // total agent count (mirrors the server's per-agent tally).
        agentCount += p.activeCount + p.waitingCount + p.queuedCount + p.doneCount
    }

    return {
        ...data,
        workspaceName: workspaceName ?? data.workspaceName,
        agentCount,
        projectCount: filteredProjects.length,
        stats,
        workingNow,
        projects: filteredProjects,
    }
}
