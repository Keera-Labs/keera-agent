<script setup lang="ts">
import { computed } from 'vue'
import type { AgentStatus } from '@/queries/agentQuery'

const props = withDefaults(defineProps<{ status: AgentStatus | null | undefined; size?: number }>(), {
    size: 10,
})

const LABEL: Record<AgentStatus, string> = {
    running: 'Working',
    needs_input: 'Needs input',
    waiting: 'Waiting',
    idle: 'Idle',
}

const status = computed<AgentStatus>(() => (props.status && props.status in LABEL ? props.status : 'idle'))
const box = computed(() => ({ width: `${props.size}px`, height: `${props.size}px` }))
// Dots read smaller than rings at the same box size, so they are drawn at 60%.
const dot = computed(() => ({ width: `${props.size * 0.6}px`, height: `${props.size * 0.6}px` }))
</script>

<template>
    <span
        data-testid="agent-status-indicator"
        :data-status="status"
        role="img"
        :aria-label="LABEL[status]"
        :title="LABEL[status]"
        class="inline-flex items-center justify-center shrink-0"
        :style="box"
    >
        <!-- Under reduced motion the ring stays still and closes, so it still reads as "busy". -->
        <span
            v-if="status === 'running'"
            class="block w-full h-full rounded-full border-[1.5px] border-success/25 border-t-success motion-safe:animate-spin motion-reduce:border-success"
        />
        <span
            v-else-if="status === 'needs_input'"
            class="flex items-center justify-center w-full h-full rounded-full bg-amber-500 text-white font-bold leading-none"
            :style="{ fontSize: `${Math.max(7, size * 0.75)}px` }"
        >?</span>
        <span
            v-else
            :class="['block rounded-full', status === 'waiting' ? 'bg-amber-400' : 'bg-zinc-300']"
            :style="dot"
        />
    </span>
</template>
