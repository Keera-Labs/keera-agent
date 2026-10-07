import type { GitFileChange, GitStatus, GitWorktree } from '@/queries/gitQuery'

export function gitWorktree(path: string, overrides: Partial<GitWorktree> = {}): GitWorktree {
    return {
        path,
        branch: 'dev',
        head: 'a1b2c3d4e5',
        detached: false,
        is_main: false,
        is_current: false,
        locked: false,
        prunable: false,
        agent_id: null,
        agent_name: null,
        ...overrides,
    }
}

export function gitFile(path: string, overrides: Partial<GitFileChange> = {}): GitFileChange {
    const slash = path.lastIndexOf('/')
    return {
        path,
        name: path.slice(slash + 1),
        dir: slash === -1 ? '' : path.slice(0, slash),
        status: 'M',
        original_path: null,
        additions: 1,
        deletions: 0,
        binary: false,
        untracked: false,
        ...overrides,
    }
}

export function gitStatus(overrides: Partial<GitStatus> = {}): GitStatus {
    return {
        is_repo: true,
        branch: 'fix/eu-promo-checkout',
        detached: false,
        head: 'a1b2c3d',
        has_commits: true,
        upstream: null,
        ahead: 0,
        behind: 0,
        staged: [],
        changes: [],
        count: 0,
        ...overrides,
    }
}
