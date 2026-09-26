<script setup lang="ts">
import { router, usePage } from '@inertiajs/vue3'
import { FileDiff } from '@lucide/vue'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import ConfirmDeleteAgentModal from '@/components/modals/ConfirmDeleteAgentModal.vue'
import Icon from '@/components/ui/Icon.vue'
import AgentAddModal from '@/pages/agents/AgentAddModal.vue'
import type { ProjectAgent } from '@/queries/agentQuery'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { useDiffStore, type DiffTab } from '@/stores/diffStore'
import { SAVE_STATUS_LABEL, saveStatus, useEditorStore, type EditorTab, type SaveStatus } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

type TabState = 'running' | 'live' | 'off'

// Pages that show the active agent's terminal; elsewhere no tab reads as active.
const TERMINAL_PAGES = ['Home', 'agents/Detail']

const page = usePage()
const layout = useAppLayoutStore()
const { activeAgentId, claudeStatus, liveSessionCount } = storeToRefs(layout)
const { activeProject } = storeToRefs(useProjectStore())
const editor = useEditorStore()
const { projectTabs: fileTabs, activeTab: activeFileTab } = storeToRefs(editor)
const diffs = useDiffStore()
const { projectTabs: diffTabs, activeTab: activeDiffTab } = storeToRefs(diffs)

const isPm = (agent: ProjectAgent) => agent.agent_type === 'pm'

// The first PM stands for the project's own session and is always pinned first;
// other agents get a tab once their terminal is open (or while they are selected).
const tabs = computed(() => {
    // Sessions live in plain Maps; the count is the reactive signal that they changed.
    void liveSessionCount.value
    if (!activeProject.value) return []
    const agents = layout.agentHook.agents.value
    const pm = agents.find(isPm)
    const others = agents.filter(a => a !== pm && (layout.agentSessions.has(a.id) || a.id === activeAgentId.value))
    return pm ? [pm, ...others] : others
})

function tabState(agent: ProjectAgent): TabState {
    void liveSessionCount.value
    const project = activeProject.value
    if (isPm(agent) && project) {
        if (claudeStatus.value[project.id] === 'running') return 'running'
        return layout.sessions.has(project.id) ? 'live' : 'off'
    }
    if (agent.status === 'running') return 'running'
    return layout.agentSessions.has(agent.id) ? 'live' : 'off'
}

const DOT_CLASS: Record<TabState, string> = {
    running: 'bg-amber-500 animate-pulse',
    live: 'bg-emerald-500',
    off: 'bg-zinc-300',
}

function isActive(agent: ProjectAgent) {
    return activeFileTab.value === null && activeDiffTab.value === null && agent.id === activeAgentId.value && TERMINAL_PAGES.includes(page.component)
}

const isFileActive = (tab: EditorTab) => activeFileTab.value?.path === tab.path
const isDiffActive = (tab: DiffTab) => activeDiffTab.value?.id === tab.id

const diffTitle = (tab: DiffTab) =>
    [tab.path, tab.staged ? 'Staged (HEAD ↔ Index)' : 'Changes (Index ↔ Working tree)', tab.worktreeLabel].filter(Boolean).join(' · ')

const SAVE_DOT_CLASS: Record<SaveStatus, string> = {
    saving: 'bg-zinc-500 animate-pulse',
    conflict: 'bg-amber-500',
    error: 'bg-red-500',
    unsaved: 'bg-zinc-500',
    saved: '',
}

function tabClass(active: boolean) {
    return [
        'group relative flex items-center gap-1.5 shrink-0 max-w-[200px] pl-3 pr-1.5 text-[12.5px] border-x -mb-px cursor-pointer transition-colors',
        active
            ? 'bg-white text-zinc-900 border-stroke'
            : 'text-zinc-500 border-transparent hover:text-zinc-800 hover:bg-black/[0.03]',
    ]
}

const closeButtonClass = 'shrink-0 w-4 h-4 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-800 hover:bg-black/[0.06]'

function select(agent: ProjectAgent) {
    const project = activeProject.value
    if (!project) return
    layout.setActiveAgentId(agent.id)
    router.visit(`/${project.slug}/agents/${agent.id}`)
}

function close(agent: ProjectAgent) {
    layout.disposeAgentSession(agent.id)
    if (activeAgentId.value === agent.id) layout.setActiveAgentId(null)
}

// Closing an agent's tab deletes the agent, so it goes through a confirmation first.
const closing = ref<ProjectAgent | null>(null)
const deleteError = ref('')
const removeAgent = layout.agentHook.remove

function requestClose(agent: ProjectAgent) {
    deleteError.value = ''
    closing.value = agent
}

function closeTabOnly() {
    if (closing.value) close(closing.value)
    closing.value = null
}

async function confirmDelete() {
    const agent = closing.value
    const project = activeProject.value
    if (!agent || !project) return
    const list = tabs.value
    const index = list.findIndex(a => a.id === agent.id)
    const neighbour = list[index + 1] ?? list[index - 1]
    const wasActive = isActive(agent)

    deleteError.value = ''
    try {
        await removeAgent.mutateAsync(agent.id)
    } catch (err) {
        deleteError.value = err instanceof Error ? err.message : 'Failed to delete agent'
        return
    }
    close(agent)
    layout.agentContainerRefs.delete(agent.id)
    closing.value = null

    if (!wasActive) return
    if (neighbour) select(neighbour)
    else router.visit(`/${project.slug}`)
}
</script>

