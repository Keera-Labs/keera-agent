<script setup lang="ts">
import { storeToRefs } from 'pinia'
import Icon from '@/components/ui/Icon.vue'
import type { ProjectAgent } from '@/queries/agentQuery'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { color } from '@/tokens'
import type { Project } from '@/types/type'
import { agentAvatarColor, agentInitials } from './presentation'
import { useAgentActions } from './useAgentActions'

// Left panel of the agent-execution view. Selecting a card drills into the agent
// via activeAgentId; terminals stay parked by the layout, so no PTY is torn down here.
const props = defineProps<{ project: Project }>()

const layout = useAppLayoutStore()
const { activeAgentId } = storeToRefs(layout)
const { agents, isRunning, open, restart, adopt, remove } = useAgentActions(() => props.project)

function startAll() {
    const list = agents.value
    if (activeAgentId.value === null) {
        layout.setActiveAgentId(list[0].id)
        return
    }
    const selected = activeAgentId.value
    // The PM's PTY belongs to the PM session; a second socket would split its output.
    requestAnimationFrame(() => {
        for (const agent of list) {
            if (agent.agent_type !== 'pm') layout.launchAgentSession(agent.id, agent.id === selected)
        }
    })
}

async function removeAll() {
    layout.setActiveAgentId(null)
    for (const agent of [...agents.value]) await remove(agent)
}

async function removeOne(agent: ProjectAgent) {
    if (activeAgentId.value === agent.id) {
        const next = agents.value.find(a => a.id !== agent.id)
        layout.setActiveAgentId(next?.id ?? null)
    }
    await remove(agent)
}

const iconButtonClass = 'bg-transparent border-0 text-zinc-400 cursor-pointer p-[5px] rounded flex items-center justify-center shrink-0 transition-[color,background] duration-100 hover:text-(--hover) hover:bg-canvas'
</script>

<template>
    <div class="w-[230px] shrink-0 bg-white border-r border-stroke flex flex-col overflow-y-auto">
        <!-- Section header + bulk controls -->
        <div class="pt-3 px-3.5 pb-1.5 flex items-center gap-1.5">
            <span class="text-[10px] font-bold uppercase tracking-[0.08em] text-zinc-400 flex-1">Agents</span>

            <button
                v-if="agents.length >= 2"
                title="Start all agents"
                class="bg-transparent border border-stroke rounded-sm text-zinc-400 text-[10px] leading-none py-0.5 px-1.5 cursor-pointer flex items-center gap-[3px] hover:border-[#16a34a] hover:text-[#16a34a]"
                @click="startAll"
            >
                <Icon name="play" :size="8" fill="currentColor" />
                All
            </button>

            <button
                v-if="agents.length > 0"
                title="Delete all agents"
                class="border border-gray-200 rounded text-gray-500 text-[10px] leading-none px-1.5 py-0.5 cursor-pointer bg-transparent hover:border-red-500 hover:text-red-500 transition-colors"
                @click="removeAll"
            >
                ✕ all
            </button>

            <button
                title="Add agent"
                class="bg-transparent border border-stroke rounded-sm text-zinc-400 text-[13px] leading-none py-px px-1.5 cursor-pointer hover:border-accent hover:text-accent"
                @click="layout.migratingModal = 'New agent'"
            >
                +
            </button>
        </div>

        <div v-if="agents.length === 0" class="py-4 px-3.5">
            <p class="text-[12px] text-zinc-400 m-0 leading-normal">No agents yet. Create one to get started.</p>
        </div>

        <div
            v-for="agent in agents"
            v-else
            :key="agent.id"
            data-testid="agent-row"
            :class="[
                'flex flex-col gap-2 py-2.5 px-3 mt-0 mx-2 mb-1.5 rounded-lg cursor-pointer transition-[background,border-color] duration-100 border',
                agent.id === activeAgentId ? 'bg-blue-50 border-[#b6d0f7]' : 'bg-white border-stroke hover:bg-canvas',
            ]"
            @click="open(agent)"
        >
            <!-- Avatar + name + status -->
            <div class="flex items-center gap-2.5">
                <div class="relative shrink-0">
                    <div
                        class="w-8 h-8 rounded-md flex items-center justify-center text-[11px] font-bold text-white"
                        :style="{ background: agentAvatarColor(agent) }"
                    >
                        {{ agentInitials(agent.name) }}
                    </div>
                    <span
                        v-if="isRunning(agent.id)"
                        class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#22c55e] border-2 border-white block"
                    />
                </div>
                <div class="flex-1 min-w-0">
                    <div
                        :class="[
                            'text-[13px] truncate',
                            agent.id === activeAgentId ? 'font-semibold text-accent' : 'font-medium text-zinc-900',
                        ]"
                    >
                        {{ agent.name }}
                    </div>
                    <div
                        class="flex items-center gap-[5px] text-[11px] mt-0.5"
                        :style="{ color: isRunning(agent.id) ? '#16a34a' : color.warningBright }"
                    >
                        <span class="w-1.5 h-1.5 rounded-full shrink-0 bg-current" />
                        {{ isRunning(agent.id) ? 'Active' : 'Waiting' }}
                    </div>
                    <div class="text-[9px] text-zinc-400 mt-1 truncate font-mono" :title="`${agent.provider} / ${agent.model}`">
                        {{ agent.provider }} · {{ agent.model }}
                    </div>
                </div>
            </div>

            <!-- Action icons — restart · edit · adopt · remove -->
            <div class="flex items-center gap-0.5">
                <button
                    type="button"
                    :title="isRunning(agent.id) ? 'Restart agent' : 'Start agent'"
                    :class="iconButtonClass"
                    style="--hover: #ca8a04"
                    @click.stop="restart(agent)"
                >
                    <Icon name="rotate-cw" :size="14" />
                </button>

                <button
                    type="button"
                    title="Edit agent"
                    :class="iconButtonClass"
                    :style="{ '--hover': color.textPrimary }"
                    @click.stop="layout.migratingModal = 'Edit agent'"
                >
                    <Icon name="circle-dot" :size="14" />
                </button>

                <button
                    type="button"
                    title="Adopt work — remove worktree, check out the agent branch"
                    :class="iconButtonClass"
                    style="--hover: #16a34a"
                    @click.stop="adopt(agent)"
                >
                    <Icon name="git-merge" :size="14" />
                </button>

                <button
                    type="button"
                    title="Remove agent"
                    :class="iconButtonClass"
                    :style="{ '--hover': color.danger }"
                    @click.stop="removeOne(agent)"
                >
                    <Icon name="x" :size="14" />
                </button>
            </div>
        </div>
    </div>
</template>
