import { Folder } from 'lucide-react'
import { color } from '@/tokens'
import { AGENT_TYPE_COLORS } from '@/types/agent'
import { agentColor } from '@/utils/agentColor'
import type { DashboardProject } from './types'

export function avatarColor(agentType: string, name: string): string {
    return AGENT_TYPE_COLORS[agentType] ?? agentColor(name)
}

export function FolderIcon({ size = 13, fill = color.textMuted }: { size?: number; fill?: string }) {
    return <Folder size={size} color={fill} className="shrink-0"/>
}

export function projectStatusSummary(p: DashboardProject): string {
    const parts: string[] = []
    if (p.activeCount) parts.push(`${p.activeCount} active`)
    if (p.waitingCount) parts.push(`${p.waitingCount} waiting`)
    if (p.queuedCount) parts.push(`${p.queuedCount} queued`)
    if (p.doneCount) parts.push(`${p.doneCount} done`)
    return parts.join(' · ') || 'No agents'
}
