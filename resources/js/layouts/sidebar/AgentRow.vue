<script setup lang="ts">
import { computed } from 'vue'
import AgentStatusIndicator from '@/components/ui/AgentStatusIndicator.vue'
import Icon, { type IconName } from '@/components/ui/Icon.vue'
import type { AgentSummary } from '@/queries/agentSummariesQuery'
import { relativeTime } from './sidebarAgents'

const props = defineProps<{ agent: AgentSummary; active: boolean; now: number }>()
defineEmits<{ select: [] }>()

const PROVIDER_ICON: Record<string, { name: IconName; color: string }> = {
    claude: { name: 'asterisk', color: '#d97757' },
    codex: { name: 'code', color: '#52525b' },
}
const provider = PROVIDER_ICON[props.agent.provider] ?? PROVIDER_ICON.claude

const needsInput = computed(() => props.agent.status === 'needs_input')
const attention = computed(() => props.agent.attention_prompt
    ?? (props.agent.attention_kind === 'permission' ? 'Waiting for permission' : 'Asked a question'))
const preview = computed(() => (needsInput.value ? null : props.agent.last_message))
const running = computed(() => props.agent.status === 'running')
const title = computed(() => {
    const detail = needsInput.value ? attention.value : preview.value
    return detail ? `${props.agent.name} — ${detail}` : props.agent.name
})
</script>

<template>
    <div class="@container relative text-ui-12.5">
        <button
            type="button"
            data-testid="sidebar-agent"
            :data-status="props.agent.status"
            :aria-current="props.active ? 'page' : undefined"
            :title="title"
            :class="[
                'flex flex-col gap-px w-full min-w-0 py-1.5 pl-2 pr-2 rounded-lg border text-left cursor-pointer transition-colors duration-100',
                props.active
                    ? 'bg-surface border-black/[0.08] shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                    : 'border-transparent hover:bg-white/60',
            ]"
            @click="$emit('select')"
        >
            <span class="flex items-center gap-1.5 w-full min-w-0">
                <AgentStatusIndicator :status="props.agent.status" :size="10" />
                <Icon :name="provider.name" :size="11" :color="provider.color" class="shrink-0" />
                <span
                    data-testid="agent-name"
                    :class="['flex-1 min-w-0 truncate', props.active ? 'text-zinc-900 font-semibold' : 'text-zinc-800 font-medium']"
                >
                    {{ props.agent.name }}
                </span>
                <span v-if="!needsInput" class="shrink-0 text-ui-11 tabular-nums text-zinc-500">
                    {{ relativeTime(props.agent.last_activity_at, props.now) }}
                </span>
                <span v-else class="shrink-0 w-12" />
            </span>
            <span
                v-if="needsInput"
                data-testid="agent-attention"
                class="pl-[22px] truncate text-ui-11.5 text-amber-700"
            >
                {{ attention }}
            </span>
            <span
                v-else-if="preview"
                data-testid="agent-preview"
                :class="['pl-[22px] truncate text-ui-11.5', running ? 'text-orange-700' : 'text-zinc-500']"
            >
                {{ preview }}
            </span>
        </button>
        <button
            v-if="needsInput"
            type="button"
            data-testid="agent-reply"
            :aria-label="`Reply to ${props.agent.name}`"
            :title="`Reply to ${props.agent.name}`"
            class="absolute right-1.5 top-1.5 flex items-center h-5 px-1.5 rounded border border-amber-300 bg-amber-50 text-amber-800 text-ui-11 font-semibold cursor-pointer hover:bg-amber-100"
            @click="$emit('select')"
        >
            <Icon name="reply" :size="12" class="@min-[10em]:hidden" />
            <span class="hidden @min-[10em]:inline">Reply</span>
        </button>
    </div>
</template>
