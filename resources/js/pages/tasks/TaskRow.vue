<script setup lang="ts">
import { computed } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import PriorityBadge from '@/components/ui/PriorityBadge.vue'
import { projectColor } from '@/layouts/sidebar/projectColor'
import TaskDetailModal from '@/pages/tasks/TaskDetailModal.vue'
import TaskStatusIcon from '@/pages/tasks/TaskStatusIcon.vue'
import { taskAge } from '@/pages/tasks/taskList'
import { STATUS_CYCLE, STATUS_LABELS } from '@/types/task'
import type { Task } from '@/types/type'

const props = defineProps<{ task: Task; projectName: string; now: number }>()

const emit = defineEmits<{
    updateStatus: [status: Task['status']]
    delete: []
}>()

const isClosed = computed(() => props.task.status === 'completed' || props.task.status === 'cancelled')
const showPriority = computed(() => props.task.priority !== 'medium')
const avatarColor = computed(() => projectColor(props.task.project_id))
const agents = computed(() => props.task.assignees.join(', '))

function onStatusChange(e: Event) {
    const status = (e.target as HTMLSelectElement).value as Task['status']
    if (status !== props.task.status) emit('updateStatus', status)
}
</script>

<template>
    <TaskDetailModal :task="task">
        <template #trigger>
            <article
                data-testid="task-row"
                :data-status="task.status"
                class="group flex items-start gap-3 py-3 px-4 cursor-pointer transition-colors hover:bg-canvas in-focus:bg-blue-50/60"
            >
                <TaskStatusIcon :status="task.status" :size="16" class="mt-px" />

                <div class="flex-1 min-w-0">
                    <span
                        data-testid="task-title"
                        :class="[
                            'block text-ui-13 leading-[1.4] break-words',
                            isClosed ? 'text-zinc-400 line-through' : 'text-zinc-900 font-semibold',
                        ]"
                    >{{ task.title }}</span>

                    <div data-testid="task-meta" class="mt-1 flex items-center gap-1.5 min-w-0 text-ui-11 text-zinc-500">
                        <template v-if="projectName">
                            <span
                                data-testid="project-avatar"
                                aria-hidden="true"
                                :class="['w-4 h-4 rounded flex items-center justify-center shrink-0 text-ui-10 font-semibold', avatarColor.tile, avatarColor.tileText]"
                            >{{ projectName[0].toUpperCase() }}</span>
                            <span class="truncate">{{ projectName }}</span>
                            <span aria-hidden="true" class="text-zinc-300">·</span>
                        </template>
                        <span data-testid="task-ref" class="shrink-0 font-mono">TASK-{{ task.id }}</span>
                        <template v-if="task.pr_url && task.pr_number !== null">
                            <span aria-hidden="true" class="text-zinc-300">·</span>
                            <a
                                data-testid="task-pr"
                                :href="task.pr_url"
                                target="_blank"
                                rel="noopener noreferrer"
                                class="shrink-0 font-mono text-zinc-500 no-underline hover:text-accent hover:underline"
                                @click.stop
                                @keydown.enter.stop
                            >PR #{{ task.pr_number }}</a>
                        </template>
                        <template v-if="agents">
                            <span aria-hidden="true" class="text-zinc-300">·</span>
                            <span data-testid="task-agents" class="truncate">{{ agents }}</span>
                        </template>
                    </div>
                </div>

                <div class="shrink-0 flex items-center gap-2">
                    <div
                        class="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
                        @click.stop
                        @keydown.enter.stop
                        @keydown.space.stop
                    >
                        <select
                            :value="task.status"
                            :aria-label="`Status of ${task.title}`"
                            class="h-5 text-ui-11 text-zinc-600 bg-surface border border-stroke rounded px-1 cursor-pointer"
                            @change="onStatusChange"
                        >
                            <option v-for="status in STATUS_CYCLE" :key="status" :value="status">{{ STATUS_LABELS[status] }}</option>
                        </select>
                        <button
                            type="button"
                            :aria-label="`Delete ${task.title}`"
                            class="flex items-center justify-center w-5 h-5 rounded text-zinc-400 cursor-pointer hover:text-danger hover:bg-red-50"
                            @click="emit('delete')"
                        >
                            <Icon name="x" :size="12" />
                        </button>
                    </div>
                    <span data-testid="task-age" class="text-ui-11 text-zinc-400 tabular-nums">{{ taskAge(task, now) }}</span>
                    <PriorityBadge v-if="showPriority" :priority="task.priority" />
                </div>
            </article>
        </template>
    </TaskDetailModal>
</template>
