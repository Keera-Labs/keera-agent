import { useQueryCache, type EntryKey } from '@pinia/colada'
import { onScopeDispose, toValue, type MaybeRefOrGetter } from 'vue'

/**
 * Give window focus the same effect Pinia Colada gives visibilitychange for the queries under
 * `key`. Colada only listens to visibilitychange, which does not fire when the user switches back
 * from another app while the browser window stayed visible.
 *
 * Refreshing (rather than invalidating) keeps each query's staleTime, so a focus that follows a
 * visibilitychange, or vice versa, reuses the fetch already in flight instead of starting another,
 * and expensive queries such as the `gh` pull request lookup are not re-run on every app switch.
 */
export function useRefetchOnWindowFocus(key: MaybeRefOrGetter<EntryKey | null>) {
    const queryCache = useQueryCache()

    function onFocus() {
        const target = toValue(key)
        if (!target) return
        for (const entry of queryCache.getEntries({ key: target, active: true })) {
            const options = entry.options
            if (!options || !toValue(options.enabled) || !toValue(options.refetchOnWindowFocus)) continue
            // Failures already land in the query's error state.
            queryCache.refresh(entry).catch(() => {})
        }
    }

    window.addEventListener('focus', onFocus)
    onScopeDispose(() => window.removeEventListener('focus', onFocus))
}
