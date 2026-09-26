<script setup lang="ts">
import { computed } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import type { ProjectAgent } from '@/queries/agentQuery'
import { color } from '@/tokens'
import AgentEditModal from './AgentEditModal.vue'
import PmCheckinControl from './PmCheckinControl.vue'
import { agentAvatarColor, agentInitials, agentRoleLabel, PLACEHOLDER } from './presentation'

export interface AgentCardStats {
    runtime: string
    provider: string
    model: string
    branch: string
    usage: string
}

const props = defineProps<{
    agent: ProjectAgent
    running: boolean
    statusLine: string | null
    stats: AgentCardStats
    adoptPending: boolean
}>()

const emit = defineEmits<{ open: []; restart: []; adopt: []; remove: [] }>()


const statusTone = computed(() =>
    props.running
        ? { bg: '#e7f6ec', fg: '#16a34a', label: 'Active' }
        : { bg: color.warningSubtle, fg: color.warningBright, label: 'Waiting' },
)

const statCells = computed(() => [
    { label: 'Runtime', value: props.stats.runtime },
    { label: 'Provider', value: props.stats.provider },
    { label: 'Model', value: props.stats.model },
    { label: 'Branch', value: props.stats.branch },
    { label: 'Usage', value: props.stats.usage },
])

const iconButtonClass = 'bg-transparent border border-stroke text-zinc-500 cursor-pointer w-[30px] h-[30px] rounded-md flex items-center justify-center shrink-0 transition-[color,background,border-color] duration-100 hover:text-(--hover) hover:border-(--hover) hover:bg-canvas'
</script>

<template>
    <article class="flex flex-col gap-4 bg-surface border border-stroke rounded-[16px] py-[22px] px-6">
        <!-- Header: avatar + name/role + status -->
        <div class="flex items-center gap-[13px]">
            <div
                class="w-[46px] h-[46px] rounded-xl shrink-0 flex items-center justify-center text-[15px] font-bold text-white tracking-[0.02em]"
                :style="{ background: agentAvatarColor(agent) }"
            >
                {{ agentInitials(agent.name) }}
            </div>
            <div class="flex-1 min-w-0">
                <div class="text-[16px] font-bold text-zinc-900 truncate">{{ agent.name }}</div>
                <div class="text-[13px] text-zinc-500 mt-px truncate">{{ agentRoleLabel(agent) }}</div>
            </div>
            <span
                data-testid="agent-status"
                class="inline-flex items-center gap-1.5 text-[12px] font-semibold py-1 px-2.5 rounded-full shrink-0"
                :style="{ background: statusTone.bg, color: statusTone.fg }"
            >
                <span class="w-1.5 h-1.5 rounded-full" :style="{ background: statusTone.fg }" />
                {{ statusTone.label }}
            </span>
        </div>

        <p :class="['m-0 text-[13.5px] leading-[1.55]', statusLine ? 'text-zinc-700' : 'text-zinc-400']">
            {{ statusLine ?? 'No status reported.' }}
        </p>

        <hr class="h-px bg-stroke border-0 m-0">

        <!-- Runtime and provider configuration -->
        <div class="grid grid-cols-2 gap-4">
            <div v-for="stat in statCells" :key="stat.label" class="flex flex-col gap-[3px] min-w-0">
                <span class="text-[10px] font-semibold uppercase tracking-[0.07em] text-zinc-400">{{ stat.label }}</span>
                <span :class="['text-[13px] font-mono truncate', stat.value === PLACEHOLDER ? 'text-zinc-400' : 'text-zinc-900']">
                    {{ stat.value }}
                </span>
            </div>
        </div>

        <template v-if="agent.agent_type === 'pm'">
            <hr class="h-px bg-stroke border-0 m-0">
            <PmCheckinControl :agent-id="agent.id" />
        </template>

        <hr class="h-px bg-stroke border-0 m-0">

        <!-- Footer: action icons + Open link -->
        <div class="flex items-center gap-2">
            <button
                type="button"
                :title="running ? 'Restart agent' : 'Start agent'"
                :class="iconButtonClass"
                style="--hover: #ca8a04"
                @click.stop="emit('restart')"
            >
                <Icon name="rotate-cw" :size="14" />
            </button>

            <span class="contents" @click.stop>
                <AgentEditModal :agent="agent">
                    <template #trigger>
                        <button type="button" title="Edit agent" :class="iconButtonClass" :style="{ '--hover': color.textPrimary }">
                            <Icon name="circle-dot" :size="14" />
                        </button>
                    </template>
                </AgentEditModal>
            </span>

            <button
                type="button"
                title="Adopt work — remove worktree, check out the agent branch"
                :class="iconButtonClass"
                style="--hover: #16a34a"
                @click.stop="adoptPending || emit('adopt')"
            >
                <Icon name="git-merge" :size="14" />
            </button>

            <button
                type="button"
                title="Delete agent"
                data-testid="agent-card-delete"
                :class="iconButtonClass"
                :style="{ '--hover': color.danger }"
                @click.stop="emit('remove')"
            >
                <Icon name="trash-2" :size="14" />
            </button>

            <button
                type="button"
                class="ml-auto bg-transparent border-0 text-blue-600 cursor-pointer text-[13.5px] font-semibold flex items-center gap-[5px] py-1 px-0.5 hover:opacity-70"
                @click="emit('open')"
            >
                Open
                <Icon name="arrow-right" :size="14" />
            </button>
        </div>
    </article>
</template>
