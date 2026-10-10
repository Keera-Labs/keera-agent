import { describe, expect, it } from 'vitest'
import type { CommandRun } from '@/components/commands/types'
import { clock, duration, recentRuns, succeeded } from './commandRuns'

const run = (overrides: Partial<CommandRun>): CommandRun => ({
    command_id: 1,
    worktree: null,
    status: 'exited',
    exit_code: 0,
    started_at: '2026-10-09T10:00:00Z',
    ...overrides,
})

describe('clock', () => {
    it('ticks in minutes and seconds, adding hours only once needed', () => {
        expect(clock(7_000)).toBe('0:07')
        expect(clock(754_000)).toBe('12:34')
        expect(clock(3_723_000)).toBe('1:02:03')
        expect(clock(-5)).toBe('0:00')
    })
})

describe('duration', () => {
    it('picks a unit that fits the length', () => {
        expect(duration(840)).toBe('840ms')
        expect(duration(4_200)).toBe('4.2s')
        expect(duration(192_000)).toBe('3m 12s')
        expect(duration(3_900_000)).toBe('1h 5m')
    })
})

describe('succeeded', () => {
    it('only counts a clean exit', () => {
        expect(succeeded(run({}))).toBe(true)
        expect(succeeded(run({ exit_code: 1 }))).toBe(false)
        expect(succeeded(run({ status: 'stopped', exit_code: null }))).toBe(false)
    })
})

describe('recentRuns', () => {
    it('drops live runs and sorts by end time, falling back to the start', () => {
        const runs = [
            run({ command_id: 1, ended_at: '2026-10-09T10:01:00Z' }),
            run({ command_id: 2, status: 'running', exit_code: null }),
            run({ command_id: 3, started_at: '2026-10-09T10:05:00Z' }),
        ]
        expect(recentRuns(runs).map(r => r.command_id)).toEqual([3, 1])
        expect(recentRuns(runs, 1)).toHaveLength(1)
    })
})
