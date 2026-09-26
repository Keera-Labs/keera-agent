// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installPinia } from '@/pages/agents/testing'
import type { GitPullRequestInfo, GitStatus } from '@/queries/gitQuery'
import type { Project } from '@/types/type'
import SourceControl from './SourceControl.vue'
import { gitFile, gitStatus } from './testing'

vi.mock('@inertiajs/vue3', () => ({ router: { on: vi.fn(() => () => {}) }, usePage: () => ({ props: {}, component: 'Dashboard' }) }))

type Reply = { body: unknown; status?: number }

let status: GitStatus
let pullRequestInfo: GitPullRequestInfo
let posts: Record<string, Reply>
const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const path = url.replace('/api/projects/9/git', '')
    const reply: Reply = init?.method === 'POST'
        ? posts[path] ?? { body: { detail: 'unexpected' }, status: 500 }
        : { body: path === '/status' ? status : path === '/pull-request' ? pullRequestInfo : { commits: [] } }
    const code = reply.status ?? 200
    return Promise.resolve({ ok: code < 400, status: code, json: () => Promise.resolve(reply.body) })
})

const project = { id: 9, name: 'shop', path: '/code/shop' } as Project

// The reference screenshot's tree: two staged files and three unstaged ones.
const referenceStatus = () => gitStatus({
    staged: [gitFile('src/checkout/promo.ts', { additions: 5, deletions: 2 }), gitFile('src/checkout/promo.test.ts', { status: 'A', additions: 18 })],
    changes: [
        gitFile('app/admin/admin_controller.py', { additions: 3, deletions: 1 }),
        gitFile('app/tasks.py', { additions: 12, deletions: 4 }),
        gitFile('app/bootstrap.py', { status: 'U', untracked: true, additions: 40 }),
    ],
    count: 5,
})

