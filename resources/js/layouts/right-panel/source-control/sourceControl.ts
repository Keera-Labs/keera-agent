import { computed, reactive, toValue, type MaybeRefOrGetter } from 'vue'
import type { GitFileChange, GitTarget } from '@/queries/gitQuery'

export type StatusBadge = { letter: string; label: string; tone: string }

const BADGES: Record<GitFileChange['status'], StatusBadge> = {
    M: { letter: 'M', label: 'Modified', tone: 'bg-orange-100 text-orange-700' },
    A: { letter: 'A', label: 'Added', tone: 'bg-emerald-100 text-emerald-700' },
    D: { letter: 'D', label: 'Deleted', tone: 'bg-red-100 text-red-700' },
    R: { letter: 'R', label: 'Renamed', tone: 'bg-sky-100 text-sky-700' },
    C: { letter: 'C', label: 'Copied', tone: 'bg-sky-100 text-sky-700' },
    // Without the untracked flag, git's U means an unmerged path.
    U: { letter: '!', label: 'Merge conflict', tone: 'bg-red-100 text-red-700' },
}

const UNTRACKED: StatusBadge = { letter: 'U', label: 'Untracked', tone: 'bg-emerald-100 text-emerald-700' }

export function statusBadge(file: GitFileChange): StatusBadge {
    return file.untracked ? UNTRACKED : BADGES[file.status]
}

// Module scope so a half-written message survives switching panel views, projects or worktrees.
const drafts = reactive(new Map<string, string>())

/** One draft per project checkout: a message written for an agent's worktree stays with it. */
export function useCommitDraft(target: MaybeRefOrGetter<GitTarget | null>) {
    const key = () => {
        const current = toValue(target)
        return current ? `${current.projectId}:${current.worktree ?? ''}` : ''
    }
    return computed({
        get: () => drafts.get(key()) ?? '',
        set: message => {
            if (message) drafts.set(key(), message)
            else drafts.delete(key())
        },
    })
}

export const menuItemClass =
    'flex items-center gap-2 w-full px-3 h-7 text-left text-ui-12 text-zinc-700 hover:bg-zinc-100 cursor-pointer disabled:text-zinc-300 disabled:cursor-default disabled:hover:bg-transparent'

/** A file's place in the index: a partly staged file has changes on both sides. */
export type StageState = 'staged' | 'unstaged' | 'partial'

export type ChangeRow = { file: GitFileChange; state?: StageState }
