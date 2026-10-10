export type EditorSide = 'original' | 'modified'

export interface LineSelection {
    side: EditorSide
    anchor: number
    start: number
    end: number
}

export interface LineChange {
    originalStartLineNumber: number
    originalEndLineNumber: number
    modifiedStartLineNumber: number
    modifiedEndLineNumber: number
}

export function selectLines(current: LineSelection | null, side: EditorSide, line: number, extend: boolean): LineSelection {
    const anchor = extend && current?.side === side ? current.anchor : line
    return { side, anchor, start: Math.min(anchor, line), end: Math.max(anchor, line) }
}

export function linesLabel({ start, end }: LineSelection): string {
    return start === end ? `Line ${start}` : `Lines ${start}–${end}`
}

export function codeSnippet({ start, end }: LineSelection, lines: string[]): string {
    return lines.slice(start - 1, end).join('\n')
}

const hasOriginalLines = (change: LineChange) => change.originalEndLineNumber > 0
const hasModifiedLines = (change: LineChange) => change.modifiedEndLineNumber > 0

function within(line: number, start: number, end: number) {
    return line >= start && line <= end
}

function removedLines(change: LineChange, original: string[]): string[] {
    if (!hasOriginalLines(change)) return []
    return original
        .slice(change.originalStartLineNumber - 1, change.originalEndLineNumber)
        .map(text => `-${text}`)
}

function originalSnippet({ start, end }: LineSelection, original: string[], changes: LineChange[]): string[] {
    const removed = (line: number) =>
        changes.some(c => hasOriginalLines(c) && within(line, c.originalStartLineNumber, c.originalEndLineNumber))
    const lines: string[] = []
    for (let line = start; line <= end; line++) lines.push(`${removed(line) ? '-' : ' '}${original[line - 1] ?? ''}`)
    return lines
}

function modifiedSnippet({ start, end }: LineSelection, original: string[], modified: string[], changes: LineChange[]): string[] {
    const added = (line: number) =>
        changes.some(c => hasModifiedLines(c) && within(line, c.modifiedStartLineNumber, c.modifiedEndLineNumber))
    const lines: string[] = []
    for (let line = start; line <= end; line++) {
        for (const change of changes) {
            if (hasModifiedLines(change) && change.modifiedStartLineNumber === line) lines.push(...removedLines(change, original))
        }
        lines.push(`${added(line) ? '+' : ' '}${modified[line - 1] ?? ''}`)
        for (const change of changes) {
            if (!hasModifiedLines(change) && change.modifiedStartLineNumber === line && line < end) {
                lines.push(...removedLines(change, original))
            }
        }
    }
    return lines
}

export function diffSnippet(selection: LineSelection, original: string[], modified: string[], changes: LineChange[]): string {
    const lines = selection.side === 'original'
        ? originalSnippet(selection, original, changes)
        : modifiedSnippet(selection, original, modified, changes)
    return lines.join('\n')
}

export interface AgentQuestion {
    path: string
    worktree: string | null
    selection: LineSelection
    snippet: string
    question: string
    diff?: boolean
    language?: string | null
}

const PASTE_MARKER = /\x1b\[20[01]~/g
const LINE_BREAK = /\r\n?/g
const UNPASTEABLE = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g

function withoutPasteMarkers(text: string): string {
    const stripped = text.replace(PASTE_MARKER, '')
    return stripped === text ? text : withoutPasteMarkers(stripped)
}

export function pasteSafe(text: string): string {
    return withoutPasteMarkers(text).replace(LINE_BREAK, '\n').replace(UNPASTEABLE, '')
}

export function agentQuestionMessage(request: AgentQuestion): string {
    return pasteSafe(questionText(request))
}

function questionText({ path, worktree, selection, snippet, question, diff = false, language = null }: AgentQuestion): string {
    const label = linesLabel(selection)
    const side = selection.side === 'original' ? ' (before the change)' : ' (after the change)'
    return [
        `Question from the user about ${path} ${label.toLowerCase()}`,
        '',
        `File: ${path}`,
        ...(worktree ? [`Worktree: ${worktree}`] : []),
        `${label}${diff ? side : ''}`,
        '',
        `\`\`\`${diff ? 'diff' : language ?? ''}`,
        snippet,
        '```',
        '',
        question.trim(),
    ].join('\n')
}