beforeEach(() => {
    status = referenceStatus()
    pullRequestInfo = { available: true, error: null, pull_request: null }
    posts = {}
    fetchMock.mockClear()
    vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

async function mountPanel() {
    const wrapper = mount(SourceControl, { props: { project }, global: { plugins: [...installPinia()] }, attachTo: document.body })
    await flushPromises()
    return wrapper
}

const postedTo = (path: string) =>
    fetchMock.mock.calls.filter(([url, init]) => init?.method === 'POST' && url === `/api/projects/9/git${path}`)

describe('SourceControl', () => {
    it('lists staged and unstaged changes with counts, status letters and line stats', async () => {
        const w = await mountPanel()

        expect(w.get('[data-testid="branch-pill"]').text()).toBe('fix/eu-promo-checkout')
        const staged = w.get('[data-testid="staged-changes"]')
        const changes = w.get('[data-testid="changes"]')
        expect(staged.text()).toContain('Staged changes')
        expect(staged.findAll('li')).toHaveLength(2)
        expect(changes.findAll('li')).toHaveLength(3)
        expect(changes.find('section > div').text()).toContain('3')

        const rows = changes.findAll('li')
        expect(rows[0].text()).toContain('admin_controller.py')
        expect(rows[0].text()).toContain('app/admin')
        expect(rows[0].get('[aria-label="Modified"]').text()).toBe('M')
        expect(rows[0].get('[data-testid="line-stats"]').text()).toBe('+3-1')
        expect(rows[2].get('[aria-label="Untracked"]').text()).toBe('U')
        expect(rows[2].get('[data-testid="line-stats"]').text()).toBe('untracked')
        expect(staged.find('li [aria-label="Staged, added"]').exists()).toBe(true)
    })

    it('stages everything from the primary button', async () => {
        posts['/stage'] = { body: gitStatus({ staged: [...status.staged, ...status.changes], count: 5 }) }
        const w = await mountPanel()

        const primary = w.get('[data-testid="primary-action"]')
        expect(primary.text()).toBe('Stage All')
        await primary.trigger('click')
        await flushPromises()

        expect(postedTo('/stage')[0][1]?.body).toBe('{"all":true}')
        expect(w.find('[data-testid="changes"]').exists()).toBe(false)
        expect(w.get('[data-testid="primary-action"]').text()).toBe('Commit')
    })

    it('stages and unstages a single file from its row', async () => {
        posts['/stage'] = { body: status }
        posts['/unstage'] = { body: status }
        const w = await mountPanel()

        await w.get('[aria-label="Stage app/tasks.py"]').trigger('click')
        await flushPromises()
        await w.get('[aria-label="Unstage src/checkout/promo.ts"]').trigger('click')
        await flushPromises()

        expect(postedTo('/stage')[0][1]?.body).toBe('{"paths":["app/tasks.py"]}')
        expect(postedTo('/unstage')[0][1]?.body).toBe('{"paths":["src/checkout/promo.ts"]}')
    })

    it('keeps Commit disabled until there is a message, then commits and clears it', async () => {
        status = gitStatus({ staged: [gitFile('src/checkout/promo.ts')], count: 1 })
        posts['/commits'] = { status: 201, body: { sha: 'abc', short_sha: 'abc', subject: 'Fix', status: gitStatus({ ahead: 1 }) } }
        const w = await mountPanel()

        const primary = () => w.get('[data-testid="primary-action"]')
        expect(primary().text()).toBe('Commit')
        expect(primary().attributes('disabled')).toBeDefined()
        expect(primary().attributes('title')).toBe('Enter a commit message')

        await w.get('textarea').setValue('   ')
        expect(primary().attributes('disabled')).toBeDefined()

        await w.get('textarea').setValue('Fix EU promo checkout tax ordering')
        expect(primary().attributes('disabled')).toBeUndefined()
        await primary().trigger('click')
        await flushPromises()

        expect(postedTo('/commits')[0][1]?.body).toBe('{"message":"Fix EU promo checkout tax ordering"}')
        expect((w.get('textarea').element as HTMLTextAreaElement).value).toBe('')
        expect(w.find('[data-testid="clean-tree"]').exists()).toBe(true)
    })

    it('commits and pushes from the dropdown', async () => {
        posts['/commits'] = { status: 201, body: { sha: 'abc', short_sha: 'abc', subject: 'Fix', status: gitStatus({ ahead: 1 }) } }
        posts['/push'] = { body: { branch: 'fix/eu-promo-checkout', upstream: 'origin/fix/eu-promo-checkout', output: '', status: gitStatus() } }
        const w = await mountPanel()

        await w.get('textarea').setValue('Fix')
        await w.get('[aria-label="More commit actions"]').trigger('click')
        const item = w.findAll('[role="menuitem"]').find(b => b.text() === 'Commit & Push')!
        await item.trigger('click')
        await flushPromises()

        expect(postedTo('/commits')).toHaveLength(1)
        expect(postedTo('/push')).toHaveLength(1)
        const order = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').map(([url]) => url.split('/').pop())
        expect(order).toEqual(['commits', 'push'])
    })

    it('shows the git error inline when a push is rejected', async () => {
        posts['/push'] = { status: 409, body: { detail: 'rejected: non-fast-forward' } }
        const w = await mountPanel()

        await w.get('[aria-label="More actions"]').trigger('click')
        await w.findAll('[role="menuitem"]').find(b => b.text() === 'Push')!.trigger('click')
        await flushPromises()

        expect(w.get('[data-testid="action-error"]').text()).toContain('rejected: non-fast-forward')
        await w.get('[data-testid="action-error"] button').trigger('click')
        expect(w.find('[data-testid="action-error"]').exists()).toBe(false)
    })

    it('links to the open pull request of the current branch', async () => {
        pullRequestInfo = {
            available: true,
            error: null,
            pull_request: { number: 7, url: 'https://github.com/acme/shop/pull/7', title: 'Fix promo', state: 'OPEN', is_draft: false, base: 'dev', head: 'fix/eu-promo-checkout' },
        }
        const w = await mountPanel()

        const link = w.get('[data-testid="pr-created"]')
        expect(link.text()).toBe('PR Created')
        expect(link.attributes('href')).toBe('https://github.com/acme/shop/pull/7')
        expect(w.find('[data-testid="create-pr"]').exists()).toBe(false)
    })

    it('creates a pull request and then shows it as created', async () => {
        posts['/pull-request'] = {
            status: 201,
            body: { pull_request: { number: 8, url: 'https://github.com/acme/shop/pull/8', title: 'Fix', state: 'OPEN', is_draft: false, base: 'dev', head: 'fix' } },
        }
        const w = await mountPanel()

        await w.get('[data-testid="create-pr"]').trigger('click')
        await flushPromises()

        expect(postedTo('/pull-request')).toHaveLength(1)
        expect(w.get('[data-testid="pr-created"]').attributes('href')).toBe('https://github.com/acme/shop/pull/8')
    })

    it('replaces Create PR with the gh message when gh is unavailable', async () => {
        pullRequestInfo = { available: false, error: 'gh is not authenticated. Run `gh auth login`.', pull_request: null }
        const w = await mountPanel()

        expect(w.get('[data-testid="pr-unavailable"]').text()).toContain('gh is not authenticated')
        expect(w.find('[data-testid="create-pr"]').exists()).toBe(false)
        await w.get('[aria-label="More commit actions"]').trigger('click')
        expect(w.findAll('[role="menuitem"]').find(b => b.text() === 'Create PR')!.attributes('disabled')).toBeDefined()
    })

    it('disables pushing and Create PR on a detached HEAD', async () => {
        status = gitStatus({ branch: null, detached: true, head: 'a1b2c3d' })
        const w = await mountPanel()

        expect(w.get('[data-testid="branch-pill"]').text()).toBe('detached @ a1b2c3d')
        expect(w.get('[data-testid="create-pr"]').attributes('disabled')).toBeDefined()
    })

    it('shows a clean tree', async () => {
        status = gitStatus()
        const w = await mountPanel()
        expect(w.get('[data-testid="clean-tree"]').text()).toContain('No changes')
    })

    it('explains when the project is not a git repository', async () => {
        status = gitStatus({ is_repo: false, branch: null })
        const w = await mountPanel()

        expect(w.get('[data-testid="not-a-repo"]').text()).toContain('Not a git repository')
        expect(w.find('textarea').exists()).toBe(false)
        expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/pull-request'))).toBe(false)
    })

    it('collapses a section', async () => {
        const w = await mountPanel()
        const section = w.get('[data-testid="changes"]')
        await section.get('button[aria-expanded]').trigger('click')
        expect(section.get('ul').isVisible()).toBe(false)
    })

    it('keeps the draft message when the panel remounts', async () => {
        const first = await mountPanel()
        await first.get('textarea').setValue('Half-written message')
        first.unmount()

        const second = await mountPanel()
        expect((second.get('textarea').element as HTMLTextAreaElement).value).toBe('Half-written message')
    })
})
