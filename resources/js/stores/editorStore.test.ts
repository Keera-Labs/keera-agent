// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createApp } from 'vue'
import { PiniaColada } from '@pinia/colada'
import type { Project } from '@/types/type'
import { AUTO_SAVE_DELAY_MS, KEEPALIVE_BUDGET_BYTES, saveStatus, useEditorStore } from './editorStore'
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
    isDisposed() { return this.disposed }
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

const savedAs = (etag: string) => () => jsonResponse(200, { path: 'src/app.ts', etag, size: 3 })

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
        it('closes a deleted project\'s tabs without asking and stops the unload warning', async () => {
            const first = await openFile('a.ts')
            const second = await openFile('b.ts')
            first.edit('unsaved')
            fetchMock.mockImplementationOnce(() => jsonResponse(415, { error: 'File is not UTF-8 text' }))
            await store.open(1, 'logo.png')
            const confirm = vi.fn()
            vi.stubGlobal('confirm', confirm)

            store.closeProject(1)

            expect(confirm).not.toHaveBeenCalled()
            expect(first.disposed && second.disposed).toBe(true)
            expect(store.tabsByProject[1]).toBeUndefined()
            expect(store.activeTab).toBeNull()
            expect(store.openError).toBeNull()
            expect(store.hasDirtyTabs()).toBe(false)
            const event = new Event('beforeunload', { cancelable: true })
            window.dispatchEvent(event)
            expect(event.defaultPrevented).toBe(false)
        })


        it('leaves a disposed model alone when its save finishes afterwards', async () => {
            const model = await openFile()
            model.edit('two')
            let respond!: (value: unknown) => void
            fetchMock.mockImplementationOnce(() => new Promise(resolve => { respond = resolve }))
            const saving = store.save(1, 'src/app.ts')
            const tab = store.activeTab!

            store.closeProject(1)
            const getVersion = vi.spyOn(model, 'getAlternativeVersionId')
            respond({ ok: true, status: 200, json: () => Promise.resolve({ path: 'src/app.ts', etag: 'e2', size: 3 }) })

            expect(await saving).toBe(false)
            expect(getVersion).not.toHaveBeenCalled()
            expect(tab.etag).toBe('e1')
        })

        it('saves pending edits and closes without asking', async () => {
            const model = await openFile()
            model.edit('two')
            fetchMock.mockImplementationOnce(savedAs('e2'))
            const confirm = vi.fn()
            vi.stubGlobal('confirm', confirm)

            expect(await store.close(1, 'src/app.ts')).toBe(true)
            expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ content: 'two', etag: 'e1' })
            expect(confirm).not.toHaveBeenCalled()
            expect(model.disposed).toBe(true)
        })

        it('asks when the pending edits fail to save and keeps the tab when declined', async () => {
            const model = await openFile()
            model.edit('two')
            fetchMock.mockImplementationOnce(() => jsonResponse(500, {}))
            const confirm = vi.fn(() => false)
            vi.stubGlobal('confirm', confirm)

            expect(await store.close(1, 'src/app.ts')).toBe(false)
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

            expect(await store.close(1, 'a.ts')).toBe(true)
            expect(confirm).not.toHaveBeenCalled()
            expect(first.disposed).toBe(true)
            expect(first.listeners).toEqual([])
            expect(store.activeTab?.path).toBe('b.ts')

            await store.close(1, 'b.ts')
            expect(store.activeTab).toBeNull()
        })
    })

    describe('leaving with unsaved changes', () => {
        const visit = (path: string, only: string[] = []) =>
            routerHandlers.get('before')!({ detail: { visit: { url: new URL(path, 'http://localhost'), only } } })

        async function failedSave() {
            const model = await openFile()
            model.edit('two')
            fetchMock.mockImplementationOnce(() => jsonResponse(500, {}))
            await store.save(1, 'src/app.ts')
            return model
        }

        it('asks before leaving a project whose save failed and cancels the visit when declined', async () => {
            await failedSave()
            vi.stubGlobal('confirm', vi.fn(() => false))

            expect(visit('/other')).toBe(false)
            expect(store.activeTab?.path).toBe('src/app.ts')
        })

        it('leaves a project with only pending edits without asking, saving them', async () => {
            const model = await openFile()
            model.edit('two')
            fetchMock.mockImplementationOnce(savedAs('e2'))
            const confirm = vi.fn()
            vi.stubGlobal('confirm', confirm)

            expect(visit('/other')).toBeUndefined()
            expect(confirm).not.toHaveBeenCalled()
            expect(fetchMock).toHaveBeenCalledTimes(2)
            expect(fetchMock.mock.calls[1][1].method).toBe('PUT')
        })

        it('lets visits within the project through and brings their page to the front', async () => {
            await failedSave()
            fetchMock.mockImplementationOnce(() => jsonResponse(500, {}))
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

        describe('on window unload', () => {
            const unload = () => {
                const event = new Event('beforeunload', { cancelable: true })
                window.dispatchEvent(event)
                return event.defaultPrevented
            }

            it('sends pending edits with keepalive instead of warning', async () => {
                const model = await openFile()
                expect(unload()).toBe(false)

                model.edit('two')
                fetchMock.mockImplementationOnce(savedAs('e2'))
                expect(unload()).toBe(false)
                const [, init] = fetchMock.mock.calls[1]
                expect(init).toMatchObject({ method: 'PUT', keepalive: true })
            })

            it('warns while a save has failed, conflicted or is still in flight', async () => {
                await failedSave()
                expect(unload()).toBe(true)
            })

            it('warns when pending edits are too large to send with keepalive', async () => {
                const model = await openFile()
                model.edit('x'.repeat(70 * 1024))
                expect(unload()).toBe(true)
                expect(fetchMock).toHaveBeenCalledTimes(1)
            })

            it.each([
                ['JSON escaping', '\n\t"'.repeat(15 * 1024)],
                ['multibyte characters', '€'.repeat(25 * 1024)],
            ])('measures the request body, which %s grows past the budget', async (_, content) => {
                expect(content.length).toBeLessThan(KEEPALIVE_BUDGET_BYTES)
                const model = await openFile()
                model.edit(content)

                expect(unload()).toBe(true)
                expect(fetchMock).toHaveBeenCalledTimes(1)
            })

            it('warns when several tabs together exceed the shared keepalive budget', async () => {
                const first = await openFile('a.ts')
                const second = await openFile('b.ts')
                fetchMock.mockImplementation(savedAs('e2'))
                first.edit('x'.repeat(35 * 1024))
                second.edit('y'.repeat(35 * 1024))

                expect(unload()).toBe(true)
                const keepalivePuts = fetchMock.mock.calls.filter(([, init]) => init?.keepalive)
                expect(keepalivePuts).toHaveLength(1)
                expect(keepalivePuts[0][0]).toContain('path=a.ts')
            })
        })
    })

    describe('auto-save', () => {
        beforeEach(() => { vi.useFakeTimers() })
        afterEach(() => { vi.useRealTimers() })

        const puts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')

        it('saves once, a second after typing stops', async () => {
            const model = await openFile()
            fetchMock.mockImplementation(savedAs('e2'))

            model.edit('t')
            await vi.advanceTimersByTimeAsync(600)
            model.edit('tw')
            await vi.advanceTimersByTimeAsync(600)
            model.edit('two')
            await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS - 1)
            expect(puts()).toHaveLength(0)

            await vi.advanceTimersByTimeAsync(1)
            expect(puts()).toHaveLength(1)
            expect(JSON.parse(puts()[0][1].body)).toEqual({ content: 'two', etag: 'e1' })
            expect(store.activeTab).toMatchObject({ dirty: false, etag: 'e2' })
            expect(saveStatus(store.activeTab!)).toBe('saved')

            await vi.advanceTimersByTimeAsync(5000)
            expect(puts()).toHaveLength(1)
        })

        it('flushes right away on blur, without waiting for the debounce', async () => {
            const model = await openFile()
            fetchMock.mockImplementation(savedAs('e2'))
            model.edit('two')

            expect(await store.flush(1, 'src/app.ts')).toBe(true)
            expect(puts()).toHaveLength(1)
            await vi.advanceTimersByTimeAsync(5000)
            expect(puts()).toHaveLength(1)
        })

        it('flushes the tab being left when switching tabs', async () => {
            const first = await openFile('a.ts')
            await openFile('b.ts')
            store.activate(1, 'a.ts')
            fetchMock.mockImplementation(savedAs('e2'))
            first.edit('two')

            store.activate(1, 'b.ts')
            await vi.advanceTimersByTimeAsync(0)

            expect(puts()).toHaveLength(1)
            expect(puts()[0][0]).toContain('path=a.ts')
            expect(store.tabsByProject[1][0].dirty).toBe(false)
        })

        it('never overlaps saves and sends one follow-up with the new etag', async () => {
            const model = await openFile()
            const responders: ((value: unknown) => void)[] = []
            fetchMock.mockImplementation(() => new Promise(resolve => { responders.push(resolve) }))

            model.edit('two')
            await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS)
            expect(saveStatus(store.activeTab!)).toBe('saving')
            model.edit('three')
            await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS)
            model.edit('four')
            store.save(1, 'src/app.ts')
            expect(puts()).toHaveLength(1)

            responders[0]({ ok: true, status: 200, json: () => Promise.resolve({ path: 'src/app.ts', etag: 'e2', size: 3 }) })
            await vi.advanceTimersByTimeAsync(0)
            expect(puts()).toHaveLength(2)
            expect(JSON.parse(puts()[1][1].body)).toEqual({ content: 'four', etag: 'e2' })
            expect(store.activeTab?.dirty).toBe(true)

            responders[1]({ ok: true, status: 200, json: () => Promise.resolve({ path: 'src/app.ts', etag: 'e3', size: 4 }) })
            await vi.advanceTimersByTimeAsync(5000)
            expect(puts()).toHaveLength(2)
            expect(store.activeTab).toMatchObject({ dirty: false, etag: 'e3', saving: false })
        })

        it('stops auto-saving on a 409 and shows the conflict instead of overwriting', async () => {
            const model = await openFile()
            fetchMock.mockImplementationOnce(() => jsonResponse(409, { error: 'File changed on disk', etag: 'e9' }))
            model.edit('two')
            await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS)
            expect(store.activeTab).toMatchObject({ conflict: true, dirty: true })
            expect(saveStatus(store.activeTab!)).toBe('conflict')

            model.edit('three')
            await vi.advanceTimersByTimeAsync(5000)
            expect(await store.flush(1, 'src/app.ts')).toBe(false)
            expect(puts()).toHaveLength(1)
            expect(store.hasUnsavedWork()).toBe(true)
        })

        it('keeps the tab dirty with a readable error and retries on the next edit', async () => {
            const model = await openFile()
            fetchMock.mockImplementationOnce(() => jsonResponse(413, { error: 'File exceeds 2 MB' }))
            model.edit('two')
            await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS)
            expect(store.activeTab).toMatchObject({ dirty: true, error: 'File exceeds 2 MB' })
            expect(saveStatus(store.activeTab!)).toBe('error')

            fetchMock.mockImplementationOnce(savedAs('e2'))
            model.edit('tw')
            await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS)
            expect(puts()).toHaveLength(2)
            expect(store.activeTab).toMatchObject({ dirty: false, error: null })
        })

        it('clears the pending timer when a tab or its project is closed', async () => {
            const first = await openFile('a.ts')
            const second = await openFile('b.ts')
            first.edit('two')
            second.edit('two')
            vi.stubGlobal('confirm', vi.fn(() => true))
            fetchMock.mockImplementationOnce(() => jsonResponse(500, {}))

            await store.close(1, 'a.ts')
            store.closeProject(1)
            expect(vi.getTimerCount()).toBe(0)
            await vi.advanceTimersByTimeAsync(5000)
            expect(puts()).toHaveLength(1)
        })
    })
})
