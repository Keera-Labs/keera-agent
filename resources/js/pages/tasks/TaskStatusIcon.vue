<script setup lang="ts">
import { STATUS_LABELS } from '@/types/task'
import type { Task } from '@/types/type'

withDefaults(defineProps<{ status: Task['status']; size?: number }>(), { size: 14 })
</script>

<template>
    <svg
        data-testid="task-status-icon"
        :data-status="status"
        role="img"
        :aria-label="STATUS_LABELS[status]"
        :width="size"
        :height="size"
        viewBox="0 0 16 16"
        fill="none"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        :class="[
            'shrink-0',
            status === 'in_progress' && 'text-accent animate-spin',
            status === 'completed' && 'text-success',
            (status === 'pending' || status === 'cancelled') && 'text-zinc-400',
        ]"
        stroke="currentColor"
    >
        <template v-if="status === 'in_progress'">
            <circle cx="8" cy="8" r="6" stroke-opacity="0.2" />
            <path d="M8 2a6 6 0 0 1 6 6" />
        </template>
        <template v-else-if="status === 'completed'">
            <circle cx="8" cy="8" r="6" />
            <path d="m5.5 8.2 1.7 1.7 3.3-3.4" />
        </template>
        <template v-else-if="status === 'cancelled'">
            <circle cx="8" cy="8" r="6" />
            <path d="m6 6 4 4M10 6l-4 4" />
        </template>
        <circle v-else cx="8" cy="8" r="6" />
    </svg>
</template>
