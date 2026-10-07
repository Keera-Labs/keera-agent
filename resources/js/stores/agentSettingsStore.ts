import { router } from '@inertiajs/vue3'
import { defineStore, storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import type { SaveState } from '@/stores/editorSettingsStore'

export const MIN_AGENTS = 1
export const MAX_AGENTS = 100

export const clampMaxAgents = (value: number) =>
    Math.min(MAX_AGENTS, Math.max(MIN_AGENTS, Math.round(value) || MIN_AGENTS))

/** Draft of the global agent limit, saved by the Settings modal footer. */
export const useAgentSettingsStore = defineStore('agentSettings', () => {
    const { maxAgentsPerProject } = storeToRefs(useAppLayoutStore())
    // Null while unedited, so the field follows the saved limit when it reloads from props.
    const draft = ref<number | null>(null)
    const saveState = ref<SaveState>('idle')
    const error = ref('')

    const maxAgents = computed(() => draft.value ?? maxAgentsPerProject.value)
    const dirty = computed(() => draft.value !== null && draft.value !== maxAgentsPerProject.value)

    function setMaxAgents(value: number) {
        draft.value = clampMaxAgents(value)
    }

    async function save() {
        if (!dirty.value) return
        saveState.value = 'saving'
        error.value = ''
        try {
            const res = await fetch('/api/global-settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ max_agents_per_project: maxAgents.value }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(data.error ?? 'Could not save the agent limit')
            // Set immediately so the add-agent limit warning updates before the reload lands.
            maxAgentsPerProject.value = data.max_agents_per_project ?? maxAgents.value
            draft.value = null
            saveState.value = 'saved'
            router.reload({ only: ['global_settings'] })
        } catch (e) {
            error.value = e instanceof Error ? e.message : 'Network error'
            saveState.value = 'error'
        }
    }

    function discard() {
        draft.value = null
        saveState.value = 'idle'
        error.value = ''
    }

    return { maxAgents, dirty, saveState, error, setMaxAgents, save, discard }
})
