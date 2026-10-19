import { usePage } from '@inertiajs/vue3'
import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useGitWorktrees, type GitWorktree } from '@/queries/gitQuery'
import { useCommandRunStore } from '@/stores/commandRunStore'

export type ViewedCheckout =
    | { status: 'ready'; worktree: GitWorktree | null }
    | { status: 'pending' }
    | { status: 'missing' }

const ROOT: ViewedCheckout = { status: 'ready', worktree: null }

export function resolveViewedWorktree(
    component: string,
    agentId: number | null,
    worktrees: GitWorktree[] | undefined,
    selectedPath: string | null,
): ViewedCheckout {
    const linked = (worktrees ?? []).filter(w => !w.prunable && !w.is_current)
    if (component === 'agents/Detail' && agentId !== null) {
        if (worktrees === undefined) return { status: 'pending' }
        const own = linked.find(w => w.agent_id === agentId)
        return own ? { status: 'ready', worktree: own } : { status: 'missing' }
    }
    if (component === 'Configurations' && selectedPath !== null) {
        return { status: 'ready', worktree: linked.find(w => w.path === selectedPath) ?? null }
    }
    return ROOT
}

export function placeLabel(worktree: GitWorktree | null): string {
    if (!worktree) return 'root'
    return worktree.path.split('/').filter(Boolean).pop() ?? worktree.path
}

const PLACE_LABELS = { pending: 'loading worktree…', missing: 'no agent worktree' }

export function useViewedWorktree(projectIdSource: MaybeRefOrGetter<number | null>, agentIdSource: MaybeRefOrGetter<number | null>) {
    const page = usePage()
    const store = useCommandRunStore()
    const projectId = () => toValue(projectIdSource)
    const query = useGitWorktrees(projectId)

    const checkout = computed(() => {
        const id = projectId()
        const selected = id === null ? null : (store.selectedWorktrees[id] ?? null)
        return resolveViewedWorktree(page.component, toValue(agentIdSource), query.data.value, selected)
    })
    const viewed = computed(() => (checkout.value.status === 'ready' ? checkout.value.worktree : null))
    const root = computed(() => (query.data.value ?? []).find(w => w.is_current) ?? null)

    return {
        status: computed(() => checkout.value.status),
        ready: computed(() => checkout.value.status === 'ready'),
        path: computed(() => viewed.value?.path ?? null),
        place: computed(() => (checkout.value.status === 'ready' ? placeLabel(viewed.value) : PLACE_LABELS[checkout.value.status])),
        branch: computed(() => (checkout.value.status === 'ready' ? ((viewed.value ?? root.value)?.branch ?? null) : null)),
    }
}
