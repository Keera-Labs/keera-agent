<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useProjectStore } from '@/stores/projectStore'
import ProjectOverview from './ProjectOverview.vue'

// Agents view rendered by ProjectLayout while no agent is drilled into. The
// off-screen terminal holder the React version also kept here now lives in AppLayout.
const { activeProject } = storeToRefs(useProjectStore())
</script>

<template>
    <div class="flex-1 overflow-hidden flex">
        <ProjectOverview v-if="activeProject" :project="activeProject" />
    </div>
</template>
