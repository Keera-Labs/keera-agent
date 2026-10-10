<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import CreateTaskModal, { type NewTask } from '@/pages/tasks/CreateTaskModal.vue'
import TaskCard from '@/pages/tasks/TaskCard.vue'
import {
    TASK_FILTERS,
    countByFilter,
    groupTasks,
    inFilter,
    matchesSearch,
    startOfLocalDay,
    type TaskFilter,
} from '@/pages/tasks/taskList'
import type { Project, Task, Workspace } from '@/types/type'

const props = withDefaults(defineProps<{
    tasks: Task[]
    projects: Project[]
    workspaces: Workspace[]
    defaultProjectId: number | null
    /** Whether the project has running agents that "pause all" would stop. */
    canPauseAll?: boolean
    notice?: string | null
}>(), { canPauseAll: false, notice: null })

const emit = defineEmits<{
    createTask: [task: NewTask]
    updateStatus: [task: Task, status: Task['status']]
    deleteTask: [task: Task]
    pauseAll: []
}>()

const query = ref('')
const filter = ref<TaskFilter>('all')
const searchInput = ref<HTMLInputElement | null>(null)

const projectNames = computed(() => new Map(props.projects.map(p => [p.id, p.name])))
const projectName = (task: Task) => projectNames.value.get(task.project_id) ?? ''

const runningCount = computed(() => props.tasks.filter(t => t.status === 'in_progress').length)
const searched = computed(() => props.tasks.filter(t => matchesSearch(t, query.value, projectName(t))))
const counts = computed(() => countByFilter(searched.value))

// Relative times and "today" only change with the clock, not with the data.
const now = ref(Date.now())
const clock = setInterval(() => { now.value = Date.now() }, 30_000)

// The overview only keeps today's completions; the Done tab lists every one.
const sections = computed(() => groupTasks(
    searched.value.filter(t => inFilter(t, filter.value)),
    filter.value === 'all' ? startOfLocalDay(now.value) : undefined,
))

const emptyMessage = computed(() => {
    if (props.tasks.length === 0) return 'No tasks yet'
    if (counts.value[filter.value] === 0) return 'No tasks match'
    return 'Nothing completed today. Earlier tasks are under Done.'
})

function onKeyDown(e: KeyboardEvent) {
    // An open dialog (e.g. Settings) and the visible Commands tab own their own ⌘K.
    if (e.defaultPrevented || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k' || document.querySelector('[role="dialog"]')) return
    e.preventDefault()
    searchInput.value?.focus()
}

onMounted(() => window.addEventListener('keydown', onKeyDown))
onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeyDown)
    clearInterval(clock)
})

const pillClass = 'text-ui-11 tabular-nums rounded-full py-px px-2 border'
</script>

<template>
    <div class="flex-1 flex flex-col overflow-hidden bg-surface">
        <header class="shrink-0 px-6 pt-4 pb-3 border-b border-stroke flex flex-col gap-3">
            <div class="flex items-center gap-2">
                <h1 class="m-0 text-ui-17 font-semibold text-zinc-900">Tasks</h1>
                <span data-testid="task-total" :class="[pillClass, 'bg-canvas border-stroke text-zinc-600']">{{ tasks.length }}</span>
                <span
                    v-if="runningCount > 0"
                    data-testid="running-pill"
                    :class="[pillClass, 'bg-green-50 border-green-200 text-success']"
                >{{ runningCount }} running</span>
                <div class="ml-auto">
                    <CreateTaskModal
                        :projects="projects"
                        :workspaces="workspaces"
                        :default-project-id="defaultProjectId"
                        @created="emit('createTask', $event)"
                    >
                        <template #trigger>
                            <span class="inline-flex items-center gap-1 h-7 px-3 rounded-md bg-accent text-white text-ui-12 font-medium cursor-pointer hover:brightness-110">
                                <Icon name="plus" :size="13" />
                                New Task
                            </span>
                        </template>
                    </CreateTaskModal>
                </div>
            </div>

            <label class="flex items-center gap-2 h-8 px-2.5 rounded-md border border-stroke bg-canvas text-zinc-400 focus-within:border-accent">
                <Icon name="search" :size="13" />
                <input
                    ref="searchInput"
                    v-model="query"
                    type="search"
                    aria-label="Search tasks"
                    placeholder="Search tasks, branches, or PRs..."
                    class="flex-1 min-w-0 bg-transparent border-none outline-none text-ui-13 text-zinc-900 placeholder:text-zinc-400"
                    @keydown.esc="query = ''"
                >
                <kbd class="font-sans text-ui-10 text-zinc-400 border border-stroke rounded px-1 bg-surface">⌘K</kbd>
            </label>

            <div role="tablist" aria-label="Filter tasks" class="flex items-center gap-1 flex-wrap">
                <button
                    v-for="tab in TASK_FILTERS"
                    :key="tab.id"
                    type="button"
                    role="tab"
                    :data-filter="tab.id"
                    :aria-selected="filter === tab.id"
                    :class="[
                        'inline-flex items-center gap-1.5 h-6 px-2 rounded-md text-ui-12 cursor-pointer transition-colors',
                        filter === tab.id ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-black/[0.04]',
                    ]"
                    @click="filter = tab.id"
                >
                    <span v-if="tab.dot" :class="['w-1.5 h-1.5 rounded-full', tab.dot]" />
                    {{ tab.label }} ({{ counts[tab.id] }})
                </button>
            </div>
        </header>

        <div class="flex-1 overflow-y-auto px-6 py-5">
            <p v-if="sections.length === 0" data-testid="tasks-empty" class="m-0 py-12 text-center text-ui-13 text-zinc-400">
                {{ emptyMessage }}
            </p>

            <section
                v-for="section in sections"
                :key="section.status"
                :data-section="section.status"
                class="pb-5 mb-5 border-b border-stroke last:border-b-0 last:mb-0"
            >
                <h2 class="m-0 mb-3 flex items-center gap-2 text-ui-11 font-semibold uppercase tracking-[0.06em] text-zinc-600">
                    <span :class="['w-1.5 h-1.5 rounded-full', section.dot]" />
                    {{ section.label }}
                    <span data-testid="section-count" class="font-normal text-zinc-400">· {{ section.tasks.length }}</span>
                    <button
                        v-if="section.status === 'in_progress' && canPauseAll"
                        type="button"
                        data-testid="pause-all"
                        class="ml-auto bg-transparent border-none p-0 text-ui-11 font-medium normal-case tracking-normal text-accent cursor-pointer hover:underline"
                        @click="emit('pauseAll')"
                    >pause all</button>
                </h2>
                <div class="flex flex-col gap-2">
                    <TaskCard
                        v-for="task in section.tasks"
                        :key="task.id"
                        :task="task"
                        :project-name="projectName(task)"
                        :now="now"
                        @update-status="status => emit('updateStatus', task, status)"
                        @delete="emit('deleteTask', task)"
                    />
                </div>
            </section>
        </div>

        <div
            role="status"
            aria-live="polite"
            class="pointer-events-none fixed bottom-10 right-6 z-50"
        >
            <p
                v-if="notice"
                data-testid="tasks-notice"
                class="m-0 py-2 px-3 rounded-md bg-zinc-900 text-white text-ui-12 shadow-lg"
            >{{ notice }}</p>
        </div>
    </div>
</template>
