import { computed, ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'
import { messageAgent, useDefaultAgent } from '@/queries/agentQuery'
import { useGitWorktrees, type GitTarget } from '@/queries/gitQuery'
import type { AskStatus } from './AskLinesPopover.vue'
import type { LineSelection } from './lineSelection'

export function useAskAgent(targetSource: MaybeRefOrGetter<GitTarget | null>, selection: Ref<LineSelection | null>) {
    const projectId = () => toValue(targetSource)?.projectId ?? null
    const worktrees = useGitWorktrees(projectId)
    const defaultAgent = useDefaultAgent(projectId)

    const status = ref<AskStatus>('idle')
    const error = ref<string | null>(null)

    const owner = computed(() => {
        const worktree = toValue(targetSource)?.worktree
        const row = worktree ? worktrees.data.value?.find(w => w.path === worktree) : undefined
        if (row?.agent_id && row.agent_name) return { id: row.agent_id, name: row.agent_name }
        const fallback = defaultAgent.data.value
        return fallback ? { id: fallback.id, name: fallback.name } : null
    })

    watch(selection, () => {
        status.value = 'idle'
        error.value = null
    })

    async function send(message: string) {
        const agent = owner.value
        if (!agent) return
        status.value = 'sending'
        error.value = null
        try {
            status.value = (await messageAgent(agent.id, message)) === 'starting' ? 'started' : 'sent'
        } catch (e) {
            status.value = 'failed'
            error.value = e instanceof Error ? e.message : null
        }
    }

    return { owner, status, error, send }
}
