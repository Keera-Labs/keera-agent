<script setup lang="ts">
import { computed } from 'vue'
import AgentStatusIndicator from '@/components/ui/AgentStatusIndicator.vue'
import type { AgentSummary } from '@/queries/agentSummariesQuery'
import { relativeTime } from '@/utils/relativeTime'

const props = defineProps<{ agent: AgentSummary; active: boolean; now: number }>()
defineEmits<{ select: [] }>()

const needsInput = computed(() => props.agent.status === 'needs_input')
const attention = computed(() => props.agent.attention_prompt
    ?? (props.agent.attention_kind === 'permission' ? 'Waiting for permission' : 'Asked a question'))
const waitingFor = computed(() => {
    const elapsed = relativeTime(props.agent.last_activity_at, props.now)
    return elapsed && elapsed !== 'now' ? `Waiting for you · ${elapsed}` : 'Waiting for you'
})
const preview = computed(() => (needsInput.value ? null : props.agent.last_message))
const running = computed(() => props.agent.status === 'running')
const title = computed(() => {
    const detail = needsInput.value ? attention.value : preview.value
    return detail ? `${props.agent.name} — ${detail}` : props.agent.name
})
</script>

<template>
    <div class="@container relative text-ui-13">
        <button
            type="button"
            data-testid="sidebar-agent"
            :data-status="props.agent.status"
            :aria-current="props.active ? 'page' : undefined"
            :title="title"
            :class="[
                'flex flex-col gap-0.5 w-full min-w-0 py-1.5 px-2 rounded-lg border text-left cursor-pointer transition-colors duration-100',
                props.active
                    ? 'bg-surface border-black/[0.08] shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                    : 'border-transparent hover:bg-white/60',
            ]"
            @click="$emit('select')"
        >
            <span class="flex items-center gap-1.5 w-full min-w-0">
                <AgentStatusIndicator :status="props.agent.status" :size="10" />
                <span
                    data-testid="agent-name"
                    :class="['flex-1 min-w-0 truncate', props.active ? 'text-zinc-900 font-semibold' : 'text-zinc-800 font-medium']"
                >
                    {{ props.agent.name }}
                </span>
                <span class="shrink-0 text-ui-12 tabular-nums text-zinc-500">
                    {{ relativeTime(props.agent.last_activity_at, props.now) }}
                </span>
            </span>
            <span
                v-if="needsInput"
                data-testid="agent-attention"
                class="pl-4 truncate text-ui-12 font-medium text-blue-700"
            >
                {{ waitingFor }}
            </span>
            <span
                v-else-if="preview"
                data-testid="agent-preview"
                :class="['pl-4 truncate text-ui-12', running ? 'text-amber-800' : 'text-zinc-500']"
            >
                {{ preview }}
            </span>
        </button>
    </div>
</template>
