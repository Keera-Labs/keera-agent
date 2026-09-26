import { PiniaColada } from '@pinia/colada'
import { createPinia, setActivePinia } from 'pinia'
import { vi } from 'vitest'
import type { Session } from '@/composables/useTerminalSessions'
import type { Project } from '@/types/type'

export const project = { id: 1, name: 'Keera', slug: 'keera', workspace_id: 7, system_prompt: 'Build agents' } as Project

export function agentResource(id: number, name: string, agentType = 'software_engineer') {
    return {
        type: 'agents',
        id: String(id),
        attributes: { project_id: project.id, name, agent_type: agentType, provider: 'claude', model: 'opus', description: null },
    }
}

type Routes = Record<string, unknown | (() => unknown)>

/** Stub fetch with JSON bodies keyed by URL path; unknown paths answer an empty list. */
export function stubFetch(routes: Routes) {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
        const path = url.split('?')[0]
        const route = routes[`${init?.method ?? 'GET'} ${path}`] ?? routes[path]
        const body = typeof route === 'function' ? (route as () => unknown)() : route ?? []
        return Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0 })
    return fetchMock
}

export function installPinia() {
    const pinia = createPinia()
    setActivePinia(pinia)
    return [pinia, PiniaColada] as const
}

export function fakeSession(): Session {
    return {
        term: { element: document.createElement('div'), focus: vi.fn(), open: vi.fn(), dispose: vi.fn() },
        ws: { close: vi.fn(), readyState: 1 },
        fitAddon: { fit: vi.fn() },
        observer: { observe: vi.fn(), disconnect: vi.fn() },
    } as unknown as Session
}
