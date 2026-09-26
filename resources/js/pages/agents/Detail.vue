<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import AgentStatusIndicator from '@/components/ui/AgentStatusIndicator.vue'
import Icon from '@/components/ui/Icon.vue'
import { attachTerminal, reportSize } from '@/composables/useTerminalSessions'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { useProjectStore } from '@/stores/projectStore'
import { color } from '@/tokens'
import { AGENT_TYPE_COLORS, AGENT_TYPE_LABELS } from '@/types/agent'
import { agentColor } from '@/utils/agentColor'
import PmCheckinControl from './PmCheckinControl.vue'
import ProjectOverview from './ProjectOverview.vue'
import { agentRoleLabel } from './presentation'

// Served at /{project}/agents/{id}. Owns the agent-execution chrome (agents
// list, header, image drop) and a terminal slot. The xterm instances and their
// sockets stay owned by the app layout store: the active agent's live terminal
// is moved into the slot, and parked back in the layout's off-screen holder
// when the agent changes or the page unmounts, so the PTY never closes.

const layout = useAppLayoutStore()
const { activeAgentId, isDraggingOver, claudeStatus } = storeToRefs(layout)
const { activeProject } = storeToRefs(useProjectStore())

const activeAgent = computed(() =>
    layout.agentHook.agents.value.find(a => a.id === activeAgentId.value) ?? null,
)
const agentBg = computed(() => {
    if (activeAgent.value) return AGENT_TYPE_COLORS[activeAgent.value.agent_type] ?? color.accent
    return activeProject.value ? agentColor(activeProject.value.name) : color.accent
})
const displayName = computed(() => activeAgent.value?.name ?? activeProject.value?.name ?? '')
const typeLabel = computed(() => {
    const agent = activeAgent.value
    return agent ? (AGENT_TYPE_LABELS[agent.agent_type] ?? agent.agent_type).toUpperCase() : 'AGENT'
})
const subtitle = computed(() => {
    const agent = activeAgent.value
    if (!agent) return null
    return agent.model ? `${agentRoleLabel(agent)} · ${agent.model}` : agentRoleLabel(agent)
})
const status = computed(() => (activeProject.value ? claudeStatus.value[activeProject.value.id] : undefined))

const terminalSlot = ref<HTMLElement | null>(null)

/** Reply: put the cursor in the agent's terminal, where the question or permission prompt is showing. */
function focusTerminal() {
    terminalSlot.value?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')?.focus()
}

function showAgentTerminal(agentId: number, el: HTMLElement) {
    layout.setAgentContainer(agentId, el)
    const session = layout.agentSessions.get(agentId)
    if (!session) {
        // launchAgentSession opens into the registered container, now this slot;
        // it is idempotent, so the store's own launch can't open a second PTY.
        layout.launchAgentSession(agentId, true)
        return
    }
    attachTerminal(session.term, el)
    session.observer.disconnect()
    session.observer.observe(el)
    requestAnimationFrame(() => { session.fitAddon.fit(); reportSize(session); session.term.focus() })
}

function parkAgentTerminal(agentId: number) {
    const holder = layout.terminalHolder
    if (!holder) return
    layout.setAgentContainer(agentId, holder)
    const session = layout.agentSessions.get(agentId)
    if (!session) return
    // The holder is not observed; the terminal refits when it is next shown in a slot.
    session.observer.disconnect()
    attachTerminal(session.term, holder)
    reportSize(session)
}

watch(
    [activeAgentId, terminalSlot, () => activeAgent.value?.agent_type === 'pm'],
    ([agentId, el, isPm], _previous, onCleanup) => {
        const projectId = activeProject.value?.id
        if (agentId === null || !el || projectId === undefined) return
        // The PM's PTY is the project's PM session; ProjectLayout reclaims it
        // once this page stops showing it, so it is not parked from here.
        if (isPm) {
            layout.showPmTerminal(projectId, el)
            return
        }
        showAgentTerminal(agentId, el)
        onCleanup(() => parkAgentTerminal(agentId))
    },
    { flush: 'post', immediate: true },
)

function onDragLeave(e: DragEvent) {
    const target = e.currentTarget as HTMLElement
    if (!target.contains(e.relatedTarget as Node | null)) isDraggingOver.value = false
}

