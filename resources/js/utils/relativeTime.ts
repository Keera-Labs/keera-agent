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
