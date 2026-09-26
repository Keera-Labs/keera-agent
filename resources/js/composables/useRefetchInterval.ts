import { onScopeDispose, toValue, type MaybeRefOrGetter } from 'vue'

/**
 * Poll a query while the tab is visible. Pinia Colada has no built-in
 * `refetchInterval`, and hidden tabs skip ticks to match the React Query
 * default this replaces.
 */
export function useRefetchInterval(
    refetch: () => unknown,
    intervalMs: number,
    enabled: MaybeRefOrGetter<boolean> = true,
) {
    const id = setInterval(() => {
        if (toValue(enabled) && document.visibilityState === 'visible') refetch()
    }, intervalMs)
    onScopeDispose(() => clearInterval(id))
}
