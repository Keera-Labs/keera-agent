<script setup lang="ts">
import { router, usePage } from '@inertiajs/vue3'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, ref, watch, watchEffect } from 'vue'
import DotsIndicator from '@/components/ui/DotsIndicator.vue'
import useProjects from '@/queries/projectsQuery'
import { useAppLayoutStore, type ProjectView } from '@/stores/appLayoutStore'
import { useProjectStore } from '@/stores/projectStore'
import AgentsIndex from '@/pages/agents/Index.vue'

const TABS: { id: ProjectView; label: string }[] = [
    { id: 'agents', label: 'Dashboard' },
    { id: 'commands', label: 'Configurations' },
    { id: 'tasks', label: 'Tasks' },
]

const page = usePage<{ project?: string }>()
const layout = useAppLayoutStore()
const { claudeStatus, projectView, liveSessionCount, activeAgentId } = storeToRefs(layout)
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
const activeStatus = computed(() => (activeProject.value ? claudeStatus.value[activeProject.value.id] : undefined))
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

function selectTab(view: ProjectView) {
    const project = activeProject.value
    if (!project) { projectView.value = view; return }
    if (view === 'tasks') { router.visit(`/${project.slug}/tasks`); return }
    if (view === 'commands') { router.visit(`/${project.slug}/configurations`); return }
    projectView.value = 'agents'
    layout.setActiveAgentId(null)
    if (isTasksPage.value || isConfigPage.value) router.visit(`/${project.slug}`)
}

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

onBeforeUnmount(() => {
    if (activeProject.value) layout.parkPmTerminal(activeProject.value.id)
})
</script>

<template>
    <div class="flex-1 flex flex-col overflow-hidden">
        <!-- Nav tabs: Dashboard / Configurations / Tasks + Claude status badge -->
        <div class="flex items-stretch px-2 bg-white shrink-0 border-b border-stroke h-10">
            <button
                v-for="tab in TABS"
                :key="tab.id"
                :class="[
                    'bg-transparent cursor-pointer px-4 h-full text-[13px] transition-colors duration-100 relative border-b-2 -mb-px',
                    activeView === tab.id ? 'text-zinc-900 font-semibold border-accent' : 'text-zinc-500 font-normal border-transparent',
                ]"
                @click="selectTab(tab.id)"
            >
                {{ tab.label }}
            </button>

            <template v-if="activeProject">
                <div class="my-2 mx-1 w-px bg-stroke" />
                <div class="flex items-center gap-1.5 px-2">
                    <span v-if="activeStatus === 'running'" class="flex items-center gap-1.5 ml-2">
                        <DotsIndicator />
                        <span class="text-amber-700 text-[11px] font-mono">running</span>
                    </span>
                    <span v-else-if="activeStatus === 'done'" class="flex items-center gap-[5px] ml-1.5">
                        <span class="w-[7px] h-[7px] rounded-full bg-success" />
                        <span class="text-success text-[11px] font-mono">done</span>
                    </span>
                </div>
            </template>

            <!-- Global running indicator -->
            <div v-if="liveSessionCount > 0" class="flex items-center gap-2 pr-3 ml-auto">
                <DotsIndicator />
                <span class="text-amber-600 text-[12.5px] font-semibold font-mono">{{ liveSessionCount }} running</span>
            </div>
        </div>

        <div class="flex-1 flex overflow-hidden">
            <!-- Always mounted (display-toggled) so the terminal slot never unmounts under a live xterm. -->
            <div :class="['flex-1 overflow-hidden', showPmTerminal ? 'flex' : 'hidden']">
                <div ref="terminalSlot" data-testid="pm-terminal" class="flex-1 overflow-hidden p-2 box-border bg-[#f6f8fa]" />
            </div>

            <AgentsIndex v-if="showOverview" />

            <div v-if="!activeProject" class="flex-1 flex items-center justify-center">
                <span class="text-zinc-400 text-[13px]">No project selected</span>
            </div>

            <slot v-if="!showAgentsView || isAgentDetail" />
        </div>
    </div>
</template>
