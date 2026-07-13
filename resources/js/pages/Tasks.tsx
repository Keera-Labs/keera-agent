import { useState } from 'react'
import { router, usePage } from '@inertiajs/react'
import AppLayout from '@/layouts/AppLayout'
import { ProjectLayout } from '@/layouts/ProjectLayout'
import { TasksView } from '@/layouts/views/TasksView'
import { CreateTaskModal } from '@/components/modals/CreateTaskModal'
import { TaskDetailModal } from '@/components/modals/TaskDetailModal'
import useProjects from '@/queries/projectsQuery'
import useWorkspaces from '@/queries/workspacesQuery'
import type { Task } from '@/types/type'

// Self-contained tasks page. Data is delivered as Inertia props by
// tasks_page_controller on every visit; mutations hit the JSON API directly and
// re-fetch with a partial reload. No task state lives in the layout/context — the
// page owns it. (projects/workspaces are read from context only to seed the
// create-task project picker; they are not task state.)
export default function Tasks() {
    const { props } = usePage<{ project: string; project_id: number | null; tasks: Task[] }>()
    const { workspaces } = useWorkspaces()
    const { projects } = useProjects()

    const tasks = props.tasks ?? []
    const [showCreate, setShowCreate] = useState(false)
    const [selected, setSelected] = useState<Task | null>(null)

    const refresh = () => router.reload({ only: ['tasks'] })

    async function createTask(title: string, body: string, assignees: string[], projectId: number) {
        await fetch(`/api/projects/${projectId}/tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, body, assignees }),
        })
        setShowCreate(false)
        refresh()
    }

    async function updateStatus(task: Task, status: Task['status']) {
        await fetch(`/api/tasks/${task.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
        })
        refresh()
    }

    async function deleteTask(task: Task) {
        await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' })
        refresh()
    }

    return (
        <>
            <TasksView
                tasks={tasks}
                onOpenCreateTask={() => setShowCreate(true)}
                onUpdateStatus={updateStatus}
                onDeleteTask={deleteTask}
                onOpenTask={setSelected}
            />

            {selected && (
                <TaskDetailModal task={selected} onClose={() => setSelected(null)} />
            )}

            {showCreate && (
                <CreateTaskModal
                    onClose={() => setShowCreate(false)}
                    onCreated={createTask}
                    projects={projects}
                    workspaces={workspaces}
                    defaultProjectId={props.project_id}
                />
            )}
        </>
    )
}

// Nested persistent layouts — see Home.tsx for why both must be listed here.
Tasks.layout = [AppLayout, ProjectLayout]
