<script setup lang="ts">
import { Files, GitBranch, LayoutGrid, List, PanelRight, RefreshCw } from '@lucide/vue'
import { useQueryCache } from '@pinia/colada'
import { storeToRefs } from 'pinia'
import { computed, ref, type Component } from 'vue'
import { useRefetchInterval } from '@/composables/useRefetchInterval'
import { useGitStatus } from '@/queries/gitQuery'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { useProjectStore } from '@/stores/projectStore'
import FileExplorer from './FileExplorer.vue'
import SourceControl from './source-control/SourceControl.vue'

type ViewId = 'files' | 'overview' | 'source-control' | 'outline'

// Overview and Outline mirror the reference layout and stay inert until theirs ship.
const VIEWS: { id: ViewId; icon: Component; label: string; ready: boolean }[] = [
    { id: 'files', icon: Files, label: 'Files', ready: true },
    { id: 'overview', icon: LayoutGrid, label: 'Overview (coming soon)', ready: false },
    { id: 'source-control', icon: GitBranch, label: 'Source control', ready: true },
    { id: 'outline', icon: List, label: 'Outline (coming soon)', ready: false },
]

const EMPTY_TEXT: Partial<Record<ViewId, string>> = {
    files: 'Select a project to browse files',
    'source-control': 'Select a project to see its changes',
}

const { rightPanelOpen } = storeToRefs(useAppLayoutStore())
const { activeProject } = storeToRefs(useProjectStore())
const activeView = ref<ViewId>('files')

const projectId = () => activeProject.value?.id ?? null
const { changedCount, refetch } = useGitStatus(projectId)
// Agents edit files behind the panel's back, so the badge re-reads status while visible; focus and mutations cover the rest.
useRefetchInterval(refetch, 30_000, () => rightPanelOpen.value && projectId() !== null)

const badge = computed(() => (changedCount.value > 99 ? '99+' : String(changedCount.value)))

const queryCache = useQueryCache()
const refreshGit = () => queryCache.invalidateQueries({ key: ['git', projectId()] })

const iconButtonClass = 'h-6 min-w-6 px-1 flex items-center justify-center gap-1 rounded-md transition-colors'
const toolButtonClass = 'text-zinc-500 cursor-pointer hover:bg-black/[0.05] hover:text-zinc-800'
</script>

<template>
    <div data-testid="right-panel-toolbar" class="shrink-0 flex items-center gap-0.5 h-10 px-2 border-b border-stroke">
        <button
            v-for="view in VIEWS"
            :key="view.id"
            type="button"
            :title="view.label"
            :aria-label="view.id === 'source-control' && changedCount ? `${view.label}, ${changedCount} changed files` : view.label"
            :aria-pressed="activeView === view.id"
            :disabled="!view.ready"
            :class="[
                iconButtonClass,
                activeView === view.id
                    ? 'text-zinc-800 bg-black/[0.06]'
                    : view.ready ? toolButtonClass : 'text-zinc-400 cursor-default',
            ]"
            @click="activeView = view.id"
        >
            <component :is="view.icon" :size="14" />
            <span
                v-if="view.id === 'source-control' && changedCount > 0"
                data-testid="source-control-badge"
                class="min-w-4 h-4 px-1 flex items-center justify-center rounded-full bg-orange-400 text-white text-[10px] font-semibold leading-none"
            >{{ badge }}</span>
        </button>
        <div class="ml-auto flex items-center gap-0.5">
            <button
                v-if="activeView === 'source-control' && activeProject"
                type="button"
                data-testid="refresh-source-control"
                aria-label="Refresh source control"
                title="Refresh"
                :class="[iconButtonClass, toolButtonClass]"
                @click="refreshGit"
            >
                <RefreshCw :size="14" />
            </button>
            <button
                type="button"
                data-testid="toggle-panel-right"
                aria-label="Hide right panel"
                title="Hide right panel"
                :class="[iconButtonClass, toolButtonClass]"
                @click="rightPanelOpen = false"
            >
                <PanelRight :size="14" />
            </button>
        </div>
    </div>

    <!-- Mounted on first open, then kept alive per project so each tree keeps its expanded folders. -->
    <KeepAlive :max="8">
        <FileExplorer
            v-if="rightPanelOpen && activeProject && activeView === 'files'"
            :key="activeProject.id"
            :project="activeProject"
        />
    </KeepAlive>
    <SourceControl
        v-if="rightPanelOpen && activeProject && activeView === 'source-control'"
        :key="activeProject.id"
        :project="activeProject"
    />
    <div
        v-if="!activeProject"
        data-testid="right-panel-empty"
        class="flex-1 flex items-center justify-center px-6 text-center text-zinc-400 text-[13px]"
    >
        {{ EMPTY_TEXT[activeView] }}
    </div>
</template>
