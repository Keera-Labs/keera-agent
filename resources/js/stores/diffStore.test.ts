// @vitest-environment happy-dom
import { PiniaColada } from '@pinia/colada'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'
import type { Project } from '@/types/type'
import { useDiffStore } from './diffStore'
import { useEditorStore } from './editorStore'
import { useProjectStore } from './projectStore'

type Handler = (event: { detail: { visit: { only: string[]; url: URL } } }) => void
const beforeHandlers = vi.hoisted(() => [] as Handler[])

vi.mock('@inertiajs/vue3', () => ({
    router: {
        on: (event: string, handler: Handler) => {
            if (event === 'before') beforeHandlers.push(handler)
            return () => {}
        },
    },
}))

vi.mock('@/editor/monaco', () => ({
    loadMonaco: () => Promise.resolve({
        editor: {
            getModel: () => null,
            createModel: (value: string) => ({
                getValue: () => value,
                getAlternativeVersionId: () => 1,
                onDidChangeContent: () => ({ dispose() {} }),
                dispose() {},
                isDisposed: () => false,
            }),
        },
    }),
    modelUri: (_monaco: unknown, projectId: number, path: string) => `/project-${projectId}/${path}`,
}))

const PROJECT = { id: 1, name: 'Keera', slug: 'keera' } as Project
const MAIN = { projectId: 1, worktree: null }
const AGENT = { projectId: 1, worktree: '/code/keera/.claude/worktrees/agent-7' }

const visit = (only: string[] = []) => beforeHandlers.forEach(handler => handler({ detail: { visit: { only, url: new URL('http://app/keera/agents') } } }))

let diffs: ReturnType<typeof useDiffStore>
let editor: ReturnType<typeof useEditorStore>

beforeEach(() => {
    beforeHandlers.length = 0
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
        ok: true, status: 200, json: () => Promise.resolve({ path: 'src/app.ts', content: 'x', etag: 'e1', size: 1, encoding: 'utf-8' }),
    })))
    const pinia = createPinia()
    createApp({}).use(pinia).use(PiniaColada)
    setActivePinia(pinia)
    useProjectStore().setActiveProject(PROJECT)
    diffs = useDiffStore()
    editor = useEditorStore()
})

afterEach(() => vi.unstubAllGlobals())

describe('useDiffStore', () => {
    it('keeps one tab per file, side and worktree, and re-activates it', () => {
        diffs.open(MAIN, 'app/tasks.py', false)
        diffs.open(MAIN, 'app/tasks.py', true)
        diffs.open(AGENT, 'app/tasks.py', false, 'Diff Frontend')
        diffs.open(MAIN, 'app/tasks.py', false)

        expect(diffs.projectTabs.map(t => [t.name, t.staged, t.worktreeLabel])).toEqual([
            ['tasks.py', false, null],
            ['tasks.py', true, null],
            ['tasks.py', false, 'Diff Frontend'],
        ])
        expect(diffs.activeTab).toMatchObject({ target: MAIN, staged: false })
    })

    it('shares the editor area with file tabs: one active at a time', async () => {
        await editor.open(1, 'src/app.ts')
        expect(editor.activeTab?.path).toBe('src/app.ts')

        diffs.open(MAIN, 'app/tasks.py', false)
        expect(editor.activeTab).toBeNull()
        expect(diffs.activeTab?.path).toBe('app/tasks.py')

        editor.activate(1, 'src/app.ts')
        expect(diffs.activeTab).toBeNull()
        expect(diffs.projectTabs).toHaveLength(1)
    })

    it('activates a neighbour when the active tab closes', () => {
        diffs.open(MAIN, 'a.ts', false)
        diffs.open(MAIN, 'b.ts', false)
        diffs.open(MAIN, 'c.ts', false)
        diffs.activate(diffs.projectTabs[1])

        diffs.close(1, diffs.projectTabs[1].id)
        expect(diffs.activeTab?.path).toBe('c.ts')

        diffs.close(1, diffs.activeTab!.id)
        expect(diffs.activeTab?.path).toBe('a.ts')

        diffs.close(1, diffs.activeTab!.id)
        expect(diffs.activeTab).toBeNull()
    })

    it('steps aside for page visits but not for partial reloads', () => {
        diffs.open(MAIN, 'a.ts', false)

        visit(['agents'])
        expect(diffs.activeTab?.path).toBe('a.ts')

        visit()
        expect(diffs.activeTab).toBeNull()
        expect(diffs.projectTabs).toHaveLength(1)
    })

    it('only shows the active project\'s tabs', () => {
        diffs.open(MAIN, 'a.ts', false)
        useProjectStore().setActiveProject({ id: 2, name: 'Other' } as Project)
        expect(diffs.projectTabs).toEqual([])
        expect(diffs.activeTab).toBeNull()
    })
})
