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
