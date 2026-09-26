import { useMutation, useQuery, useQueryCache } from '@pinia/colada'
import { computed, toValue, type MaybeRefOrGetter } from 'vue'

// Contract of the git API (tasks #2028 and #2033), served under /api/projects/{id}/git.

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

export type GitWorktree = {
    path: string
    branch: string | null
    head: string | null
    detached: boolean
    is_main: boolean
    /** The checkout the API uses when no worktree is given. */
    is_current: boolean
    locked: boolean
    prunable: boolean
    agent_id: number | null
    agent_name: string | null
}

export type GitDiff = {
    path: string
    original_path: string | null
    status: GitFileStatusCode
    staged: boolean
    original: string | null
    modified: string | null
    binary: boolean
    too_large: boolean
    language: string | null
}

/** The checkout git calls run against; a null worktree is the project's own checkout. */
export type GitTarget = { projectId: number; worktree: string | null }

export type GitDiffRequest = { target: GitTarget; path: string; staged: boolean }

export class GitRequestError extends Error {
    constructor(readonly status: number, message: string) {
        super(message)
    }
}

function gitUrl(target: GitTarget, path: string, params: Record<string, string> = {}) {
    const search = new URLSearchParams(params)
    if (target.worktree) search.set('worktree', target.worktree)
    const query = search.toString()
    return `/api/projects/${target.projectId}/git/${path}${query ? `?${query}` : ''}`
}

// Keys include the worktree so switching checkouts never shows another one's cached data,
// while ['git', projectId] still prefixes everything for a project-wide refresh.
const treeKey = (target: GitTarget | null) => ['git', target?.projectId ?? null, 'tree', target?.worktree ?? '']

export const gitKeys = {
    worktrees: (projectId: number | null) => ['git', projectId, 'worktrees'],
    status: (target: GitTarget | null) => [...treeKey(target), 'status'],
    pullRequest: (target: GitTarget | null) => [...treeKey(target), 'pull-request'],
    commits: (target: GitTarget | null) => [...treeKey(target), 'commits'],
    diffs: (target: GitTarget | null) => [...treeKey(target), 'diff'],
    diff: (diff: GitDiffRequest | null) =>
        [...gitKeys.diffs(diff?.target ?? null), diff?.path ?? '', diff?.staged ? 'staged' : 'unstaged'],
}

async function request<T>(url: string, init?: { method: 'POST'; body: object }): Promise<T> {
    // Without Accept: application/json the backend answers validation errors with a 303 redirect instead of a 422 body.
    const headers: Record<string, string> = { Accept: 'application/json' }
    const res = await fetch(url, init
        ? { method: init.method, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) }
        : { headers })
    if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new GitRequestError(res.status, typeof body?.detail === 'string' ? body.detail : `Request failed (${res.status})`)
    }
    return res.json()
}

export const isOpenPullRequest = (info: GitPullRequestInfo | undefined) => info?.pull_request?.state === 'OPEN'

export function useGitWorktrees(projectIdSource: MaybeRefOrGetter<number | null>) {
    const projectId = () => toValue(projectIdSource)
    return useQuery({
        key: () => gitKeys.worktrees(projectId()),
        query: async () =>
            (await request<{ worktrees: GitWorktree[] }>(`/api/projects/${projectId()!}/git/worktrees`)).worktrees,
        enabled: () => projectId() !== null,
        staleTime: 30_000,
        refetchOnWindowFocus: true,
    })
}

export function useGitStatus(targetSource: MaybeRefOrGetter<GitTarget | null>) {
    const target = () => toValue(targetSource)
    const query = useQuery({
        key: () => gitKeys.status(target()),
        query: () => request<GitStatus>(gitUrl(target()!, 'status')),
        enabled: () => target() !== null,
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

export function useGitPullRequest(targetSource: MaybeRefOrGetter<GitTarget | null>, enabled: MaybeRefOrGetter<boolean> = true) {
    const target = () => toValue(targetSource)
    // Each read shells out to `gh`, so this refreshes on focus and on demand rather than on the status cadence.
    return useQuery({
        key: () => gitKeys.pullRequest(target()),
        query: () => request<GitPullRequestInfo>(gitUrl(target()!, 'pull-request')),
        enabled: () => target() !== null && toValue(enabled),
        staleTime: 30_000,
    })
}

export function useGitCommits(targetSource: MaybeRefOrGetter<GitTarget | null>, enabled: MaybeRefOrGetter<boolean>) {
    const target = () => toValue(targetSource)
    return useQuery({
        key: () => gitKeys.commits(target()),
        query: async () => (await request<{ commits: GitCommit[] }>(gitUrl(target()!, 'commits', { limit: '20' }))).commits,
        enabled: () => target() !== null && toValue(enabled),
    })
}

export function useGitDiff(diffSource: MaybeRefOrGetter<GitDiffRequest | null>) {
    const diff = () => toValue(diffSource)
    return useQuery({
        key: () => gitKeys.diff(diff()),
        query: () => {
            const { target, path, staged } = diff()!
            return request<GitDiff>(gitUrl(target, 'diff', { path, staged: String(staged) }))
        },
        enabled: () => diff() !== null,
        staleTime: 5000,
        refetchOnWindowFocus: true,
    })
}

export function useGitActions(targetSource: MaybeRefOrGetter<GitTarget | null>) {
    const queryCache = useQueryCache()
    const target = () => toValue(targetSource)!
    const url = (path: string) => gitUrl(target(), path)

    // Staging and committing move content between HEAD, the index and the tree, so open diffs are re-read too.
    const setStatus = (status: GitStatus) => {
        queryCache.setQueryData(gitKeys.status(target()), status)
        queryCache.invalidateQueries({ key: gitKeys.diffs(target()) })
    }
    // A failed push or a rejected commit hook can still have changed the tree, so failures re-read it.
    const refreshStatus = () => queryCache.invalidateQueries({ key: gitKeys.status(target()), exact: true })
    const refreshCommits = () => queryCache.invalidateQueries({ key: gitKeys.commits(target()), exact: true })

    const stage = useMutation({
        mutation: (paths: GitPaths) => request<GitStatus>(url('stage'), { method: 'POST', body: paths }),
        onSuccess: setStatus,
        onError: refreshStatus,
    })

    const unstage = useMutation({
        mutation: (paths: GitPaths) => request<GitStatus>(url('unstage'), { method: 'POST', body: paths }),
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
            queryCache.setQueryData<GitPullRequestInfo>(gitKeys.pullRequest(target()), {
                available: true,
                error: null,
                pull_request: pullRequest,
            }),
        // A 503 means gh is missing or signed out; re-reading swaps the Create PR action for gh's own message.
        onError: () => queryCache.invalidateQueries({ key: gitKeys.pullRequest(target()), exact: true }),
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
