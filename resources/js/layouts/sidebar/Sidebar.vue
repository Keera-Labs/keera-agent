<script setup lang="ts">
import { router, usePage } from '@inertiajs/vue3'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, ref } from 'vue'
import ProjectCreateModal from '@/components/project/ProjectCreateModal.vue'
import Icon, { type IconName } from '@/components/ui/Icon.vue'
import AgentAddModal from '@/pages/agents/AgentAddModal.vue'
import { useAgentSummaries, type AgentSummary } from '@/queries/agentSummariesQuery'
import useProjects from '@/queries/projectsQuery'
import { useAppLayoutStore, type ProjectView } from '@/stores/appLayoutStore'
import { useProjectStore } from '@/stores/projectStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import type { Project } from '@/types/type'
import ProjectCard from './ProjectCard.vue'
import { loadCollapsedProjects, saveCollapsedProjects } from './sidebarAgents'
import WorkspacePicker from './WorkspacePicker.vue'

// Agents stay reachable from each project's card below; Commands only by its URL.
const PROJECT_NAV: { id: ProjectView; label: string; icon: IconName }[] = [
    { id: 'tasks', label: 'Tasks', icon: 'clipboard-check' },
]

const page = usePage()
const layout = useAppLayoutStore()
const { activeAgentId, claudeStatus, settingsSection, showProjectSearch, sidebarOpen, statusBarOpen, tasks } = storeToRefs(layout)
const { activeProject } = storeToRefs(useProjectStore())
const { projects } = useProjects()
const { currentWorkspaceId } = storeToRefs(useWorkspaceStore())
const { agentsByProject } = useAgentSummaries(() => projects.value.map(p => p.id))

const agentsOf = (project: Project) => agentsByProject.value.get(project.id) ?? []

const collapsed = ref(loadCollapsedProjects())
function toggleCollapsed(projectId: number) {
    const next = new Set(collapsed.value)
    if (!next.delete(projectId)) next.add(projectId)
    collapsed.value = next
    saveCollapsedProjects(next)
}

// Relative times ("now", "5m") only change with the clock, not with the data.
const now = ref(Date.now())
const clock = setInterval(() => { now.value = Date.now() }, 30_000)
onBeforeUnmount(() => clearInterval(clock))

function selectAgent(project: Project, agent: AgentSummary) {
    layout.setActiveAgentId(agent.id)
    router.visit(`/${project.slug}/agents/${agent.id}`)
}

const isSettingsOpen = computed(() => settingsSection.value !== null)
const activeView = computed<ProjectView | null>(() => (page.component === 'Tasks' ? 'tasks' : null))

function changeView(view: ProjectView) {
    const project = activeProject.value
    if (project && view === 'tasks') router.visit(`/${project.slug}/tasks`)
}

const navClass = (active: boolean) => [
    'flex items-center gap-2 h-7 px-2 w-full rounded-md text-ui-13 text-left cursor-pointer transition-colors duration-100',
    active ? 'bg-black/[0.06] text-zinc-900 font-medium' : 'text-zinc-600 hover:bg-black/[0.04] hover:text-zinc-900',
]
const iconButtonClass = 'shrink-0 flex items-center justify-center w-6 h-6 rounded-md text-zinc-500 cursor-pointer hover:bg-black/[0.05] hover:text-zinc-800'
</script>

