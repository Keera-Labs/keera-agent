// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import TagInput from './TagInput.vue'

function mountTagInput(initial: string[] = [], extra: Record<string, unknown> = {}) {
    const wrapper = mount(TagInput, {
        props: {
            modelValue: initial,
            'onUpdate:modelValue': (tags: string[]) => wrapper.setProps({ modelValue: tags }),
            tagColor: '#3b82f6',
            placeholder: 'Add tag',
            ...extra,
        },
    })
    return wrapper
}

const tagsOf = (w: ReturnType<typeof mountTagInput>) => w.props('modelValue') as string[]

describe('TagInput', () => {
    it('adds a trimmed tag on Enter and clears the input', async () => {
        const w = mountTagInput()
        const input = w.get('input')

        await input.setValue('  alpha  ')
        await input.trigger('keydown', { key: 'Enter' })

        expect(tagsOf(w)).toEqual(['alpha'])
        expect((input.element as HTMLInputElement).value).toBe('')
    })

    it('adds a tag on comma', async () => {
        const w = mountTagInput(['alpha'])
        const input = w.get('input')

        await input.setValue('beta')
        await input.trigger('keydown', { key: ',' })

        expect(tagsOf(w)).toEqual(['alpha', 'beta'])
    })

    it('ignores duplicates and blank input', async () => {
        const w = mountTagInput(['alpha'])
        const input = w.get('input')

        await input.setValue('alpha')
        await input.trigger('keydown', { key: 'Enter' })
        await input.setValue('   ')
        await input.trigger('keydown', { key: 'Enter' })

        expect(tagsOf(w)).toEqual(['alpha'])
        expect(w.emitted('update:modelValue')).toBeUndefined()
    })

    it('removes the last tag on Backspace only when the input is empty', async () => {
        const w = mountTagInput(['alpha', 'beta'])
        const input = w.get('input')

        await input.setValue('x')
        await input.trigger('keydown', { key: 'Backspace' })
        expect(tagsOf(w)).toEqual(['alpha', 'beta'])

        await input.setValue('')
        await input.trigger('keydown', { key: 'Backspace' })
        expect(tagsOf(w)).toEqual(['alpha'])
    })

    it('removes a specific tag with its × button', async () => {
        const w = mountTagInput(['alpha', 'beta', 'gamma'])

        await w.get('button[aria-label="Remove beta"]').trigger('click')

        expect(tagsOf(w)).toEqual(['alpha', 'gamma'])
    })

    it('commits pending text on blur', async () => {
        const w = mountTagInput()
        const input = w.get('input')

        await input.setValue('pending')
        await input.trigger('blur')

        expect(tagsOf(w)).toEqual(['pending'])
    })

    it('hides the input and remove buttons when disabled', () => {
        const w = mountTagInput(['alpha'], { disabled: true })

        expect(w.find('input').exists()).toBe(false)
        expect(w.find('button').exists()).toBe(false)
    })
})
