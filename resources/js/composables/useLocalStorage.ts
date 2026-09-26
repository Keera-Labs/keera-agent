import { readonly, ref, type Ref } from 'vue'

/**
 * A ref persisted to localStorage.
 * Falls back to initialValue when the stored JSON can't be parsed.
 */
export function useLocalStorage<T>(key: string, initialValue: T): [Readonly<Ref<T>>, (value: T) => void] {
    const stored = ref(read()) as Ref<T>

    function read(): T {
        try {
            const item = window.localStorage.getItem(key)
            return item !== null ? (JSON.parse(item) as T) : initialValue
        } catch {
            return initialValue
        }
    }

    function setValue(value: T) {
        stored.value = value
        try {
            if (value === null || value === undefined) {
                window.localStorage.removeItem(key)
            } else {
                window.localStorage.setItem(key, JSON.stringify(value))
            }
        } catch {
            // localStorage unavailable (private mode, quota exceeded) — silently degrade
        }
    }

    return [readonly(stored) as Readonly<Ref<T>>, setValue]
}
