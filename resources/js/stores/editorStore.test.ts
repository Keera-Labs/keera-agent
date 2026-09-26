// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createApp } from 'vue'
import { PiniaColada } from '@pinia/colada'
import type { Project } from '@/types/type'
import { useEditorStore } from './editorStore'
import { useProjectStore } from './projectStore'

type Handler = (...args: unknown[]) => unknown
const routerHandlers = vi.hoisted(() => new Map<string, Handler>())

vi.mock('@inertiajs/vue3', () => ({
    router: {
        on: (event: string, handler: Handler) => {
            routerHandlers.set(event, handler)
            return () => routerHandlers.delete(event)
        },
    },
}))

class FakeModel {
    version = 1
    listeners: (() => void)[] = []
    disposed = false
    constructor(public value: string, public uri: string) {}
    getValue() { return this.value }
    setValue(value: string) { this.edit(value) }
    edit(value: string) {
        this.value = value
        this.version++
        this.listeners.forEach(l => l())
    }
    getAlternativeVersionId() { return this.version }
    onDidChangeContent(listener: () => void) {
        this.listeners.push(listener)
        return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener) } }
    }
    dispose() { this.disposed = true }
}

const models = vi.hoisted(() => new Map<string, unknown>())

vi.mock('@/editor/monaco', () => ({
    loadMonaco: () => Promise.resolve({
        editor: {
            getModel: (uri: string) => models.get(uri) ?? null,
            createModel: (value: string, _language: undefined, uri: string) => {
                const model = new FakeModel(value, uri)
                models.set(uri, model)
                return model
            },
        },
    }),
    modelUri: (_monaco: unknown, projectId: number, path: string) => `/project-${projectId}/${path}`,
}))

const PROJECT = { id: 1, name: 'Keera', slug: 'keera' } as Project

function jsonResponse(status: number, body: unknown) {
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })
}

let fetchMock: ReturnType<typeof vi.fn>
let store: ReturnType<typeof useEditorStore>

function modelOf(path: string) {
    return store.modelFor(store.tabsByProject[1].find(t => t.path === path)!) as unknown as FakeModel
}

async function openFile(path = 'src/app.ts', content = 'one', etag = 'e1') {
    fetchMock.mockImplementationOnce(() => jsonResponse(200, { path, content, etag, size: content.length, encoding: 'utf-8' }))
    await store.open(1, path)
    return modelOf(path)
}

beforeEach(() => {
    models.clear()
    routerHandlers.clear()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const pinia = createPinia()
    createApp({}).use(pinia).use(PiniaColada)
    setActivePinia(pinia)
    useProjectStore().setActiveProject(PROJECT)
    store = useEditorStore()
})

afterEach(() => {
    store.$dispose()
    vi.unstubAllGlobals()
})

