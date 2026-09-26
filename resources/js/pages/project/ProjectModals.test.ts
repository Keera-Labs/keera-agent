// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, h, ref, type Component } from 'vue'
import type { Project, Workspace } from '@/types/type'
import ProjectDeleteModal from './ProjectDeleteModal.vue'
import ProjectEditModal from './ProjectEditModal.vue'
import ProjectMoveModal from './ProjectMoveModal.vue'

const projects = vi.hoisted(() => ({
    handleMoveProject: vi.fn(),
    handleProjectUpdated: vi.fn(),
    handleProjectDeleted: vi.fn(),
}))

vi.mock('@/queries/projectsQuery', () => ({
    default: () => ({ ...projects, deleting: ref(false) }),
}))

vi.mock('@/queries/workspacesQuery', () => ({
    default: () => ({
        workspaces: computed<Workspace[]>(() => [
            { id: 1, name: 'Alpha', description: null },
            { id: 2, name: 'Beta', description: null },
        ]),
    }),
}))

vi.mock('@/components/modals/ProjectTemplatesModal.vue', () => ({
    default: { props: ['projectId', 'projectName'], template: '<div data-testid="templates">{{ projectName }}</div>' },
}))

const project: Project = {
    id: 7, name: 'demo', slug: 'demo', path: '~/code/demo', language: 'Python',
    workspace_id: 1, claude_status: null, system_prompt: null,
}

let wrapper: VueWrapper | undefined

async function open(component: Component) {
    wrapper = mount(component, {
        attachTo: document.body,
        props: { project },
        slots: { trigger: () => h('button', { id: 'open' }, 'Open') },
    })
    await wrapper.get('#open').trigger('click')
    return wrapper
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
const button = (label: string) => [...dialog()!.querySelectorAll('button')].find(b => b.textContent?.includes(label))!

beforeEach(() => {
    Object.values(projects).forEach(fn => fn.mockReset())
})

afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.unstubAllGlobals()
    vi.useRealTimers()
})

describe('ProjectMoveModal', () => {
    it('marks the current workspace and moves to another', async () => {
        projects.handleMoveProject.mockResolvedValue(undefined)
        const w = await open(ProjectMoveModal)

        expect(button('Alpha').textContent).toContain('current')
        button('Beta').click()
        await flushPromises()

        expect(projects.handleMoveProject).toHaveBeenCalledWith(project, 2)
        expect(dialog()).toBeNull()
        expect(w.emitted('openChange')).toEqual([[true], [false]])
    })

    it('closes without a request when the current workspace is picked', async () => {
        await open(ProjectMoveModal)

        button('Alpha').click()
        await flushPromises()

        expect(projects.handleMoveProject).not.toHaveBeenCalled()
        expect(dialog()).toBeNull()
    })

    it('shows an error and stays open when the move fails', async () => {
        projects.handleMoveProject.mockRejectedValue(new Error('nope'))
        await open(ProjectMoveModal)

        button('Unassigned').click()
        await flushPromises()

        expect(projects.handleMoveProject).toHaveBeenCalledWith(project, null)
        expect(dialog()!.textContent).toContain('Failed to move project')
    })
})

describe('ProjectDeleteModal', () => {
    it('deletes the project and closes', async () => {
        projects.handleProjectDeleted.mockResolvedValue(7)
        await open(ProjectDeleteModal)

        expect(dialog()!.textContent).toContain('demo')
        button('Delete').click()
        await flushPromises()

        expect(projects.handleProjectDeleted).toHaveBeenCalledWith(7)
        expect(dialog()).toBeNull()
    })

    it('stays open when the delete fails', async () => {
        projects.handleProjectDeleted.mockRejectedValue(new Error('nope'))
        await open(ProjectDeleteModal)

        button('Delete').click()
        await flushPromises()

        expect(dialog()).not.toBeNull()
    })
})

describe('ProjectEditModal', () => {
    it('saves the trimmed path, confirms, then closes', async () => {
        vi.useFakeTimers()
        const updated = { ...project, path: '/new/path' }
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(updated) })))
        await open(ProjectEditModal)

        const input = dialog()!.querySelector<HTMLInputElement>('input[name="path"]')!
        expect(input.value).toBe('~/code/demo')
        input.value = '  /new/path  '
        input.dispatchEvent(new Event('input'))
        dialog()!.querySelector('form')!.dispatchEvent(new Event('submit'))
        await flushPromises()

        const [url, init] = vi.mocked(fetch).mock.calls[0]
        expect(url).toBe('/api/projects/7')
        expect(init).toMatchObject({ method: 'PATCH', body: JSON.stringify({ path: '/new/path' }) })
        expect(projects.handleProjectUpdated).toHaveBeenCalledWith(updated)
        expect(dialog()!.textContent).toContain('✓ Saved')

        vi.advanceTimersByTime(1000)
        await flushPromises()
        expect(dialog()).toBeNull()
    })

    it('shows an error when the save fails', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })))
        await open(ProjectEditModal)

        dialog()!.querySelector('form')!.dispatchEvent(new Event('submit'))
        await flushPromises()

        expect(dialog()!.textContent).toContain('Something went wrong')
        expect(projects.handleProjectUpdated).not.toHaveBeenCalled()
    })

    it('opens the project templates manager', async () => {
        await open(ProjectEditModal)

        button('Manage agent templates').click()
        await flushPromises()

        expect(dialog()!.querySelector('[data-testid="templates"]')!.textContent).toBe('demo')
    })
})
