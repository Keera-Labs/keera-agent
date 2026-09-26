<script setup lang="ts">
import Icon, { type IconName } from '@/components/ui/Icon.vue'
import type { AgentSummary } from '@/queries/agentSummariesQuery'
import { relativeTime } from './sidebarAgents'

const props = defineProps<{ agent: AgentSummary; active: boolean; now: number }>()
defineEmits<{ select: [] }>()

const STATUS_DOT: Record<AgentSummary['status'], string> = {
    running: 'bg-success animate-pulse',
    waiting: 'bg-amber-500',
    idle: 'bg-zinc-300',
}

const PROVIDER_ICON: Record<string, { name: IconName; color: string }> = {
    claude: { name: 'asterisk', color: '#d97757' },
    codex: { name: 'code', color: '#52525b' },
}
const provider = PROVIDER_ICON[props.agent.provider] ?? PROVIDER_ICON.claude
</script>

<template>
    <button
        type="button"
        data-testid="sidebar-agent"
        :data-status="props.agent.status"
        :aria-current="props.active ? 'page' : undefined"
        :title="props.agent.last_message ? `${props.agent.name} — ${props.agent.last_message}` : props.agent.name"
        :class="[
            'flex items-center gap-1.5 w-full h-7 px-1.5 rounded-md text-[12.5px] text-left cursor-pointer transition-colors duration-100',
            props.active
                ? 'bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.04]'
                : 'hover:bg-black/[0.04]',
        ]"
        @click="$emit('select')"
    >
        <span :class="['w-1.5 h-1.5 rounded-full shrink-0', STATUS_DOT[props.agent.status] ?? STATUS_DOT.idle]" />
        <Icon :name="provider.name" :size="12" :color="provider.color" class="shrink-0" />
        <span data-testid="agent-name" :class="['truncate shrink-0 max-w-[60%]', props.active ? 'text-zinc-900 font-medium' : 'text-zinc-700']">
            {{ props.agent.name }}
        </span>
        <span class="flex-1 min-w-0 truncate text-zinc-400">
            <template v-if="props.agent.last_message">– {{ props.agent.last_message }}</template>
        </span>
        <span class="shrink-0 text-[11px] tabular-nums text-zinc-400">
            {{ relativeTime(props.agent.last_activity_at, props.now) }}
        </span>
    </button>
</template>
