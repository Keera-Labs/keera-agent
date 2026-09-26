// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PmCheckinControl from './PmCheckinControl.vue'
import { installPinia, stubFetch } from './testing'

let wrapper: VueWrapper | undefined

async function mountControl(checkin: { enabled: boolean; interval_minutes: number; running: boolean }, compact = false) {
    const fetchMock = stubFetch({
        'GET /api/agents/10/checkin': checkin,
        'PATCH /api/agents/10/checkin': { enabled: true, interval_minutes: 3, running: true },
    })
    const plugins = installPinia()
    wrapper = mount(PmCheckinControl, { props: { agentId: 10, compact }, global: { plugins: [...plugins] } })
    await flushPromises()
    return { wrapper, fetchMock }
}

afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.unstubAllGlobals()
})

describe('PmCheckinControl', () => {
    it('shows the server interval and stopped state', async () => {
        const { wrapper } = await mountControl({ enabled: false, interval_minutes: 12, running: false })

        expect((wrapper.get('input').element as HTMLInputElement).value).toBe('12')
        expect(wrapper.text()).toContain('Stopped')
        expect(wrapper.get('button').text()).toBe('Start')
    })

    it('starts the scheduler with the entered interval', async () => {
        const { wrapper, fetchMock } = await mountControl({ enabled: false, interval_minutes: 5, running: false })

        await wrapper.get('input').setValue('3')
        await wrapper.get('button').trigger('click')
        await flushPromises()

        expect(fetchMock).toHaveBeenCalledWith('/api/agents/10/checkin', expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({ enabled: true, interval_minutes: 3 }),
        }))
        expect(wrapper.text()).toContain('Running')
        expect(wrapper.get('input').attributes('disabled')).toBeDefined()
    })

    it('renders the compact variant with a stop toggle while running', async () => {
        const { wrapper } = await mountControl({ enabled: true, interval_minutes: 5, running: true }, true)

        expect(wrapper.text()).not.toContain('PM Check-in')
        expect(wrapper.get('button').attributes('title')).toBe('Stop PM check-in')
    })
})
