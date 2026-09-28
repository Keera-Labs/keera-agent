import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { SaveState } from '@/stores/editorSettingsStore'
import {
    applyUiFontSize,
    cacheUiFontSize,
    clampUiFontSize,
    DEFAULT_UI_FONT_SIZE,
    readCachedUiFontSize,
} from '@/utils/uiFontSize'

export const APPEARANCE_SETTINGS_URL = '/api/settings/appearance'

interface AppearanceSettings {
    ui_font_size: number
}

async function request(init?: RequestInit): Promise<AppearanceSettings> {
    const res = await fetch(APPEARANCE_SETTINGS_URL, init)
    if (!res.ok) throw new Error(`Failed to ${init?.method === 'PATCH' ? 'save' : 'load'} appearance settings`)
    return (await res.json()).data.attributes
}

/**
 * Unlike the editor font, the draft UI font size is applied to the whole app
 * while the Settings modal edits it, so the live preview is the app itself;
 * discarding the draft puts the saved size back.
 */
export const useAppearanceSettingsStore = defineStore('appearanceSettings', () => {
    const saved = ref(readCachedUiFontSize())
    const draft = ref(saved.value)
    const saveState = ref<SaveState>('idle')
    const error = ref('')

    const dirty = computed(() => draft.value !== saved.value)
    const isDefault = computed(() => draft.value === DEFAULT_UI_FONT_SIZE)

    function accept(attrs: AppearanceSettings) {
        saved.value = clampUiFontSize(attrs.ui_font_size)
        draft.value = saved.value
        cacheUiFontSize(saved.value)
    }

    async function load() {
        try {
            accept(await request())
        } catch {
            // The cached size stays in effect; the modal shows the error on save.
        }
    }

    async function save() {
        saveState.value = 'saving'
        error.value = ''
        try {
            accept(await request({
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ui_font_size: clampUiFontSize(draft.value) }),
            }))
            saveState.value = 'saved'
        } catch (e) {
            error.value = e instanceof Error ? e.message : String(e)
            saveState.value = 'error'
        }
    }

    function setSize(size: number) {
        draft.value = clampUiFontSize(size)
    }

    const reset = () => setSize(DEFAULT_UI_FONT_SIZE)

    function discard() {
        draft.value = saved.value
        saveState.value = 'idle'
        error.value = ''
    }

    watch(draft, applyUiFontSize, { immediate: true })

    return { saved, draft, saveState, error, dirty, isDefault, load, save, setSize, reset, discard }
})
