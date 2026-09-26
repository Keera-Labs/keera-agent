// @vitest-environment happy-dom
import { useQueryCache } from '@pinia/colada'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installPinia } from '@/pages/agents/testing'
import { gitKeys, type GitDiff } from '@/queries/gitQuery'
import { useDiffStore } from '@/stores/diffStore'
import { useEditorSettingsStore } from '@/stores/editorSettingsStore'
import { useProjectStore } from '@/stores/projectStore'
import type { Project } from '@/types/type'
import DiffPane from './DiffPane.vue'

vi.mock('@inertiajs/vue3', () => ({ router: { on: vi.fn(() => () => {}) } }))

const monaco = vi.hoisted(() => {
    const models: { value: string; language: string | undefined; uri: string; disposed: boolean }[] = []
    const editor = { setModel: vi.fn(), updateOptions: vi.fn(), dispose: vi.fn() }
    const createDiffEditor = vi.fn((_host: HTMLElement, _options: Record<string, unknown>) => editor)
    return { models, editor, createDiffEditor }
})

vi.mock('@/editor/monaco', () => ({
    EDITOR_THEME: 'vs',
    loadMonaco: () => Promise.resolve({
        Uri: { from: ({ scheme, path }: { scheme: string; path: string }) => `${scheme}:${path}` },
        editor: {
            createDiffEditor: monaco.createDiffEditor,
            createModel: (value: string, language: string | undefined, uri: string) => {
                const model = { value, language, uri, disposed: false, getValue: () => value, dispose: () => { model.disposed = true } }
                monaco.models.push(model)
                return model
            },
        },
    }),
}))

const PROJECT = { id: 1, name: 'shop', slug: 'shop' } as Project
const MAIN = { projectId: 1, worktree: null }

const diffBody = (overrides: Partial<GitDiff> = {}): GitDiff => ({
    path: 'src/promo.ts',
    original_path: null,
    status: 'M',
    staged: false,
    original: 'const rate = 0.1\n',
    modified: 'const rate = 0.2\n',
    binary: false,
    too_large: false,
    language: 'typescript',
    ...overrides,
})

let reply: () => { status: number; body: unknown }
const fetchMock = vi.fn((_url: string, _init?: RequestInit) => {
    const { status, body } = reply()
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })
})

