import { useQueryCache } from '@pinia/colada'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { REMOTE_CONTROL_QUERY_KEY, saveRemoteControl, useRemoteControlSetting } from '@/queries/remoteControlQuery'
import type { SaveState } from '@/stores/editorSettingsStore'

/** Draft of Claude's "Remote Control for all sessions" toggle, saved by the Settings modal footer. */
export const useRemoteControlSettingsStore = defineStore('remoteControlSettings', () => {
    const queryCache = useQueryCache()
    const query = useRemoteControlSetting()
    // Null while unedited, so the toggle follows the saved value when the query refetches.
    const draft = ref<boolean | null>(null)
    const saveState = ref<SaveState>('idle')
    const error = ref('')

    const saved = computed(() => query.data.value ?? false)
    const enabled = computed(() => draft.value ?? saved.value)
    const dirty = computed(() => draft.value !== null && draft.value !== saved.value)
    const loadError = computed(() => query.error.value?.message ?? '')
    const ready = computed(() => query.data.value !== undefined)

    function setEnabled(value: boolean) {
        draft.value = value
    }

    async function save() {
        if (!dirty.value) return
        saveState.value = 'saving'
        error.value = ''
        try {
            queryCache.setQueryData(REMOTE_CONTROL_QUERY_KEY, await saveRemoteControl(enabled.value))
            draft.value = null
            saveState.value = 'saved'
        } catch (e) {
            error.value = e instanceof Error ? e.message : 'Network error'
            saveState.value = 'error'
        } finally {
            await queryCache.invalidateQueries({ key: REMOTE_CONTROL_QUERY_KEY })
        }
    }

    function discard() {
        draft.value = null
        saveState.value = 'idle'
        error.value = ''
    }

    // Claude's own /config can flip the value, so the tab re-reads it each time it opens.
    const refresh = () => query.refetch()

    return { enabled, ready, loadError, dirty, saveState, error, setEnabled, save, discard, refresh }
})
