import { useQuery } from '@pinia/colada'
import { toValue, type MaybeRefOrGetter } from 'vue'
import { useRefetchInterval } from '@/composables/useRefetchInterval'

export const PROJECT_USAGE_QUERY_KEY = ['project-usage']

export interface TokenUsage {
    input: number
    output: number
    cache_creation: number
    cache_read: number
    total: number
}

export interface AgentTokenUsage extends TokenUsage {
    last_model: string | null
    last_used_at: string | null
}

export interface LimitWindow {
    used_percentage: number
    /** Unix epoch seconds. */
    resets_at: number | null
}

export interface PlanLimits {
    five_hour: LimitWindow | null
    seven_day: LimitWindow | null
}

/** The latest statusline report of an agent. */
export interface AgentUsageReport extends PlanLimits {
    agent_id: number
    model: string | null
    context_used_percentage: number | null
    context_window_size: number | null
    updated_at: string | null
}

export interface ProjectUsage {
    today: TokenUsage
    /** Keyed by agent id; agents with no recorded usage are absent. */
    agents: Record<string, AgentTokenUsage>
    /** Keyed by agent id; only agents whose statusline has reported. */
    reports: Record<string, AgentUsageReport>
    /** Account-wide plan limits from the most recent report, null when unknown. */
    limits: PlanLimits | null
}

async function fetchProjectUsage(projectId: number): Promise<ProjectUsage | null> {
    const res = await fetch(`/api/projects/${projectId}/usage`)
    if (!res.ok) throw new Error('Failed to fetch usage')
    const json = await res.json()
    return (json.data?.attributes as ProjectUsage | undefined) ?? null
}

/** Claude token usage of a project, read from the session transcripts and polled. */
export function useProjectUsage(projectIdSource: MaybeRefOrGetter<number | null | undefined>) {
    const projectId = () => toValue(projectIdSource) ?? null
    const enabled = () => projectId() !== null

    const query = useQuery({
        key: () => [...PROJECT_USAGE_QUERY_KEY, projectId() ?? 0],
        query: () => fetchProjectUsage(projectId()!),
        enabled,
        staleTime: 1000 * 15,
    })
    useRefetchInterval(query.refetch, 1000 * 30, enabled)

    return { usage: query.data }
}

const UNITS: [number, string][] = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']]

/** Compact token count, e.g. `1.2M tok`. */
export function formatTokens(count: number): string {
    for (const [size, unit] of UNITS) {
        if (count >= size) return `${Number((count / size).toFixed(1))}${unit} tok`
    }
    return `${count} tok`
}

/** Multi-line tooltip splitting a total into its token kinds. */
export function tokenBreakdown(usage: TokenUsage & { last_model?: string | null }): string {
    const n = (value: number) => value.toLocaleString('en-US')
    const lines = [
        `Input: ${n(usage.input)}`,
        `Output: ${n(usage.output)}`,
        `Cache write: ${n(usage.cache_creation)}`,
        `Cache read: ${n(usage.cache_read)}`,
    ]
    if (usage.last_model) lines.push(`Last model: ${usage.last_model}`)
    return lines.join('\n')
}

/** Time until a reset, e.g. `2h 5m` or `3d 4h`. */
export function formatResetsIn(resetsAt: number, now = Date.now()): string {
    const minutes = Math.max(0, Math.round((resetsAt * 1000 - now) / 60000))
    const days = Math.floor(minutes / 1440)
    const hours = Math.floor((minutes % 1440) / 60)
    if (days) return `${days}d ${hours}h`
    if (hours) return `${hours}h ${minutes % 60}m`
    return `${minutes}m`
}

/** Tooltip line for a plan-limit window. */
export function limitDetail(label: string, window: LimitWindow, now = Date.now()): string {
    const resets = window.resets_at ? `, resets in ${formatResetsIn(window.resets_at, now)}` : ''
    return `${label}: ${Math.round(window.used_percentage)}% used${resets}`
}

/** Tooltip line for an agent's context window fill, or null when not reported. */
export function contextDetail(report: AgentUsageReport | undefined): string | null {
    if (report?.context_used_percentage == null) return null
    const size = report.context_window_size ? ` of ${formatTokens(report.context_window_size)}` : ''
    return `Context: ${Math.round(report.context_used_percentage)}%${size}`
}
