import type { AgentFlags } from '@/queries/agentQuery'

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
    // Two-tier scoping (task #283). project_id null = global template.
    project_id?: number | null
    source_template_id?: number | null
    is_override?: boolean
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

// Model options offered in the agent/template selectors. The `value` is passed
// verbatim to `claude --model`, so each must be a real model id the CLI accepts.
export const MODELS = [
    { value: 'claude-opus-5', label: 'Claude Opus 5' },
    { value: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
    { value: 'claude-fable-5', label: 'Claude Fable 5' },
]

// Default model when a selector needs a starting value (matches the backend DEFAULT_MODEL).
export const DEFAULT_MODEL = 'claude-opus-5'

