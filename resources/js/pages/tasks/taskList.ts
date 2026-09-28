import { relativeTime } from '@/layouts/sidebar/sidebarAgents'
import type { Task } from '@/types/type'

export type TaskFilter = 'all' | 'running' | 'done' | 'backlog'

// No "In Review" tab: the task model has no review status yet, so it could only ever be empty.
export const TASK_FILTERS: { id: TaskFilter; label: string; statuses: Task['status'][] | null; dot: string | null }[] = [
    { id: 'all', label: 'All', statuses: null, dot: null },
    { id: 'running', label: 'Running', statuses: ['in_progress'], dot: 'bg-accent' },
    { id: 'done', label: 'Done', statuses: ['completed'], dot: 'bg-success' },
    { id: 'backlog', label: 'Backlog', statuses: ['pending'], dot: 'bg-zinc-400' },
]

export type TaskSection = { status: Task['status']; label: string; dot: string; tasks: Task[] }

const SECTIONS: Omit<TaskSection, 'tasks'>[] = [
    { status: 'in_progress', label: 'Active agents', dot: 'bg-accent' },
    { status: 'pending', label: 'Backlog', dot: 'bg-zinc-400' },
    { status: 'completed', label: 'Completed', dot: 'bg-success' },
    { status: 'cancelled', label: 'Cancelled', dot: 'bg-zinc-300' },
]

export const taskRef = (task: Task) => `TASK-${task.id}`

export function matchesSearch(task: Task, query: string, projectName = ''): boolean {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (terms.length === 0) return true
    const haystack = [task.title, task.body ?? '', taskRef(task), projectName, ...task.assignees].join('\n').toLowerCase()
    return terms.every(term => haystack.includes(term))
}

export function inFilter(task: Task, filter: TaskFilter): boolean {
    const statuses = TASK_FILTERS.find(f => f.id === filter)?.statuses
    return !statuses || statuses.includes(task.status)
}

export function countByFilter(tasks: Task[]): Record<TaskFilter, number> {
    const counts = { all: 0, running: 0, done: 0, backlog: 0 }
    for (const { id } of TASK_FILTERS) counts[id] = tasks.filter(t => inFilter(t, id)).length
    return counts
}

const lastActivity = (task: Task) => Date.parse(task.completed_at ?? task.created_at) || 0

/** Non-empty status sections in display order, newest activity first within each. */
export function groupTasks(tasks: Task[]): TaskSection[] {
    return SECTIONS
        .map(section => ({
            ...section,
            tasks: tasks.filter(t => t.status === section.status).sort((a, b) => lastActivity(b) - lastActivity(a)),
        }))
        .filter(section => section.tasks.length > 0)
}

export function taskAge(task: Task, now: number): string {
    const age = relativeTime(task.completed_at ?? task.created_at, now)
    return age && age !== 'now' ? `${age} ago` : age
}
