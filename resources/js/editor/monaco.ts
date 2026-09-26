import type * as Monaco from 'monaco-editor'

export type MonacoApi = typeof Monaco
export type TextModel = Monaco.editor.ITextModel

// The app only has a light theme so far; a dark theme plugs in here.
export const EDITOR_THEME = 'vs'

let loading: Promise<MonacoApi> | null = null

/** Loads Monaco (a separate chunk, several MB) on first use. */
export function loadMonaco(): Promise<MonacoApi> {
    loading ??= import('./monacoSetup').then(m => m.default)
    return loading
}

/**
 * The URI names the model uniquely per project and lets Monaco pick the
 * language from the file extension.
 */
export function modelUri(monaco: MonacoApi, projectId: number, path: string) {
    return monaco.Uri.from({ scheme: 'file', path: `/project-${projectId}/${path}` })
}
