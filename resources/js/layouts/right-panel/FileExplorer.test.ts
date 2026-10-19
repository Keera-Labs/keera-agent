// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, KeepAlive, ref } from 'vue'
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

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

let wrapper: VueWrapper | undefined

afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
})

async function mountExplorer(plugins = installPinia()) {
    wrapper = mount(FileExplorer, { props: { project }, attachTo: document.body, global: { plugins: [...plugins] } })
    await flushPromises()
    return wrapper
}

function openTabs(...paths: string[]) {
    useProjectStore().setActiveProject(project)
    const editor = useEditorStore()
    editor.tabsByProject[project.id] = paths.map(path => ({
        projectId: project.id, path, name: path.split('/').pop()!, etag: 'e', dirty: false, saving: false, conflict: false, error: null,
    }))
    return editor
}

function layoutTree(rowTops: Record<string, number>) {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        if (!this.isConnected) return new DOMRect()
        if (this.getAttribute('role') === 'tree') return new DOMRect(0, 0, 200, 100)
        return new DOMRect(0, (rowTops[this.dataset.path ?? ''] ?? 0) - this.closest('[role="tree"]')!.scrollTop, 200, 28)
    })
    return rowTops
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
        const rowTops = layoutTree({ 'README.md': 20, 'app/tasks.py': 60 })
        const plugins = installPinia()
        const editor = openTabs('README.md', 'app/tasks.py')
        const w = await mountExplorer(plugins)
        const list = w.get('[role="tree"]').element

        editor.activate(project.id, 'README.md')
        await flushPromises()
        expect(w.get('[role="treeitem"][aria-selected="true"]').text()).toBe('README.md')
        expect(list.scrollTop).toBe(0)

        editor.activate(project.id, 'app/tasks.py')
        await flushPromises()
        rowTops['README.md'] = 400
        editor.activate(project.id, 'README.md')
        await flushPromises()
        expect(list.scrollTop).toBe(400)
    })

    it('expands the collapsed folders around the active file and scrolls it into view', async () => {
        layoutTree({ 'app/tasks.py': 400 })
        const plugins = installPinia()
        const editor = openTabs('app/tasks.py')
        const w = await mountExplorer(plugins)
        expect(rowTexts(w)).toEqual(['.venv', 'app', 'README.md'])

        editor.activate(project.id, 'app/tasks.py')
        await flushPromises()

        expect(rowTexts(w)).toEqual(['.venv', 'app', 'tasks.py', 'README.md'])
        expect(w.get('[role="treeitem"][aria-selected="true"]').text()).toBe('tasks.py')
        expect(w.get('[role="tree"]').element.scrollTop).toBe(400)
    })

    it('reveals a file already active on first open once the slower root listing arrives, fetching each folder once', async () => {
        layoutTree({ 'app/tasks.py': 400 })
        let releaseRoot = () => {}
        const rootArrived = new Promise<void>(resolve => { releaseRoot = resolve })
        const fetchMock = vi.fn((url: string, init?: RequestInit): Promise<unknown> => {
            const isRoot = (new URL(url, 'http://x').searchParams.get('path') ?? '') === ''
            return isRoot ? rootArrived.then((): unknown => fakeFetch(url, init)) : fakeFetch(url, init)
        })
        vi.stubGlobal('fetch', fetchMock)
        const plugins = installPinia()
        openTabs('app/tasks.py').activate(project.id, 'app/tasks.py')

        const w = await mountExplorer(plugins)
        releaseRoot()
        await flushPromises()

        expect(rowTexts(w)).toEqual(['.venv', 'app', 'tasks.py', 'README.md'])
        expect(w.get('[role="tree"]').element.scrollTop).toBe(400)
        const listedPaths = fetchMock.mock.calls.map(([url]) => new URL(url, 'http://x').searchParams.get('path'))
        expect(listedPaths.sort()).toEqual(['', 'app'])
    })

    it('scrolls to a file activated while the explorer was hidden once it is shown again', async () => {
        layoutTree({ 'README.md': 20, 'app/tasks.py': 400 })
        const plugins = installPinia()
        const editor = openTabs('README.md', 'app/tasks.py')
        const shown = ref(true)
        const Host = defineComponent(() => () => h(KeepAlive, null, [shown.value ? h(FileExplorer, { project }) : h('p', 'other view')]))
        wrapper = mount(Host, { attachTo: document.body, global: { plugins: [...plugins] } })
        await flushPromises()
        const list = wrapper.get('[role="tree"]').element

        shown.value = false
        await flushPromises()
        editor.activate(project.id, 'app/tasks.py')
        await flushPromises()
        expect(list.scrollTop).toBe(0)

        shown.value = true
        await flushPromises()
        expect(wrapper.get('[role="treeitem"][aria-selected="true"]').text()).toBe('tasks.py')
        expect(list.scrollTop).toBe(400)
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
