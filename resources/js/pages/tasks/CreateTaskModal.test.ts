// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { h } from 'vue'
import type { Project, Workspace } from '@/types/type'
import CreateTaskModal from './CreateTaskModal.vue'

const workspaces = [{ id: 10, name: 'Alpha' }, { id: 20, name: 'Beta' }] as Workspace[]
const projects = [
    { id: 1, name: 'Web', workspace_id: 10 },
    { id: 2, name: 'Api', workspace_id: 10 },
    { id: 3, name: 'Ops', workspace_id: 20 },
] as Project[]

let wrapper: VueWrapper | undefined

function memoryStorage() {
    const data = new Map<string, string>()
    return {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, v),
        removeItem: (k: string) => void data.delete(k),
    }
}

async function openModal(defaultProjectId: number | null = 2) {
    wrapper = mount(CreateTaskModal, {
        attachTo: document.body,
        props: { projects, workspaces, defaultProjectId },
        slots: { trigger: () => h('span', 'New') },
    })
    await wrapper.get('[role="button"]').trigger('click')
    return wrapper
}

const field = <T extends HTMLElement>(name: string) => document.querySelector<T>(`[name="${name}"]`)!
const form = () => document.querySelector('form')!
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
const optionLabels = (name: string) => [...field<HTMLSelectElement>(name).options].map(o => o.text)

async function setValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string, event = 'input') {
    el.value = value
    el.dispatchEvent(new Event(event))
    await wrapper!.vm.$nextTick()
}

async function submit() {
    form().dispatchEvent(new Event('submit'))
    await wrapper!.vm.$nextTick()
}

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()))

afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.unstubAllGlobals()
})

describe('CreateTaskModal', () => {
    it('preselects the page project and its workspace', async () => {
        await openModal(3)
        expect(field<HTMLSelectElement>('workspace').value).toBe('20')
        expect(field<HTMLSelectElement>('project').value).toBe('3')
        expect(optionLabels('project')).toEqual(['Select project', 'Ops'])
    })

    it('requires a title', async () => {
        const w = await openModal()
        await submit()
        expect(dialog()?.textContent).toContain('Title is required')
        expect(w.emitted('created')).toBeUndefined()
    })

    it('requires a project', async () => {
        const w = await openModal(null)
        await setValue(field('title'), 'Task')
        await submit()
        expect(dialog()?.textContent).toContain('Select a project')
        expect(w.emitted('created')).toBeUndefined()
    })

    it('emits the trimmed task and closes', async () => {
        const w = await openModal()
        await setValue(field('title'), '  Fix login  ')
        await setValue(field('body'), ' Steps ')
        const assignee = document.querySelector<HTMLInputElement>('input[placeholder="Add name and press Enter"]')!
        await setValue(assignee, 'Ana')
        assignee.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
        await w.vm.$nextTick()
        await submit()

        expect(w.emitted('created')).toEqual([[{ title: 'Fix login', body: 'Steps', assignees: ['Ana'], projectId: 2 }]])
        expect(dialog()).toBeNull()
    })

    it('switching workspace picks its first project and remembers both choices', async () => {
        const w = await openModal()
        await setValue(field('workspace'), '20', 'change')

        expect(field<HTMLSelectElement>('project').value).toBe('3')
        expect(localStorage.getItem('keera:task_workspace_id')).toBe('20')
        expect(localStorage.getItem('keera:task_project_id')).toBe('3')

        await setValue(field('workspace'), '', 'change')
        expect(optionLabels('project')).toEqual(['Select project', 'Web', 'Api', 'Ops'])
        expect(localStorage.getItem('keera:task_workspace_id')).toBeNull()
        expect(w.emitted('created')).toBeUndefined()
    })

    it('restores the remembered project and starts each open with an empty form', async () => {
        localStorage.setItem('keera:task_workspace_id', '10')
        localStorage.setItem('keera:task_project_id', '1')
        const w = await openModal(3)
        expect(field<HTMLSelectElement>('project').value).toBe('1')

        await setValue(field('title'), 'Draft')
        document.querySelector<HTMLButtonElement>('button[type="button"]')!.click()
        await w.vm.$nextTick()
        await w.get('[role="button"]').trigger('click')

        expect(field<HTMLInputElement>('title').value).toBe('')
    })

    it('ignores a remembered project that no longer exists', async () => {
        localStorage.setItem('keera:task_project_id', '99')
        await openModal(2)
        expect(field<HTMLSelectElement>('project').value).toBe('2')
    })
})