describe('useEditorStore', () => {
    it('opens a file into an active tab, asking the API for JSON', async () => {
        const model = await openFile()

        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe('/api/projects/1/files/content?path=src%2Fapp.ts')
        expect(init.headers.Accept).toBe('application/json')
        expect(model.getValue()).toBe('one')
        expect(store.projectTabs.map(t => t.name)).toEqual(['app.ts'])
        expect(store.activeTab?.path).toBe('src/app.ts')
    })

    it('re-activates an already open file without fetching it again', async () => {
        await openFile()
        store.activate(1, null)
        await store.open(1, 'src/app.ts')

        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(store.activeTab?.path).toBe('src/app.ts')
    })

    it.each([
        [413, 'File exceeds 2 MB'],
        [415, 'File is not UTF-8 text'],
    ])('reports a %i as a message instead of opening a tab', async (status, error) => {
        fetchMock.mockImplementationOnce(() => jsonResponse(status, { error }))
        await store.open(1, 'big.bin')

        expect(store.openError).toEqual({ projectId: 1, path: 'big.bin', message: error })
        expect(store.projectTabs).toEqual([])
    })

    it('marks a tab dirty on edit and clean again once saved with the etag', async () => {
        const model = await openFile()
        model.edit('two')
        expect(store.activeTab?.dirty).toBe(true)

        fetchMock.mockImplementationOnce(() => jsonResponse(200, { path: 'src/app.ts', etag: 'e2', size: 3 }))
        await store.save(1, 'src/app.ts')

        const [, init] = fetchMock.mock.calls[1]
        expect(init.method).toBe('PUT')
        expect(JSON.parse(init.body)).toEqual({ content: 'two', etag: 'e1' })
        expect(store.activeTab).toMatchObject({ dirty: false, etag: 'e2', conflict: false })
    })

    it('keeps a save error on the tab and the tab dirty', async () => {
        const model = await openFile()
        model.edit('two')
        fetchMock.mockImplementationOnce(() => jsonResponse(403, { error: 'Path is outside the project' }))
        await store.save(1, 'src/app.ts')

        expect(store.activeTab).toMatchObject({ dirty: true, error: 'Path is outside the project' })
    })

    describe('on a 409 conflict', () => {
        async function conflictedFile() {
            const model = await openFile()
            model.edit('mine')
            fetchMock.mockImplementationOnce(() => jsonResponse(409, { error: 'File changed on disk', etag: 'e9' }))
            await store.save(1, 'src/app.ts')
            expect(store.activeTab?.conflict).toBe(true)
            return model
        }

        it('reloads from disk, discarding the local edits', async () => {
            const model = await conflictedFile()
            fetchMock.mockImplementationOnce(() => jsonResponse(200, { content: 'theirs', etag: 'e9' }))
            await store.resolveConflict(1, 'src/app.ts', 'reload')

            expect(model.getValue()).toBe('theirs')
            expect(store.activeTab).toMatchObject({ dirty: false, conflict: false, etag: 'e9' })
        })

        it('overwrites by refetching the etag and saving again with it', async () => {
            await conflictedFile()
            fetchMock
                .mockImplementationOnce(() => jsonResponse(200, { content: 'theirs', etag: 'e9' }))
                .mockImplementationOnce(() => jsonResponse(200, { path: 'src/app.ts', etag: 'e10', size: 4 }))
            await store.resolveConflict(1, 'src/app.ts', 'overwrite')

            const [, init] = fetchMock.mock.calls.at(-1)!
            expect(JSON.parse(init.body)).toEqual({ content: 'mine', etag: 'e9' })
            expect(store.activeTab).toMatchObject({ dirty: false, conflict: false, etag: 'e10' })
        })
    })

    describe('closing', () => {
        it('asks before discarding unsaved changes and keeps the tab when declined', async () => {
            const model = await openFile()
            model.edit('two')
            const confirm = vi.fn(() => false)
            vi.stubGlobal('confirm', confirm)

            expect(store.close(1, 'src/app.ts')).toBe(false)
            expect(confirm).toHaveBeenCalledOnce()
            expect(store.projectTabs).toHaveLength(1)
            expect(model.disposed).toBe(false)
        })

        it('disposes the model and activates the neighbouring tab', async () => {
            const first = await openFile('a.ts')
            await openFile('b.ts')
            store.activate(1, 'a.ts')
            const confirm = vi.fn(() => true)
            vi.stubGlobal('confirm', confirm)

            expect(store.close(1, 'a.ts')).toBe(true)
            expect(confirm).not.toHaveBeenCalled()
            expect(first.disposed).toBe(true)
            expect(first.listeners).toEqual([])
            expect(store.activeTab?.path).toBe('b.ts')

            store.close(1, 'b.ts')
            expect(store.activeTab).toBeNull()
        })
    })

    describe('leaving with unsaved changes', () => {
        const visit = (path: string, only: string[] = []) =>
            routerHandlers.get('before')!({ detail: { visit: { url: new URL(path, 'http://localhost'), only } } })

        it('asks before switching project and cancels the visit when declined', async () => {
            const model = await openFile()
            model.edit('two')
            vi.stubGlobal('confirm', vi.fn(() => false))

            expect(visit('/other')).toBe(false)
            expect(store.activeTab?.path).toBe('src/app.ts')
        })

        it('lets visits within the project through and brings their page to the front', async () => {
            const model = await openFile()
            model.edit('two')
            const confirm = vi.fn()
            vi.stubGlobal('confirm', confirm)

            expect(visit('/keera/agents/3')).toBeUndefined()
            expect(confirm).not.toHaveBeenCalled()
            expect(store.activeTab).toBeNull()
        })

        it('keeps the editor in front on partial reloads', async () => {
            await openFile()
            visit('/keera', ['tasks'])
            expect(store.activeTab?.path).toBe('src/app.ts')
        })

        it('warns on window unload only while a tab is dirty', async () => {
            const model = await openFile()
            const unload = () => {
                const event = new Event('beforeunload', { cancelable: true })
                window.dispatchEvent(event)
                return event.defaultPrevented
            }
            expect(unload()).toBe(false)
            model.edit('two')
            expect(unload()).toBe(true)
        })
    })
})
