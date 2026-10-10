<script setup lang="ts">
import { router, usePage } from '@inertiajs/vue3'
import { Activity } from '@lucide/vue'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, ref } from 'vue'
import ProjectCreateModal from '@/components/project/ProjectCreateModal.vue'
import Icon from '@/components/ui/Icon.vue'
import { useAgentSummaries, type AgentSummary } from '@/queries/agentSummariesQuery'
import useProjects from '@/queries/projectsQuery'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { useProjectStore } from '@/stores/projectStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import type { Project } from '@/types/type'
import ProjectCard from './ProjectCard.vue'
import { loadCollapsedProjects, saveCollapsedProjects } from './sidebarAgents'
import WorkspacePicker from './WorkspacePicker.vue'


const page = usePage()
const layout = useAppLayoutStore()
const { activeAgentId, claudeStatus, settingsSection, showProjectSearch, sidebarOpen, statusBarOpen, taskTotal } = storeToRefs(layout)
const { activeProject } = storeToRefs(useProjectStore())
const { projects } = useProjects()
const { currentWorkspaceId } = storeToRefs(useWorkspaceStore())
const { agentsByProject } = useAgentSummaries(() => projects.value.map(p => p.id))

const agentsOf = (project: Project) => agentsByProject.value.get(project.id) ?? []
const runningCount = computed(() =>
    [...agentsByProject.value.values()].flat().filter(agent => agent.status === 'running').length,
)

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
const isTasksPage = computed(() => page.component === 'Tasks')
const isDashboard = computed(() => page.component === 'Dashboard')

function openTasks() {
    const project = activeProject.value
    if (project) router.visit(`/${project.slug}/tasks`)
}

const navClass = (active: boolean) => [
    'flex items-center gap-2.5 h-8 px-2.5 w-full rounded-lg text-ui-13 text-left cursor-pointer transition-colors duration-100',
    active ? 'bg-black/[0.06] text-zinc-900 font-medium' : 'text-zinc-700 hover:bg-black/[0.04] hover:text-zinc-900',
]
const iconButtonClass = 'shrink-0 flex items-center justify-center w-6 h-6 rounded-md text-zinc-500 cursor-pointer hover:bg-black/[0.05] hover:text-zinc-800'
</script>

