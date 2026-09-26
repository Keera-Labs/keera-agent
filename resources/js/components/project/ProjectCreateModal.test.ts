// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, h } from 'vue'
import type { Workspace } from '@/types/type'
import ProjectCreateModal from './ProjectCreateModal.vue'

const handleProjectCreated = vi.hoisted(() => vi.fn())

vi.mock('@/queries/projectsQuery', () => ({
    default: () => ({ handleProjectCreated }),
}))

vi.mock('@/queries/workspacesQuery', () => ({
    default: () => ({
        workspaces: computed<Workspace[]>(() => [
            { id: 1, name: 'Alpha', description: null },
            { id: 2, name: 'Beta', description: null },
        ]),
    }),
}))

type Reply = { ok: boolean; body: Record<string, unknown> }
let replies: Reply[]
let wrapper: VueWrapper | undefined

async function open(defaultWorkspaceId: number | null = null) {
    wrapper = mount(ProjectCreateModal, {
        attachTo: document.body,
        props: { defaultWorkspaceId },
        slots: { trigger: () => h('button', { id: 'open' }, 'Add') },
    })
    await wrapper.get('#open').trigger('click')
    return wrapper
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
const field = <T extends HTMLElement>(sel: string) => dialog()!.querySelector<T>(sel)!
const button = (label: string) => [...dialog()!.querySelectorAll('button')].find(b => b.textContent?.trim() === label)!
const sentBody = (i: number) => JSON.parse(vi.mocked(fetch).mock.calls[i][1]!.body as string)

function fill(name: string, path: string) {
    for (const [key, value] of [['name', name], ['path', path]]) {
        const input = field<HTMLInputElement>(`input[name="${key}"]`)
        input.value = value
        input.dispatchEvent(new Event('input'))
    }
}

async function submit() {
    field('form').dispatchEvent(new Event('submit'))
    await flushPromises()
}

beforeEach(() => {
    replies = []
    handleProjectCreated.mockReset()
    vi.stubGlobal('fetch', vi.fn(() => {
        const reply = replies.shift() ?? { ok: true, body: {} }
        return Promise.resolve({ ok: reply.ok, json: () => Promise.resolve(reply.body) })
    }))
})

afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    vi.unstubAllGlobals()
})

describe('ProjectCreateModal', () => {
    it('defaults to the given workspace, falling back to the first one', async () => {
        await open(2)
        expect(field<HTMLSelectElement>('select[name="workspace"]').value).toBe('2')
        wrapper!.unmount()

        await open(null)
        expect(field<HTMLSelectElement>('select[name="workspace"]').value).toBe('1')
    })

    it('creates the project and closes', async () => {
        const created = { id: 5, slug: 'demo' }
        replies.push({ ok: true, body: created })
        await open(1)

        fill('demo', '~/code/demo')
        await submit()

        expect(sentBody(0)).toEqual({ name: 'demo', path: '~/code/demo', language: 'Python', workspace_id: 1, create_dir: false })
        expect(handleProjectCreated).toHaveBeenCalledWith(created)
        expect(dialog()).toBeNull()
    })

    it('offers to create a missing directory and retries with create_dir', async () => {
        replies.push({ ok: false, body: { error: 'path_not_found', expanded: '/home/me/code/demo' } })
        replies.push({ ok: true, body: { id: 5, slug: 'demo' } })
        await open(1)

        fill('demo', '~/code/demo')
        await submit()

        expect(dialog()!.textContent).toContain('Directory not found')
        expect(dialog()!.textContent).toContain('/home/me/code/demo')

        button('Create & Add').click()
        await flushPromises()

        expect(sentBody(1).create_dir).toBe(true)
        expect(dialog()).toBeNull()
    })

    it('shows the server error and keeps the modal open', async () => {
        replies.push({ ok: false, body: { detail: 'Project already exists' } })
        await open(1)

        fill('demo', '~/code/demo')
        await submit()

        expect(dialog()!.textContent).toContain('Project already exists')
        expect(handleProjectCreated).not.toHaveBeenCalled()
    })

    it('resets the form when reopened', async () => {
        replies.push({ ok: false, body: { error: 'boom' } })
        const w = await open(1)
        fill('demo', '~/code/demo')
        await submit()

        button('Cancel').click()
        await flushPromises()
        await w.get('#open').trigger('click')

        expect(field<HTMLInputElement>('input[name="name"]').value).toBe('')
        expect(dialog()!.textContent).not.toContain('boom')
    })
})
