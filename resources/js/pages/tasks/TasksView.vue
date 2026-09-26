<script setup lang="ts">
import { ref } from 'vue'
import CreateTaskModal, { type NewTask } from '@/pages/tasks/CreateTaskModal.vue'
import TaskDetailModal from '@/pages/tasks/TaskDetailModal.vue'
import PriorityBadge from '@/components/ui/PriorityBadge.vue'
import { STATUS_COLORS, STATUS_CYCLE, STATUS_LABELS } from '@/types/task'
import type { Project, Task, Workspace } from '@/types/type'

const props = defineProps<{
    tasks: Task[]
    projects: Project[]
    workspaces: Workspace[]
    defaultProjectId: number | null
}>()

const emit = defineEmits<{
    createTask: [task: NewTask]
    updateStatus: [task: Task, status: Task['status']]
    deleteTask: [task: Task]
}>()

const dragTaskId = ref<number | null>(null)
const dragOverStatus = ref<Task['status'] | null>(null)

const tasksWithStatus = (status: Task['status']) => props.tasks.filter(t => t.status === status)
const isClosed = (task: Task) => task.status === 'completed' || task.status === 'cancelled'
const hasPlanning = (task: Task) =>
    task.acceptance_criteria.length > 0 || task.testing_methods.length > 0 || task.validation_steps.length > 0

function onDragLeave(e: DragEvent) {
    const column = e.currentTarget as HTMLElement
    if (!column.contains(e.relatedTarget as Node | null)) dragOverStatus.value = null
}

function onDrop(status: Task['status']) {
    dragOverStatus.value = null
    const task = props.tasks.find(t => t.id === dragTaskId.value)
    if (task && task.status !== status) emit('updateStatus', task, status)
    dragTaskId.value = null
}

function onDragEnd() {
    dragTaskId.value = null
    dragOverStatus.value = null
}
</script>

