<script setup lang="ts">
import { computed } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import PriorityBadge from '@/components/ui/PriorityBadge.vue'
import TaskDetailModal from '@/pages/tasks/TaskDetailModal.vue'
import TaskStatusIcon from '@/pages/tasks/TaskStatusIcon.vue'
import { progressLabel, taskAge, taskRef } from '@/pages/tasks/taskList'
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
const hasDiff = computed(() =>
    props.task.status === 'in_review' && (props.task.additions !== null || props.task.deletions !== null),
)
const progress = computed(() => (props.task.status === 'in_progress' ? progressLabel(props.task) : null))
const hasMeta = computed(() =>
    showPriority.value
    || props.task.assignees.length > 0
    || props.task.acceptance_criteria.length > 0
    || props.task.branch !== null
    || hasDiff.value
    || props.task.review_note !== null
    || progress.value !== null,
)
const refClass = computed(() =>
    props.task.status === 'in_review' && props.task.pr_number !== null
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-stroke bg-canvas text-zinc-500 in-focus:bg-blue-50 in-focus:border-blue-200 in-focus:text-accent',
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
                    <!-- Stops click/Enter so following the PR link doesn't also open the task modal. -->
                    <a
                        v-if="task.pr_url && task.pr_number !== null"
                        data-testid="task-ref"
                        :href="task.pr_url"
                        target="_blank"
                        rel="noopener noreferrer"
                        :class="[chipClass, refClass, 'no-underline hover:underline']"
                        @click.stop
                        @keydown.enter.stop
                    >{{ taskRef(task) }}</a>
                    <span v-else data-testid="task-ref" :class="[chipClass, refClass]">{{ taskRef(task) }}</span>
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
                    <span
                        v-if="task.branch !== null"
                        data-testid="task-branch"
                        :title="task.branch"
                        :class="[chipClass, 'min-w-0 max-w-[260px] border-stroke bg-surface text-zinc-600']"
                    >
                        <Icon name="git-branch" :size="10" class="shrink-0 text-zinc-400" />
                        <span class="truncate">{{ task.branch }}</span>
                    </span>
                    <PriorityBadge v-if="showPriority" :priority="task.priority" />
                    <span
                        v-for="assignee in task.assignees"
                        :key="assignee"
                        data-testid="task-assignee"
                        :class="[chipClass, 'border-violet-200 bg-violet-50 text-violet-700']"
                    >
                        {{ assignee }}
                    </span>
                    <span v-if="task.acceptance_criteria.length > 0" class="text-ui-11 text-zinc-500">
                        {{ task.acceptance_criteria.length }} criteria
                    </span>
                    <span v-if="hasDiff" data-testid="task-diff" class="inline-flex gap-1.5 font-mono text-ui-11 font-semibold tabular-nums">
                        <span v-if="task.additions !== null" class="text-success">+{{ task.additions }}</span>
                        <span v-if="task.deletions !== null" class="text-danger">-{{ task.deletions }}</span>
                    </span>
                    <span v-if="hasDiff && task.review_note !== null" aria-hidden="true" class="text-ui-11 text-zinc-300">·</span>
                    <span v-if="task.review_note !== null" data-testid="task-review-note" class="text-ui-11 text-zinc-500">
                        {{ task.review_note }}
                    </span>
                    <span v-if="progress" data-testid="task-progress" class="text-ui-11 text-accent tabular-nums">{{ progress }}</span>
                </div>
            </article>
        </template>
    </TaskDetailModal>
</template>