<template>
    <aside class="sidebar-spacing shrink-0 bg-canvas border-r border-stroke flex flex-col overflow-hidden">
        <!-- Same height as the header so their borders line up, so it keeps the header's unscaled spacing. -->
        <div class="shrink-0 flex items-center h-10 pr-2 border-b border-stroke [--spacing:0.25rem]">
            <!-- The logo doubles as the Dashboard (home) link. -->
            <button
                type="button"
                aria-label="Go to Dashboard"
                title="Dashboard"
                class="flex-1 min-w-0 flex items-center gap-2 h-full px-3.5 text-left cursor-pointer"
                @click="router.visit('/')"
            >
                <div class="w-6 h-6 rounded-md flex items-center justify-center shrink-0 bg-accent">
                    <Icon name="info" :size="13" color="white" />
                </div>
                <span class="font-semibold text-ui-13 text-zinc-900 tracking-[-0.01em] whitespace-nowrap">Keera Agent</span>
            </button>
            <button
                type="button"
                data-testid="toggle-panel-left"
                aria-label="Hide sidebar"
                title="Hide sidebar"
                :class="iconButtonClass"
                @click="sidebarOpen = false"
            >
                <Icon name="panel-left" :size="14" />
            </button>
        </div>

        <div class="px-2 pt-2.5 pb-2">
            <button
                type="button"
                data-testid="sidebar-search"
                class="flex items-center gap-2 w-full h-7 px-2.5 rounded-md bg-black/[0.04] text-zinc-500 text-ui-13 text-left cursor-pointer hover:bg-black/[0.06]"
                @click="showProjectSearch = true"
            >
                <Icon name="search" :size="13" />
                <span class="flex-1">Search</span>
                <kbd class="font-sans text-ui-11 text-zinc-400">⌘P</kbd>
            </button>

            <nav class="mt-2 flex flex-col gap-px">
                <button
                    v-for="item in PROJECT_NAV"
                    :key="item.id"
                    type="button"
                    :data-tab="item.id"
                    :aria-current="item.id === activeView ? 'page' : undefined"
                    :class="navClass(item.id === activeView)"
                    @click="changeView(item.id)"
                >
                    <Icon :name="item.icon" :size="14" class="shrink-0 text-zinc-500" />
                    <span class="flex-1">{{ item.label }}</span>
                    <span
                        v-if="item.id === 'tasks' && tasks.length > 0"
                        class="text-ui-11 tabular-nums text-zinc-500"
                    >
                        {{ tasks.length }}
                    </span>
                </button>
            </nav>
        </div>

        <div class="flex-1 overflow-y-auto min-h-0 px-2 pb-2">
            <div data-testid="section-projects" class="flex items-center h-7 pl-1.5 pr-0.5 mt-1">
                <span class="flex-1 text-zinc-800 text-ui-12 font-semibold">Projects</span>
                <ProjectCreateModal :default-workspace-id="currentWorkspaceId">
                    <template #trigger>
                        <button type="button" title="Add project" :class="iconButtonClass">
                            <Icon name="plus" :size="13" />
                        </button>
                    </template>
                </ProjectCreateModal>
            </div>

            <ul class="list-none m-0 p-0 mb-1 flex flex-col gap-1">
                <template v-if="projects.length === 0">
                    <li class="py-1 px-2 text-zinc-400 text-ui-12">No projects</li>
                    <li>
                        <ProjectCreateModal :default-workspace-id="currentWorkspaceId">
                            <template #trigger>
                                <button
                                    type="button"
                                    class="mt-0.5 w-full bg-transparent border border-dashed border-stroke rounded-md text-zinc-500 text-ui-12 p-1.5 cursor-pointer text-center block hover:text-zinc-700 hover:border-zinc-400"
                                >
                                    + Add project
                                </button>
                            </template>
                        </ProjectCreateModal>
                    </li>
                </template>
                <li v-for="project in projects" :key="project.id">
                    <ProjectCard
                        :project="project"
                        :agents="agentsOf(project)"
                        :active="project.id === activeProject?.id"
                        :active-agent-id="activeAgentId"
                        :status="claudeStatus[project.id]"
                        :collapsed="collapsed.has(project.id)"
                        :now="now"
                        @toggle="toggleCollapsed(project.id)"
                        @select-agent="agent => selectAgent(project, agent)"
                    />
                </li>
            </ul>
        </div>

        <WorkspacePicker />

        <div class="flex items-center gap-1 px-2.5 pt-1 pb-2">
            <button
                type="button"
                title="Settings"
                aria-label="Settings"
                :aria-expanded="isSettingsOpen"
                :class="[iconButtonClass, isSettingsOpen && 'bg-black/[0.06] text-zinc-900']"
                @click="layout.openSettings()"
            >
                <Icon name="settings" :size="14" />
            </button>
            <button
                type="button"
                data-testid="toggle-panel-bottom"
                aria-label="Toggle status bar"
                title="Toggle status bar"
                :aria-pressed="statusBarOpen"
                :class="[iconButtonClass, !statusBarOpen && 'text-zinc-400']"
                @click="statusBarOpen = !statusBarOpen"
            >
                <Icon name="panel-bottom" :size="14" />
            </button>

            <!-- Always shown; inert until a project is active (AgentAddModal then renders no modal). -->
            <div class="ml-auto min-w-0">
                <AgentAddModal>
                    <template #trigger>
                        <button
                            type="button"
                            :disabled="!activeProject"
                            class="flex items-center gap-1 max-w-full h-6 px-2 rounded-md text-ui-12 font-medium whitespace-nowrap text-zinc-600 cursor-pointer hover:bg-black/[0.05] hover:text-zinc-900 disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent"
                        >
                            <Icon name="plus" :size="12" class="shrink-0" />
                            <span class="truncate">New Agent</span>
                        </button>
                    </template>
                </AgentAddModal>
            </div>
        </div>
    </aside>
</template>
