// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { installPinia } from '@/pages/agents/testing'
import { useEditorStore } from '@/stores/editorStore'
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

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
        const path = new URL(url, 'http://x').searchParams.get('path') ?? ''
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ path, entries: listing[path], truncated: false }) })
    }))
})

afterEach(() => vi.unstubAllGlobals())

async function mountExplorer() {
    const wrapper = mount(FileExplorer, { props: { project }, global: { plugins: [...installPinia()] } })
    await flushPromises()
    return wrapper
}

const rowTexts = (w: Awaited<ReturnType<typeof mountExplorer>>) => w.findAll('[role="treeitem"]').map(r => r.text())

describe('FileExplorer', () => {
    it('shows the project name and its root entries', async () => {
        const w = await mountExplorer()
        expect(w.text()).toContain('salut-ai')
        expect(rowTexts(w)).toEqual(['.venv', 'app', 'README.md'])
    })

    it('styles dot and ignored folders as muted', async () => {
        const w = await mountExplorer()
        const [venv, app] = w.findAll('[role="treeitem"]')
        expect(venv.classes()).toContain('italic')
        expect(venv.find('[aria-label="ignored"]').exists()).toBe(true)
        expect(app.classes()).not.toContain('italic')
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

    it('filters the tree by the Find files input', async () => {
        const w = await mountExplorer()
        await w.get('input[aria-label="Find files"]').setValue('read')
        expect(rowTexts(w)).toEqual(['README.md'])

        await w.get('input[aria-label="Find files"]').setValue('zzz')
        expect(w.text()).toContain('No matching files')
    })

    it('hides dot and ignored entries via the filter button', async () => {
        const w = await mountExplorer()
        await w.get('button[aria-pressed="false"]').trigger('click')
        expect(rowTexts(w)).toEqual(['app', 'README.md'])
    })

    it('keeps content search as a disabled placeholder', async () => {
        const w = await mountExplorer()
        const contents = w.findAll('button').find(b => b.text() === 'Contents')!
        expect(contents.attributes('disabled')).toBeDefined()
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
