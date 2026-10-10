import { useQuery } from '@pinia/colada'
import { toValue, type MaybeRefOrGetter } from 'vue'
import type { Command, CommandRun } from '@/components/commands/types'

type CommandResourceObject = { type: 'commands'; id: string; attributes: Omit<Command, 'id'> }
type CommandRunResourceObject = { type: 'command_runs'; id: string; attributes: CommandRun }

const JSON_API_HEADERS = { Accept: 'application/json' }

export const COMMANDS_QUERY_KEY = ['commands']
export const COMMAND_RUNS_QUERY_KEY = ['command-runs']

export class CommandRequestError extends Error {
    constructor(readonly status: number, message: string) {
        super(message)
    }
}

export function parseCommand(resource: CommandResourceObject): Command {
    return { ...resource.attributes, id: Number(resource.id) }
}

async function request<T>(url: string, init: { method?: string; body?: object } = {}): Promise<T | null> {
    const headers: Record<string, string> = { ...JSON_API_HEADERS }
    if (init.body) headers['Content-Type'] = 'application/json'
    const res = await fetch(url, {
        method: init.method ?? 'GET',
        headers,
        body: init.body ? JSON.stringify(init.body) : undefined,
    })
    if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new CommandRequestError(res.status, typeof body?.detail === 'string' ? body.detail : `Request failed (${res.status})`)
    }
    return res.status === 204 ? null : res.json()
}

const worktreeQuery = (worktree: string | null) => (worktree ? `?${new URLSearchParams({ worktree })}` : '')

export async function fetchCommands(projectId: number): Promise<Command[]> {
    const document = await request<{ data: CommandResourceObject[] }>(`/api/projects/${projectId}/commands`)
    return document!.data.map(parseCommand)
}

export async function fetchCommandRuns(projectId: number): Promise<CommandRun[]> {
    const document = await request<{ data: CommandRunResourceObject[] }>(`/api/projects/${projectId}/command-runs`)
    return document!.data.map(resource => resource.attributes)
}

export type CommandFields = Pick<Command, 'label' | 'command'>

export async function createCommand(projectId: number, fields: CommandFields): Promise<Command> {
    const document = await request<{ data: CommandResourceObject }>(`/api/projects/${projectId}/commands`, { method: 'POST', body: fields })
    return parseCommand(document!.data)
}

export async function updateCommand(commandId: number, fields: Partial<CommandFields>): Promise<Command> {
    const document = await request<{ data: CommandResourceObject }>(`/api/commands/${commandId}`, { method: 'PATCH', body: fields })
    return parseCommand(document!.data)
}

export async function deleteCommand(commandId: number): Promise<void> {
    await request(`/api/commands/${commandId}`, { method: 'DELETE' })
}

export async function startCommandRun(commandId: number, worktree: string | null): Promise<CommandRun> {
    const document = await request<{ data: CommandRunResourceObject }>(`/api/commands/${commandId}/runs`, {
        method: 'POST',
        body: worktree ? { worktree } : {},
    })
    return document!.data.attributes
}

export async function stopCommandRun(commandId: number, worktree: string | null): Promise<void> {
    await request(`/api/commands/${commandId}/runs${worktreeQuery(worktree)}`, { method: 'DELETE' })
}

export function useCommands(projectIdSource: MaybeRefOrGetter<number | null>) {
    const projectId = () => toValue(projectIdSource)
    return useQuery({
        key: () => [...COMMANDS_QUERY_KEY, projectId()],
        query: () => fetchCommands(projectId()!),
        enabled: () => projectId() !== null,
        staleTime: 30_000,
    })
}

export function useCommandRuns(projectIdSource: MaybeRefOrGetter<number | null>) {
    const projectId = () => toValue(projectIdSource)
    return useQuery({
        key: () => [...COMMAND_RUNS_QUERY_KEY, projectId()],
        query: () => fetchCommandRuns(projectId()!),
        enabled: () => projectId() !== null,
        staleTime: 5_000,
        refetchOnWindowFocus: true,
    })
}
