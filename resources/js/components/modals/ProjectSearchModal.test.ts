// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import type { Project } from '@/types/type'
import ProjectSearchModal from './ProjectSearchModal.vue'

function project(id: number, name: string, path: string): Project {
    return { id, name, slug: name, path, language: 'ts', workspace_id: null, claude_status: null, system_prompt: null }
}

const projects = [
    project(1, 'keera-api', '~/code/keera/api'),
    project(2, 'keera-web', '~/code/keera/web'),
    project(3, 'blog', '~/sites/blog'),
]

let wrapper: VueWrapper | undefined

function mountSearch() {
    wrapper = mount(ProjectSearchModal, { attachTo: document.body, props: { projects } })
    return wrapper
}

const names = (w: VueWrapper) => w.findAll('[data-testid="search-result"] .font-medium').map(el => el.text())

afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
})

describe('ProjectSearchModal', () => {
    it('focuses the input and lists every project', () => {
        const w = mountSearch()
        expect(document.activeElement).toBe(w.get('input').element)
        expect(names(w)).toEqual(['keera-api', 'keera-web', 'blog'])
    })

    it('filters by name or path, case-insensitively', async () => {
        const w = mountSearch()

        await w.get('input').setValue('WEB')
        expect(names(w)).toEqual(['keera-web'])

        await w.get('input').setValue('sites')
        expect(names(w)).toEqual(['blog'])

        await w.get('input').setValue('nothing')
        expect(w.text()).toContain('No projects found')
    })

    it('navigates with the arrow keys and opens with Enter', async () => {
        const w = mountSearch()
        const input = w.get('input')

        await input.trigger('keydown', { key: 'ArrowDown' })
        await input.trigger('keydown', { key: 'ArrowDown' })
        await input.trigger('keydown', { key: 'ArrowDown' })
        await input.trigger('keydown', { key: 'ArrowUp' })
        await input.trigger('keydown', { key: 'Enter' })

        expect(w.emitted('select')).toEqual([[projects[1]]])
        expect(w.emitted('close')).toHaveLength(1)
    })

    it('resets the cursor when the query changes', async () => {
        const w = mountSearch()
        await w.get('input').trigger('keydown', { key: 'ArrowDown' })

        await w.get('input').setValue('keera')
        await w.get('input').trigger('keydown', { key: 'Enter' })

        expect(w.emitted('select')).toEqual([[projects[0]]])
    })

    it('selects on click and clears the query', async () => {
        const w = mountSearch()
        await w.get('input').setValue('blog')

        await w.get('[aria-label="Clear search"]').trigger('click')
        expect(names(w)).toHaveLength(3)

        await w.findAll('[data-testid="search-result"]')[2].trigger('click')
        expect(w.emitted('select')).toEqual([[projects[2]]])
    })

    it('closes on Escape and on backdrop click', async () => {
        const w = mountSearch()

        await w.get('input').trigger('keydown', { key: 'Escape' })
        await w.get('[role="dialog"]').trigger('click')
        await w.get('[data-testid="search-backdrop"]').trigger('click')

        expect(w.emitted('close')).toHaveLength(2)
    })
})
