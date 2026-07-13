import { color } from '@/tokens'
import { AGENT_TYPE_COLORS } from '@/types/agent'
import { agentColor } from '@/utils/agentColor'
import type { Project } from '@/types/type'
import type { DashboardData, DashboardProject } from './types'

export function avatarColor(agentType: string, name: string): string {
    return AGENT_TYPE_COLORS[agentType] ?? agentColor(name)
}

export function FolderIcon({ size = 13, fill = color.textMuted }: { size?: number; fill?: string }) {
    return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill={fill} style={{ flexShrink: 0 }}>
            <path d="M1.75 1A1.75 1.75 0 000 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0016 13.25v-8.5A1.75 1.75 0 0014.25 3H7.5a.25.25 0 01-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75z" />
        </svg>
    )
}

export function projectStatusSummary(p: DashboardProject): string {
    const parts: string[] = []
    if (p.activeCount) parts.push(`${p.activeCount} active`)
    if (p.waitingCount) parts.push(`${p.waitingCount} waiting`)
    if (p.queuedCount) parts.push(`${p.queuedCount} queued`)
    if (p.doneCount) parts.push(`${p.doneCount} done`)
    return parts.join(' · ') || 'No agents'
}

// The dashboard payload is a server-computed snapshot for ALL projects; it has
// no per-project workspace_id. Scope it client-side by cross-referencing the
// reactive project list (which carries workspace_id) and re-aggregating totals
// from the per-project counts already in the payload — so a selected workspace
// narrows the view without a reload. A null selection ("All Projects") returns
// the payload untouched, matching the server's own scope.
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
