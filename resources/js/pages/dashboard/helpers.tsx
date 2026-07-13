import { color } from '@/tokens'
import { AGENT_TYPE_COLORS } from '@/types/agent'
import { agentColor } from '@/utils/agentColor'
import type { DashboardProject } from './types'

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
