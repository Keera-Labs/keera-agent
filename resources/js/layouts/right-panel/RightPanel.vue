<script setup lang="ts">
import { storeToRefs } from 'pinia'
import Icon, { type IconName } from '@/components/ui/Icon.vue'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { useProjectStore } from '@/stores/projectStore'
import FileExplorer from './FileExplorer.vue'

// Only Files has a view today; the other slots mirror the reference layout and stay inert until theirs ship.
const VIEWS: { icon: IconName; label: string; ready: boolean }[] = [
    { icon: 'files', label: 'Files', ready: true },
    { icon: 'layout-grid', label: 'Overview (coming soon)', ready: false },
    { icon: 'git-branch', label: 'Source control (coming soon)', ready: false },
    { icon: 'list', label: 'Outline (coming soon)', ready: false },
]

const { rightPanelOpen } = storeToRefs(useAppLayoutStore())
const { activeProject } = storeToRefs(useProjectStore())

const iconButtonClass = 'w-6 h-6 flex items-center justify-center rounded-md transition-colors'
</script>

<template>
    <div data-testid="right-panel-toolbar" class="shrink-0 flex items-center gap-0.5 h-10 px-2 border-b border-stroke">
        <button
            v-for="view in VIEWS"
            :key="view.icon"
            type="button"
            :title="view.label"
            :aria-label="view.label"
            :aria-pressed="view.ready"
            :disabled="!view.ready"
            :class="[iconButtonClass, view.ready ? 'text-zinc-800 bg-black/[0.06]' : 'text-zinc-400 cursor-default']"
        >
            <Icon :name="view.icon" :size="14" />
        </button>
        <button
            type="button"
            data-testid="toggle-panel-right"
            aria-label="Hide right panel"
            title="Hide right panel"
            :class="[iconButtonClass, 'ml-auto text-zinc-500 cursor-pointer hover:bg-black/[0.05] hover:text-zinc-800']"
            @click="rightPanelOpen = false"
        >
            <Icon name="panel-right" :size="14" />
        </button>
    </div>

    <!-- Mounted on first open, then kept alive per project so each tree keeps its expanded folders. -->
    <KeepAlive :max="8">
        <FileExplorer v-if="rightPanelOpen && activeProject" :key="activeProject.id" :project="activeProject" />
    </KeepAlive>
    <div
        v-if="!activeProject"
        data-testid="right-panel-empty"
        class="flex-1 flex items-center justify-center px-6 text-center text-zinc-400 text-[13px]"
    >
        Select a project to browse files
    </div>
</template>
