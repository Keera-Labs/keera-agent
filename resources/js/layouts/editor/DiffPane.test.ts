// @vitest-environment happy-dom
import { useQueryCache } from '@pinia/colada'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installPinia } from '@/pages/agents/testing'
import { gitKeys, type GitDiff } from '@/queries/gitQuery'
import { useDiffStore, type DiffTabOptions } from '@/stores/diffStore'
import { useEditorSettingsStore } from '@/stores/editorSettingsStore'
import { useProjectStore } from '@/stores/projectStore'
import type { Project } from '@/types/type'
import DiffPane from './DiffPane.vue'

vi.mock('@inertiajs/vue3', () => ({ router: { on: vi.fn(() => () => {}) } }))

const monaco = vi.hoisted(() => {
    const models: { value: string; language: string | undefined; uri: string; disposed: boolean }[] = []
    type MouseHandler = (e: unknown) => void
    const sideEditor = () => {
        const mouseDown: MouseHandler[] = []
        const noop = () => ({ dispose: () => {} })
        return {
            mouseDown,
            onMouseDown: (fn: MouseHandler) => { mouseDown.push(fn); return { dispose: () => {} } },
            onDidScrollChange: noop,
            onDidLayoutChange: noop,
            createDecorationsCollection: () => ({ clear: () => {} }),
            getDomNode: () => document.createElement('div'),
            getOption: () => 18,
            getScrollTop: () => 0,
            getTopForLineNumber: (line: number) => (line - 1) * 18,
            getLayoutInfo: () => ({ contentLeft: 60 }),
            setPosition: () => {},
            getTargetAtClientPoint: () => null,
        }
    }
    const sides = { original: sideEditor(), modified: sideEditor() }
    const editor = {
        setModel: vi.fn(),
        updateOptions: vi.fn(),
        dispose: vi.fn(),
        getModel: vi.fn(),
        getLineChanges: vi.fn(),
        getOriginalEditor: () => sides.original,
        getModifiedEditor: () => sides.modified,
    }
    const createDiffEditor = vi.fn((_host: HTMLElement, _options: Record<string, unknown>) => editor)
    return { models, editor, sides, createDiffEditor }
})

vi.mock('@/editor/monaco', () => ({
    EDITOR_THEME: 'github-light',
    loadMonaco: () => Promise.resolve({
        Range: class { constructor(public startLineNumber: number) {} },
        Uri: { from: ({ scheme, path }: { scheme: string; path: string }) => `${scheme}:${path}` },
        editor: {
            MouseTargetType: { GUTTER_LINE_NUMBERS: 3, GUTTER_LINE_DECORATIONS: 4 },
            EditorOption: { lineHeight: 0 },
            createDiffEditor: monaco.createDiffEditor,
            createModel: (value: string, language: string | undefined, uri: string) => {
                const model = {
                    value, language, uri, disposed: false,
                    getValue: () => value,
                    getLinesContent: () => value.split('\n'),
                    dispose: () => { model.disposed = true },
                }
                monaco.models.push(model)
                return model
            },
        },
    }),
}))

vi.mock('@/editor/markdown', async importOriginal => ({
    ...await importOriginal<typeof import('@/editor/markdown')>(),
    renderMarkdown: (source: string) => `<h1>${source.replace(/^#\s*/, '').trim()}</h1>`,
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

const PM = { data: { type: 'agents', id: '9', attributes: { name: 'Project Manager' } } }

let reply: () => { status: number; body: unknown }
let worktrees: unknown[] = []
let triggerReply: () => { status: number; body: unknown }
const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
    const { status, body } = url.endsWith('/default-agent')
        ? { status: 200, body: PM }
        : url.endsWith('/worktrees')
            ? { status: 200, body: { worktrees } }
            : url.endsWith('/trigger') ? triggerReply() : reply()
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })
})

