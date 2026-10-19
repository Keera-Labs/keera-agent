<script setup lang="ts">
import { storeToRefs } from 'pinia'
import CommandsPanel from '@/components/commands/CommandsPanel.vue'
import { useProjectStore } from '@/stores/projectStore'

const { activeProject } = storeToRefs(useProjectStore())
</script>

<template>
    <div v-if="!activeProject" data-testid="commands-no-project" class="flex-1 flex items-center justify-center">
        <span class="text-zinc-400 text-ui-13">Open a project to manage its commands.</span>
    </div>
    <CommandsPanel v-else :key="activeProject.id" :project-id="activeProject.id" />
</template>
