// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { h } from 'vue'
import Modal from './Modal.vue'

let wrapper: VueWrapper | undefined

function mountModal() {
    wrapper = mount(Modal, {
        attachTo: document.body,
        props: { ariaLabel: 'Open settings' },
        slots: {
            trigger: () => h('span', 'Open'),
            default: ({ close }: { close: () => void }) =>
                h('button', { id: 'done', onClick: close }, 'Done'),
        },
    })
    return wrapper
}

const backdrop = () => document.querySelector<HTMLElement>('[data-testid="modal-backdrop"]')
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')

afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
})

describe('Modal', () => {
    it('is closed until the trigger is clicked', async () => {
        const w = mountModal()
        expect(dialog()).toBeNull()

        await w.get('[role="button"]').trigger('click')

        expect(dialog()).not.toBeNull()
        expect(w.emitted('openChange')).toEqual([[true]])
    })

    it('opens from the keyboard with Enter and Space', async () => {
        const w = mountModal()
        const trigger = w.get('[role="button"]')

        await trigger.trigger('keydown', { key: 'Enter' })
        expect(dialog()).not.toBeNull()

        await w.vm.$nextTick()
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        await w.vm.$nextTick()
        expect(dialog()).toBeNull()

        await trigger.trigger('keydown', { key: ' ' })
        expect(dialog()).not.toBeNull()
    })

    it('closes on Escape', async () => {
        const w = mountModal()
        await w.get('[role="button"]').trigger('click')

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        await w.vm.$nextTick()

        expect(dialog()).toBeNull()
        expect(w.emitted('openChange')).toEqual([[true], [false]])
    })

    it('closes on backdrop click but not on panel click', async () => {
        const w = mountModal()
        await w.get('[role="button"]').trigger('click')

        dialog()!.click()
        await w.vm.$nextTick()
        expect(dialog()).not.toBeNull()

        backdrop()!.click()
        await w.vm.$nextTick()
        expect(dialog()).toBeNull()
    })

    it('lets the body close the modal through the slot prop', async () => {
        const w = mountModal()
        await w.get('[role="button"]').trigger('click')

        document.querySelector<HTMLButtonElement>('#done')!.click()
        await w.vm.$nextTick()

        expect(dialog()).toBeNull()
    })
})
