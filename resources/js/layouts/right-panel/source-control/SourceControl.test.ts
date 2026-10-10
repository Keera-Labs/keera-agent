// @vitest-environment happy-dom
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installPinia } from '@/pages/agents/testing'
import type { GitBranchChanges, GitBranches, GitPullRequestInfo, GitStatus, GitWorktree, GitWorktreeChanges } from '@/queries/gitQuery'
import { useDiffStore } from '@/stores/diffStore'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'
import type { Project } from '@/types/type'
import SourceControl from './SourceControl.vue'
import { gitFile, gitStatus, gitWorktree } from './testing'

vi.mock('@inertiajs/vue3', () => ({ router: { on: vi.fn(() => () => {}) }, usePage: () => ({ props: {}, component: 'Dashboard' }) }))

type Reply = { body: unknown; status?: number }

const AGENT_TREE = '/code/shop/.claude/worktrees/agent-7'

let branchChanges: GitBranchChanges
let branches: GitBranches
let status: GitStatus
let agentStatus: GitStatus
let worktrees: GitWorktree[]
let worktreeChanges: GitWorktreeChanges
let pullRequestInfo: GitPullRequestInfo
let posts: Record<string, Reply>
const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const { pathname, searchParams } = new URL(url, 'http://app')
    const path = pathname.replace('/api/projects/9/git', '')
    const inAgentTree = searchParams.get('worktree') === AGENT_TREE
    const reply: Reply = init?.method === 'POST'
        ? posts[path] ?? { body: { detail: 'unexpected' }, status: 500 }
        : {
            body: path === '/status' ? (inAgentTree ? agentStatus : status)
                : path === '/branch-changes' ? { ...branchChanges, base: searchParams.get('base') ?? branchChanges.base }
                : path === '/branches' ? branches
                : path === '/pull-request' ? pullRequestInfo
                : path === '/worktrees' ? { worktrees }
                : path === '/worktrees/changes' ? { changes: worktreeChanges }
                : { commits: [] },
        }
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
    localStorage.clear()
    branchChanges = { base: 'dev', merge_base: 'base', head: 'head', ahead: 0, files: [] }
    branches = { branches: ['dev', 'main', 'fix/eu-promo-checkout', 'origin/main'], default_base: 'dev' }
    status = referenceStatus()
    agentStatus = gitStatus({ branch: 'task/2034-diff', changes: [gitFile('resources/js/DiffPane.vue', { status: 'A', untracked: true })], count: 1 })
    worktrees = [
        gitWorktree('/code/shop', { branch: 'fix/eu-promo-checkout', is_main: true, is_current: true }),
        gitWorktree(AGENT_TREE, { branch: 'task/2034-diff', agent_id: 7, agent_name: 'Diff Frontend' }),
        gitWorktree('/tmp/gone', { branch: 'old', prunable: true }),
    ]
    worktreeChanges = {}
    pullRequestInfo = { available: true, error: null, pull_request: null }
    posts = {}
    fetchMock.mockClear()
    vi.stubGlobal('fetch', fetchMock)
})

enableAutoUnmount(afterEach)
afterEach(() => vi.unstubAllGlobals())

async function mountPanel() {
    const wrapper = mount(SourceControl, { props: { project }, global: { plugins: [...installPinia()] }, attachTo: document.body })
    useProjectStore().setActiveProject(project)
    await flushPromises()
    return wrapper
}

const postedTo = (path: string) =>
    fetchMock.mock.calls.filter(([url, init]) => init?.method === 'POST' && url === `/api/projects/9/git${path}`)

