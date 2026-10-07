import { computed, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { useGitWorktrees, type GitTarget, type GitWorktree } from '@/queries/gitQuery'
import { useGitWorktreeStore } from '@/stores/gitWorktreeStore'

export function worktreeLabel(worktree: GitWorktree): string {
    if (worktree.agent_name) return worktree.agent_name
    if (worktree.is_main) return 'Main checkout'
    return worktree.path.split('/').filter(Boolean).pop() ?? worktree.path
}

/**
 * The worktree a project's git views operate on: the remembered choice when
 * `git worktree list` still has it, otherwise the project's own checkout.
 */
export function useGitWorktree(projectIdSource: MaybeRefOrGetter<number | null>) {
    const store = useGitWorktreeStore()
    const projectId = () => toValue(projectIdSource)
    const query = useGitWorktrees(projectId)

    const worktrees = computed(() => (query.data.value ?? []).filter(w => !w.prunable))
    const remembered = computed(() => {
        const id = projectId()
        return id === null ? undefined : store.selected[id]
    })
    const selected = computed(() =>
        worktrees.value.find(w => w.path === remembered.value) ?? worktrees.value.find(w => w.is_current) ?? null,
    )

    const target = computed<GitTarget | null>(() => {
        const id = projectId()
        if (id === null) return null
        // A remembered worktree waits for the list, so one removed since is never sent to the API.
        if (remembered.value && query.data.value === undefined && !query.error.value) return null
        const worktree = selected.value
        return { projectId: id, worktree: worktree && !worktree.is_current ? worktree.path : null }
    })

    function select(path: string) {
        const id = projectId()
        if (id !== null) store.select(id, path)
    }

    return { worktrees, selected, target, select }
}

/** Switches the project's git views to an agent's own worktree whenever that agent is opened. */
export function useAgentWorktreeDefault(
    projectIdSource: MaybeRefOrGetter<number | null>,
    agentIdSource: MaybeRefOrGetter<number | null>,
) {
    const store = useGitWorktreeStore()
    const { data } = useGitWorktrees(projectIdSource)
    // Applied once per opened agent, so picking another worktree afterwards sticks.
    let handledAgentId: number | null = null

    watch(
        [() => toValue(agentIdSource), data],
        ([agentId, worktrees]) => {
            const projectId = toValue(projectIdSource)
            if (agentId === null) handledAgentId = null
            if (agentId === null || agentId === handledAgentId || !worktrees || projectId === null) return
            handledAgentId = agentId
            const own = worktrees.find(w => w.agent_id === agentId && !w.prunable)
            if (own) store.select(projectId, own.path)
        },
        { immediate: true },
    )
}
