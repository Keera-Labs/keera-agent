import { useState } from 'react'

/**
 * Like useState but persists to localStorage.
 * Falls back to initialValue when the stored JSON can't be parsed.
 */
export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T) => void] {
    const [stored, setStored] = useState<T>(() => {
        try {
            const item = window.localStorage.getItem(key)
            return item !== null ? (JSON.parse(item) as T) : initialValue
        } catch {
            return initialValue
        }
    })

    const setValue = (value: T) => {
        try {
            setStored(value)
            if (value === null || value === undefined) {
                window.localStorage.removeItem(key)
            } else {
                window.localStorage.setItem(key, JSON.stringify(value))
            }
        } catch {
            // localStorage unavailable (private mode, quota exceeded) — silently degrade
        }
    }

    return [stored, setValue]
}
