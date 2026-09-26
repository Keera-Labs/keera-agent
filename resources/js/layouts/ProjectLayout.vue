<script setup lang="ts">
import { usePage } from '@inertiajs/vue3'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, ref, watch, watchEffect } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import useProjects from '@/queries/projectsQuery'
import { useAppLayoutStore, type ProjectView } from '@/stores/appLayoutStore'
import { useProjectStore } from '@/stores/projectStore'
import AgentsIndex from '@/pages/agents/Index.vue'

const page = usePage<{ project?: string }>()
const layout = useAppLayoutStore()
const { projectView, activeAgentId } = storeToRefs(layout)
const { activeProject } = storeToRefs(useProjectStore())

// The only layout with a project route, so it is the one place that resolves
// the slug into the active project. Unscoped pages keep the last one resolved.
const { setActiveProject } = useProjects()
watchEffect(() => setActiveProject(page.props.project))

const isTasksPage = computed(() => page.component === 'Tasks')
const isConfigPage = computed(() => page.component === 'Configurations')
const activeView = computed<ProjectView>(() =>
    isTasksPage.value ? 'tasks' : isConfigPage.value ? 'commands' : projectView.value,
)
const showAgentsView = computed(() => !!activeProject.value && activeView.value === 'agents')
// agents/Detail renders the whole agents view itself (overview included).
const isAgentDetail = computed(() => page.component === 'agents/Detail')
const showOverview = computed(() => showAgentsView.value && !isAgentDetail.value && activeAgentId.value === null)
const showPmTerminal = computed(() => showAgentsView.value && !isAgentDetail.value && activeAgentId.value !== null)
// The PM agent's terminal is the project's PM session, so while the detail page
// shows the PM it borrows the session; this layout takes it back afterwards.
const pmShownByPage = computed(() =>
    isAgentDetail.value
    && layout.agentHook.agents.value.some(a => a.id === activeAgentId.value && a.agent_type === 'pm'),
)

// The active project's PM terminal is shown here; on a project switch or when
// this layout unmounts it is parked off-screen so its xterm DOM and socket survive.
const terminalSlot = ref<HTMLElement | null>(null)

watch(
    [() => activeProject.value?.id, terminalSlot, pmShownByPage],
    ([projectId, slot, borrowed], previous) => {
        const previousId = previous?.[0]
        if (previousId !== undefined && previousId !== projectId) layout.parkPmTerminal(previousId)
        if (projectId !== undefined && slot && !borrowed) layout.showPmTerminal(projectId, slot)
    },
    { flush: 'post', immediate: true },
)

const PANE_BUTTON_CLASS = 'w-6 h-6 flex items-center justify-center rounded-md text-zinc-400 bg-transparent cursor-pointer transition-colors hover:text-zinc-800 hover:bg-black/[0.05]'

function clearPmTerminal() {
    if (activeProject.value) layout.sessions.get(activeProject.value.id)?.term.clear()
}

onBeforeUnmount(() => {
    if (activeProject.value) layout.parkPmTerminal(activeProject.value.id)
})
</script>

<template>
    <div class="flex-1 flex flex-col overflow-hidden">
        <div class="flex-1 flex overflow-hidden">
            <!-- Always mounted (display-toggled) so the terminal slot never unmounts under a live xterm. -->
            <div :class="['flex-1 overflow-hidden relative', showPmTerminal ? 'flex' : 'hidden']">
                <div ref="terminalSlot" data-testid="pm-terminal" class="flex-1 overflow-hidden terminal-host bg-[#f6f8fa]" />
                <div class="absolute top-2 right-3 z-10 flex items-center gap-0.5">
                    <button
                        type="button"
                        title="Restart Claude"
                        aria-label="Restart Claude"
                        :class="PANE_BUTTON_CLASS"
                        @click="layout.restartClaude()"
                    >
                        <Icon name="rotate-cw" :size="13" />
                    </button>
                    <button
                        type="button"
                        data-testid="pm-terminal-clear"
                        title="Clear terminal"
                        aria-label="Clear terminal"
                        :class="PANE_BUTTON_CLASS"
                        @click="clearPmTerminal"
                    >
                        <Icon name="trash-2" :size="13" />
                    </button>
                </div>
            </div>

            <AgentsIndex v-if="showOverview" />

            <div v-if="!activeProject" class="flex-1 flex items-center justify-center">
                <span class="text-zinc-400 text-[13px]">No project selected</span>
            </div>

            <slot v-if="!showAgentsView || isAgentDetail" />
        </div>
    </div>
</template>
