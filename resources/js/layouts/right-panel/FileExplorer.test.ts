// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { installPinia } from '@/pages/agents/testing'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'
import type { Project } from '@/types/type'
import FileExplorer from './FileExplorer.vue'

vi.mock('@inertiajs/vue3', () => ({ router: { on: vi.fn(() => () => {}) } }))

const project = { id: 3, name: 'salut-ai', path: '/code/salut-ai' } as Project

const listing: Record<string, unknown[]> = {
    '': [
        { name: '.venv', path: '.venv', type: 'dir' },
        { name: 'app', path: 'app', type: 'dir' },
        { name: 'README.md', path: 'README.md', type: 'file' },
    ],
    app: [{ name: 'tasks.py', path: 'app/tasks.py', type: 'file' }],
}

// Stands in for the backend, which drops dotfiles once the saved filters say so.
let hideHidden = false
let settingsBody: Record<string, unknown> | undefined

function fakeFetch(url: string, init?: RequestInit) {
    if (url === '/api/settings/editor') {
        settingsBody = JSON.parse(String(init?.body ?? '{}'))
        hideHidden = settingsBody!.hide_hidden === true
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: { attributes: { ...settingsBody, customized: true } } }) })
    }
    const path = new URL(url, 'http://x').searchParams.get('path') ?? ''
    const entries = (listing[path] as { name: string }[]).filter(e => !(hideHidden && e.name.startsWith('.')))
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ path, entries, truncated: false }) })
}

beforeEach(() => {
    hideHidden = false
    settingsBody = undefined
    vi.stubGlobal('fetch', vi.fn(fakeFetch))
    // happy-dom has no FontFaceSet; any settings save re-applies the terminal font through it.
    Object.defineProperty(document, 'fonts', { value: { load: () => Promise.resolve([]) }, configurable: true })
})

afterEach(() => vi.unstubAllGlobals())

async function mountExplorer() {
    const wrapper = mount(FileExplorer, { props: { project }, global: { plugins: [...installPinia()] } })
    await flushPromises()
    return wrapper
}

const rowTexts = (w: Awaited<ReturnType<typeof mountExplorer>>) => w.findAll('[role="treeitem"]').map(r => r.text())

