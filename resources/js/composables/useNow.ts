import { onScopeDispose, ref } from 'vue'

export function useNow(intervalMs = 30_000) {
    const now = ref(Date.now())
    const id = setInterval(() => { now.value = Date.now() }, intervalMs)
    onScopeDispose(() => clearInterval(id))
    return now
}
