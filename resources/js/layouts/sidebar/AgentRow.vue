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
// Beside the Reply button a row has no room for a readable snippet, so a blocked
// agent's prompt lives in the tooltip (the card and detail header show it in full).
const preview = computed(() => (needsInput.value ? null : props.agent.last_message))
const title = computed(() => {
    const detail = needsInput.value ? attention.value : preview.value
    return detail ? `${props.agent.name} — ${detail}` : props.agent.name
})
</script>

<template>
    <!-- A query container in its own font size, so the em breakpoint below scales with the UI font size. -->
    <div class="@container flex items-center gap-1 text-ui-12.5">
        <button
            type="button"
            data-testid="sidebar-agent"
            :data-status="props.agent.status"
            :aria-current="props.active ? 'page' : undefined"
            :title="title"
            :class="[
                'flex items-center gap-1.5 flex-1 min-w-0 h-7 px-1.5 rounded-md text-ui-12.5 text-left cursor-pointer transition-colors duration-100',
                props.active
                    ? 'bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.04]'
                    : 'hover:bg-black/[0.04]',
            ]"
            @click="$emit('select')"
        >
            <AgentStatusIndicator :status="props.agent.status" :size="10" />
            <Icon :name="provider.name" :size="12" :color="provider.color" class="shrink-0" />
            <!-- Next to Reply the name takes all the room left; the badge's breakpoint keeps that readable. -->
            <span
                data-testid="agent-name"
                :class="['truncate', needsInput ? 'flex-1 min-w-0' : 'min-w-[3ch]', props.active ? 'text-zinc-900 font-medium' : 'text-zinc-700']"
            >
                {{ props.agent.name }}
            </span>
            <!-- The name gives up width first, so a preview is never squeezed to a lone dash. -->
            <span
                v-if="!needsInput"
                data-testid="agent-preview"
                :class="['flex-1 truncate text-zinc-400', preview ? 'min-w-12' : 'min-w-0']"
            >
                <template v-if="preview">– {{ preview }}</template>
            </span>
            <span v-if="!needsInput" class="shrink-0 text-ui-11 tabular-nums text-zinc-400">
                {{ relativeTime(props.agent.last_activity_at, props.now) }}
            </span>
        </button>
        <button
            v-if="needsInput"
            type="button"
            data-testid="agent-reply"
            :aria-label="`Reply to ${props.agent.name}`"
            :title="`Reply to ${props.agent.name}`"
            class="shrink-0 flex items-center h-5 px-1.5 rounded border border-amber-300 bg-amber-50 text-amber-800 text-ui-11 font-semibold cursor-pointer hover:bg-amber-100"
            @click="$emit('select')"
        >
            <!-- In a narrow row only the icon shows, so the name keeps room to stay readable. -->
            <Icon name="reply" :size="12" class="@min-[10em]:hidden" />
            <span class="hidden @min-[10em]:inline">Reply</span>
        </button>
    </div>
</template>
