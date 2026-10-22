<script setup lang="ts">
import { computed } from 'vue'
import { projectColor } from '@/layouts/sidebar/projectColor'
import type { AgentQuestion } from '@/queries/agentQuestionsQuery'

const props = defineProps<{ question: AgentQuestion; showWorktree?: boolean }>()

const color = computed(() => projectColor(props.question.project_id ?? 0))
const parts = computed(() => [
    props.question.task_id ? `TASK-${props.question.task_id}` : null,
    props.showWorktree ? props.question.worktree : null,
].filter((part): part is string => Boolean(part)))
</script>

<template>
    <span class="flex items-center gap-1.5 min-w-0 text-zinc-500 text-ui-12">
        <template v-if="question.project_name">
            <span
                aria-hidden="true"
                :class="['shrink-0 w-3.5 h-3.5 rounded-sm flex items-center justify-center text-ui-9 font-bold', color.tile, color.tileText]"
            >
                {{ question.project_name.charAt(0).toUpperCase() }}
            </span>
            <span class="shrink-0">{{ question.project_name }}</span>
        </template>
        <template v-for="part in parts" :key="part">
            <span aria-hidden="true" class="shrink-0">·</span>
            <span class="font-mono truncate">{{ part }}</span>
        </template>
    </span>
</template>
