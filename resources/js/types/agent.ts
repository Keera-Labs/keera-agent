import type { AgentFlags } from '@/layouts/hooks/agents'

export type { AgentFlags }

export interface AgentTemplate {
    id: number
    name: string
    description: string | null
    agent_type: string
    system_prompt: string | null
    model: string
    flags: AgentFlags
    dangerously_skip_permissions: boolean
    plan_mode: boolean
    is_builtin: boolean
}

export const AGENT_TYPE_LABELS: Record<string, string> = {
    pm: 'PM',
    software_engineer: 'Software Engineer',
    software_engineer_frontend: 'Frontend Engineer',
    reviewer: 'Reviewer',
    qa: 'QA',
}

export const AGENT_TYPE_COLORS: Record<string, string> = {
    pm: '#58a6ff',
    software_engineer: '#3fb950',
    qa: '#ffa657',
}