beforeEach(() => {
    monaco.models.length = 0
    monaco.createDiffEditor.mockClear()
    Object.values(monaco.editor).forEach(fn => vi.isMockFunction(fn) && fn.mockReset())
    monaco.sides.original.mouseDown.length = 0
    monaco.sides.modified.mouseDown.length = 0
    fetchMock.mockClear()
    reply = () => ({ status: 200, body: diffBody() })
    worktrees = []
    triggerReply = () => ({ status: 200, body: { data: { type: 'agents', id: '9' } } })
    vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

async function mountPane(path = 'src/promo.ts', staged = false, options: DiffTabOptions = {}, target: typeof MAIN | { projectId: number; worktree: string } = MAIN) {
    const wrapper = mount(DiffPane, { global: { plugins: [...installPinia()] }, attachTo: document.body })
    useProjectStore().setActiveProject(PROJECT)
    useDiffStore().open(target, path, staged, options)
    await flushPromises()
    return wrapper
}

describe('DiffPane', () => {
    it('loads a committed diff and names its merge-base comparison', async () => {
        const w = await mountPane('src/promo.ts', false, { committed: true })
        expect(fetchMock).toHaveBeenCalledWith('/api/projects/1/git/diff?path=src%2Fpromo.ts&staged=false&committed=true', expect.anything())
        expect(w.get('[data-testid="diff-compared"]').text()).toBe('Merge base ↔ HEAD')
    })

    it('applies a newly saved editor font to the open diff', async () => {
        await mountPane()
        const settings = useEditorSettingsStore()

        settings.saved = { font_family: 'fira-code', font_size: 15, hide_hidden: false, hide_ignored: false, hidden_patterns: [] }
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
        const w = await mountPane('src/promo.ts', true, { worktreeLabel: 'Diff Frontend' })
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
        [{ status: 'C', original_path: 'src/discount.ts' }, 'Copied from src/discount.ts'],
        [{ status: 'U' }, 'Merge conflict: the working file is compared with HEAD.'],
    ] as const)('explains a %o diff', async (overrides, notice) => {
        reply = () => ({ status: 200, body: diffBody(overrides as Partial<GitDiff>) })
        const w = await mountPane()
        expect(w.get('[data-testid="diff-notice"]').text()).toBe(`· ${notice}`)
    })

    it('calls an untracked file new, not a merge conflict, although both report U', async () => {
        reply = () => ({ status: 200, body: diffBody({ status: 'U', original: null, modified: 'new' }) })
        const w = await mountPane('src/promo.test.ts', false, { untracked: true })
        expect(w.get('[data-testid="diff-notice"]').text()).toBe('· New file')
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

    describe('markdown preview', () => {
        beforeEach(() => window.localStorage.clear())

        it('offers no Code/Preview toggle for other files', async () => {
            const w = await mountPane()
            expect(w.find('[data-testid="markdown-view-toggle"]').exists()).toBe(false)
        })

        it('shows the diff first and previews the current contents on demand', async () => {
            reply = () => ({ status: 200, body: diffBody({ path: 'README.md', original: '# Old\n', modified: '# New\n', language: 'markdown' }) })
            const w = await mountPane('README.md')

            expect(w.find('[data-testid="markdown-view-code"]').attributes('aria-pressed')).toBe('true')
            expect(w.find('[data-testid="markdown-preview"]').exists()).toBe(false)

            await w.find('[data-testid="markdown-view-preview"]').trigger('click')

            expect(w.find('[data-testid="markdown-preview"]').text()).toBe('New')
            expect(w.find('[data-testid="diff-side-by-side"]').exists()).toBe(false)
            expect(window.localStorage.getItem('keera.markdownView.changes')).toBe('preview')
        })
    })

    describe('asking the agent about selected lines', () => {
        async function selectLine(line: number, shiftKey = false) {
            const [original, modified] = monaco.models.slice(-2)
            monaco.editor.getModel.mockReturnValue({ original, modified })
            monaco.sides.modified.mouseDown.forEach(fn => fn({ target: { type: 3, position: { lineNumber: line } }, event: { shiftKey } }))
            await flushPromises()
        }

        const triggerCalls = () => fetchMock.mock.calls.filter(([url]) => url.endsWith('/trigger'))

        beforeEach(() => {
            reply = () => ({ status: 200, body: diffBody({ original: 'a\nb\nc', modified: 'a\nB\nc' }) })
            monaco.editor.getLineChanges.mockReturnValue([
                { originalStartLineNumber: 2, originalEndLineNumber: 2, modifiedStartLineNumber: 2, modifiedEndLineNumber: 2 },
            ] as never)
        })

        it('opens a popover for a clicked line range addressed to the owning agent', async () => {
            const w = await mountPane()
            await selectLine(1)
            await selectLine(2, true)

            expect(w.get('[data-testid="ask-lines-label"]').text()).toBe('Lines 1–2')
            expect(w.get('[data-testid="ask-lines-question"]').attributes('placeholder')).toBe('Ask Project Manager about these lines…')
            expect(w.get('[data-testid="ask-lines-send"]').attributes('disabled')).toBeDefined()
        })

        it('sends the file, the diffed lines and the question to the agent', async () => {
            const w = await mountPane()
            await selectLine(2)
            await w.get('[data-testid="ask-lines-question"]').setValue('Why upper case?')
            await w.get('[data-testid="ask-lines-send"]').trigger('click')
            await flushPromises()

            const [url, init] = triggerCalls()[0]
            expect(url).toBe('/api/agents/9/trigger')
            expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' })
            const { message } = JSON.parse(String(init?.body))
            expect(message).toContain('File: src/promo.ts')
            expect(message).toContain('```diff\n-b\n+B\n```')
            expect(message).toContain('Why upper case?')
            expect(w.get('[data-testid="ask-lines-sent"]').text()).toContain('Sent to Project Manager')
        })

        it('says the agent is starting when it had no live session', async () => {
            triggerReply = () => ({ status: 200, body: { status: 'starting', message: 'Agent is starting up...' } })
            const w = await mountPane()
            await selectLine(2)
            await w.get('[data-testid="ask-lines-question"]').setValue('Why?')
            await w.get('[data-testid="ask-lines-send"]').trigger('click')
            await flushPromises()

            expect(w.find('[data-testid="ask-lines-sent"]').exists()).toBe(false)
            expect(w.get('[data-testid="ask-lines-started"]').text()).toBe('Starting Project Manager with your question')
        })

        it('addresses the agent that owns the viewed worktree', async () => {
            const tree = '/repo/.claude/worktrees/agent-7'
            worktrees = [{ path: tree, agent_id: 7, agent_name: 'UI Polish Engineer' }]
            const w = await mountPane('src/promo.ts', false, {}, { projectId: 1, worktree: tree })
            await selectLine(2)

            expect(w.get('[data-testid="ask-lines-question"]').attributes('placeholder')).toBe('Ask UI Polish Engineer about these lines…')
        })

        it('falls back to the default agent when the worktree names no agent of this project', async () => {
            const tree = '/repo/.claude/worktrees/agent-404'
            worktrees = [{ path: tree, agent_id: 404, agent_name: null }]
            const w = await mountPane('src/promo.ts', false, {}, { projectId: 1, worktree: tree })
            await selectLine(2)
            await w.get('[data-testid="ask-lines-question"]').setValue('Why?')
            await w.get('[data-testid="ask-lines-send"]').trigger('click')
            await flushPromises()

            expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/trigger')).map(([url]) => url)).toEqual(['/api/agents/9/trigger'])
        })

        it('reports a failed send', async () => {
            triggerReply = () => ({ status: 400, body: { error: 'Agent is not running' } })
            const w = await mountPane()
            await selectLine(2)
            await w.get('[data-testid="ask-lines-question"]').setValue('Why?')
            await w.get('[data-testid="ask-lines-send"]').trigger('click')
            await flushPromises()

            expect(w.get('[data-testid="ask-lines-error"]').text()).toBe('Agent is not running')
        })

        it('closes the popover on Escape', async () => {
            const w = await mountPane()
            await selectLine(2)
            await w.get('[data-testid="ask-lines-question"]').trigger('keydown', { key: 'Escape' })

            expect(w.find('[data-testid="ask-lines-popover"]').exists()).toBe(false)
        })
    })
})
