// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { h, reactive } from 'vue'
import Detail from '@/pages/agents/Detail.vue'
import { agentResource, installPinia, project, stubFetch } from '@/pages/agents/testing'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { useProjectStore } from '@/stores/projectStore'
import ProjectLayout from './ProjectLayout.vue'

const PM = 10

const page = reactive({ component: 'agents/Detail', props: { project: project.slug, agent_id: PM as number | undefined } })

vi.mock('@inertiajs/vue3', () => ({
    usePage: () => page,
    router: { visit: vi.fn(), on: vi.fn(() => () => {}) },
}))

vi.mock('@xterm/xterm', () => ({
    Terminal: class {
        element: HTMLElement | undefined
        cols = 80
        rows = 24
        open(container: HTMLElement) {
            this.element = document.createElement('div')
            this.element.dataset.testid = 'xterm'
            container.appendChild(this.element)
        }
        loadAddon() {}
        onData() {}
        onResize() {}
        focus() {}
        write() {}
        clear() {}
        attachCustomKeyEventHandler() {}
        dispose() {}
    },
}))

const fit = vi.hoisted(() => vi.fn())
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = fit } }))

class FakeSocket {
    readyState = 0
    binaryType = ''
    send() {}
    close() {}
}

const observed = new Map<Element, () => void>()

class FakeResizeObserver {
    constructor(private callback: () => void) {}
    observe(el: Element) { observed.set(el, this.callback) }
    disconnect() {}
}

let wrapper: VueWrapper | undefined
let store: ReturnType<typeof useAppLayoutStore> | undefined

afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    store?.sessions.clear()
    store?.$dispose()
    store = undefined
    observed.clear()
    fit.mockClear()
    vi.unstubAllGlobals()
})

/** requestAnimationFrame that only runs when flushed, as a browser would one frame later. */
function deferFrames() {
    const queue: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => queue.push(cb))
    return () => { while (queue.length) queue.shift()!(0) }
}

describe('ProjectLayout', () => {
    it('opens the PM terminal in the visible page slot when landing on the PM agent', async () => {
        stubFetch({
            '/api/projects': [project],
            '/api/projects/1/agents': { data: [agentResource(PM, 'Planner', 'pm'), agentResource(11, 'Builder')] },
        })
        const flushFrames = deferFrames()
        vi.stubGlobal('WebSocket', FakeSocket)
        vi.stubGlobal('ResizeObserver', FakeResizeObserver)

        const plugins = installPinia()
        useProjectStore().setActiveProject(project)
        store = useAppLayoutStore()
        store.setTerminalHolder(document.createElement('div'))
        wrapper = mount(ProjectLayout, {
            global: { plugins: [...plugins], stubs: { PmCheckinControl: true } },
            slots: { default: () => h(Detail) },
            attachTo: document.body,
        })
        await flushPromises()
        flushFrames()
        await flushPromises()

        expect(store.sessions.has(project.id)).toBe(true)
        const xterm = wrapper.get('[data-testid="xterm"]').element
        expect(wrapper.get('[data-testid="agent-terminal"]').element.contains(xterm)).toBe(true)
        expect(wrapper.get('[data-testid="pm-terminal"]').element.contains(xterm)).toBe(false)

        // A terminal opened while its slot was still 0x0 refits once the slot gets a size.
        fit.mockClear()
        observed.get(wrapper.get('[data-testid="agent-terminal"]').element)!()
        expect(fit).toHaveBeenCalled()
    })
})
