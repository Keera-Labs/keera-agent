import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { applyTerminalFont } from '@/composables/useTerminalSessions'
import { clampFontSize, fontStack, type FontFamilyId } from '@/editor/fonts'

export interface EditorSettings {
    font_family: FontFamilyId
    font_size: number
}

interface EditorSettingsAttributes extends EditorSettings {
    customized: boolean
}

export const EDITOR_SETTINGS_URL = '/api/settings/editor'

const DEFAULTS: EditorSettings = { font_family: 'dank-mono', font_size: 13 }

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

async function request(init?: RequestInit): Promise<EditorSettingsAttributes> {
    const res = await fetch(EDITOR_SETTINGS_URL, init)
    if (!res.ok) throw new Error(`Failed to ${init?.method === 'PATCH' ? 'save' : 'load'} editor settings`)
    return (await res.json()).data.attributes
}

/**
 * `saved` is what the editor and terminal render with; `draft` is what the
 * Settings modal edits and previews until the user saves or discards it.
 */
export const useEditorSettingsStore = defineStore('editorSettings', () => {
    const saved = ref<EditorSettings>({ ...DEFAULTS })
    const draft = ref<EditorSettings>({ ...DEFAULTS })
    // Until the user picks a font the terminal keeps its own, larger size.
    const customized = ref(false)
    const saveState = ref<SaveState>('idle')
    const error = ref('')

    const dirty = computed(() =>
        draft.value.font_family !== saved.value.font_family || draft.value.font_size !== saved.value.font_size,
    )

    const font = computed(() => ({
        fontFamily: fontStack(saved.value.font_family),
        fontSize: saved.value.font_size,
    }))

    function accept(attrs: EditorSettingsAttributes) {
        saved.value = { font_family: attrs.font_family, font_size: attrs.font_size }
        draft.value = { ...saved.value }
        customized.value = attrs.customized
    }

    async function load() {
        try {
            accept(await request())
        } catch {
            // The defaults stay in effect; the modal shows the error on save.
        }
    }

    async function save() {
        saveState.value = 'saving'
        error.value = ''
        try {
            accept(await request({
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...draft.value, font_size: clampFontSize(draft.value.font_size) }),
            }))
            saveState.value = 'saved'
        } catch (e) {
            error.value = e instanceof Error ? e.message : String(e)
            saveState.value = 'error'
        }
    }

    function discard() {
        draft.value = { ...saved.value }
        saveState.value = 'idle'
        error.value = ''
    }

    watch([font, customized], ([next, custom]) => { if (custom) applyTerminalFont(next) })

    return { saved, draft, customized, saveState, error, dirty, font, load, save, discard }
})
