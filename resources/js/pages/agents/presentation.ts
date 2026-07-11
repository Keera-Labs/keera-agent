import { agentColor } from '@/utils/agentColor'
import { AGENT_TYPE_COLORS, AGENT_TYPE_LABELS } from '@/types/agent'
import type { ProjectAgent } from '@/layouts/hooks/agents'

// Shown wherever the backend doesn't yet expose a value (runtime, usage, branch).
// Never fabricate a number — a placeholder reads as "unknown", a made-up figure lies.
export const PLACEHOLDER = '—'

export function agentInitials(name: string): string {
    return name.slice(0, 2).toUpperCase()
}

export function agentAvatarColor(agent: ProjectAgent): string {
    return AGENT_TYPE_COLORS[agent.agent_type] ?? agentColor(agent.name)
}

export function agentRoleLabel(agent: ProjectAgent): string {
    return AGENT_TYPE_LABELS[agent.agent_type] ?? agent.agent_type
}
