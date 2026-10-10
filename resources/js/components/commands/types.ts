export type CommandKind = 'run' | 'setup'

export type CommandRunStatus = 'running' | 'stopped' | 'exited'

export interface CommandRun {
    command_id: number
    worktree: string | null
    status: CommandRunStatus
    exit_code: number | null
    started_at: string
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
