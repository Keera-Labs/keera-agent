// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import { router } from '@inertiajs/vue3'
import { agentResource, fakeSession, installPinia, project, stubFetch } from '@/pages/agents/testing'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'
import AppHeader from './AppHeader.vue'
import StatusBar from './StatusBar.vue'

const page = reactive<{ component: string; props: Record<string, unknown> }>({ component: 'agents/Detail', props: {} })

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => page,
    router: { visit: vi.fn(), on: vi.fn(() => () => {}) },
}))

const PM = 10
const ENGINEER = 11
const REVIEWER = 12

let wrapper: VueWrapper | undefined
let store: ReturnType<typeof useAppLayoutStore>

async function mountHeader() {
    const plugins = installPinia()
    wrapper = mount({ components: { AppHeader, StatusBar }, template: '<AppHeader /><StatusBar />' }, {
        attachTo: document.body,
        global: { plugins: [...plugins] },
    })
    store = useAppLayoutStore()
    useProjectStore().setActiveProject(project)
    await flushPromises()
    return wrapper
}

function openSession(agentId: number) {
    store.agentSessions.set(agentId, fakeSession())
    store.liveSessionCount = store.sessions.size + store.agentSessions.size
}

const tabNames = (w: VueWrapper) => w.findAll('[data-testid="session-tab"]').map(el => el.text())

beforeEach(() => {
    page.component = 'agents/Detail'
    localStorage.clear()
    stubFetch({
        [`/api/projects/${project.id}/agents`]: {
            data: [agentResource(ENGINEER, 'Frontend Engineer with a very long name'), agentResource(PM, 'PM', 'pm'), agentResource(REVIEWER, 'Reviewer', 'reviewer'), agentResource(13, 'Second PM', 'pm')],
        },
    })
})

afterEach(() => {
    store.sessions.clear()
    store.agentSessions.clear()
    wrapper?.unmount()
    wrapper = undefined
    vi.unstubAllGlobals()
    vi.mocked(router.visit).mockClear()
})

describe('SessionTabs', () => {
    it('pins a single PM tab first and adds a tab for each agent with an open terminal', async () => {
        const w = await mountHeader()
        expect(tabNames(w)).toEqual(['PM'])

        openSession(ENGINEER)
        await flushPromises()

        expect(tabNames(w)).toEqual(['PM', 'Frontend Engineer with a very long name'])
        const dots = w.findAll('[data-testid="session-tab-dot"]').map(el => el.attributes('data-state'))
        expect(dots).toEqual(['off', 'live'])
    })

    it('marks the selected agent tab active and navigates to an agent on click', async () => {
        const w = await mountHeader()
        openSession(ENGINEER)
        store.setActiveAgentId(PM)
        await flushPromises()

        const [pmTab, engineerTab] = w.findAll('[role="tab"]')
        expect(pmTab.attributes('aria-selected')).toBe('true')
        expect(engineerTab.attributes('aria-selected')).toBe('false')

        await engineerTab.trigger('click')
        expect(store.activeAgentId).toBe(ENGINEER)
        expect(router.visit).toHaveBeenCalledWith(`/${project.slug}/agents/${ENGINEER}`)
    })

    it('shows no active tab outside the terminal pages', async () => {
        const w = await mountHeader()
        store.setActiveAgentId(PM)
        page.component = 'Tasks'
        await flushPromises()

        expect(w.get('[role="tab"]').attributes('aria-selected')).toBe('false')
    })

    it('closes an agent terminal and drops back to the overview when it was active', async () => {
        const w = await mountHeader()
        openSession(ENGINEER)
        const session = store.agentSessions.get(ENGINEER)!
        store.setActiveAgentId(ENGINEER)
        await flushPromises()

        expect(w.findAll('[data-testid="session-tab-close"]')).toHaveLength(1)
        await w.get('[data-testid="session-tab-close"]').trigger('click')
        await flushPromises()

        expect(session.ws.close).toHaveBeenCalled()
        expect(store.agentSessions.has(ENGINEER)).toBe(false)
        expect(store.activeAgentId).toBeNull()
        expect(router.visit).not.toHaveBeenCalled()
        expect(tabNames(w)).toEqual(['PM'])
    })

    it('shows open files as tabs beside the terminals, with a dirty marker', async () => {
        const w = await mountHeader()
        store.setActiveAgentId(PM)
        const editor = useEditorStore()
        editor.tabsByProject[project.id] = [
            { projectId: project.id, path: 'src/app.ts', name: 'app.ts', etag: 'e1', dirty: true, saving: false, conflict: false, error: null },
            { projectId: project.id, path: 'README.md', name: 'README.md', etag: 'e2', dirty: false, saving: false, conflict: false, error: null },
        ]
        editor.activate(project.id, 'src/app.ts')
        await flushPromises()

        const fileTabs = w.findAll('[data-testid="editor-tab"]')
        expect(fileTabs.map(t => t.text())).toEqual(['app.ts', 'README.md'])
        expect(fileTabs.map(t => t.attributes('data-dirty'))).toEqual(['true', 'false'])
        const selected = w.findAll('[role="tab"][aria-selected="true"]')
        expect(selected.map(t => t.text())).toEqual(['app.ts'])

        await fileTabs[1].trigger('click')
        expect(editor.activeTab?.path).toBe('README.md')

        const close = vi.spyOn(editor, 'close').mockReturnValue(true)
        await fileTabs[0].get('[data-testid="editor-tab-close"]').trigger('click')
        expect(close).toHaveBeenCalledWith(project.id, 'src/app.ts')
    })
})

describe('Header toolbar', () => {
    it('opens the command palette from the Command button', async () => {
        const w = await mountHeader()
        await w.get('[data-testid="command-button"]').trigger('click')
        expect(store.showProjectSearch).toBe(true)
    })

    it('toggles each layout region and persists the choice', async () => {
        const w = await mountHeader()

        await w.get('[data-testid="toggle-panel-left"]').trigger('click')
        await w.get('[data-testid="toggle-panel-bottom"]').trigger('click')
        await w.get('[data-testid="toggle-panel-right"]').trigger('click')
        await flushPromises()

        expect(store.sidebarOpen).toBe(false)
        expect(store.statusBarOpen).toBe(false)
        expect(store.rightPanelOpen).toBe(true)
        expect(localStorage.getItem('keera.layout.sidebarOpen')).toBe('false')
        expect(localStorage.getItem('keera.layout.statusBarOpen')).toBe('false')
        expect(localStorage.getItem('keera.layout.rightPanelOpen')).toBe('true')
        expect(w.get('[data-testid="toggle-panel-right"]').attributes('aria-pressed')).toBe('true')
    })

    it('restores persisted toggles on load', async () => {
        localStorage.setItem('keera.layout.sidebarOpen', 'false')
        localStorage.setItem('keera.layout.rightPanelOpen', 'true')
        await mountHeader()

        expect(store.sidebarOpen).toBe(false)
        expect(store.rightPanelOpen).toBe(true)
        expect(store.statusBarOpen).toBe(true)
    })
})

describe('StatusBar', () => {
    it('counts running projects and open terminals', async () => {
        const w = await mountHeader()
        store.setClaudeStatus(1, 'running')
        store.setClaudeStatus(2, 'done')
        openSession(ENGINEER)
        openSession(REVIEWER)
        await flushPromises()

        expect(w.get('[data-testid="running-count"]').text()).toBe('1 running')
        expect(w.get('[data-testid="terminal-count"]').text()).toBe('2')
        expect(w.find('[data-testid="usage-placeholder"]').exists()).toBe(true)
    })
})
