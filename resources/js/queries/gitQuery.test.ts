// @vitest-environment happy-dom
import { PiniaColada } from '@pinia/colada'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, ref } from 'vue'
import { gitFile, gitStatus } from '@/layouts/right-panel/source-control/testing'
import {
    isOpenPullRequest, useGitActions, useGitDiff, useGitPullRequest, useGitStatus, type GitDiff, type GitDiffRequest, type GitPullRequest, type GitTarget,
} from './gitQuery'

function jsonResponse(body: unknown, status = 200) {
    return { ok: status < 400, status, json: async () => body }
}

const pullRequest: GitPullRequest = {
    number: 42, url: 'https://github.com/acme/app/pull/42', title: 'Fix promo', state: 'OPEN', is_draft: false, base: 'dev', head: 'fix/promo',
}

const fetchMock = vi.fn()
const calls = (suffix: string) => fetchMock.mock.calls.filter(([url]) => String(url).endsWith(suffix))

const MAIN: GitTarget = { projectId: 1, worktree: null }
const AGENT_TREE = '/code/keera/.claude/worktrees/agent-7'

function mountGit(initial: GitTarget | null = MAIN, diffRequest: GitDiffRequest | null = null) {
    const target = ref(initial)
    const diff = ref(diffRequest)
    let api!: {
        status: ReturnType<typeof useGitStatus>
        pullRequest: ReturnType<typeof useGitPullRequest>
        actions: ReturnType<typeof useGitActions>
        diff: ReturnType<typeof useGitDiff>
        target: typeof target
    }
    mount(
        defineComponent({
            setup() {
                api = {
                    status: useGitStatus(target),
                    pullRequest: useGitPullRequest(target),
                    actions: useGitActions(target),
                    diff: useGitDiff(diff),
                    target,
                }
                return () => null
            },
        }),
        { global: { plugins: [createPinia(), PiniaColada] } },
    )
    return api
}

/** Route GETs by URL suffix; POSTs are queued per test with mockResolvedValueOnce-style overrides. */
function routeGets(routes: Record<string, () => unknown>) {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        const suffix = Object.keys(routes).find(key => url.endsWith(key) && (init?.method ?? 'GET') === 'GET')
        return Promise.resolve(suffix ? jsonResponse(routes[suffix]()) : jsonResponse({}, 404))
    })
}

beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

describe('useGitStatus', () => {
    it('loads the status and exposes the badge count', async () => {
        const status = gitStatus({ changes: [gitFile('app/tasks.py')], count: 1 })
        routeGets({ '/git/status': () => status, '/git/pull-request': () => ({ available: true, error: null, pull_request: null }) })
        const api = mountGit()
        await flushPromises()

        expect(fetchMock).toHaveBeenCalledWith('/api/projects/1/git/status', { headers: { Accept: 'application/json' } })
        expect(api.status.status.value).toEqual(status)
        expect(api.status.changedCount.value).toBe(1)
    })

    it('does not fetch without a project', async () => {
        const api = mountGit(null)
        await flushPromises()
        expect(fetchMock).not.toHaveBeenCalled()
        expect(api.status.changedCount.value).toBe(0)
    })

    it('surfaces the API detail message on failure', async () => {
        fetchMock.mockResolvedValue(jsonResponse({ detail: 'Project not found' }, 404))
        const api = mountGit()
        await flushPromises()
        expect(api.status.error.value?.message).toBe('Project not found')
    })
})

describe('useGitActions', () => {
    let current = gitStatus()

    beforeEach(() => {
        current = gitStatus({ changes: [gitFile('app/tasks.py')], count: 1 })
        routeGets({ '/git/status': () => current, '/git/pull-request': () => ({ available: true, error: null, pull_request: null }) })
    })

    it('stages everything and writes the returned status into the cache without re-reading it', async () => {
        const api = mountGit()
        await flushPromises()
        const staged = gitStatus({ staged: [gitFile('app/tasks.py')], count: 1 })
        fetchMock.mockResolvedValueOnce(jsonResponse(staged))

        await api.actions.stage.mutateAsync({ all: true })
        await flushPromises()

        expect(fetchMock).toHaveBeenCalledWith('/api/projects/1/git/stage', expect.objectContaining({ method: 'POST', body: '{"all":true}', headers: { Accept: 'application/json', 'Content-Type': 'application/json' } }))
        expect(api.status.status.value).toEqual(staged)
        expect(calls('/git/status')).toHaveLength(1)
    })

    it('unstages specific paths', async () => {
        const api = mountGit()
        await flushPromises()
        fetchMock.mockResolvedValueOnce(jsonResponse(gitStatus()))

        await api.actions.unstage.mutateAsync({ paths: ['app/tasks.py'] })

        expect(fetchMock).toHaveBeenCalledWith('/api/projects/1/git/unstage', expect.objectContaining({ body: '{"paths":["app/tasks.py"]}' }))
    })

    it('commits the message and takes the status embedded in the response', async () => {
        const api = mountGit()
        await flushPromises()
        const clean = gitStatus({ ahead: 1 })
        fetchMock.mockResolvedValueOnce(jsonResponse({ sha: 'abc', short_sha: 'abc', subject: 'Fix', status: clean }, 201))

        await api.actions.commit.mutateAsync('Fix EU promo')

        expect(fetchMock).toHaveBeenCalledWith('/api/projects/1/git/commits', expect.objectContaining({ body: '{"message":"Fix EU promo"}' }))
        expect(api.status.status.value).toEqual(clean)
    })

    it('shows the git message of a failed push and re-reads the status', async () => {
        const api = mountGit()
        await flushPromises()
        fetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'rejected: non-fast-forward' }, 409))

        await expect(api.actions.push.mutateAsync()).rejects.toThrow('rejected: non-fast-forward')
        await flushPromises()

        expect(api.actions.error.value?.message).toBe('rejected: non-fast-forward')
        expect(calls('/git/status')).toHaveLength(2)
        api.actions.resetErrors()
        expect(api.actions.error.value).toBeNull()
    })

    it('stores a created pull request so the panel flips to PR Created', async () => {
        const api = mountGit()
        await flushPromises()
        fetchMock.mockResolvedValueOnce(jsonResponse({ pull_request: pullRequest }, 201))

        await api.actions.createPullRequest.mutateAsync()

        expect(fetchMock).toHaveBeenCalledWith('/api/projects/1/git/pull-request', expect.objectContaining({ method: 'POST' }))
        expect(isOpenPullRequest(api.pullRequest.data.value)).toBe(true)
    })

    it('re-reads pull request availability when gh is unavailable', async () => {
        const api = mountGit()
        await flushPromises()
        fetchMock.mockResolvedValueOnce(jsonResponse({ detail: 'gh is not authenticated' }, 503))

        await expect(api.actions.createPullRequest.mutateAsync()).rejects.toThrow('gh is not authenticated')
        await flushPromises()

        expect(calls('/git/pull-request').filter(([, init]) => !init?.method)).toHaveLength(2)
    })
})

