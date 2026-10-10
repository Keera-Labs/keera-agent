import type * as Monaco from 'monaco-editor'
import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { MonacoApi } from '@/editor/monaco'
import { selectLines, type EditorSide, type LineSelection } from './lineSelection'

type CodeEditor = Monaco.editor.ICodeEditor

export interface PopoverAnchor {
    top: number
    left: number
    width: number
}

const POPOVER_HEIGHT = 168
const POPOVER_MAX_WIDTH = 640
const GAP = 4

export function useLineSelection(container: Ref<HTMLElement | null>) {
    const selection = ref<LineSelection | null>(null)
    const anchor = ref<PopoverAnchor | null>(null)
    const dragging = ref(false)

    let monaco: MonacoApi | null = null
    let editors: Partial<Record<EditorSide, CodeEditor>> = {}
    let decorations: Monaco.editor.IEditorDecorationsCollection | null = null
    let disposables: Monaco.IDisposable[] = []

    function isLineNumberTarget(target: Monaco.editor.IMouseTarget) {
        const types = monaco!.editor.MouseTargetType
        return target.type === types.GUTTER_LINE_NUMBERS || target.type === types.GUTTER_LINE_DECORATIONS
    }

    function listen(side: EditorSide, editor: CodeEditor) {
        disposables.push(
            editor.onMouseDown(e => {
                const line = e.target.position?.lineNumber
                if (!line || !isLineNumberTarget(e.target)) return
                selection.value = selectLines(selection.value, side, line, e.event.shiftKey)
                dragging.value = true
            }),
            editor.onDidScrollChange(updateAnchor),
            editor.onDidLayoutChange(updateAnchor),
        )
    }

    function extendWhileDragging(e: MouseEvent) {
        const current = selection.value
        const editor = current && editors[current.side]
        if (!dragging.value || !current || !editor) return
        const line = editor.getTargetAtClientPoint(e.clientX, e.clientY)?.position?.lineNumber
        if (!line) return
        const next = selectLines(current, current.side, line, true)
        if (next.start !== current.start || next.end !== current.end) selection.value = next
    }

    function stopDragging() {
        if (!dragging.value) return
        dragging.value = false
        const current = selection.value
        if (current) editors[current.side]?.setPosition({ lineNumber: current.start, column: 1 })
    }

    function attach(api: MonacoApi, sides: Partial<Record<EditorSide, CodeEditor>>) {
        monaco = api
        editors = sides
        for (const [side, editor] of Object.entries(sides) as [EditorSide, CodeEditor][]) listen(side, editor)
        window.addEventListener('mousemove', extendWhileDragging)
        window.addEventListener('mouseup', stopDragging)
    }

    function renderDecorations(current: LineSelection | null) {
        decorations?.clear()
        decorations = null
        const editor = current && editors[current.side]
        if (!current || !editor || !monaco) return
        decorations = editor.createDecorationsCollection([{
            range: new monaco.Range(current.start, 1, current.end, 1),
            options: {
                isWholeLine: true,
                className: 'ask-lines-row',
                marginClassName: 'ask-lines-margin',
                lineNumberClassName: 'ask-lines-number',
            },
        }])
    }

    function updateAnchor() {
        const current = selection.value
        const host = container.value
        const editor = current && editors[current.side]
        const node = editor?.getDomNode()
        if (!current || !editor || !node || !monaco || !host) {
            anchor.value = null
            return
        }
        const hostRect = host.getBoundingClientRect()
        const editorRect = node.getBoundingClientRect()
        const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight)
        const scrollTop = editor.getScrollTop()
        const editorTop = editorRect.top - hostRect.top
        const below = editorTop + editor.getTopForLineNumber(current.end) + lineHeight - scrollTop + GAP
        const above = editorTop + editor.getTopForLineNumber(current.start) - scrollTop - POPOVER_HEIGHT - GAP
        const fitsBelow = below + POPOVER_HEIGHT <= hostRect.height
        const top = fitsBelow || above < 0 ? Math.min(below, hostRect.height - POPOVER_HEIGHT) : above
        const editorLeft = editorRect.left - hostRect.left
        const left = editorLeft + Math.max(GAP, editor.getLayoutInfo().contentLeft - 24)
        const width = Math.min(POPOVER_MAX_WIDTH, editorLeft + editorRect.width - left - 16)
        anchor.value = { top: Math.max(0, top), left, width }
    }

    watch(selection, current => {
        renderDecorations(current)
        updateAnchor()
    })

    function clear() {
        selection.value = null
        dragging.value = false
    }

    function onKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape' && selection.value) clear()
    }

    window.addEventListener('keydown', onKeydown)

    onBeforeUnmount(() => {
        window.removeEventListener('mousemove', extendWhileDragging)
        window.removeEventListener('mouseup', stopDragging)
        window.removeEventListener('keydown', onKeydown)
        disposables.forEach(disposable => disposable.dispose())
        disposables = []
        decorations = null
        editors = {}
    })

    return { selection, anchor, dragging, attach, clear }
}
