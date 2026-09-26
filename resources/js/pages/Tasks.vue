<script setup lang="ts">
import { router, usePage } from '@inertiajs/vue3'
import { computed } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import ProjectLayout from '@/layouts/ProjectLayout.vue'
import type { NewTask } from '@/pages/tasks/CreateTaskModal.vue'
import TasksView from '@/pages/tasks/TasksView.vue'
import useProjects from '@/queries/projectsQuery'
import useWorkspaces from '@/queries/workspacesQuery'
import type { Task } from '@/types/type'

defineOptions({ layout: [AppLayout, ProjectLayout] })

// Tasks arrive as Inertia props (tasks_page_controller); mutations hit the JSON API
// and re-fetch with a partial reload. The props, not queries/taskQuery, are the source:
// the API list is paginated, hides older closed tasks and returns a JSON:API envelope.
const page = usePage<{ project: string; project_id: number | null; tasks?: Task[] }>()
const tasks = computed(() => page.props.tasks ?? [])
const { projects } = useProjects()
const { workspaces } = useWorkspaces()

async function send(url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: object) {
    await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    })
    router.reload({ only: ['tasks'] })
}

function createTask({ projectId, ...task }: NewTask) {
    return send(`/api/projects/${projectId}/tasks`, 'POST', task)
}

function updateStatus(task: Task, status: Task['status']) {
    return send(`/api/tasks/${task.id}`, 'PATCH', { status })
}

function deleteTask(task: Task) {
    return send(`/api/tasks/${task.id}`, 'DELETE')
}
</script>

<template>
    <TasksView
        :tasks="tasks"
        :projects="projects"
        :workspaces="workspaces"
        :default-project-id="page.props.project_id"
        @create-task="createTask"
        @update-status="updateStatus"
        @delete-task="deleteTask"
    />
</template>