describe('FileExplorer', () => {
    it('shows the root entries, dotfiles included', async () => {
        const w = await mountExplorer()
        expect(rowTexts(w)).toEqual(['.venv', 'app', 'README.md'])
    })

    it('dims conventionally ignored folders only', async () => {
        const w = await mountExplorer()
        const [venv, app] = w.findAll('[role="treeitem"]')
        expect(venv.classes()).toContain('text-zinc-400')
        expect(venv.find('[aria-label="ignored"]').exists()).toBe(true)
        expect(app.classes()).not.toContain('text-zinc-400')
    })

    it('highlights the selected row in amber', async () => {
        const w = await mountExplorer()
        vi.spyOn(useEditorStore(), 'open').mockResolvedValue()
        await w.findAll('[role="treeitem"]')[2].trigger('click')
        expect(w.get('[role="treeitem"][aria-selected="true"]').classes()).toEqual(
            expect.arrayContaining(['bg-amber-100/80!', 'font-semibold']),
        )
    })

    it('selects the active file and scrolls it to the top only when it is out of view', async () => {
        const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
        const w = await mountExplorer()
        useProjectStore().setActiveProject(project)
        const editor = useEditorStore()
        const list = w.get('[role="tree"]').element
        vi.spyOn(list, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 100))
        const readme = w.findAll('[role="treeitem"]')[2].element
        const rowAt = (top: number) => vi.spyOn(readme, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, top, 200, 28))
        const tab = { projectId: project.id, name: 'README.md', etag: 'e', dirty: false, saving: false, conflict: false, error: null }
        editor.tabsByProject[project.id] = [{ ...tab, path: 'README.md' }, { ...tab, path: 'app/tasks.py', name: 'tasks.py' }]

        rowAt(20)
        editor.activate(project.id, 'README.md')
        await flushPromises()
        expect(w.get('[role="treeitem"][aria-selected="true"]').text()).toBe('README.md')
        expect(scrollIntoView).not.toHaveBeenCalled()

        editor.activate(project.id, 'app/tasks.py')
        await flushPromises()
        rowAt(400)
        editor.activate(project.id, 'README.md')
        await flushPromises()
        expect(scrollIntoView).toHaveBeenCalledTimes(1)
        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
        scrollIntoView.mockRestore()
    })

    it('expands the collapsed folders around the active file and scrolls it into view', async () => {
        const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
        const w = await mountExplorer()
        useProjectStore().setActiveProject(project)
        const editor = useEditorStore()
        vi.spyOn(w.get('[role="tree"]').element, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 100))
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 400, 200, 28))
        editor.tabsByProject[project.id] = [
            { projectId: project.id, path: 'app/tasks.py', name: 'tasks.py', etag: 'e', dirty: false, saving: false, conflict: false, error: null },
        ]
        expect(rowTexts(w)).toEqual(['.venv', 'app', 'README.md'])

        editor.activate(project.id, 'app/tasks.py')
        await flushPromises()

        expect(rowTexts(w)).toEqual(['.venv', 'app', 'tasks.py', 'README.md'])
        expect(w.get('[role="treeitem"][aria-selected="true"]').text()).toBe('tasks.py')
        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
        vi.restoreAllMocks()
    })

    it('collapses every open folder at once', async () => {
        const w = await mountExplorer()
        await w.findAll('[role="treeitem"]')[1].trigger('click')
        await flushPromises()
        expect(rowTexts(w)).toContain('tasks.py')

        await w.get('[data-testid="collapse-all"]').trigger('click')
        expect(rowTexts(w)).toEqual(['.venv', 'app', 'README.md'])
    })

    it('selects a clicked row and lazily expands folders', async () => {
        const w = await mountExplorer()
        const app = w.findAll('[role="treeitem"]')[1]
        await app.trigger('click')
        await flushPromises()

        expect(rowTexts(w)).toEqual(['.venv', 'app', 'tasks.py', 'README.md'])
        const selected = w.findAll('[role="treeitem"][aria-selected="true"]')
        expect(selected.map(r => r.text())).toEqual(['app'])
        expect(selected[0].attributes('aria-expanded')).toBe('true')
    })

    it('filters the tree by the Go to file input', async () => {
        const w = await mountExplorer()
        await w.get('input[aria-label="Go to file"]').setValue('read')
        expect(rowTexts(w)).toEqual(['README.md'])

        await w.get('input[aria-label="Go to file"]').setValue('zzz')
        expect(w.text()).toContain('No matching files')
    })

    it('opens the first matching file on Enter, matching whole paths once the query has a slash', async () => {
        const w = await mountExplorer()
        await w.findAll('[role="treeitem"]')[1].trigger('click')
        await flushPromises()
        const open = vi.spyOn(useEditorStore(), 'open').mockResolvedValue()

        const input = w.get('input[aria-label="Go to file"]')
        await input.setValue('app/ta')
        expect(rowTexts(w)).toEqual(['app', 'tasks.py'])
        await input.trigger('keydown', { key: 'Enter' })

        expect(open).toHaveBeenCalledWith(3, 'app/tasks.py')
    })

    it('saves the hide filters from the funnel and reloads the tree', async () => {
        const w = await mountExplorer()
        const funnel = w.get('button[title="Hide hidden and ignored files"]')
        await funnel.trigger('click')
        await flushPromises()

        expect(settingsBody).toMatchObject({ hide_hidden: true, hide_ignored: true })
        expect(rowTexts(w)).toEqual(['app', 'README.md'])
        expect(w.get('button[title="Show hidden and ignored files"]').attributes('aria-pressed')).toBe('true')
    })

    it('opens a clicked file in the editor', async () => {
        const w = await mountExplorer()
        const open = vi.spyOn(useEditorStore(), 'open').mockResolvedValue()
        await w.findAll('[role="treeitem"]')[2].trigger('click')

        expect(open).toHaveBeenCalledWith(3, 'README.md')
    })

    it('shows why a file could not be opened, for this project only', async () => {
        const w = await mountExplorer()
        const editor = useEditorStore()
        editor.openError = { projectId: 99, path: 'x.bin', message: 'File is not UTF-8 text' }
        await flushPromises()
        expect(w.find('[data-testid="file-open-error"]').exists()).toBe(false)

        editor.openError = { projectId: 3, path: 'data/x.bin', message: 'File is not UTF-8 text' }
        await flushPromises()
        expect(w.get('[data-testid="file-open-error"]').text()).toContain("Can't open x.bin: File is not UTF-8 text")
    })
})
