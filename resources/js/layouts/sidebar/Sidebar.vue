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
const { claudeStatus, projectView, tasks } = storeToRefs(layout)
const { activeProject } = storeToRefs(useProjectStore())
const { projects } = useProjects()
const { currentWorkspaceId } = storeToRefs(useWorkspaceStore())

const isSettingsPage = computed(() => page.component === 'Settings')
const isTasksPage = computed(() => page.component === 'Tasks')
const isConfigPage = computed(() => page.component === 'Configurations')
const activeView = computed<ProjectView>(() =>
    isTasksPage.value ? 'tasks' : isConfigPage.value ? 'commands' : projectView.value,
)

function changeView(view: ProjectView) {
    const project = activeProject.value
    if (!project) { projectView.value = view; return }
    if (view === 'tasks') { router.visit(`/${project.slug}/tasks`); return }
    if (view === 'commands') { router.visit(`/${project.slug}/configurations`); return }
    projectView.value = 'agents'
    if (isTasksPage.value || isConfigPage.value) router.visit(`/${project.slug}`)
}

const navClass = (active: boolean) => [
    'flex items-center gap-2 py-[7px] px-2.5 w-full border rounded text-[12px] cursor-pointer text-left transition-all duration-100',
    active
        ? 'bg-blue-50 border-blue-600 text-blue-600 font-semibold'
        : 'bg-transparent border-transparent text-zinc-500 font-normal hover:bg-surface hover:text-zinc-700',
]
</script>

<template>
    <aside class="w-[220px] shrink-0 bg-canvas border-r border-stroke flex flex-col overflow-hidden">
        <WorkspacePicker />

        <div class="flex-1 overflow-y-auto flex flex-col min-h-0">
            <div class="pt-2.5 pr-2.5 pb-1 pl-3.5 flex items-center justify-between">
                <span class="text-zinc-400 text-[10px] font-bold uppercase tracking-[0.12em]">Projects</span>
                <ProjectCreateModal :default-workspace-id="currentWorkspaceId">
                    <template #trigger>
                        <button
                            type="button"
                            title="Add project"
                            class="bg-transparent border-0 cursor-pointer text-zinc-400 py-0 px-0.5 flex items-center hover:text-zinc-500"
                        >
                            <Icon name="plus" :size="11" />
                        </button>
                    </template>
                </ProjectCreateModal>
            </div>

            <ul class="list-none m-0 py-0 px-0.5">
                <template v-if="projects.length === 0">
                    <li class="py-1 px-4 text-zinc-400 text-[11px] italic">No projects</li>
                    <li>
                        <ProjectCreateModal :default-workspace-id="currentWorkspaceId">
                            <template #trigger>
                                <button
                                    type="button"
                                    class="mt-0.5 mx-2.5 mb-1.5 w-[calc(100%-20px)] bg-transparent border border-dashed border-stroke rounded text-zinc-400 text-[11px] p-1.5 cursor-pointer text-center block hover:text-zinc-500 hover:border-zinc-500"
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

            <div v-if="activeProject" class="pt-2 px-2 pb-1">
                <div class="flex items-center gap-2.5 py-[9px] px-3 rounded-md bg-surface border border-stroke">
                    <div class="w-8 h-8 rounded-md bg-[#EEF2FF] flex items-center justify-center shrink-0">
                        <Icon name="terminal" :size="16" color="#4F46E5" />
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="text-zinc-900 text-[13px] font-bold truncate">{{ activeProject.name }}</div>
                        <div class="text-zinc-500 text-[11px] mt-px">AI Coding Manager</div>
                    </div>
                </div>
            </div>

            <div class="pt-2.5 px-4 pb-1">
                <span class="text-zinc-400 text-[10px] font-bold uppercase tracking-[0.08em]">Workspace</span>
            </div>
            <div class="pt-0 px-2 pb-2 flex flex-col gap-px">
                <button
                    v-for="item in PROJECT_NAV"
                    :key="item.id"
                    type="button"
                    :data-tab="item.id"
                    :class="navClass(item.id === activeView)"
                    @click="changeView(item.id)"
                >
                    <Icon :name="item.icon" :size="15" />
                    <span class="flex-1">{{ item.label }}</span>
                    <span
                        v-if="item.id === 'tasks' && tasks.length > 0"
                        class="text-[10px] font-bold py-px px-1.5 rounded-lg bg-blue-50 text-accent"
                    >
                        {{ tasks.length }}
                    </span>
                </button>
            </div>
        </div>

        <div class="border-t border-stroke flex flex-col gap-1 pt-2 px-2.5 pb-2.5">
            <button type="button" :class="navClass(isSettingsPage)" @click="router.visit('/settings')">
                <Icon name="settings" :size="14" />
                <span>Settings</span>
            </button>

            <!-- Always shown; inert until a project is active (AgentAddModal then renders no modal). -->
            <AgentAddModal>
                <template #trigger>
                    <button
                        type="button"
                        :disabled="!activeProject"
                        :class="[
                            'w-full py-2 px-3 rounded-[7px] text-[13px] font-semibold flex items-center justify-center gap-1.5 transition-opacity duration-100',
                            activeProject
                                ? 'bg-blue-600 border-0 text-white cursor-pointer opacity-100 hover:opacity-[0.88]'
                                : 'bg-surface border border-stroke text-zinc-400 cursor-default opacity-50',
                        ]"
                    >
                        <Icon name="plus" :size="12" />
                        + New Agent
                    </button>
                </template>
            </AgentAddModal>
        </div>
    </aside>
</template>