<template>
    <div class="flex-1 flex flex-col overflow-hidden">
        <div class="py-3 px-5 border-b border-stroke flex items-center gap-2 shrink-0">
            <span class="text-zinc-900 text-[13px] font-semibold flex-1">Tasks</span>
            <CreateTaskModal
                :projects="projects"
                :workspaces="workspaces"
                :default-project-id="defaultProjectId"
                @created="emit('createTask', $event)"
            >
                <template #trigger>
                    <span class="inline-block bg-success border border-success rounded-[5px] text-white text-[11px] py-1 px-2.5 cursor-pointer">
                        + New task
                    </span>
                </template>
            </CreateTaskModal>
        </div>

        <div class="flex-1 flex flex-row gap-3 p-4 overflow-x-auto overflow-y-hidden items-start">
            <div
                v-for="status in STATUS_CYCLE"
                :key="status"
                :data-status="status"
                :class="[
                    'w-[240px] shrink-0 flex flex-col border border-stroke rounded-md transition-colors duration-100 max-h-full',
                    dragOverStatus === status ? 'bg-surface' : 'bg-canvas',
                ]"
                @dragover.prevent="dragOverStatus = status"
                @dragleave="onDragLeave"
                @drop.prevent="onDrop(status)"
            >
                <div class="pt-2.5 px-3 pb-2 flex items-center gap-[7px] border-b border-stroke shrink-0">
                    <span class="w-2 h-2 rounded-full shrink-0 inline-block" :style="{ background: STATUS_COLORS[status] }" />
                    <span class="text-[11px] font-semibold text-zinc-500 uppercase tracking-[0.06em] flex-1">
                        {{ STATUS_LABELS[status] }}
                    </span>
                    <span data-testid="column-count" class="text-[10px] text-zinc-400 bg-canvas rounded-lg py-px px-1.5 border border-stroke">
                        {{ tasksWithStatus(status).length }}
                    </span>
                </div>

                <div class="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5">
                    <div
                        v-if="tasksWithStatus(status).length === 0"
                        class="border border-dashed border-stroke rounded py-5 px-2.5 text-center text-zinc-400 text-[11px] italic transition-colors duration-100"
                    >
                        {{ dragOverStatus === status ? 'Drop here' : 'No tasks' }}
                    </div>

                    <TaskDetailModal v-for="task in tasksWithStatus(status)" :key="task.id" :task="task">
                        <template #trigger>
                            <div
                                draggable="true"
                                data-testid="task-card"
                                :class="[
                                    'bg-canvas border border-stroke hover:border-stroke rounded py-2.5 px-2.5 pb-2 cursor-pointer transition-opacity duration-100 flex flex-col gap-1.5 relative',
                                    dragTaskId === task.id ? 'opacity-35' : 'opacity-100',
                                ]"
                                @dragstart="dragTaskId = task.id"
                                @dragend="onDragEnd"
                            >
                                <div class="flex items-start gap-1.5">
                                    <span
                                        :class="[
                                            'flex-1 text-[12px] font-medium leading-[1.4] break-words',
                                            isClosed(task) ? 'text-zinc-400 line-through' : 'text-zinc-900 no-underline',
                                        ]"
                                    >
                                        {{ task.title }}
                                    </span>
                                    <!-- Key events are stopped too: the card's trigger would otherwise open the modal and swallow the press. -->
                                    <button
                                        type="button"
                                        :aria-label="`Delete ${task.title}`"
                                        class="shrink-0 bg-transparent border-none cursor-pointer p-0 text-[14px] leading-none transition-opacity duration-100 opacity-0 hover:opacity-100 focus:opacity-100 text-zinc-400 hover:text-danger"
                                        @click.stop="emit('deleteTask', task)"
                                        @keydown.enter.stop
                                        @keydown.space.stop
                                    >
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                            <path d="M18 6 6 18" />
                                            <path d="m6 6 12 12" />
                                        </svg>
                                    </button>
                                </div>

                                <span v-if="task.body" class="text-[11px] text-zinc-500 leading-[1.4] break-words line-clamp-2">
                                    {{ task.body }}
                                </span>

                                <div class="flex items-center gap-1 flex-wrap">
                                    <PriorityBadge :priority="task.priority" />
                                    <span
                                        v-for="assignee in task.assignees"
                                        :key="assignee"
                                        class="bg-blue-50 border border-blue-600 rounded-lg py-px px-1.5 text-blue-600 text-[10px]"
                                    >{{ assignee }}</span>
                                </div>

                                <div v-if="hasPlanning(task)" class="flex gap-1 flex-wrap">
                                    <span v-if="task.acceptance_criteria.length > 0" class="text-[10px] text-success">
                                        ✓ {{ task.acceptance_criteria.length }} criteria
                                    </span>
                                    <span v-if="task.testing_methods.length > 0" class="text-[10px] text-accent">
                                        ⬡ {{ task.testing_methods.length }} tests
                                    </span>
                                    <span v-if="task.validation_steps.length > 0" class="text-[10px] text-amber-700">
                                        ◎ {{ task.validation_steps.length }} steps
                                    </span>
                                </div>
                            </div>
                        </template>
                    </TaskDetailModal>

                    <CreateTaskModal
                        v-if="status === 'pending'"
                        :projects="projects"
                        :workspaces="workspaces"
                        :default-project-id="defaultProjectId"
                        @created="emit('createTask', $event)"
                    >
                        <template #trigger>
                            <span
                                :class="[
                                    'block bg-transparent border border-dashed border-stroke hover:border-stroke rounded text-zinc-400 hover:text-zinc-500 text-[11px] p-2 cursor-pointer text-center',
                                    tasksWithStatus(status).length > 0 ? 'mt-0.5' : 'mt-0',
                                ]"
                            >
                                + Add task
                            </span>
                        </template>
                    </CreateTaskModal>
                </div>
            </div>
        </div>
    </div>
</template>
