<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { ref, watch } from 'vue'
import CommandsPanel from '@/components/commands/CommandsPanel.vue'
import type { Command } from '@/components/commands/types'
import { useProjectStore } from '@/stores/projectStore'

const { activeProject } = storeToRefs(useProjectStore())

const commands = ref<Command[] | null>(null)
const error = ref(false)

watch(
    () => activeProject.value?.id,
    async projectId => {
        commands.value = null
        error.value = false
        if (projectId === undefined) return
        try {
            const res = await fetch(`/api/projects/${projectId}/commands`)
            if (!res.ok) throw new Error(String(res.status))
            const list: Command[] = await res.json()
            // A project switch while the request was in flight makes this response stale.
            if (activeProject.value?.id === projectId) commands.value = list
        } catch {
            if (activeProject.value?.id === projectId) error.value = true
        }
    },
    { immediate: true },
)
</script>

<template>
    <div v-if="!activeProject" data-testid="commands-no-project" class="flex-1 flex items-center justify-center">
        <span class="text-zinc-400 text-ui-13">Open a project to manage its commands.</span>
    </div>
    <div v-else-if="error" data-testid="commands-error" class="flex-1 flex items-center justify-center">
        <span class="text-danger text-ui-13">Could not load commands for {{ activeProject.name }}.</span>
    </div>
    <div v-else-if="commands === null" data-testid="commands-loading" class="flex-1 flex items-center justify-center">
        <span class="text-zinc-400 text-ui-13">Loading commands…</span>
    </div>
    <CommandsPanel
        v-else
        :key="activeProject.id"
        :project-id="activeProject.id"
        :project-slug="activeProject.slug"
        :initial-commands="commands"
    />
</template>
