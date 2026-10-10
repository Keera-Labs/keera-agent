<script setup lang="ts">
import { usePage } from '@inertiajs/vue3'
import { Diff, FolderClosed, PanelRight, SquareTerminal, Zap, type LucideIcon } from '@lucide/vue'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useAgentWorktreeDefault, useGitWorktree } from '@/composables/useGitWorktree'
import { useRefetchInterval } from '@/composables/useRefetchInterval'
import { useCommandRuns } from '@/queries/commandQuery'
import { useGitStatus } from '@/queries/gitQuery'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { useCommandRunStore } from '@/stores/commandRunStore'
import { useProjectStore } from '@/stores/projectStore'
import CommandsView from './commands/CommandsView.vue'
import FileExplorer from './FileExplorer.vue'
import SourceControl from './source-control/SourceControl.vue'
import TerminalView from './TerminalView.vue'

type ViewId = 'changes' | 'files' | 'terminal' | 'commands'

const VIEWS: { id: ViewId; label: string; icon: LucideIcon }[] = [
    { id: 'changes', label: 'Changes', icon: Diff },
    { id: 'files', label: 'Files', icon: FolderClosed },
    { id: 'terminal', label: 'Terminal', icon: SquareTerminal },
    { id: 'commands', label: 'Commands', icon: Zap },
]

const EMPTY_TEXT: Record<ViewId, string> = {
    changes: 'Select a project to see its changes',
    files: 'Select a project to browse files',
    terminal: 'Select a project to see command output',
    commands: 'Select a project to run its commands',
}

const { rightPanelOpen, activeAgentId } = storeToRefs(useAppLayoutStore())
const { activeProject } = storeToRefs(useProjectStore())
const { dockOpen } = storeToRefs(useCommandRunStore())
const page = usePage()

// The run store asks for the output through `dockOpen` whenever a run is opened, so that flag is the Terminal tab.
const otherView = ref<Exclude<ViewId, 'terminal'>>('changes')
const activeView = computed<ViewId>({
    get: () => (dockOpen.value ? 'terminal' : otherView.value),
    set: view => {
        dockOpen.value = view === 'terminal'
        if (view !== 'terminal') otherView.value = view
    },
})
watch(dockOpen, open => {
    if (open) rightPanelOpen.value = true
})

const projectId = () => activeProject.value?.id ?? null
useAgentWorktreeDefault(projectId, () => (page.component === 'agents/Detail' ? activeAgentId.value : null))
const { target } = useGitWorktree(projectId)
const { changedCount, refetch } = useGitStatus(target)
// Agents edit files behind the panel's back, so the badge re-reads status while visible; focus and mutations cover the rest.
useRefetchInterval(refetch, 30_000, () => rightPanelOpen.value && projectId() !== null)

const { data: commandRuns } = useCommandRuns(projectId)
const anyRunning = computed(() => (commandRuns.value ?? []).some(r => r.status === 'running'))

const badge = computed(() => (changedCount.value > 99 ? '99+' : String(changedCount.value)))

function viewLabel(view: ViewId) {
    if (view === 'changes' && changedCount.value) return `Changes, ${changedCount.value} changed files`
    if (view === 'commands' && anyRunning.value) return 'Commands, running'
    return VIEWS.find(v => v.id === view)!.label
}
</script>

<template>
    <div data-testid="right-panel-toolbar" class="shrink-0 flex items-center gap-2 h-14 px-3 border-b border-stroke">
        <div role="tablist" aria-label="Right panel" class="@container flex-1 min-w-0 flex items-center gap-0.5 p-1 rounded-xl bg-zinc-100">
            <button
                v-for="view in VIEWS"
                :key="view.id"
                type="button"
                role="tab"
                :data-view="view.id"
                :aria-selected="activeView === view.id"
                :aria-label="viewLabel(view.id)"
                :title="view.label"
                :class="[
                    'min-w-0 flex-auto h-8 flex items-center justify-center gap-1.5 px-2 rounded-lg text-ui-13 cursor-pointer transition-colors',
                    activeView === view.id
                        ? 'bg-surface font-semibold text-zinc-900 shadow-sm ring-1 ring-black/[0.06]'
                        : 'text-zinc-500 hover:text-zinc-800',
                ]"
                @click="activeView = view.id"
            >
                <component :is="view.icon" :size="14" class="shrink-0" />
                <!-- Four labelled tabs don't fit the default 380px panel, so inactive tabs fall back to icons until it is widened. -->
                <span :class="['min-w-0 truncate', activeView !== view.id && 'hidden @min-[26rem]:inline']">{{ view.label }}</span>
                <span
                    v-if="view.id === 'changes' && changedCount > 0"
                    data-testid="source-control-badge"
                    class="shrink-0 min-w-5 h-5 px-1.5 flex items-center justify-center rounded-full bg-orange-500 text-white text-ui-11 font-semibold leading-none"
                >{{ badge }}</span>
                <span
                    v-if="view.id === 'commands' && anyRunning"
                    data-testid="commands-running-dot"
                    class="shrink-0 w-1.5 h-1.5 rounded-full bg-orange-500"
                />
            </button>
        </div>
        <button
            type="button"
            data-testid="toggle-panel-right"
            aria-label="Hide right panel"
            title="Hide right panel"
            class="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-zinc-500 cursor-pointer hover:bg-black/[0.05] hover:text-zinc-800"
            @click="rightPanelOpen = false"
        >
            <PanelRight :size="16" />
        </button>
    </div>

    <SourceControl
        v-if="rightPanelOpen && activeProject && activeView === 'changes'"
        :key="activeProject.id"
        :project="activeProject"
    />
    <!-- Mounted on first open, then kept alive per project so each tree keeps its expanded folders. -->
    <KeepAlive :max="8">
        <FileExplorer
            v-if="rightPanelOpen && activeProject && activeView === 'files'"
            :key="activeProject.id"
            :project="activeProject"
        />
    </KeepAlive>
    <!-- Always mounted: the run store parks each live xterm in a host element here. -->
    <TerminalView :visible="!!activeProject && activeView === 'terminal'" />
    <CommandsView v-if="activeProject" :visible="activeView === 'commands'" />
    <div
        v-if="!activeProject"
        data-testid="right-panel-empty"
        class="flex-1 flex items-center justify-center px-6 text-center text-zinc-400 text-ui-13"
    >
        {{ EMPTY_TEXT[activeView] }}
    </div>
</template>
