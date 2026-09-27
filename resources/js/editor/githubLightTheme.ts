import type { editor } from 'monaco-editor'

/**
 * Mirrors VS Code's "GitHub Light Default" theme using Primer's light
 * palette, so the in-app editor matches the colors most contributors
 * already read code in on github.com.
 */
export const githubLightTheme: editor.IStandaloneThemeData = {
    base: 'vs',
    inherit: true,
    rules: [
        { token: 'comment', foreground: '6e7781' },
        { token: 'keyword', foreground: 'cf222e' },
        { token: 'string', foreground: '0a3069' },
        { token: 'regexp', foreground: '0a3069' },
        { token: 'number', foreground: '0550ae' },
        { token: 'constant', foreground: '0550ae' },
        { token: 'type', foreground: '8250df' },
        { token: 'type.identifier', foreground: '8250df' },
        { token: 'function', foreground: '8250df' },
        { token: 'tag', foreground: '116329' },
        { token: 'attribute.name', foreground: '0550ae' },
        { token: 'attribute.value', foreground: '0a3069' },
        { token: 'delimiter', foreground: '24292f' },
        { token: 'identifier', foreground: '24292f' },
    ],
    colors: {
        'editor.foreground': '#24292f',
        'editor.background': '#ffffff',
        'editorLineNumber.foreground': '#8c959f',
        'editorLineNumber.activeForeground': '#24292f',
        'editor.selectionBackground': '#0969da33',
        'editorCursor.foreground': '#0969da',
        'editor.lineHighlightBackground': '#eaeef280',
        'editorIndentGuide.background1': '#d0d7de',
        'editorIndentGuide.activeBackground1': '#d0d7de',
        'diffEditor.insertedLineBackground': '#dafbe1',
        'diffEditor.removedLineBackground': '#ffebe9',
        'diffEditor.insertedTextBackground': '#aceebb',
        'diffEditor.removedTextBackground': '#ffcecb',
    },
}
