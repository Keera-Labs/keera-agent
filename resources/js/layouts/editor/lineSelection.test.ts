import { describe, expect, it } from 'vitest'
import { agentQuestionMessage, codeSnippet, diffSnippet, linesLabel, selectLines, type LineChange, type LineSelection } from './lineSelection'

const change = (original: [number, number], modified: [number, number]): LineChange => ({
    originalStartLineNumber: original[0],
    originalEndLineNumber: original[1],
    modifiedStartLineNumber: modified[0],
    modifiedEndLineNumber: modified[1],
})

describe('selectLines', () => {
    it('selects a single clicked line', () => {
        expect(selectLines(null, 'modified', 4, false)).toEqual({ side: 'modified', anchor: 4, start: 4, end: 4 })
    })

    it('extends from the anchor in either direction', () => {
        const first = selectLines(null, 'modified', 5, false)
        expect(selectLines(first, 'modified', 8, true)).toMatchObject({ anchor: 5, start: 5, end: 8 })
        expect(selectLines(first, 'modified', 2, true)).toMatchObject({ anchor: 5, start: 2, end: 5 })
    })

    it('starts over when extending onto the other side', () => {
        const first = selectLines(null, 'original', 5, false)
        expect(selectLines(first, 'modified', 8, true)).toEqual({ side: 'modified', anchor: 8, start: 8, end: 8 })
    })
})

describe('linesLabel', () => {
    it('names one line or a range', () => {
        expect(linesLabel(selectLines(null, 'modified', 3, false))).toBe('Line 3')
        expect(linesLabel({ side: 'modified', anchor: 97, start: 97, end: 98 })).toBe('Lines 97–98')
    })
})

describe('codeSnippet', () => {
    it('returns the selected lines', () => {
        expect(codeSnippet({ side: 'modified', anchor: 2, start: 2, end: 3 }, ['a', 'b', 'c', 'd'])).toBe('b\nc')
    })
})

describe('diffSnippet', () => {
    const original = ['a', 'b', 'c', 'd']
    const modified = ['a', 'B', 'c', 'new', 'd']
    const changes = [change([2, 2], [2, 2]), change([0, 0], [4, 4])]

    it('marks removed lines on the original side', () => {
        expect(diffSnippet({ side: 'original', anchor: 1, start: 1, end: 2 }, original, modified, changes)).toBe(' a\n-b')
    })

    it('shows replaced lines before their additions on the modified side', () => {
        const selection: LineSelection = { side: 'modified', anchor: 1, start: 1, end: 4 }
        expect(diffSnippet(selection, original, modified, changes)).toBe(' a\n-b\n+B\n c\n+new')
    })

    it('includes a pure deletion inside the selection', () => {
        const deleted = [change([2, 3], [1, 0])]
        const selection: LineSelection = { side: 'modified', anchor: 1, start: 1, end: 2 }
        expect(diffSnippet(selection, ['a', 'b', 'c', 'd'], ['a', 'd'], deleted)).toBe(' a\n-b\n-c\n d')
    })
})

describe('agentQuestionMessage', () => {
    const selection: LineSelection = { side: 'modified', anchor: 2, start: 2, end: 3 }

    it('frames a diff question with the file, worktree and side', () => {
        expect(agentQuestionMessage({
            path: 'src/app.ts', worktree: '/repo/.claude/worktrees/agent-7', selection, snippet: '+x', question: '  Why?  ', diff: true,
        })).toBe([
            'Question from the user about src/app.ts lines 2–3',
            '',
            'File: src/app.ts',
            'Worktree: /repo/.claude/worktrees/agent-7',
            'Lines 2–3 (after the change)',
            '',
            '```diff',
            '+x',
            '```',
            '',
            'Why?',
        ].join('\n'))
    })

    it('fences plain code in its language without a worktree line', () => {
        const message = agentQuestionMessage({ path: 'src/app.ts', worktree: null, selection, snippet: 'x', question: 'Why?', language: 'typescript' })
        expect(message).not.toContain('Worktree:')
        expect(message).toContain('Lines 2–3\n\n```typescript\nx\n```')
    })
})
