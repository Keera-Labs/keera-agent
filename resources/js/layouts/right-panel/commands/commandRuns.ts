import type { CommandRun } from '@/components/commands/types'

/** A running clock: `0:07`, `12:34`, `1:02:03`. */
export function clock(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000))
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = String(total % 60).padStart(2, '0')
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** A finished run's length: `840ms`, `4.2s`, `3m 12s`, `1h 5m`. */
export function duration(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)}ms`
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
    const minutes = Math.floor(ms / 60_000)
    if (minutes < 60) return `${minutes}m ${Math.floor((ms % 60_000) / 1000)}s`
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function elapsedMs(run: CommandRun, now: number): number {
    return now - Date.parse(run.started_at)
}

export const succeeded = (run: CommandRun) => run.status === 'exited' && run.exit_code === 0

/** Newest finished first, by when they ended (or started, for servers that don't report an end). */
export function recentRuns(runs: CommandRun[], limit = 20): CommandRun[] {
    const finishedAt = (run: CommandRun) => Date.parse(run.ended_at ?? run.started_at)
    return runs
        .filter(run => run.status !== 'running')
        .sort((a, b) => finishedAt(b) - finishedAt(a))
        .slice(0, limit)
}
