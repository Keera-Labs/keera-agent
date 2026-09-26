import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { isMuted, useFileTree, type FileEntry, type TreeRow } from './useFileTree'

const dir = (path: string): FileEntry => ({ name: path.split('/').pop()!, path, type: 'dir' })
const file = (path: string): FileEntry => ({ name: path.split('/').pop()!, path, type: 'file' })

let listing: Record<string, FileEntry[]>
let status: Record<string, number>
const fetchMock = vi.fn((url: string) => {
    const path = new URL(url, 'http://x').searchParams.get('path') ?? ''
    const entries = listing[path]
    return Promise.resolve(entries
        ? { ok: true, status: 200, json: () => Promise.resolve({ path, entries, truncated: path === 'big' }) }
        : { ok: false, status: status[path] ?? 404, json: () => Promise.resolve({}) })
})

beforeEach(() => {
    listing = {
        '': [dir('.venv'), dir('app'), dir('config'), file('README.md')],
        app: [dir('app/__pycache__'), dir('app/controllers'), file('app/tasks.py')],
        'app/controllers': [file('app/controllers/admin_controller.py')],
    }
    status = {}
    fetchMock.mockClear()
    vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

const names = (rows: TreeRow[]) =>
    rows.map(r => `${'  '.repeat(r.depth)}${r.kind === 'entry' ? r.entry.name : `[${r.text}]`}`)

async function loadedTree() {
    const tree = useFileTree(7)
    await tree.refresh()
    return tree
}

describe('useFileTree', () => {
    it('loads the project root from the files endpoint', async () => {
        const tree = await loadedTree()
        expect(fetchMock).toHaveBeenCalledWith('/api/projects/7/files?path=')
        expect(names(tree.visibleRows('', false))).toEqual(['.venv', 'app', 'config', 'README.md'])
    })

    it('fetches a folder only on its first expand and collapses it on the next toggle', async () => {
        const tree = await loadedTree()
        tree.toggle(dir('app'))
        await flushPromises()
        expect(fetchMock).toHaveBeenLastCalledWith('/api/projects/7/files?path=app')
        expect(names(tree.visibleRows('', false))).toEqual([
            '.venv', 'app', '  __pycache__', '  controllers', '  tasks.py', 'config', 'README.md',
        ])

        tree.toggle(dir('app'))
        tree.toggle(dir('app'))
        await flushPromises()
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('ignores toggles on files', async () => {
        const tree = await loadedTree()
        tree.toggle(file('README.md'))
        await flushPromises()
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('shows an inline error row under a folder whose listing fails', async () => {
        status.config = 403
        const tree = await loadedTree()
        tree.toggle(dir('config'))
        await flushPromises()
        expect(names(tree.visibleRows('', false))).toEqual(['.venv', 'app', 'config', '  [Permission denied]', 'README.md'])
    })

    it('adds a notice row after a truncated listing', async () => {
        listing[''] = [dir('big')]
        listing.big = [file('big/a.txt'), file('big/b.txt')]
        const tree = await loadedTree()
        tree.toggle(dir('big'))
        await flushPromises()
        expect(names(tree.visibleRows('', false))).toEqual(['big', '  a.txt', '  b.txt', '  [Showing first 2 entries]'])
    })

    it('filters by name and opens loaded folders that contain a match', async () => {
        const tree = await loadedTree()
        tree.toggle(dir('app'))
        await flushPromises()
        tree.toggle(dir('app/controllers'))
        await flushPromises()
        tree.toggle(dir('app'))

        expect(names(tree.visibleRows('ADMIN', false))).toEqual(['app', '  controllers', '    admin_controller.py'])
        expect(tree.visibleRows('nothing-matches', false)).toEqual([])
    })

    it('hides dot and ignored entries when asked', async () => {
        const tree = await loadedTree()
        tree.toggle(dir('app'))
        await flushPromises()
        expect(names(tree.visibleRows('', true))).toEqual(['app', '  controllers', '  tasks.py', 'config', 'README.md'])
    })

    it('reports a root failure', async () => {
        listing = {}
        const tree = await loadedTree()
        expect(tree.rootError.value).toBe('Folder not found')
    })

    it('refresh reloads open folders and flags ones that vanished', async () => {
        const tree = await loadedTree()
        tree.toggle(dir('app'))
        await flushPromises()
        tree.toggle(dir('app/controllers'))
        await flushPromises()

        listing.app = [file('app/tasks.py')]
        delete listing['app/controllers']
        await tree.refresh()

        expect(names(tree.visibleRows('', false))).toEqual(['.venv', 'app', '  tasks.py', 'config', 'README.md'])
        expect(fetchMock).toHaveBeenLastCalledWith('/api/projects/7/files?path=app%2Fcontrollers')
    })
})

describe('isMuted', () => {
    it('mutes dot entries and conventionally ignored folders', () => {
        expect(isMuted('.claude')).toBe(true)
        expect(isMuted('__pycache__')).toBe(true)
        expect(isMuted('node_modules')).toBe(true)
        expect(isMuted('app')).toBe(false)
    })
})
