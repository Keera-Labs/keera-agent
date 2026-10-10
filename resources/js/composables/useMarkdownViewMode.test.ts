// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMarkdownViewMode } from './useMarkdownViewMode'

beforeEach(() => window.localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('useMarkdownViewMode', () => {
    it('starts from the viewer default and remembers the choice per viewer', async () => {
        const files = useMarkdownViewMode('files', 'preview')
        expect(files.value).toBe('preview')

        files.value = 'code'
        await nextTick()

        expect(useMarkdownViewMode('files', 'preview').value).toBe('code')
        expect(useMarkdownViewMode('changes', 'preview').value).toBe('preview')
    })

    it('ignores an unknown stored value', () => {
        window.localStorage.setItem('keera.markdownView.changes', 'split')

        expect(useMarkdownViewMode('changes', 'code').value).toBe('code')
    })

    it('keeps working when storage is unavailable', async () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })

        const mode = useMarkdownViewMode('files', 'preview')
        mode.value = 'code'
        await nextTick()

        expect(mode.value).toBe('code')
    })
})
