// @vitest-environment happy-dom
import { PiniaColada } from '@pinia/colada'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, ref } from 'vue'
import { gitFile, gitStatus } from '@/layouts/right-panel/source-control/testing'
import { isOpenPullRequest, useGitActions, useGitPullRequest, useGitStatus, type GitPullRequest } from './gitQuery'

function jsonResponse(body: unknown, status = 200) {
    return { ok: status < 400, status, json: async () => body }
}

const pullRequest: GitPullRequest = {
    number: 42, url: 'https://github.com/acme/app/pull/42', title: 'Fix promo', state: 'OPEN', is_draft: false, base: 'dev', head: 'fix/promo',
}

const fetchMock = vi.fn()
const calls = (suffix: string) => fetchMock.mock.calls.filter(([url]) => String(url).endsWith(suffix))

function mountGit(projectId: number | null = 1) {
    const id = ref(projectId)
    let api!: {
        status: ReturnType<typeof useGitStatus>
        pullRequest: ReturnType<typeof useGitPullRequest>
        actions: ReturnType<typeof useGitActions>
    }
    mount(
        defineComponent({
            setup() {
                api = { status: useGitStatus(id), pullRequest: useGitPullRequest(id), actions: useGitActions(id) }
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

describe('isOpenPullRequest', () => {
    it('only counts an open pull request', () => {
        expect(isOpenPullRequest({ available: true, error: null, pull_request: pullRequest })).toBe(true)
        expect(isOpenPullRequest({ available: true, error: null, pull_request: { ...pullRequest, state: 'MERGED' } })).toBe(false)
        expect(isOpenPullRequest({ available: true, error: null, pull_request: null })).toBe(false)
        expect(isOpenPullRequest(undefined)).toBe(false)
    })
})
