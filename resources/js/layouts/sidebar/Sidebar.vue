<script setup lang="ts">
import { router, usePage } from '@inertiajs/vue3'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import ProjectCreateModal from '@/components/project/ProjectCreateModal.vue'
import Icon, { type IconName } from '@/components/ui/Icon.vue'
import AgentAddModal from '@/pages/agents/AgentAddModal.vue'
import useProjects from '@/queries/projectsQuery'
import { useAppLayoutStore, type ProjectView } from '@/stores/appLayoutStore'
import { useProjectStore } from '@/stores/projectStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import ProjectItem from './ProjectItem.vue'
import WorkspacePicker from './WorkspacePicker.vue'

const PROJECT_NAV: { id: ProjectView; label: string; icon: IconName }[] = [
    { id: 'agents', label: 'Agents', icon: 'info' },
    { id: 'commands', label: 'Commands', icon: 'terminal' },
    { id: 'tasks', label: 'Tasks', icon: 'square-check-big' },
]

const page = usePage()
const layout = useAppLayoutStore()
const { claudeStatus, projectView, showProjectSearch, tasks } = storeToRefs(layout)
const { activeProject } = storeToRefs(useProjectStore())
const { projects } = useProjects()
const { currentWorkspaceId } = storeToRefs(useWorkspaceStore())

const isSettingsPage = computed(() => page.component.startsWith('settings/'))
const isTasksPage = computed(() => page.component === 'Tasks')
const isConfigPage = computed(() => page.component === 'Configurations')
// A project's agents view renders as "Home" (no agents yet) or "agents/*".
const isAgentsPage = computed(() =>
    !!activeProject.value && (page.component === 'Home' || page.component.startsWith('agents/')),
)
// null on pages outside a project (dashboard, settings, broadcasting): no nav item is current.
const activeView = computed<ProjectView | null>(() => {
    if (isTasksPage.value) return 'tasks'
    if (isConfigPage.value) return 'commands'
    return isAgentsPage.value ? projectView.value : null
})

function changeView(view: ProjectView) {
    const project = activeProject.value
    if (!project) { projectView.value = view; return }
    if (view === 'tasks') { router.visit(`/${project.slug}/tasks`); return }
    if (view === 'commands') { router.visit(`/${project.slug}/configurations`); return }
    projectView.value = 'agents'
    if (!isAgentsPage.value) router.visit(`/${project.slug}`)
}

const navClass = (active: boolean) => [
    'flex items-center gap-2 h-7 px-2 w-full rounded-md text-[13px] text-left cursor-pointer transition-colors duration-100',
    active ? 'bg-black/[0.06] text-zinc-900 font-medium' : 'text-zinc-600 hover:bg-black/[0.04] hover:text-zinc-900',
]
const iconButtonClass = 'flex items-center justify-center w-6 h-6 rounded-md text-zinc-500 cursor-pointer hover:bg-black/[0.05] hover:text-zinc-800'
</script>

<template>
    <aside class="w-[216px] shrink-0 bg-canvas border-r border-stroke flex flex-col overflow-hidden">
        <div class="px-2 pt-2.5 pb-2">
            <button
                type="button"
                data-testid="sidebar-search"
                class="flex items-center gap-2 w-full h-7 px-2.5 rounded-md bg-black/[0.04] text-zinc-500 text-[13px] text-left cursor-pointer hover:bg-black/[0.06]"
                @click="showProjectSearch = true"
            >
                <Icon name="search" :size="13" />
                <span class="flex-1">Search</span>
                <kbd class="font-sans text-[11px] text-zinc-400">⌘P</kbd>
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
                        class="text-[11px] tabular-nums text-zinc-500"
                    >
                        {{ tasks.length }}
                    </span>
                </button>
            </nav>
        </div>

        <div class="flex-1 overflow-y-auto min-h-0 px-2 pb-2">
            <div class="flex items-center gap-1.5 h-7 pl-1.5 pr-0.5 mt-1">
                <Icon name="circle-dot" :size="12" class="text-amber-500 shrink-0" />
                <span class="flex-1 text-zinc-800 text-[12px] font-semibold">Projects</span>
                <ProjectCreateModal :default-workspace-id="currentWorkspaceId">
                    <template #trigger>
                        <button type="button" title="Add project" :class="iconButtonClass">
                            <Icon name="plus" :size="13" />
                        </button>
                    </template>
                </ProjectCreateModal>
            </div>

            <ul class="list-none m-0 p-0 flex flex-col gap-px">
                <template v-if="projects.length === 0">
                    <li class="py-1 px-2 text-zinc-400 text-[12px]">No projects</li>
                    <li>
                        <ProjectCreateModal :default-workspace-id="currentWorkspaceId">
                            <template #trigger>
                                <button
                                    type="button"
                                    class="mt-0.5 w-full bg-transparent border border-dashed border-stroke rounded-md text-zinc-500 text-[12px] p-1.5 cursor-pointer text-center block hover:text-zinc-700 hover:border-zinc-400"
                                >
                                    + Add project
                                </button>
                            </template>
                        </ProjectCreateModal>
                    </li>
                </template>
                <li v-for="project in projects" :key="project.id">
                    <ProjectItem
                        :project="project"
                        :active="project.id === activeProject?.id"
                        :status="claudeStatus[project.id]"
                    />
                </li>
            </ul>
        </div>

        <WorkspacePicker />

        <div class="flex items-center gap-1 px-2.5 pt-1 pb-2">
            <button
                type="button"
                title="Settings"
                :aria-current="isSettingsPage ? 'page' : undefined"
                :class="[iconButtonClass, isSettingsPage && 'bg-black/[0.06] text-zinc-900']"
                @click="router.visit('/settings')"
            >
                <Icon name="settings" :size="14" />
            </button>

            <!-- Always shown; inert until a project is active (AgentAddModal then renders no modal). -->
            <div class="ml-auto">
                <AgentAddModal>
                    <template #trigger>
                        <button
                            type="button"
                            :disabled="!activeProject"
                            class="flex items-center gap-1 h-6 px-2 rounded-md text-[12px] font-medium text-zinc-600 cursor-pointer hover:bg-black/[0.05] hover:text-zinc-900 disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent"
                        >
                            <Icon name="plus" :size="12" />
                            New Agent
                        </button>
                    </template>
                </AgentAddModal>
            </div>
        </div>
    </aside>
</template>
