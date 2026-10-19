// @vitest-environment happy-dom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installPinia } from '@/pages/agents/testing'
import type { GitWorktree, GitWorktreeChanges } from '@/queries/gitQuery'
import { useGitWorktreeStore } from '@/stores/gitWorktreeStore'
import type { Project } from '@/types/type'
import { gitStatus, gitWorktree } from '../source-control/testing'
import WorktreesView from './WorktreesView.vue'

vi.mock('@inertiajs/vue3', () => ({ router: { on: vi.fn(() => () => {}) }, usePage: () => ({ props: {}, component: 'Dashboard' }) }))

const AGENT_TREE = '/code/shop/.claude/worktrees/agent-7'
const CLEAN_TREE = '/code/shop/.worktrees/docs'

let worktrees: GitWorktree[]
let worktreeChanges: GitWorktreeChanges
let deleteReply: { status: number; body?: unknown }
const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const { pathname } = new URL(url, 'http://app')
    const path = pathname.replace('/api/projects/9/git', '')
    if (init?.method === 'DELETE') {
        const ok = deleteReply.status < 400
        if (ok) worktrees = worktrees.filter(w => w.path !== new URL(url, 'http://app').searchParams.get('worktree'))
        return Promise.resolve({ ok, status: deleteReply.status, json: () => Promise.resolve(deleteReply.body) })
    }
    const body = path === '/status' ? gitStatus()
        : path === '/worktrees' ? { worktrees }
        : path === '/worktrees/changes' ? { changes: worktreeChanges }
        : path === '/branches' ? { branches: ['dev', 'main'], default_base: 'dev' }
        : path === '/branch-changes' ? { base: 'dev', merge_base: 'base', head: 'head', ahead: 0, files: [] }
        : {}
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
})

const project = { id: 9, name: 'shop', path: '/code/shop' } as Project

beforeEach(() => {
    localStorage.clear()
    worktrees = [
        gitWorktree('/code/shop', { branch: 'dev', is_main: true, is_current: true }),
        gitWorktree(CLEAN_TREE, { branch: 'docs/frontend-structure-with-a-long-name' }),
        gitWorktree(AGENT_TREE, { branch: 'task/2034-diff', agent_id: 7, agent_name: 'Diff Frontend' }),
        gitWorktree('/tmp/gone', { branch: 'old', prunable: true }),
    ]
    worktreeChanges = { '/code/shop': 2, [AGENT_TREE]: 3, [CLEAN_TREE]: 0 }
    deleteReply = { status: 204 }
    fetchMock.mockClear()
    vi.stubGlobal('fetch', fetchMock)
})

enableAutoUnmount(afterEach)
afterEach(() => vi.unstubAllGlobals())

async function mountView() {
    const wrapper = mount(WorktreesView, { props: { project }, global: { plugins: [...installPinia()] }, attachTo: document.body })
    await flushPromises()
    return wrapper
}

const deleteCalls = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE').map(([url]) => url)
const dialog = () => document.querySelector<HTMLElement>('[data-testid="remove-worktree-dialog"]')

describe('WorktreesView', () => {
    it('highlights the current worktree and lists the rest with dirty ones first', async () => {
        const w = await mountView()

        const current = w.get('[data-testid="current-worktree"]')
        expect(current.text()).toContain('Main checkout')
        expect(current.text()).toContain('CURRENT')
        expect(current.text()).toContain('2 files')
        expect(w.get('[data-testid="worktree-total"]').text()).toBe('3')

        const rows = w.findAll('[data-testid="worktree-row"]')
        expect(rows.map(r => r.text())).toEqual([
            expect.stringContaining('Diff Frontend'),
            expect.stringContaining('docs'),
        ])
        expect(rows[0]!.get('[data-testid="worktree-changes"]').text()).toBe('3 files')
        expect(rows[0]!.text()).toContain('task/2034-diff')
        expect(rows[1]!.get('[data-testid="worktree-changes"]').text()).toBe('No changes')
    })

    it('opens a worktree in the Changes tab from its chevron', async () => {
        const w = await mountView()

        await w.findAll('[data-testid="open-worktree"]')[0]!.trigger('click')

        expect(useGitWorktreeStore().selected[9]).toBe(AGENT_TREE)
        expect(w.emitted('open')).toHaveLength(1)
    })

    it('hides the remove button on the main worktree', async () => {
        localStorage.setItem('keera.git.worktree', JSON.stringify({ 9: AGENT_TREE }))
        const w = await mountView()

        const main = w.findAll('[data-testid="worktree-row"]').find(r => r.text().includes('Main checkout'))!
        expect(main.get('[data-testid="remove-worktree"]').attributes('disabled')).toBeDefined()
    })

    it('warns about uncommitted files and force-removes after confirmation', async () => {
        const w = await mountView()

        await w.findAll('[data-testid="remove-worktree"]')[0]!.trigger('click')
        expect(dialog()!.querySelector('[data-testid="remove-worktree-warning"]')!.textContent)
            .toContain('3 uncommitted files will be permanently lost.')
        dialog()!.querySelector<HTMLElement>('[data-testid="confirm-remove-worktree"]')!.click()
        await flushPromises()

        expect(deleteCalls()).toEqual([`/api/projects/9/git/worktrees?worktree=${encodeURIComponent(AGENT_TREE)}&force=true`])
        expect(dialog()).toBeNull()
        expect(w.findAll('[data-testid="worktree-row"]')).toHaveLength(1)
    })

    it('removes a clean worktree without forcing', async () => {
        const w = await mountView()

        await w.findAll('[data-testid="remove-worktree"]')[1]!.trigger('click')
        expect(dialog()!.querySelector('[data-testid="remove-worktree-warning"]')).toBeNull()
        dialog()!.querySelector<HTMLElement>('[data-testid="confirm-remove-worktree"]')!.click()
        await flushPromises()

        expect(deleteCalls()).toEqual([`/api/projects/9/git/worktrees?worktree=${encodeURIComponent(CLEAN_TREE)}&force=false`])
    })

    it('keeps the dialog open with the server error when removal is refused', async () => {
        deleteReply = { status: 409, body: { error: 'The worktree is locked by a running session' } }
        const w = await mountView()

        await w.findAll('[data-testid="remove-worktree"]')[0]!.trigger('click')
        dialog()!.querySelector<HTMLElement>('[data-testid="confirm-remove-worktree"]')!.click()
        await flushPromises()

        expect(dialog()!.querySelector('[role="alert"]')!.textContent).toBe('The worktree is locked by a running session')
    })
})
