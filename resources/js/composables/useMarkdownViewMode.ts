import { ref, watch, type Ref } from 'vue'

export type MarkdownViewMode = 'code' | 'preview'

const storageKey = (viewer: string) => `keera.markdownView.${viewer}`

function loadMode(viewer: string, fallback: MarkdownViewMode): MarkdownViewMode {
    try {
        const stored = window.localStorage.getItem(storageKey(viewer))
        return stored === 'code' || stored === 'preview' ? stored : fallback
    } catch {
        return fallback
    }
}

function saveMode(viewer: string, mode: MarkdownViewMode) {
    try {
        window.localStorage.setItem(storageKey(viewer), mode)
    } catch {
        return
    }
}

export function useMarkdownViewMode(viewer: 'files' | 'changes', fallback: MarkdownViewMode): Ref<MarkdownViewMode> {
    const mode = ref<MarkdownViewMode>(loadMode(viewer, fallback))
    watch(mode, next => saveMode(viewer, next))
    return mode
}