describe('SourceControl', () => {
    it('lists staged and unstaged changes in one list with checkboxes, status letters and line stats', async () => {
        const w = await mountPanel()

        expect(w.get('[data-testid="branch-pill"]').text()).toBe('fix/eu-promo-checkout')
        const changes = w.get('[data-testid="changes"]')
        expect(changes.text()).toContain('Changes')
        expect(changes.get('[data-testid="staged-count"]').text()).toBe('2 of 5 staged')

        const rows = changes.findAll('li')
        expect(rows.map(row => row.attributes('data-state'))).toEqual(['staged', 'staged', 'unstaged', 'unstaged', 'unstaged'])
        expect((rows[0].get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true)
        expect((rows[2].get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false)
        expect(rows[1].get('[aria-label="Added"]').text()).toBe('A')
        expect(rows[2].text()).toContain('admin_controller.py')
        expect(rows[2].text()).toContain('app/admin')
        expect(rows[2].get('[aria-label="Modified"]').text()).toBe('M')
        expect(rows[2].get('[data-testid="line-stats"]').text()).toBe('+3-1')
        expect(rows[4].get('[aria-label="Untracked"]').text()).toBe('U')
        expect(rows[4].get('[data-testid="line-stats"]').text()).toBe('+40')
    })

    it('lists a partly staged file once, as an indeterminate row that stages the rest', async () => {
        status = gitStatus({ staged: [gitFile('app/tasks.py', { additions: 1 })], changes: [gitFile('app/tasks.py', { additions: 4 })], count: 1 })
        posts['/stage'] = { body: status }
        const w = await mountPanel()

        const rows = w.get('[data-testid="changes"]').findAll('li')
        expect(rows).toHaveLength(1)
        expect((rows[0].get('input').element as HTMLInputElement).indeterminate).toBe(true)
        expect(rows[0].get('[data-testid="line-stats"]').text()).toBe('+4')
        expect(w.get('[data-testid="staged-count"]').text()).toBe('1 of 1 staged')
        expect(w.get('[data-testid="primary-action"]').text()).toBe('Commit 1 file')
        await rows[0].get('[aria-label="Stage app/tasks.py"]').trigger('click')
        await flushPromises()
        expect(postedTo('/stage')[0][1]?.body).toBe('{"paths":["app/tasks.py"]}')
    })

    it('stages everything from the select-all checkbox, then unstages everything from it', async () => {
        posts['/stage'] = { body: gitStatus({ staged: [...status.staged, ...status.changes], count: 5 }) }
        posts['/unstage'] = { body: status }
        const w = await mountPanel()

        const selectAll = () => w.get('[data-testid="changes"] > div input[type="checkbox"]')
        expect((selectAll().element as HTMLInputElement).indeterminate).toBe(true)
        await w.get('[aria-label="Stage all"]').trigger('click')
        await flushPromises()

        expect(postedTo('/stage')[0][1]?.body).toBe('{"all":true}')
        expect(w.get('[data-testid="staged-count"]').text()).toBe('5 of 5 staged')
        expect(w.get('[data-testid="primary-action"]').text()).toBe('Commit 5 files')

        await w.get('[aria-label="Unstage all"]').trigger('click')
        await flushPromises()
        expect(postedTo('/unstage')[0][1]?.body).toBe('{"all":true}')
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
        expect(primary().text()).toBe('Commit 1 file')
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

    it('commits with ⌘↵ and commits and pushes with ⌘⇧↵', async () => {
        posts['/commits'] = { status: 201, body: { sha: 'abc', short_sha: 'abc', subject: 'Fix', status: status } }
        posts['/push'] = { body: { branch: 'fix/eu-promo-checkout', upstream: 'origin/fix/eu-promo-checkout', output: '', status: status } }
        const w = await mountPanel()

        await w.get('textarea').setValue('Fix')
        await w.get('textarea').trigger('keydown', { key: 'Enter', metaKey: true })
        await flushPromises()
        expect(postedTo('/commits')).toHaveLength(1)
        expect(postedTo('/push')).toHaveLength(0)

        await w.get('textarea').setValue('Fix again')
        await w.get('textarea').trigger('keydown', { key: 'Enter', metaKey: true, shiftKey: true })
        await flushPromises()
        expect(postedTo('/commits')).toHaveLength(2)
        expect(postedTo('/push')).toHaveLength(1)
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

    it('shows committed changes separately and opens a committed diff', async () => {
        status = gitStatus()
        branchChanges = { base: 'dev', merge_base: 'base', head: 'head', ahead: 2, files: [gitFile('src/feature.ts')] }
        const w = await mountPanel()
        expect(w.find('[data-testid="clean-tree"]').exists()).toBe(false)
        const section = w.get('[data-testid="committed-changes"]')
        expect(section.text()).toContain('2 commits ahead of dev')
        expect(w.get('[data-testid="base-picker"]').text()).toBe('dev')
        expect(w.get('[data-testid="ahead-of-base"]').text()).toBe('2 ahead of dev')
        expect(section.find('[aria-label^="Stage"]').exists()).toBe(false)
        await section.get('button[title^="Show changes"]').trigger('click')
        expect(useDiffStore().activeTab).toMatchObject({ path: 'src/feature.ts', committed: true, base: 'dev' })
    })

    it('refreshes committed files immediately after commit and push', async () => {
        status = gitStatus({ upstream: 'origin/feature', staged: [gitFile('src/feature.ts')], count: 1 })
        const w = await mountPanel()
        branchChanges = { base: 'dev', merge_base: 'base', head: 'head', ahead: 1, files: [gitFile('src/feature.ts')] }
        posts['/commits'] = { body: { status: gitStatus({ upstream: 'origin/feature' }) } }
        posts['/push'] = posts['/commits']!
        const changeCountReads = () => fetchMock.mock.calls.filter(([url]) => url.endsWith('/worktrees/changes')).length
        expect(changeCountReads()).toBe(1)
        await w.get('textarea').setValue('Feature')
        await w.get('[data-testid="primary-action"]').trigger('click')
        await flushPromises()
        expect(changeCountReads()).toBe(2)
        expect(w.get('[data-testid="committed-changes"]').text()).toContain('feature.ts')
        expect(w.find('[data-testid="clean-tree"]').exists()).toBe(false)
        for (const action of ['Push']) {
            await w.get('[aria-label="More actions"]').trigger('click')
            await w.findAll('[role="menuitem"]').find(b => b.text() === action)!.trigger('click')
            await flushPromises()
        }
        expect(fetchMock.mock.calls.filter(([url, init]) => url.endsWith('/branch-changes') && !init?.method)).toHaveLength(3)
    })

    describe('window focus', () => {
        const gets = (path: string) => fetchMock.mock.calls.filter(([url, init]) => url.startsWith(`/api/projects/9/git${path}`) && !init?.method).length
        // Past the 5s staleTime of status and branch changes, within the 30s of the pull request lookup.
        const AWAY_MS = 10_000

        beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }))
        afterEach(() => vi.useRealTimers())

        const focus = () => window.dispatchEvent(new Event('focus'))
        const becomeVisible = () => document.dispatchEvent(new Event('visibilitychange'))

        it('refetches status and branch changes when switching back from another app', async () => {
            status = gitStatus()
            const w = await mountPanel()
            const before = { status: gets('/status'), branch: gets('/branch-changes'), pr: gets('/pull-request') }
            branchChanges = { base: 'dev', merge_base: 'base', head: 'new', ahead: 1, files: [gitFile('src/outside.ts')] }
            vi.advanceTimersByTime(AWAY_MS)

            focus()
            await flushPromises()

            expect(gets('/status')).toBe(before.status + 1)
            expect(gets('/branch-changes')).toBe(before.branch + 1)
            expect(gets('/pull-request')).toBe(before.pr)
            expect(w.get('[data-testid="committed-changes"]').text()).toContain('outside.ts')
        })

        it('fetches once when focus and visibilitychange arrive together, in either order', async () => {
            await mountPanel()
            for (const events of [[focus, becomeVisible], [becomeVisible, focus]]) {
                vi.advanceTimersByTime(AWAY_MS)
                const before = { status: gets('/status'), branch: gets('/branch-changes') }
                // Both while the fetch is in flight, then both again once it has landed.
                events.forEach(dispatch => dispatch())
                await flushPromises()
                events.forEach(dispatch => dispatch())
                await flushPromises()
                expect(gets('/status')).toBe(before.status + 1)
                expect(gets('/branch-changes')).toBe(before.branch + 1)
            }
        })

        it('stops listening once the panel unmounts', async () => {
            const w = await mountPanel()
            const remove = vi.spyOn(window, 'removeEventListener')
            w.unmount()
            expect(remove).toHaveBeenCalledWith('focus', expect.any(Function))
            remove.mockRestore()
        })
    })

    it('keeps a section for commits whose net diff is empty', async () => {
        status = gitStatus()
        branchChanges.ahead = 2
        const w = await mountPanel()
        expect(w.find('[data-testid="clean-tree"]').exists()).toBe(false)
        expect(w.get('[data-testid="committed-changes"]').text()).toContain('2 commits ahead')
    })

    it('does not claim a clean branch when no base can be resolved', async () => {
        status = gitStatus()
        branchChanges.merge_base = null
        const w = await mountPanel()
        expect(w.find('[data-testid="clean-tree"]').exists()).toBe(false)
        expect(w.text()).toContain('No shared base branch found')
    })

    it('shows a clean tree naming the checkout, without a committed section or worktree list', async () => {
        status = gitStatus()
        worktreeChanges = { '/code/shop': 0, [AGENT_TREE]: 0 }
        const w = await mountPanel()
        const clean = w.get('[data-testid="clean-tree"]')
        expect(clean.text()).toContain('No changes')
        expect(clean.text()).toContain('Nothing to commit in the main checkout.')
        expect(w.get('[data-testid="ahead-of-base"]').text()).toBe('0 ahead of dev')
        expect(w.get('[data-testid="base-picker"]').text()).toBe('dev')
        expect(w.find('[data-testid="committed-changes"]').exists()).toBe(false)
        expect(w.find('[data-testid="dirty-worktrees"]').exists()).toBe(false)
    })

    it('lists other worktrees with uncommitted changes and switches to one on click', async () => {
        status = gitStatus()
        worktreeChanges = { '/code/shop': 0, [AGENT_TREE]: 3, '/tmp/gone': 4 }
        const w = await mountPanel()

        const rows = w.findAll('[data-testid="dirty-worktree"]')
        expect(rows).toHaveLength(1)
        expect(rows[0]!.text()).toContain('Diff Frontend')
        expect(rows[0]!.text()).toContain('task/2034-diff')
        expect(rows[0]!.text()).toContain('3 files')

        await rows[0]!.trigger('click')
        await flushPromises()

        expect(fetchMock).toHaveBeenCalledWith(`/api/projects/9/git/status?worktree=${encodeURIComponent(AGENT_TREE)}`, expect.anything())
        expect(w.get('[data-testid="worktree-label"]').text()).toBe('Diff Frontend')
        expect(w.find('[data-testid="dirty-worktrees"]').exists()).toBe(false)
    })

    it('caps the dirty worktree list and points at the menu for the rest', async () => {
        status = gitStatus()
        worktrees = [worktrees[0]!, ...Array.from({ length: 7 }, (_, i) => gitWorktree(`/code/shop/.claude/worktrees/agent-${i + 20}`))]
        worktreeChanges = Object.fromEntries(worktrees.map(w => [w.path, 1]))
        const w = await mountPanel()

        expect(w.findAll('[data-testid="dirty-worktree"]')).toHaveLength(5)
        expect(w.get('[data-testid="dirty-worktrees-more"]').text()).toBe('2 more in the worktree menu above.')
    })

    it('hides other worktrees while the viewed checkout has its own changes', async () => {
        worktreeChanges = { '/code/shop': 5, [AGENT_TREE]: 3 }
        const w = await mountPanel()
        expect(w.find('[data-testid="dirty-worktrees"]').exists()).toBe(false)
    })

    it('shows each worktree\'s uncommitted file count in the worktree menu', async () => {
        worktreeChanges = { '/code/shop': 5, [AGENT_TREE]: 0 }
        const w = await mountPanel()
        await w.get('[data-testid="branch-pill"]').trigger('click')
        const options = w.findAll('[data-testid="worktree-option"]')
        expect(options[0]!.get('[data-testid="worktree-changes"]').text()).toBe('5')
        expect(options[0]!.get('[data-testid="worktree-changes"]').attributes('title')).toBe('5 uncommitted files')
        expect(options[1]!.find('[data-testid="worktree-changes"]').exists()).toBe(false)
    })

    it('says the working tree is clean while the branch still has commits', async () => {
        status = gitStatus()
        branchChanges = { ...branchChanges, ahead: 1, files: [gitFile('src/feature.ts')] }
        const w = await mountPanel()
        expect(w.get('[data-testid="no-uncommitted"]').text()).toBe('No uncommitted changes in the main checkout.')
    })

    it('hides the committed section but keeps the base picker when the branch has nothing ahead of its base', async () => {
        const w = await mountPanel()
        expect(w.find('[data-testid="changes"]').exists()).toBe(true)
        expect(w.find('[data-testid="committed-changes"]').exists()).toBe(false)
        expect(w.find('[data-testid="clean-tree"]').exists()).toBe(false)
        expect(w.get('[data-testid="ahead-of-base"]').text()).toBe('0 ahead of dev')

        await w.get('[data-testid="base-picker"]').trigger('click')
        await w.findAll('[data-testid="base-option"]').find(option => option.text() === 'main')!.trigger('click')
        await flushPromises()

        expect(fetchMock).toHaveBeenCalledWith('/api/projects/9/git/branch-changes?base=main', expect.anything())
        expect(w.get('[data-testid="base-picker"]').text()).toBe('main')
    })

    it('keeps the base picker reachable when the picked base shares no history', async () => {
        localStorage.setItem('keera.git.base', JSON.stringify({ 9: 'main' }))
        branchChanges.merge_base = null
        const w = await mountPanel()
        expect(w.text()).toContain('No shared base branch found')
        expect(w.find('[data-testid="ahead-of-base"]').exists()).toBe(false)
        expect(w.get('[data-testid="base-picker"]').text()).toBe('main')
    })

    it('has no base picker before the first commit', async () => {
        status = gitStatus({ has_commits: false })
        const w = await mountPanel()
        expect(w.find('[data-testid="base-picker"]').exists()).toBe(false)
    })

    describe('base branch', () => {
        const branchChangeUrls = () =>
            fetchMock.mock.calls.map(([url]) => url).filter(url => url.startsWith('/api/projects/9/git/branch-changes'))

        async function pickBase(w: Awaited<ReturnType<typeof mountPanel>>, name: string) {
            await w.get('[data-testid="base-picker"]').trigger('click')
            await w.findAll('[data-testid="base-option"]').find(option => option.text().startsWith(name))!.trigger('click')
            await flushPromises()
        }

        it('lists branches with the default marked and filters them', async () => {
            status = gitStatus()
            const w = await mountPanel()
            await w.get('[data-testid="base-picker"]').trigger('click')
            const options = w.findAll('[data-testid="base-option"]')
            expect(options.map(option => option.text())).toEqual(['devdefault', 'main', 'fix/eu-promo-checkout', 'origin/main'])
            expect(options[0]!.attributes('aria-checked')).toBe('true')
            await w.get('input[aria-label="Filter branches"]').setValue('MAIN')
            expect(w.findAll('[data-testid="base-option"]').map(option => option.text())).toEqual(['main', 'origin/main'])
        })

        it('compares against the picked base, remembers it and opens diffs against it', async () => {
            status = gitStatus()
            branchChanges = { ...branchChanges, ahead: 1, files: [gitFile('src/feature.ts')] }
            const w = await mountPanel()
            expect(branchChangeUrls()).toEqual(['/api/projects/9/git/branch-changes'])

            await pickBase(w, 'origin/main')

            expect(branchChangeUrls().at(-1)).toBe('/api/projects/9/git/branch-changes?base=origin%2Fmain')
            expect(w.get('[data-testid="base-picker"]').text()).toBe('origin/main')
            expect(JSON.parse(localStorage.getItem('keera.git.base')!)).toEqual({ 9: 'origin/main' })

            await w.get('[data-testid="committed-changes"] button[title^="Show changes"]').trigger('click')
            expect(useDiffStore().activeTab).toMatchObject({ path: 'src/feature.ts', committed: true, base: 'origin/main' })

            await pickBase(w, 'dev')
            expect(w.get('[data-testid="base-picker"]').text()).toBe('dev')
            expect(JSON.parse(localStorage.getItem('keera.git.base')!)).toEqual({})
        })

        it('waits for the branch list and uses a remembered base only while it exists', async () => {
            status = gitStatus()
            localStorage.setItem('keera.git.base', JSON.stringify({ 9: 'main' }))
            await mountPanel()
            expect(branchChangeUrls()).toEqual(['/api/projects/9/git/branch-changes?base=main'])

            fetchMock.mockClear()
            localStorage.setItem('keera.git.base', JSON.stringify({ 9: 'deleted-branch' }))
            await mountPanel()
            expect(branchChangeUrls()).toEqual(['/api/projects/9/git/branch-changes'])
        })
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

    it('opens a file row as a diff of the side it is listed on', async () => {
        const w = await mountPanel()
        const diffs = useDiffStore()

        const rows = w.get('[data-testid="changes"]').findAll('li')
        await rows[3].get('button[title^="Show changes"]').trigger('click')
        expect(diffs.activeTab).toMatchObject({ path: 'app/tasks.py', staged: false, untracked: false, target: { projectId: 9, worktree: null } })

        await rows[4].get('button[title^="Show changes"]').trigger('click')
        expect(diffs.activeTab).toMatchObject({ path: 'app/bootstrap.py', untracked: true })

        await rows[0].get('button[title^="Show changes"]').trigger('click')
        expect(diffs.activeTab).toMatchObject({ path: 'src/checkout/promo.ts', staged: true })
        expect(diffs.tabsByProject[9]).toHaveLength(3)
    })

    it('opens deleted files as diffs, and the file itself only from the explicit Open file action', async () => {
        status = gitStatus({ changes: [gitFile('app/old.py', { status: 'D', additions: 0, deletions: 9 }), gitFile('app/tasks.py')], count: 2 })
        const w = await mountPanel()
        const editor = useEditorStore()
        const open = vi.spyOn(editor, 'open').mockResolvedValue()

        const [deleted, modified] = w.get('[data-testid="changes"]').findAll('li')
        expect(deleted.find('[aria-label="Open app/old.py"]').exists()).toBe(false)
        await deleted.get('button[title^="Show changes"]').trigger('click')
        expect(useDiffStore().activeTab?.path).toBe('app/old.py')
        expect(open).not.toHaveBeenCalled()

        await modified.get('[aria-label="Open app/tasks.py"]').trigger('click')
        expect(open).toHaveBeenCalledWith(9, 'app/tasks.py')
    })

    it('lists the live worktrees with branch and agent, and switches every git call to the chosen one', async () => {
        const w = await mountPanel()

        await w.get('[data-testid="branch-pill"]').trigger('click')
        const options = w.findAll('[data-testid="worktree-option"]')
        expect(options.map(o => o.text())).toEqual([
            'fix/eu-promo-checkoutMain checkout',
            'task/2034-diffDiff Frontend',
        ])
        expect(options[0].attributes('aria-checked')).toBe('true')

        await options[1].trigger('click')
        await flushPromises()

        const worktreeParam = `worktree=${encodeURIComponent(AGENT_TREE)}`
        expect(fetchMock).toHaveBeenCalledWith(`/api/projects/9/git/status?${worktreeParam}`, expect.anything())
        expect(w.get('[data-testid="branch-pill"]').text()).toContain('task/2034-diff')
        expect(fetchMock).toHaveBeenCalledWith(`/api/projects/9/git/branch-changes?${worktreeParam}`, expect.anything())
        expect(w.get('[data-testid="worktree-label"]').text()).toBe('Diff Frontend')
        expect(w.get('[data-testid="changes"]').text()).toContain('DiffPane.vue')
        expect(w.find('[data-testid="changes"] li[data-state="staged"]').exists()).toBe(false)
        // The file editor reads the project's own checkout, so another worktree's files open only as diffs.
        expect(w.find('[aria-label="Open resources/js/DiffPane.vue"]').exists()).toBe(false)

        await w.get('[data-testid="changes"] button[title^="Show changes"]').trigger('click')
        expect(useDiffStore().activeTab).toMatchObject({ target: { worktree: AGENT_TREE }, worktreeLabel: 'Diff Frontend' })

        posts['/stage'] = { body: agentStatus }
        await w.get('[aria-label="Stage resources/js/DiffPane.vue"]').trigger('click')
        await flushPromises()
        expect(fetchMock).toHaveBeenCalledWith(`/api/projects/9/git/stage?${worktreeParam}`, expect.objectContaining({ method: 'POST' }))
    })

    it('shows an agent worktree nested in the main checkout as a worktree row that switches to it', async () => {
        status = gitStatus({ changes: [gitFile('.claude/worktrees/agent-7/', { status: 'A', untracked: true })], count: 1 })
        const w = await mountPanel()

        const row = w.get('[data-testid="changes"] li')
        expect(row.get('[data-testid="line-stats"]').text()).toBe('worktree')
        expect(row.text()).toContain('Diff Frontend.claude/worktrees/agent-7')
        expect(row.find('[aria-label^="Open "]').exists()).toBe(false)

        await row.get('button[title="Switch to worktree Diff Frontend"]').trigger('click')
        await flushPromises()

        expect(useDiffStore().activeTab).toBeNull()
        expect(w.get('[data-testid="worktree-label"]').text()).toBe('Diff Frontend')
    })

    it('remembers the chosen worktree per project', async () => {
        const first = await mountPanel()
        await first.get('[data-testid="branch-pill"]').trigger('click')
        await first.findAll('[data-testid="worktree-option"]')[1].trigger('click')
        first.unmount()

        fetchMock.mockClear()
        const second = await mountPanel()
        expect(second.get('[data-testid="branch-pill"]').text()).toContain('task/2034-diff')
        // It waits for the worktree list, so the main checkout is never read in between.
        expect(fetchMock.mock.calls.filter(([url]) => url === '/api/projects/9/git/status')).toHaveLength(0)
    })

    it('falls back to the main checkout when the remembered worktree is gone or prunable', async () => {
        localStorage.setItem('keera.git.worktree', JSON.stringify({ 9: '/tmp/gone' }))
        const w = await mountPanel()

        expect(w.get('[data-testid="branch-pill"]').text()).toBe('fix/eu-promo-checkout')
        expect(fetchMock.mock.calls.some(([url]) => url.includes('worktree='))).toBe(false)
    })

    it('keeps the draft message when the panel remounts', async () => {
        const first = await mountPanel()
        await first.get('textarea').setValue('Half-written message')
        first.unmount()

        const second = await mountPanel()
        expect((second.get('textarea').element as HTMLTextAreaElement).value).toBe('Half-written message')
    })
})
