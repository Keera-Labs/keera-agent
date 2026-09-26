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

const dialog = () => document.querySelector<HTMLElement>('[data-testid="confirm-delete-agent"]')

async function clickDialog(testid: string) {
    document.querySelector<HTMLElement>(`[data-testid="${testid}"]`)!.click()
    await flushPromises()
}

async function clickClose(w: VueWrapper, agentName: string) {
    const tab = w.findAll('[data-testid="session-tab"]').find(t => t.text() === agentName)!
    await tab.get('[data-testid="session-tab-close"]').trigger('click')
    await flushPromises()
}

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

    it('"Just close tab" closes the terminal but keeps the agent', async () => {
        const w = await mountHeader()
        openSession(ENGINEER)
        const session = store.agentSessions.get(ENGINEER)!
        store.setActiveAgentId(ENGINEER)
        await flushPromises()

        expect(w.findAll('[data-testid="session-tab-close"]')).toHaveLength(1)
        await w.get('[data-testid="session-tab-close"]').trigger('click')
        await flushPromises()
        await clickDialog('confirm-delete-agent-close-only')

        expect(dialog()).toBeNull()
        expect(fetch).not.toHaveBeenCalledWith(`/api/agents/${ENGINEER}`, expect.anything())
        expect(session.ws.close).toHaveBeenCalled()
        expect(store.agentSessions.has(ENGINEER)).toBe(false)
        expect(store.activeAgentId).toBeNull()
        expect(router.visit).not.toHaveBeenCalled()
        expect(tabNames(w)).toEqual(['PM'])
    })

    it('asks before deleting an agent on tab close; Cancel and Escape keep the agent and its tab', async () => {
        const w = await mountHeader()
        openSession(ENGINEER)
        store.setActiveAgentId(ENGINEER)
        await flushPromises()

        await clickClose(w, 'Frontend Engineer with a very long name')
        expect(dialog()?.textContent).toContain('Delete agent Frontend Engineer with a very long name?')
        // Enter lands on Cancel, never on Delete.
        expect(document.activeElement?.getAttribute('data-testid')).toBe('confirm-delete-agent-cancel')

        await clickDialog('confirm-delete-agent-cancel')
        expect(dialog()).toBeNull()

        await clickClose(w, 'Frontend Engineer with a very long name')
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        await flushPromises()
        expect(dialog()).toBeNull()

        expect(fetch).not.toHaveBeenCalledWith(`/api/agents/${ENGINEER}`, expect.anything())
        expect(store.agentSessions.has(ENGINEER)).toBe(true)
        expect(tabNames(w)).toEqual(['PM', 'Frontend Engineer with a very long name'])
    })

    it('Delete removes the agent, closes its tab and moves to the neighbouring tab', async () => {
        const w = await mountHeader()
        openSession(ENGINEER)
        openSession(REVIEWER)
        const session = store.agentSessions.get(ENGINEER)!
        store.setActiveAgentId(ENGINEER)
        await flushPromises()

        await clickClose(w, 'Frontend Engineer with a very long name')
        await clickDialog('confirm-delete-agent-confirm')

        expect(fetch).toHaveBeenCalledWith(`/api/agents/${ENGINEER}`, { method: 'DELETE' })
        expect(dialog()).toBeNull()
        expect(session.ws.close).toHaveBeenCalled()
        expect(store.agentSessions.has(ENGINEER)).toBe(false)
        expect(tabNames(w)).toEqual(['PM', 'Reviewer'])
        expect(store.activeAgentId).toBe(REVIEWER)
        expect(router.visit).toHaveBeenCalledWith(`/${project.slug}/agents/${REVIEWER}`)
    })

    it('deleting an inactive agent tab leaves the current page alone', async () => {
        const w = await mountHeader()
        openSession(ENGINEER)
        store.setActiveAgentId(PM)
        await flushPromises()

        await clickClose(w, 'Frontend Engineer with a very long name')
        await clickDialog('confirm-delete-agent-confirm')

        expect(fetch).toHaveBeenCalledWith(`/api/agents/${ENGINEER}`, { method: 'DELETE' })
        expect(tabNames(w)).toEqual(['PM'])
        expect(store.activeAgentId).toBe(PM)
        expect(router.visit).not.toHaveBeenCalled()
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
        expect(fileTabs.map(t => t.attributes('data-save-status'))).toEqual(['unsaved', 'saved'])
        const selected = w.findAll('[role="tab"][aria-selected="true"]')
        expect(selected.map(t => t.text())).toEqual(['app.ts'])

        await fileTabs[1].trigger('click')
        expect(editor.activeTab?.path).toBe('README.md')

        const close = vi.spyOn(editor, 'close').mockResolvedValue(true)
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

    it('offers a way back only for hidden panels and persists reopening them', async () => {
        const w = await mountHeader()
        expect(w.find('[data-testid="show-panel-left"]').exists()).toBe(false)

        store.sidebarOpen = false
        await flushPromises()
        await w.get('[data-testid="show-panel-left"]').trigger('click')
        await w.get('[data-testid="show-panel-right"]').trigger('click')
        await flushPromises()

        expect(store.sidebarOpen).toBe(true)
        expect(store.rightPanelOpen).toBe(true)
        expect(localStorage.getItem('keera.layout.sidebarOpen')).toBe('true')
        expect(localStorage.getItem('keera.layout.rightPanelOpen')).toBe('true')
        expect(w.find('[data-testid="show-panel-left"]').exists()).toBe(false)
        expect(w.find('[data-testid="show-panel-right"]').exists()).toBe(false)
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

    it('shows today\'s token usage of the active project', async () => {
        stubFetch({
            '/api/projects/1/usage': {
                data: { attributes: {
                    today: { input: 1, output: 2, cache_creation: 3, cache_read: 45_000, total: 45_006 },
                    agents: {},
                } },
            },
        })
        const w = await mountHeader()
        await flushPromises()

        expect(w.get('[data-testid="usage-today"]').text()).toBe('Today 45K tok')
        expect(w.find('[data-testid="usage-placeholder"]').exists()).toBe(false)
    })
})
