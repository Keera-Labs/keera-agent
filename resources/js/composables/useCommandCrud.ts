import { useQueryCache } from '@pinia/colada'
import { toValue, type MaybeRefOrGetter } from 'vue'
import type { Command } from '@/components/commands/types'
import {
    COMMAND_RUNS_QUERY_KEY,
    COMMANDS_QUERY_KEY,
    CommandRequestError,
    createCommand,
    deleteCommand,
    updateCommand,
} from '@/queries/commandQuery'
import { useCommandRunStore } from '@/stores/commandRunStore'

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Network error')

export function useCommandCrud(projectId: MaybeRefOrGetter<number>) {
    const queryCache = useQueryCache()
    const runs = useCommandRunStore()

    const setCommands = (updater: (prev: Command[]) => Command[]) =>
        queryCache.setQueryData<Command[]>([...COMMANDS_QUERY_KEY, toValue(projectId)], prev => updater(prev ?? []))

    async function create(label: string, command: string): Promise<string | null> {
        try {
            const created = await createCommand(toValue(projectId), { label, command })
            setCommands(prev => [...prev, created])
            return null
        } catch (e) {
            return errorMessage(e)
        }
    }

    async function update(target: Command, label: string, command: string): Promise<boolean> {
        try {
            const updated = await updateCommand(target.id, { label, command })
            setCommands(prev => prev.map(c => (c.id === target.id ? updated : c)))
            return true
        } catch {
            return false
        }
    }

    async function remove(target: Command): Promise<string | null> {
        try {
            await deleteCommand(target.id)
        } catch (e) {
            if (!(e instanceof CommandRequestError)) throw e
            return `Could not delete "${target.label}": ${e.message}`
        }
        setCommands(prev => prev.filter(c => c.id !== target.id))
        runs.forgetCommand(target.id)
        queryCache.invalidateQueries({ key: COMMAND_RUNS_QUERY_KEY })
        return null
    }

    return { create, update, remove }
}
