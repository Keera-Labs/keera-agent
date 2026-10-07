<script setup lang="ts">
import { router, usePage } from '@inertiajs/vue3'
import { useQueryCache } from '@pinia/colada'
import { computed, onBeforeUnmount, ref } from 'vue'
import AppLayout from '@/layouts/AppLayout.vue'
import ProjectLayout from '@/layouts/ProjectLayout.vue'
import type { NewTask } from '@/pages/tasks/CreateTaskModal.vue'
import TasksView from '@/pages/tasks/TasksView.vue'
import { useAgents } from '@/queries/agentQuery'
import { AGENT_SUMMARIES_QUERY_KEY } from '@/queries/agentSummariesQuery'
import useProjects from '@/queries/projectsQuery'
import useWorkspaces from '@/queries/workspacesQuery'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import type { Task } from '@/types/type'

defineOptions({ layout: [AppLayout, ProjectLayout] })

// Tasks arrive as Inertia props (tasks_page_controller); mutations hit the JSON API
// and re-fetch with a partial reload. The props, not queries/taskQuery, are the source:
// the API list is paginated, hides older closed tasks and returns a JSON:API envelope.
const page = usePage<{ project: string; project_id: number | null; tasks?: Task[] }>()
const tasks = computed(() => page.props.tasks ?? [])
const { projects } = useProjects()
const { workspaces } = useWorkspaces()
const agentsQuery = useAgents(() => page.props.project_id)
const queryCache = useQueryCache()
const layout = useAppLayoutStore()

// Mirrors the statuses the pause endpoint stops (agent_pause_controller.ACTIVE_STATUSES).
const activeAgents = computed(() =>
    agentsQuery.agents.value.filter(a => a.status === 'running' || a.status === 'needs_input'),
)

const notice = ref<string | null>(null)
let noticeTimer: ReturnType<typeof setTimeout> | undefined

function showNotice(message: string) {
    notice.value = message
    clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => { notice.value = null }, 4000)
}

onBeforeUnmount(() => clearTimeout(noticeTimer))

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

async function pauseAll() {
    const projectId = page.props.project_id
    const count = activeAgents.value.length
    if (projectId === null || count === 0) return
    const label = count === 1 ? '1 running agent' : `${count} running agents`
    if (!window.confirm(`Pause ${label}? Their terminals stop; starting an agent again resumes its conversation.`)) return

    const res = await fetch(`/api/projects/${projectId}/agents/pause`, { method: 'POST' }).catch(() => null)
    if (!res?.ok) {
        showNotice('Failed to pause agents')
        return
    }
    const { paused } = (await res.json()) as { paused: number[] }

    // The backend killed these PTYs; drop the dead client sessions so reopening an agent relaunches it.
    const pausedIds = new Set(paused)
    for (const agent of activeAgents.value.filter(a => pausedIds.has(a.id))) {
        if (agent.agent_type === 'pm') layout.disposePmSession(projectId)
        else layout.disposeAgentSession(agent.id)
    }

    showNotice(paused.length === 1 ? 'Paused 1 agent' : `Paused ${paused.length} agents`)
    agentsQuery.invalidate()
    queryCache.invalidateQueries({ key: AGENT_SUMMARIES_QUERY_KEY })
    router.reload({ only: ['tasks'] })
}
</script>

<template>
    <TasksView
        :tasks="tasks"
        :projects="projects"
        :workspaces="workspaces"
        :default-project-id="page.props.project_id"
        :can-pause-all="activeAgents.length > 0"
        :notice="notice"
        @create-task="createTask"
        @update-status="updateStatus"
        @delete-task="deleteTask"
        @pause-all="pauseAll"
    />
</template>
