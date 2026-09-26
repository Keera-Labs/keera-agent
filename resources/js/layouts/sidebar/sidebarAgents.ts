/** Compact age like the reference sidebar: "now", "5m", "3h", "2d". */
export function relativeTime(iso: string | null, now: number): string {
    if (!iso) return ''
    const then = Date.parse(iso)
    if (Number.isNaN(then)) return ''
    const minutes = Math.floor(Math.max(0, now - then) / 60_000)
    if (minutes < 1) return 'now'
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h`
    return `${Math.floor(hours / 24)}d`
}

const COLLAPSED_KEY = 'keera.sidebar.collapsedProjects'

export function loadCollapsedProjects(): Set<number> {
    try {
        const stored = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? '[]')
        return new Set(Array.isArray(stored) ? stored.filter(Number.isInteger) : [])
    } catch {
        return new Set()
    }
}

export function saveCollapsedProjects(ids: Set<number>) {
    try {
        window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...ids]))
    } catch { /* storage unavailable: collapse state stays in memory */ }
}
