<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { useProjectStore } from '@/stores/projectStore'
import FileExplorer from './FileExplorer.vue'

const { rightPanelOpen } = storeToRefs(useAppLayoutStore())
const { activeProject } = storeToRefs(useProjectStore())
</script>

<template>
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