<template>
    <aside class="sidebar-spacing shrink-0 bg-sidebar border-r border-stroke flex flex-col overflow-hidden">
        <div class="shrink-0 flex items-center h-14 pl-3 pr-2 border-b border-stroke">
            <button
                type="button"
                aria-label="Go to Dashboard"
                title="Dashboard"
                class="flex-1 min-w-0 flex items-center gap-2.5 h-full text-left cursor-pointer"
                @click="router.visit('/')"
            >
                <span
                    data-testid="sidebar-logo"
                    class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-zinc-900 text-amber-400 text-ui-16 font-black leading-none"
                    aria-hidden="true"
                >K</span>
                <span class="min-w-0 flex flex-col">
                    <span class="font-semibold text-ui-14 text-zinc-900 tracking-[-0.01em] truncate leading-tight">Keera</span>
                    <span class="text-ui-11.5 text-zinc-500 truncate leading-tight">Agent workspace</span>
                </span>
            </button>
            <button
                type="button"
                data-testid="toggle-panel-left"
                aria-label="Hide sidebar"
                title="Hide sidebar"
                :class="iconButtonClass"
                @click="sidebarOpen = false"
            >
                <Icon name="panel-left" :size="15" />
            </button>
        </div>

        <div class="px-2.5 pt-3 pb-2">
            <button
                type="button"
                data-testid="sidebar-search"
                class="flex items-center gap-2 w-full h-8 px-2.5 rounded-lg border border-stroke bg-surface text-zinc-500 text-ui-13 text-left cursor-pointer shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:border-zinc-300"
                @click="showProjectSearch = true"
            >
                <Icon name="search" :size="13" class="shrink-0" />
                <span class="flex-1 min-w-0 truncate">Search agents, tasks…</span>
                <kbd class="shrink-0 font-sans text-ui-10.5 text-zinc-500 px-1 rounded border border-stroke">⌘P</kbd>
            </button>

            <nav class="mt-2 flex flex-col gap-px">
                <button
                    type="button"
                    data-tab="tasks"
                    :aria-current="isTasksPage ? 'page' : undefined"
                    :class="navClass(isTasksPage)"
                    @click="openTasks"
                >
                    <Icon name="list" :size="14" class="shrink-0 text-zinc-500" />
                    <span class="flex-1">Tasks</span>
                    <span v-if="taskTotal > 0" class="text-ui-12 tabular-nums text-zinc-500">{{ taskTotal }}</span>
                </button>
                <button
                    type="button"
                    data-tab="running"
                    :aria-current="isDashboard ? 'page' : undefined"
                    :class="navClass(isDashboard)"
                    @click="router.visit('/')"
                >
                    <Activity :size="14" class="shrink-0 text-zinc-500" />
                    <span class="flex-1">Running</span>
                    <span data-testid="running-total" class="flex items-center gap-1.5 text-ui-12 tabular-nums text-zinc-500">
                        <span v-if="runningCount > 0" class="w-1.5 h-1.5 rounded-full bg-orange-500" />
                        {{ runningCount }}
                    </span>
                </button>
            </nav>
        </div>

        <div class="flex-1 overflow-y-auto min-h-0 px-2.5 pb-2">
            <div data-testid="section-projects" class="flex items-center h-7 pl-1.5 mt-1 mb-1">
                <span class="flex-1 text-zinc-500 text-ui-11 font-semibold uppercase tracking-[0.08em]">Projects</span>
                <ProjectCreateModal :default-workspace-id="currentWorkspaceId">
                    <template #trigger>
                        <button type="button" title="Add project" :class="iconButtonClass">
                            <Icon name="plus" :size="14" />
                        </button>
                    </template>
                </ProjectCreateModal>
            </div>

            <ul class="list-none m-0 p-0 mb-1 flex flex-col gap-1.5">
                <li v-if="projects.length === 0" class="py-1 px-2 text-zinc-400 text-ui-12">No projects</li>
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
                <li>
                    <ProjectCreateModal :default-workspace-id="currentWorkspaceId">
                        <template #trigger>
                            <button
                                type="button"
                                data-testid="add-project-group"
                                aria-label="Add project"
                                class="w-full h-8 flex items-center justify-center rounded-xl border border-dashed border-stroke text-zinc-500 cursor-pointer transition-colors duration-100 hover:bg-black/[0.03] hover:text-zinc-900"
                            >
                                <Icon name="plus" :size="14" />
                            </button>
                        </template>
                    </ProjectCreateModal>
                </li>
            </ul>
        </div>

        <div class="shrink-0 flex items-center gap-1 px-2.5 py-2.5 border-t border-stroke">
            <WorkspacePicker class="flex-1 min-w-0" />
            <button
                type="button"
                data-testid="toggle-panel-bottom"
                aria-label="Toggle status bar"
                title="Toggle status bar"
                :aria-pressed="statusBarOpen"
                :class="[iconButtonClass, 'w-8 h-8', !statusBarOpen && 'text-zinc-400']"
                @click="statusBarOpen = !statusBarOpen"
            >
                <Icon name="panel-bottom" :size="15" />
            </button>
            <button
                type="button"
                title="Settings"
                aria-label="Settings"
                :aria-expanded="isSettingsOpen"
                :class="[iconButtonClass, 'w-8 h-8', isSettingsOpen && 'bg-black/[0.06] text-zinc-900']"
                @click="layout.openSettings()"
            >
                <Icon name="settings" :size="16" />
            </button>
        </div>
    </aside>
</template>
