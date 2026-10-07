import { ref } from 'vue'

/** Load and save an allow/deny permission pair at `url`; `save` resolves true on success. */
export function usePermissionsForm(url: string, loadError: string, saveError = 'Something went wrong') {
    const allow = ref<string[]>([])
    const deny = ref<string[]>([])
    const error = ref('')
    const fetching = ref(true)
    const saving = ref(false)

    fetch(url)
        .then(r => r.json())
        .then(d => {
            allow.value = d.allow ?? []
            deny.value = d.deny ?? []
        })
        .catch(() => { error.value = loadError })
        .finally(() => { fetching.value = false })

    async function save(): Promise<boolean> {
        error.value = ''
        saving.value = true
        try {
            const res = await fetch(url, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ allow: allow.value, deny: deny.value }),
            })
            const data = await res.json()
            if (!res.ok) {
                error.value = data.error ?? saveError
                return false
            }
            allow.value = data.allow ?? []
            deny.value = data.deny ?? []
            return true
        } catch {
            error.value = 'Network error'
            return false
        } finally {
            saving.value = false
        }
    }

    return { allow, deny, error, fetching, saving, save }
}