<template>
    <nav aria-label="Sessions" class="flex items-stretch min-w-0 flex-1">
        <div role="tablist" class="flex items-stretch min-w-0 overflow-x-auto [scrollbar-width:none]">
            <div
                v-for="agent in tabs"
                :key="agent.id"
                data-testid="session-tab"
                :class="tabClass(isActive(agent))"
                :title="agent.name"
                @click="select(agent)"
            >
                <span
                    data-testid="session-tab-dot"
                    :data-state="tabState(agent)"
                    :class="['w-[7px] h-[7px] rounded-full shrink-0', DOT_CLASS[tabState(agent)]]"
                />
                <button
                    type="button"
                    role="tab"
                    :aria-selected="isActive(agent)"
                    class="truncate bg-transparent border-0 p-0 text-inherit cursor-pointer"
                >
                    {{ agent.name }}
                </button>
                <button
                    v-if="!isPm(agent)"
                    type="button"
                    data-testid="session-tab-close"
                    :aria-label="`Close ${agent.name} tab`"
                    title="Close tab"
                    :class="[closeButtonClass, isActive(agent) ? 'visible' : 'invisible group-hover:visible']"
                    @click.stop="requestClose(agent)"
                >
                    <Icon name="x" :size="11" />
                </button>
                <span v-else class="w-1" />
            </div>

            <div
                v-for="tab in fileTabs"
                :key="`file:${tab.path}`"
                data-testid="editor-tab"
                :data-dirty="tab.dirty"
                :data-save-status="saveStatus(tab)"
                :class="tabClass(isFileActive(tab))"
                :title="tab.path"
                @click="editor.activate(tab.projectId, tab.path)"
            >
                <Icon name="file-text" :size="12" class="shrink-0 text-accent" />
                <button
                    type="button"
                    role="tab"
                    :aria-selected="isFileActive(tab)"
                    class="truncate bg-transparent border-0 p-0 text-inherit cursor-pointer"
                >
                    {{ tab.name }}
                </button>
                <button
                    type="button"
                    data-testid="editor-tab-close"
                    :aria-label="`Close ${tab.name}`"
                    :title="tab.dirty ? SAVE_STATUS_LABEL[saveStatus(tab)] : 'Close file'"
                    :class="[closeButtonClass, isFileActive(tab) || tab.dirty ? 'visible' : 'invisible group-hover:visible']"
                    @click.stop="editor.close(tab.projectId, tab.path)"
                >
                    <!-- The unsaved dot turns into the close cross on hover, as in most editors. -->
                    <span v-if="tab.dirty" :class="['w-2 h-2 rounded-full group-hover:hidden', SAVE_DOT_CLASS[saveStatus(tab)]]" />
                    <Icon name="x" :size="11" :class="tab.dirty && 'hidden group-hover:block'" />
                </button>
            </div>

            <div
                v-for="tab in diffTabs"
                :key="`diff:${tab.id}`"
                data-testid="diff-tab"
                :class="tabClass(isDiffActive(tab))"
                :title="diffTitle(tab)"
                @click="diffs.activate(tab)"
            >
                <FileDiff :size="12" class="shrink-0 text-accent" />
                <button
                    type="button"
                    role="tab"
                    :aria-selected="isDiffActive(tab)"
                    class="truncate bg-transparent border-0 p-0 text-inherit cursor-pointer"
                >
                    {{ tab.name }} <span class="text-zinc-400">({{ tab.staged ? 'Index' : 'Working Tree' }})</span>
                </button>
                <button
                    type="button"
                    data-testid="diff-tab-close"
                    :aria-label="`Close diff of ${tab.name}`"
                    title="Close diff"
                    :class="[closeButtonClass, isDiffActive(tab) ? 'visible' : 'invisible group-hover:visible']"
                    @click.stop="diffs.close(tab.target.projectId, tab.id)"
                >
                    <Icon name="x" :size="11" />
                </button>
            </div>
        </div>

        <div v-if="activeProject" class="shrink-0 flex items-center ml-1">
            <AgentAddModal>
                <template #trigger>
                    <button
                        type="button"
                        tabindex="-1"
                        aria-label="New agent"
                        title="New agent"
                        class="w-6 h-6 flex items-center justify-center rounded-md text-zinc-400 cursor-pointer hover:text-zinc-800 hover:bg-black/[0.05]"
                    >
                        <Icon name="plus" :size="14" />
                    </button>
                </template>
            </AgentAddModal>
        </div>

        <ConfirmDeleteAgentModal
            v-if="closing"
            :agent-name="closing.name"
            :pending="removeAgent.isLoading.value"
            :error="deleteError"
            close-only
            @cancel="closing = null"
            @close-only="closeTabOnly"
            @confirm="confirmDelete"
        />
    </nav>
</template>
