import type { GitFileChange, GitStatus } from '@/queries/gitQuery'

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
