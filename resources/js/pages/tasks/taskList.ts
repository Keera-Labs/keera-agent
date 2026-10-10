import { relativeTime } from '@/utils/relativeTime'
import type { Task } from '@/types/type'

export type TaskFilter = 'all' | 'running' | 'review' | 'done' | 'backlog'

export const TASK_FILTERS: { id: TaskFilter; label: string; statuses: Task['status'][] | null; dot: string | null }[] = [
    { id: 'all', label: 'All', statuses: null, dot: null },
    { id: 'running', label: 'Running', statuses: ['in_progress'], dot: 'bg-orange-500' },
    { id: 'review', label: 'In review', statuses: ['in_review'], dot: 'bg-blue-500' },
    { id: 'done', label: 'Done', statuses: ['completed'], dot: 'bg-green-500' },
    { id: 'backlog', label: 'Backlog', statuses: ['pending'], dot: 'bg-zinc-400' },
]

export type TaskSection = { status: Task['status']; label: string; dot: string; tasks: Task[] }

const SECTIONS: Omit<TaskSection, 'tasks'>[] = [
    { status: 'in_progress', label: 'Active agents', dot: 'bg-orange-500' },
    { status: 'in_review', label: 'Awaiting review', dot: 'bg-blue-500' },
    { status: 'completed', label: 'Completed', dot: 'bg-green-500' },
    { status: 'pending', label: 'Backlog', dot: 'bg-zinc-400' },
    { status: 'cancelled', label: 'Cancelled', dot: 'bg-zinc-300' },
]

export function matchesSearch(task: Task, query: string, projectName = ''): boolean {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (terms.length === 0) return true
    const haystack = [
        task.title,
        task.body ?? '',
        `TASK-${task.id}`,
        task.pr_number !== null ? `PR #${task.pr_number}` : '',
        task.branch ?? '',
        projectName,
        ...task.assignees,
    ].join('\n').toLowerCase()
    return terms.every(term => haystack.includes(term))
}

export function inFilter(task: Task, filter: TaskFilter): boolean {
    const statuses = TASK_FILTERS.find(f => f.id === filter)?.statuses
    return !statuses || statuses.includes(task.status)
}

export function countByFilter(tasks: Task[]): Record<TaskFilter, number> {
    const counts = { all: 0, running: 0, review: 0, done: 0, backlog: 0 }
    for (const { id } of TASK_FILTERS) counts[id] = tasks.filter(t => inFilter(t, id)).length
    return counts
}

const parseUtc = (timestamp: string | null) => Date.parse(asUtc(timestamp) ?? '') || 0
const lastActivity = (task: Task) => parseUtc(task.completed_at ?? task.created_at)

export const startOfLocalDay = (now: number) => new Date(now).setHours(0, 0, 0, 0)

/**
 * Non-empty status sections in display order, newest activity first within each.
 * With `completedSince`, the completed section only keeps tasks finished from that
 * instant on and is labelled "Completed today"; older ones stay under the Done tab.
 */
export function groupTasks(tasks: Task[], completedSince?: number): TaskSection[] {
    return SECTIONS
        .map(section => {
            let sectionTasks = tasks.filter(t => t.status === section.status)
            let label = section.label
            if (section.status === 'completed' && completedSince !== undefined) {
                sectionTasks = sectionTasks.filter(t => parseUtc(t.completed_at) >= completedSince)
                label = 'Completed today'
            }
            return { ...section, label, tasks: sectionTasks.sort((a, b) => lastActivity(b) - lastActivity(a)) }
        })
        .filter(section => section.tasks.length > 0)
}

// The backend serializes timestamps as naive UTC ("2026-01-01 10:00:00"), which Date.parse would read as local time.
export function asUtc(timestamp: string | null): string | null {
    if (!timestamp) return timestamp
    const iso = timestamp.trim().replace(' ', 'T')
    return /(Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? iso : `${iso}Z`
}

export function taskAge(task: Task, now: number): string {
    const age = relativeTime(asUtc(task.completed_at ?? task.created_at), now)
    return age && age !== 'now' ? `${age} ago` : age
}