describe('worktrees', () => {
    const mainStatus = gitStatus({ branch: 'dev', changes: [gitFile('README.md')], count: 1 })
    const agentStatus = gitStatus({ branch: 'task/diff', changes: [gitFile('app/diff.ts')], count: 1 })
    const diffBody: GitDiff = {
        path: 'app/diff.ts', original_path: null, status: 'M', staged: false, original: 'a', modified: 'b', binary: false, too_large: false, language: 'typescript',
    }

    beforeEach(() => {
        fetchMock.mockImplementation((url: string) => {
            const { pathname, searchParams } = new URL(url, 'http://app')
            const agent = searchParams.get('worktree') === AGENT_TREE
            if (pathname.endsWith('/git/status')) return Promise.resolve(jsonResponse(agent ? agentStatus : mainStatus))
            if (pathname.endsWith('/git/diff')) return Promise.resolve(jsonResponse(diffBody))
            return Promise.resolve(jsonResponse({ available: true, error: null, pull_request: null }))
        })
    })

    it('sends the worktree as a query param and never shows another checkout\'s cached status', async () => {
        const api = mountGit()
        await flushPromises()
        expect(api.status.status.value?.branch).toBe('dev')

        api.target.value = { projectId: 1, worktree: AGENT_TREE }
        await Promise.resolve()
        expect(api.status.status.value).toBeUndefined()
        await flushPromises()

        expect(fetchMock).toHaveBeenCalledWith(`/api/projects/1/git/status?worktree=${encodeURIComponent(AGENT_TREE)}`, expect.anything())
        expect(api.status.status.value?.branch).toBe('task/diff')
    })

    it('runs mutations against the selected worktree, even bodyless ones', async () => {
        const api = mountGit({ projectId: 1, worktree: AGENT_TREE })
        await flushPromises()
        fetchMock.mockResolvedValueOnce(jsonResponse({ branch: 'task/diff', upstream: 'origin/task/diff', output: '', status: agentStatus }))

        await api.actions.push.mutateAsync()

        expect(fetchMock).toHaveBeenCalledWith(
            `/api/projects/1/git/push?worktree=${encodeURIComponent(AGENT_TREE)}`,
            expect.objectContaining({ method: 'POST', body: '{}' }),
        )
    })

    it('loads a diff for one side and re-reads it after staging', async () => {
        const target = { projectId: 1, worktree: AGENT_TREE }
        const api = mountGit(target, { target, path: 'app/diff.ts', staged: false })
        await flushPromises()

        expect(fetchMock).toHaveBeenCalledWith(
            `/api/projects/1/git/diff?path=app%2Fdiff.ts&staged=false&worktree=${encodeURIComponent(AGENT_TREE)}`,
            { headers: { Accept: 'application/json' } },
        )
        expect(api.diff.data.value).toEqual(diffBody)

        fetchMock.mockResolvedValueOnce(jsonResponse(gitStatus()))
        await api.actions.stage.mutateAsync({ paths: ['app/diff.ts'] })
        await flushPromises()
        expect(calls('/git/diff?path=app%2Fdiff.ts&staged=false&worktree=' + encodeURIComponent(AGENT_TREE))).toHaveLength(2)
    })

    it('keeps the HTTP status of a failed diff so a vanished file can be told apart', async () => {
        fetchMock.mockResolvedValue(jsonResponse({ detail: 'No unstaged changes for app/diff.ts' }, 404))
        const api = mountGit(MAIN, { target: MAIN, path: 'app/diff.ts', staged: false })
        await flushPromises()
        expect(api.diff.error.value).toMatchObject({ status: 404, message: 'No unstaged changes for app/diff.ts' })
    })
})

describe('isOpenPullRequest', () => {
    it('only counts an open pull request', () => {
        expect(isOpenPullRequest({ available: true, error: null, pull_request: pullRequest })).toBe(true)
        expect(isOpenPullRequest({ available: true, error: null, pull_request: { ...pullRequest, state: 'MERGED' } })).toBe(false)
        expect(isOpenPullRequest({ available: true, error: null, pull_request: null })).toBe(false)
        expect(isOpenPullRequest(undefined)).toBe(false)
    })
})