function onDrop(e: DragEvent) {
    isDraggingOver.value = false
    const file = e.dataTransfer?.files[0]
    if (file) layout.uploadImage(file)
}
</script>

<template>
    <template v-if="activeProject">
        <!-- Back / no selection renders the overview in place: visiting /{slug}
             would redirect to the default agent and bounce straight back here. -->
        <ProjectOverview v-if="activeAgentId === null" :project="activeProject" />

        <div v-else class="flex-1 overflow-hidden flex">
            <div
                data-testid="agent-execution"
                class="flex-1 flex flex-col overflow-hidden relative bg-white"
                @dragover.prevent="isDraggingOver = true"
                @dragenter.prevent="isDraggingOver = true"
                @dragleave="onDragLeave"
                @drop.prevent="onDrop"
            >
                <div class="min-h-[48px] shrink-0 flex items-center pl-4 pr-3.5 pt-[7px] pb-[7px] gap-2.5 border-b border-stroke bg-white">
                    <button
                        title="Back"
                        class="bg-transparent border-0 text-zinc-400 cursor-pointer p-1 flex items-center rounded-sm hover:text-zinc-900 hover:bg-canvas"
                        @click="layout.setActiveAgentId(null)"
                    >
                        <Icon name="arrow-left" :size="14" />
                    </button>

                    <div
                        class="w-7 h-7 rounded-md shrink-0 flex items-center justify-center text-[11px] font-bold text-white"
                        :style="{ background: agentBg }"
                    >
                        {{ displayName.charAt(0).toUpperCase() }}
                    </div>

                    <div class="flex-1 min-w-0 flex flex-col justify-center gap-px">
                        <div class="flex items-center gap-2">
                            <span class="text-zinc-900 text-[13px] font-semibold truncate">{{ displayName }}</span>
                            <span
                                class="text-[10px] font-semibold py-0.5 px-[7px] rounded-lg tracking-[0.04em] border shrink-0"
                                :style="{ background: `${agentBg}18`, borderColor: `${agentBg}40`, color: agentBg }"
                            >
                                {{ typeLabel }}
                            </span>
                        </div>
                        <span v-if="subtitle" class="text-zinc-500 text-[12px] truncate">{{ subtitle }}</span>
                    </div>

                    <div class="flex items-center gap-3 shrink-0">
                        <PmCheckinControl v-if="activeAgent?.agent_type === 'pm'" :agent-id="activeAgent.id" compact />
                        <span
                            v-if="activeAgent?.status === 'needs_input'"
                            data-testid="agent-needs-input"
                            class="flex items-center gap-2 ml-2 max-w-[360px] py-1 pl-1.5 pr-1 rounded-md bg-amber-50 border border-amber-200"
                        >
                            <AgentStatusIndicator status="needs_input" :size="14" />
                            <span class="text-amber-800 text-[12px] truncate" :title="activeAgent.attention_prompt ?? undefined">
                                {{ activeAgent.attention_prompt ?? 'Needs input' }}
                            </span>
                            <button
                                type="button"
                                data-testid="agent-reply"
                                class="shrink-0 h-6 px-2 rounded bg-amber-500 text-white text-[11px] font-semibold cursor-pointer border-0 hover:bg-amber-600"
                                @click="focusTerminal"
                            >
                                Reply
                            </button>
                        </span>
                        <span v-else-if="status === 'running' || activeAgent?.status === 'running'" class="flex items-center gap-1.5 ml-2">
                            <AgentStatusIndicator status="running" :size="12" />
                            <span class="text-success text-[11px] font-mono">running</span>
                        </span>
                    </div>
                </div>

                <div
                    v-if="isDraggingOver"
                    class="absolute inset-0 z-10 bg-[rgba(9,105,218,0.08)] border-2 border-dashed border-accent rounded-sm flex items-center justify-center pointer-events-none"
                >
                    <div class="flex flex-col items-center gap-2.5">
                        <Icon name="image" :size="36" :color="color.accent" class="opacity-80" />
                        <span class="text-accent text-[13px] font-mono">Drop image to attach</span>
                    </div>
                </div>

                <div ref="terminalSlot" data-testid="agent-terminal" class="flex-1 relative overflow-hidden bg-canvas terminal-host" />
            </div>
        </div>
    </template>
</template>
