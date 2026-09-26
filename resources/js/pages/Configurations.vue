<script setup lang="ts">
import CommandsPanel from '@/pages/configurations/CommandsPanel.vue'
import type { Command } from '@/pages/configurations/types'

// Commands arrive as props on every visit, so the panel never has an initial fetch to fail.
defineProps<{ project: string; project_id: number | null; commands?: Command[] }>()
</script>

<template>
    <div v-if="project_id === null" class="flex-1 flex items-center justify-center">
        <span class="text-zinc-400 text-[13px]">Project not found</span>
    </div>
    <CommandsPanel
        v-else
        :project-id="project_id"
        :project-slug="project"
        :initial-commands="commands ?? []"
    />
</template>
