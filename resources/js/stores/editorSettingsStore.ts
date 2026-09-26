import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { applyTerminalFont } from '@/composables/useTerminalSessions'
import { clampFontSize, fontStack, type FontFamilyId } from '@/editor/fonts'

export interface FileTreeFilters {
    hide_hidden: boolean
    hide_ignored: boolean
    /** gitignore-style globs, one per entry; "build/" matches folders only. */
    hidden_patterns: string[]
}

export interface EditorSettings extends FileTreeFilters {
    font_family: FontFamilyId
    font_size: number
}

interface EditorSettingsAttributes extends EditorSettings {
    customized: boolean
}

export const EDITOR_SETTINGS_URL = '/api/settings/editor'

const DEFAULTS: EditorSettings = {
    font_family: 'dank-mono',
    font_size: 13,
    hide_hidden: false,
    hide_ignored: false,
    hidden_patterns: [],
}

const copy = (s: EditorSettings): EditorSettings => ({ ...s, hidden_patterns: [...s.hidden_patterns] })

const cleanPatterns = (patterns: string[]) => patterns.map(p => p.trim()).filter(Boolean)

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
    const saved = ref<EditorSettings>(copy(DEFAULTS))
    const draft = ref<EditorSettings>(copy(DEFAULTS))
    // Until the user picks a font the terminal keeps its own, larger size.
    const customized = ref(false)
    const saveState = ref<SaveState>('idle')
    const error = ref('')

    const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(saved.value))

    const font = computed(() => ({
        fontFamily: fontStack(saved.value.font_family),
        fontSize: saved.value.font_size,
    }))

    const fileFilters = computed<FileTreeFilters>(() => ({
        hide_hidden: saved.value.hide_hidden,
        hide_ignored: saved.value.hide_ignored,
        hidden_patterns: saved.value.hidden_patterns,
    }))

    function accept(attrs: EditorSettingsAttributes) {
        saved.value = {
            font_family: attrs.font_family,
            font_size: attrs.font_size,
            hide_hidden: attrs.hide_hidden,
            hide_ignored: attrs.hide_ignored,
            hidden_patterns: attrs.hidden_patterns,
        }
        draft.value = copy(saved.value)
        customized.value = attrs.customized
    }

    async function load() {
        try {
            accept(await request())
        } catch {
            // The defaults stay in effect; the modal shows the error on save.
        }
    }

    async function persist(values: EditorSettings) {
        saveState.value = 'saving'
        error.value = ''
        try {
            accept(await request({
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...values,
                    font_size: clampFontSize(values.font_size),
                    hidden_patterns: cleanPatterns(values.hidden_patterns),
                }),
            }))
            saveState.value = 'saved'
        } catch (e) {
            error.value = e instanceof Error ? e.message : String(e)
            saveState.value = 'error'
        }
    }

    const save = () => persist(draft.value)

    /** One-click filter change from the file explorer, saved straight away. */
    const setFileFilters = (filters: Partial<FileTreeFilters>) => persist({ ...saved.value, ...filters })

    function discard() {
        draft.value = copy(saved.value)
        saveState.value = 'idle'
        error.value = ''
    }

    watch([font, customized], ([next, custom]) => { if (custom) applyTerminalFont(next) })

    return { saved, draft, customized, saveState, error, dirty, font, fileFilters, load, save, setFileFilters, discard }
})
