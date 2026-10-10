import { usePage } from '@inertiajs/vue3'
import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useGitWorktrees, type GitWorktree } from '@/queries/gitQuery'
import { useCommandRunStore } from '@/stores/commandRunStore'

/**
 * The checkout a page is looking at, or null for the project root: an agent's
 * own worktree on its detail page, the Commands page's selection there, and the
 * root everywhere else.
 */
export function resolveViewedWorktree(
    component: string,
    agentId: number | null,
    worktrees: GitWorktree[],
    selectedPath: string | null,
): GitWorktree | null {
    const linked = worktrees.filter(w => !w.prunable && !w.is_current)
    if (component === 'agents/Detail' && agentId !== null) return linked.find(w => w.agent_id === agentId) ?? null
    if (component === 'Configurations' && selectedPath !== null) return linked.find(w => w.path === selectedPath) ?? null
    return null
}

export function placeLabel(worktree: GitWorktree | null): string {
    if (!worktree) return 'root'
    return worktree.path.split('/').filter(Boolean).pop() ?? worktree.path
}

export function useViewedWorktree(projectIdSource: MaybeRefOrGetter<number | null>, agentIdSource: MaybeRefOrGetter<number | null>) {
    const page = usePage()
    const store = useCommandRunStore()
    const projectId = () => toValue(projectIdSource)
    const query = useGitWorktrees(projectId)

    const worktrees = computed(() => (query.data.value ?? []).filter(w => !w.prunable))
    const viewed = computed(() => {
        const id = projectId()
        const selected = id === null ? null : (store.selectedWorktrees[id] ?? null)
        return resolveViewedWorktree(page.component, toValue(agentIdSource), worktrees.value, selected)
    })
    const root = computed(() => worktrees.value.find(w => w.is_current) ?? null)

    return {
        worktrees,
        viewed,
        path: computed(() => viewed.value?.path ?? null),
        place: computed(() => placeLabel(viewed.value)),
        branch: computed(() => (viewed.value ?? root.value)?.branch ?? null),
    }
}
