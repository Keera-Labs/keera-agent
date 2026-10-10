export type CommandKind = 'run' | 'setup'

export type CommandRunStatus = 'running' | 'stopped' | 'exited'

export interface CommandRun {
    id?: string
    command_id: number | null
    label?: string
    command?: string
    worktree: string | null
    status: CommandRunStatus
    exit_code: number | null
    started_at: string
    ended_at?: string | null
    duration_ms?: number | null
    timeout_seconds?: number | null
}

export interface Command {
    id: number
    project_id: number
    label: string
    command: string
    description: string
    category: string
    shortcut: string
    kind: CommandKind
    run: CommandRun | null
}
