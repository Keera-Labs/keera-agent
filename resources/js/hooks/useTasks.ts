import { useEffect, useState } from 'react'

export interface Task {
    id: number
    project_id: number
    title: string
    description: string
    body: string | null
    priority: 'low' | 'medium' | 'high'
    assignees: string[]
    acceptance_criteria: string[]
    testing_methods: string[]
    validation_steps: string[]
    status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
    created_at: string
}

export function useTasks(projectId: number | null, initialTasks: Task[] = []) {
    const [tasks, setTasks] = useState<Task[]>(initialTasks)

    useEffect(() => {
        if (!projectId) { setTasks([]); return }
        fetch(`/api/projects/${projectId}/tasks`)
            .then(r => r.json())
            .then(setTasks)
            .catch(() => {})
    }, [projectId])

    async function createTask(title: string, body: string, assignees: string[]): Promise<Task | null> {
        if (!projectId) return null
        const res = await fetch(`/api/projects/${projectId}/tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, body, assignees }),
        })
        if (!res.ok) return null
        const task: Task = await res.json()
        setTasks(prev => [...prev, task])
        return task
    }

    async function updateStatus(task: Task, status: Task['status']) {
        const res = await fetch(`/api/tasks/${task.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
        })
        if (res.ok) setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status } : t))
    }

    async function deleteTask(task: Task) {
        await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' })
        setTasks(prev => prev.filter(t => t.id !== task.id))
    }

    return { tasks, setTasks, createTask, updateStatus, deleteTask }
}