beforeEach(() => {
    monaco.models.length = 0
    monaco.createDiffEditor.mockClear()
    Object.values(monaco.editor).forEach(fn => fn.mockClear())
    fetchMock.mockClear()
    reply = () => ({ status: 200, body: diffBody() })
    vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

async function mountPane(path = 'src/promo.ts', staged = false, worktreeLabel: string | null = null) {
    const wrapper = mount(DiffPane, { global: { plugins: [...installPinia()] }, attachTo: document.body })
    useProjectStore().setActiveProject(PROJECT)
    useDiffStore().open(MAIN, path, staged, worktreeLabel)
    await flushPromises()
    return wrapper
}

describe('DiffPane', () => {
    it('applies a newly saved editor font to the open diff', async () => {
        await mountPane()
        const settings = useEditorSettingsStore()

        settings.saved = { font_family: 'fira-code', font_size: 15 }
        await flushPromises()

        expect(monaco.editor.updateOptions).toHaveBeenCalledWith(settings.font)
        expect(settings.font.fontSize).toBe(15)
    })

    it('renders both sides side by side with the file\'s language', async () => {
        const w = await mountPane()

        expect(fetchMock).toHaveBeenCalledWith('/api/projects/1/git/diff?path=src%2Fpromo.ts&staged=false', expect.anything())
        expect(w.get('[data-testid="diff-path"]').text()).toBe('src/promo.ts')
        expect(w.get('[data-testid="diff-compared"]').text()).toBe('Index ↔ Working tree')
        expect(monaco.createDiffEditor.mock.calls[0][1]).toMatchObject({
            readOnly: true, originalEditable: false, renderSideBySide: true, ...useEditorSettingsStore().font,
        })
        expect(monaco.models.map(m => [m.value, m.language])).toEqual([
            ['const rate = 0.1\n', 'typescript'],
            ['const rate = 0.2\n', 'typescript'],
        ])
        expect(monaco.editor.setModel).toHaveBeenLastCalledWith({ original: monaco.models[0], modified: monaco.models[1] })
    })

    it('compares HEAD with the index for a staged file and names another worktree', async () => {
        const w = await mountPane('src/promo.ts', true, 'Diff Frontend')
        expect(fetchMock).toHaveBeenCalledWith('/api/projects/1/git/diff?path=src%2Fpromo.ts&staged=true', expect.anything())
        expect(w.get('[data-testid="diff-compared"]').text()).toBe('HEAD ↔ Index')
        expect(w.text()).toContain('Diff Frontend')
    })

    it('switches between side-by-side and inline', async () => {
        const w = await mountPane()

        await w.get('[data-testid="diff-inline"]').trigger('click')
        expect(monaco.editor.updateOptions).toHaveBeenLastCalledWith({ renderSideBySide: false })
        expect(w.get('[data-testid="diff-inline"]').attributes('aria-pressed')).toBe('true')

        await w.get('[data-testid="diff-side-by-side"]').trigger('click')
        expect(monaco.editor.updateOptions).toHaveBeenLastCalledWith({ renderSideBySide: true })
    })

    it.each([
        [{ status: 'A', original: null, modified: 'new' }, 'New file'],
        [{ status: 'D', original: 'old', modified: null }, 'Deleted file'],
        [{ status: 'R', original_path: 'src/discount.ts' }, 'Renamed from src/discount.ts'],
        [{ status: 'U' }, 'Merge conflict: the working file is compared with HEAD.'],
    ] as const)('explains a %o diff', async (overrides, notice) => {
        reply = () => ({ status: 200, body: diffBody(overrides as Partial<GitDiff>) })
        const w = await mountPane()
        expect(w.get('[data-testid="diff-notice"]').text()).toBe(`· ${notice}`)
    })

    it('shows an empty side for a new file', async () => {
        reply = () => ({ status: 200, body: diffBody({ status: 'A', original: null, modified: 'new' }) })
        await mountPane()
        expect(monaco.models.map(m => m.value)).toEqual(['', 'new'])
    })

    it.each([
        [{ binary: true, original: null, modified: null }, 'Binary file: no text diff to show.'],
        [{ too_large: true, original: null, modified: null }, 'File too large to diff (over 1 MB).'],
    ] as const)('shows a placeholder instead of the editor for %o', async (overrides, text) => {
        reply = () => ({ status: 200, body: diffBody(overrides) })
        const w = await mountPane()
        expect(w.get('[data-testid="diff-placeholder"]').text()).toBe(text)
        expect(monaco.models).toHaveLength(0)
        expect(monaco.editor.setModel).toHaveBeenLastCalledWith(null)
    })

    it('shows loading until the diff arrives', async () => {
        let resolve!: () => void
        fetchMock.mockImplementationOnce(() => new Promise(r => {
            resolve = () => r({ ok: true, status: 200, json: () => Promise.resolve(diffBody()) })
        }))
        const w = mount(DiffPane, { global: { plugins: [...installPinia()] } })
        useProjectStore().setActiveProject(PROJECT)
        useDiffStore().open(MAIN, 'src/promo.ts', false)
        await flushPromises()
        expect(w.find('[data-testid="diff-loading"]').exists()).toBe(true)

        resolve()
        await flushPromises()
        expect(w.find('[data-testid="diff-loading"]').exists()).toBe(false)
    })

    it('shows a git failure and retries it', async () => {
        reply = () => ({ status: 409, body: { detail: 'fatal: bad revision' } })
        const w = await mountPane()
        expect(w.get('[data-testid="diff-error"]').text()).toContain('fatal: bad revision')

        reply = () => ({ status: 200, body: diffBody() })
        await w.get('[data-testid="diff-error"] button').trigger('click')
        await flushPromises()
        expect(w.find('[data-testid="diff-error"]').exists()).toBe(false)
        expect(monaco.models).toHaveLength(2)
    })

    it('closes the tab and re-reads the status when the file left that list', async () => {
        reply = () => ({ status: 404, body: { detail: 'No unstaged changes for src/promo.ts' } })
        mount(DiffPane, { global: { plugins: [...installPinia()] } })
        const invalidate = vi.spyOn(useQueryCache(), 'invalidateQueries')
        useProjectStore().setActiveProject(PROJECT)
        useDiffStore().open(MAIN, 'src/promo.ts', false)
        await flushPromises()

        expect(useDiffStore().projectTabs).toEqual([])
        expect(invalidate).toHaveBeenCalledWith({ key: gitKeys.status(MAIN), exact: true })
    })

    it('disposes the editor and its models on unmount', async () => {
        const w = await mountPane()
        w.unmount()
        expect(monaco.editor.dispose).toHaveBeenCalled()
        expect(monaco.models.every(m => m.disposed)).toBe(true)
    })
})
