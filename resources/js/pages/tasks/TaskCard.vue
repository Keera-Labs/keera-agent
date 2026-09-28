<script setup lang="ts">
import { computed } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import PriorityBadge from '@/components/ui/PriorityBadge.vue'
import TaskDetailModal from '@/pages/tasks/TaskDetailModal.vue'
import TaskStatusIcon from '@/pages/tasks/TaskStatusIcon.vue'
import { taskAge, taskRef } from '@/pages/tasks/taskList'
import { STATUS_CYCLE, STATUS_LABELS } from '@/types/task'
import type { Task } from '@/types/type'

const props = defineProps<{ task: Task; projectName: string; now: number }>()

const emit = defineEmits<{
    updateStatus: [status: Task['status']]
    delete: []
}>()

const isClosed = computed(() => props.task.status === 'completed' || props.task.status === 'cancelled')
// "medium" is the default every task gets, so only a deliberate priority earns a chip.
const showPriority = computed(() => props.task.priority !== 'medium')
const hasMeta = computed(() =>
    showPriority.value || props.task.assignees.length > 0 || props.task.acceptance_criteria.length > 0,
)

function onStatusChange(e: Event) {
    const status = (e.target as HTMLSelectElement).value as Task['status']
    if (status !== props.task.status) emit('updateStatus', status)
}

const chipClass = 'inline-flex items-center gap-1 font-mono text-ui-11 py-px px-1.5 rounded border'
</script>

<template>
    <TaskDetailModal :task="task">
        <template #trigger>
            <!-- The modal trigger wrapping this card is what takes focus, hence the in-focus variants. -->
            <article
                data-testid="task-card"
                :data-status="task.status"
                class="group relative flex flex-col gap-1.5 py-3 px-4 rounded-md border border-stroke bg-surface cursor-pointer transition-colors hover:border-zinc-300 in-focus:bg-blue-50/60 in-focus:border-blue-200"
            >
                <span aria-hidden="true" class="absolute -left-px -inset-y-px w-[3px] rounded-l-md bg-accent opacity-0 in-focus:opacity-100" />

                <div :class="['flex items-center gap-2 min-w-0', isClosed && 'opacity-60']">
                    <TaskStatusIcon :status="task.status" />
                    <span
                        data-testid="task-ref"
                        :class="[chipClass, 'border-stroke bg-canvas text-zinc-500 in-focus:bg-blue-50 in-focus:border-blue-200 in-focus:text-accent']"
                    >{{ taskRef(task) }}</span>
                    <span v-if="projectName" class="font-mono text-ui-11 text-zinc-400 truncate">· {{ projectName }}</span>

                    <!-- Key and click events stop here: the card's trigger would otherwise open the modal and swallow them. -->
                    <div
                        class="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
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
                    <span data-testid="task-age" class="shrink-0 font-mono text-ui-11 text-zinc-400 tabular-nums">{{ taskAge(task, now) }}</span>
                </div>

                <span
                    data-testid="task-title"
                    :class="[
                        'text-ui-13 leading-[1.4] break-words',
                        isClosed ? 'text-zinc-400 line-through' : 'text-zinc-900 font-semibold',
                    ]"
                >{{ task.title }}</span>

                <div v-if="hasMeta" :class="['flex items-center gap-1.5 flex-wrap', isClosed && 'opacity-60']">
                    <PriorityBadge v-if="showPriority" :priority="task.priority" />
                    <span
                        v-for="assignee in task.assignees"
                        :key="assignee"
                        data-testid="task-assignee"
                        :class="[chipClass, 'border-violet-200 bg-violet-50 text-violet-700']"
                    >
                        <span class="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        {{ assignee }}
                    </span>
                    <span v-if="task.acceptance_criteria.length > 0" class="text-ui-11 text-zinc-500">
                        {{ task.acceptance_criteria.length }} criteria
                    </span>
                </div>
            </article>
        </template>
    </TaskDetailModal>
</template>
