<script setup lang="ts">
import { computed } from 'vue'
import CommandsPanel from '@/components/commands/CommandsPanel.vue'
import { placeLabel } from '@/composables/useViewedWorktree'
import { useGitWorktrees } from '@/queries/gitQuery'
import { useCommandRunStore } from '@/stores/commandRunStore'

const props = defineProps<{ project: string; project_id: number | null }>()

const runs = useCommandRunStore()
const worktreesQuery = useGitWorktrees(() => props.project_id)
const linkedWorktrees = computed(() => (worktreesQuery.data.value ?? []).filter(w => !w.prunable && !w.is_current))

const selected = computed({
    get: () => (props.project_id === null ? '' : (runs.selectedWorktrees[props.project_id] ?? '')),
    set: (path: string) => {
        if (props.project_id !== null) runs.selectedWorktrees[props.project_id] = path || null
    },
})
</script>

<template>
    <div v-if="project_id === null" class="flex-1 flex items-center justify-center">
        <span class="text-zinc-400 text-ui-13">Project not found</span>
    </div>
    <CommandsPanel v-else :project-id="project_id">
        <template #toolbar>
            <label class="flex items-center gap-1.5 text-ui-11 text-zinc-500">
                Run in
                <select
                    v-model="selected"
                    data-testid="command-worktree-select"
                    class="h-6 rounded border border-stroke bg-white text-ui-11 text-zinc-700 px-1"
                >
                    <option value="">root</option>
                    <option v-for="w in linkedWorktrees" :key="w.path" :value="w.path">
                        {{ placeLabel(w) }}{{ w.branch ? ` (${w.branch})` : '' }}
                    </option>
                </select>
            </label>
        </template>
    </CommandsPanel>
</template>
