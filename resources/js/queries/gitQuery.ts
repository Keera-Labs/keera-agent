import { useMutation, useQuery, useQueryCache } from '@pinia/colada'
import { computed, toValue, type MaybeRefOrGetter } from 'vue'

// Contract of the git API (task #2028), served under /api/projects/{id}/git.

export type GitFileStatusCode = 'M' | 'A' | 'D' | 'R' | 'U' | 'C'

export type GitFileChange = {
    path: string
    name: string
    dir: string
    status: GitFileStatusCode
    original_path: string | null
    additions: number | null
    deletions: number | null
    binary: boolean
    untracked: boolean
}

export type GitStatus = {
    is_repo: boolean
    branch: string | null
    detached: boolean
    head: string | null
    has_commits: boolean
    upstream: string | null
    ahead: number
    behind: number
    staged: GitFileChange[]
    changes: GitFileChange[]
    count: number
}

export type GitCommit = { sha: string; short_sha: string; subject: string; author: string; date: string }

export type GitPullRequest = {
    number: number
    url: string
    title: string
    state: 'OPEN' | 'MERGED' | 'CLOSED'
    is_draft: boolean
    base: string
    head: string
}

export type GitPullRequestInfo = { available: boolean; error: string | null; pull_request: GitPullRequest | null }

export type GitPaths = { paths: string[] } | { all: true }

const base = (projectId: number) => `/api/projects/${projectId}/git`

export const gitKeys = {
    status: (projectId: number | null) => ['git', projectId, 'status'],
    pullRequest: (projectId: number | null) => ['git', projectId, 'pull-request'],
    commits: (projectId: number | null) => ['git', projectId, 'commits'],
}

async function request<T>(url: string, init?: { method: 'POST'; body: object }): Promise<T> {
    // Without Accept: application/json the backend answers validation errors with a 303 redirect instead of a 422 body.
    const headers: Record<string, string> = { Accept: 'application/json' }
    const res = await fetch(url, init
        ? { method: init.method, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) }
        : { headers })
    if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(typeof body?.detail === 'string' ? body.detail : `Request failed (${res.status})`)
    }
    return res.json()
}

export const isOpenPullRequest = (info: GitPullRequestInfo | undefined) => info?.pull_request?.state === 'OPEN'

export function useGitStatus(projectIdSource: MaybeRefOrGetter<number | null>) {
    const projectId = () => toValue(projectIdSource)
    const query = useQuery({
        key: () => gitKeys.status(projectId()),
        query: () => request<GitStatus>(`${base(projectId()!)}/status`),
        enabled: () => projectId() !== null,
        staleTime: 5000,
        refetchOnWindowFocus: true,
    })
    return {
        status: query.data,
        error: query.error,
        isLoading: query.isLoading,
        refetch: query.refetch,
        changedCount: computed(() => query.data.value?.count ?? 0),
    }
}

export function useGitPullRequest(projectIdSource: MaybeRefOrGetter<number | null>, enabled: MaybeRefOrGetter<boolean> = true) {
    const projectId = () => toValue(projectIdSource)
    // Each read shells out to `gh`, so this refreshes on focus and on demand rather than on the status cadence.
    return useQuery({
        key: () => gitKeys.pullRequest(projectId()),
        query: () => request<GitPullRequestInfo>(`${base(projectId()!)}/pull-request`),
        enabled: () => projectId() !== null && toValue(enabled),
        staleTime: 30_000,
    })
}

export function useGitCommits(projectIdSource: MaybeRefOrGetter<number | null>, enabled: MaybeRefOrGetter<boolean>) {
    const projectId = () => toValue(projectIdSource)
    return useQuery({
        key: () => gitKeys.commits(projectId()),
        query: async () => (await request<{ commits: GitCommit[] }>(`${base(projectId()!)}/commits?limit=20`)).commits,
        enabled: () => projectId() !== null && toValue(enabled),
    })
}

export function useGitActions(projectIdSource: MaybeRefOrGetter<number | null>) {
    const queryCache = useQueryCache()
    const projectId = () => toValue(projectIdSource)!
    const url = (path: string) => `${base(projectId())}/${path}`

    const setStatus = (status: GitStatus) => queryCache.setQueryData(gitKeys.status(projectId()), status)
    // A failed push or a rejected commit hook can still have changed the tree, so failures re-read it.
    const refreshStatus = () => queryCache.invalidateQueries({ key: gitKeys.status(projectId()), exact: true })
    const refreshCommits = () => queryCache.invalidateQueries({ key: gitKeys.commits(projectId()), exact: true })

    const stage = useMutation({
        mutation: (target: GitPaths) => request<GitStatus>(url('stage'), { method: 'POST', body: target }),
        onSuccess: setStatus,
        onError: refreshStatus,
    })

    const unstage = useMutation({
        mutation: (target: GitPaths) => request<GitStatus>(url('unstage'), { method: 'POST', body: target }),
        onSuccess: setStatus,
        onError: refreshStatus,
    })

    const commit = useMutation({
        mutation: async (message: string) =>
            (await request<{ status: GitStatus }>(url('commits'), { method: 'POST', body: { message } })).status,
        onSuccess: status => {
            setStatus(status)
            refreshCommits()
        },
        onError: refreshStatus,
    })

    const push = useMutation({
        mutation: async () => (await request<{ status: GitStatus }>(url('push'), { method: 'POST', body: {} })).status,
        onSuccess: setStatus,
        onError: refreshStatus,
    })

    const createPullRequest = useMutation({
        mutation: async () =>
            (await request<{ pull_request: GitPullRequest }>(url('pull-request'), { method: 'POST', body: {} })).pull_request,
        onSuccess: pullRequest =>
            queryCache.setQueryData<GitPullRequestInfo>(gitKeys.pullRequest(projectId()), {
                available: true,
                error: null,
                pull_request: pullRequest,
            }),
        // A 503 means gh is missing or signed out; re-reading swaps the Create PR action for gh's own message.
        onError: () => queryCache.invalidateQueries({ key: gitKeys.pullRequest(projectId()), exact: true }),
        onSettled: refreshStatus,
    })

    const mutations = [stage, unstage, commit, push, createPullRequest]

    return {
        stage,
        unstage,
        commit,
        push,
        createPullRequest,
        isBusy: computed(() => mutations.some(m => m.isLoading.value)),
        error: computed(() => mutations.map(m => m.error.value).find(Boolean) ?? null),
        resetErrors: () => mutations.forEach(m => m.reset()),
    }
}
