import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useGitBranches, type GitTarget } from '@/queries/gitQuery'
import { useGitBaseStore } from '@/stores/gitBaseStore'

export function useGitBase(
    projectIdSource: MaybeRefOrGetter<number | null>,
    targetSource: MaybeRefOrGetter<GitTarget | null>,
    enabled: MaybeRefOrGetter<boolean> = true,
) {
    const store = useGitBaseStore()
    const query = useGitBranches(targetSource, enabled)

    const branches = computed(() => query.data.value?.branches ?? [])
    const defaultBase = computed(() => query.data.value?.default_base ?? null)
    const remembered = computed(() => {
        const id = toValue(projectIdSource)
        return id === null ? undefined : store.selected[id]
    })
    const base = computed(() => {
        const choice = remembered.value
        return choice && branches.value.includes(choice) ? choice : null
    })

    const ready = computed(() => !remembered.value || query.data.value !== undefined || !!query.error.value)

    function select(name: string) {
        const id = toValue(projectIdSource)
        if (id !== null) store.select(id, name === defaultBase.value ? null : name)
    }

    return { branches, defaultBase, base, ready, select }
}
