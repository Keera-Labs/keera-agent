<script setup lang="ts">
import { useQueryCache } from '@pinia/colada'
import {
    ArrowDown, ArrowUp, ChevronDown, CircleAlert, CircleCheck, Ellipsis, GitBranch, GitPullRequest, History, RefreshCw, X,
} from '@lucide/vue'
import { computed, ref } from 'vue'
import { useGitBase } from '@/composables/useGitBase'
import { useGitWorktree, worktreeLabel } from '@/composables/useGitWorktree'
import { useRefetchOnWindowFocus } from '@/composables/useRefetchOnWindowFocus'
import {
    gitKeys, isOpenPullRequest, useGitActions, useGitBranchChanges, useGitCommits, useGitPullRequest, useGitStatus, useGitWorktreeChanges,
    type GitFileChange, type GitPaths, type GitWorktree,
} from '@/queries/gitQuery'
import { useDiffStore } from '@/stores/diffStore'
import { useEditorStore } from '@/stores/editorStore'
import type { Project } from '@/types/type'
import BasePicker from './BasePicker.vue'
import ChangeList from './ChangeList.vue'
import DirtyWorktrees from './DirtyWorktrees.vue'
import PanelMenu from './PanelMenu.vue'
import { menuItemClass, useCommitDraft, type ChangeRow } from './sourceControl'
import WorktreePicker from './WorktreePicker.vue'

const props = defineProps<{ project: Project }>()
const projectId = () => props.project.id

const { worktrees, selected: selectedWorktree, target, select: selectWorktree } = useGitWorktree(projectId)
// Commits made in a terminal or by an agent must show up after switching back from another app.
useRefetchOnWindowFocus(() => gitKeys.project(projectId()))
const { status, error: statusError, isLoading, refetch } = useGitStatus(target)
const isRepo = computed(() => status.value?.is_repo === true)
const hasCommits = computed(() => isRepo.value && status.value?.has_commits === true)
const comparisonBase = useGitBase(projectId, target, hasCommits)
const branchQuery = useGitBranchChanges(target, comparisonBase.base, () => isRepo.value && comparisonBase.ready.value)
const committed = computed(() => branchQuery.data.value?.files ?? [])
const comparedBase = computed(() => branchQuery.data.value?.base ?? null)
const ahead = computed(() => branchQuery.data.value?.ahead ?? 0)
const aheadCount = computed(() => `${ahead.value} ${ahead.value === 1 ? 'commit' : 'commits'} ahead of ${comparedBase.value}`)
const hasComparison = computed(() => !!branchQuery.data.value?.merge_base)
const showCommitted = computed(() =>
    hasCommits.value && !!branchQuery.data.value && (branchQuery.data.value.ahead > 0 || committed.value.length > 0),
)
const worktreeChangesQuery = useGitWorktreeChanges(projectId, isRepo)
const worktreeChanges = computed(() => worktreeChangesQuery.data.value ?? {})
const pullRequestQuery = useGitPullRequest(target, isRepo)
const actions = useGitActions(target)
const editor = useEditorStore()
const diffs = useDiffStore()

const historyOpen = ref(false)
const commitsQuery = useGitCommits(target, historyOpen)

const message = useCommitDraft(target)

const branchLabel = computed(() => {
    if (!status.value) return ''
    return status.value.detached ? `detached @ ${status.value.head?.slice(0, 7)}` : status.value.branch ?? 'no branch'
})
const branchTitle = computed(() =>
    status.value?.upstream ? `${status.value.branch} → ${status.value.upstream}` : branchLabel.value,
)
// The file editor reads the project's own checkout, so files of another worktree only open as diffs.
const canOpenFile = computed(() => target.value?.worktree === null)

// Git lists a worktree nested in the shown checkout (e.g. .claude/worktrees/agent-7) as an untracked
// directory; its row switches to that worktree, since there is no file diff to show for it.
const nestedWorktrees = computed(() => {
    const root = selectedWorktree.value?.path
    const byRow: Record<string, GitWorktree> = {}
    if (!root) return byRow
    for (const file of status.value?.changes ?? []) {
        const path = `${root}/${file.path.replace(/\/$/, '')}`
        const worktree = worktrees.value.find(w => w.path === path)
        if (worktree) byRow[file.path] = worktree
    }
    return byRow
})
const nestedWorktreeLabels = computed(() =>
    Object.fromEntries(Object.entries(nestedWorktrees.value).map(([path, worktree]) => [path, worktreeLabel(worktree)])),
)

const staged = computed(() => status.value?.staged ?? [])
const changes = computed(() => status.value?.changes ?? [])
// One row per path: a partly staged file is listed once, opening the unstaged side the agent is still editing.
const rows = computed<ChangeRow[]>(() => {
    const unstaged = new Map(changes.value.map(file => [file.path, file]))
    const stagedPaths = new Set(staged.value.map(file => file.path))
    return [
        ...staged.value.map(file => {
            const pending = unstaged.get(file.path)
            return pending ? { file: pending, state: 'partial' as const } : { file, state: 'staged' as const }
        }),
        ...changes.value.filter(file => !stagedPaths.has(file.path)).map(file => ({ file, state: 'unstaged' as const })),
    ]
})
const committedRows = computed<ChangeRow[]>(() => committed.value.map(file => ({ file })))
const workingTreeClean = computed(() => !staged.value.length && !changes.value.length)
const cleanTree = computed(() => workingTreeClean.value
    && hasComparison.value && !branchQuery.data.value?.ahead
    && !committed.value.length && !branchQuery.error.value)
const checkoutName = computed(() => {
    const worktree = selectedWorktree.value
    if (!worktree) return 'this checkout'
    return worktree.is_main ? 'the main checkout' : worktreeLabel(worktree)
})
const dirtyWorktrees = computed(() =>
    worktrees.value.filter(w => w.path !== selectedWorktree.value?.path && (worktreeChanges.value[w.path] ?? 0) > 0),
)
const pullRequestInfo = computed(() => pullRequestQuery.data.value)
const openPullRequest = computed(() => (isOpenPullRequest(pullRequestInfo.value) ? pullRequestInfo.value!.pull_request : null))
const onBranch = computed(() => !!status.value?.branch && !status.value.detached)

const commitBlocker = computed(() => {
    if (!message.value.trim()) return 'Enter a commit message'
    if (staged.value.length === 0) return 'Stage changes to commit'
    return null
})
const canCommit = computed(() => !commitBlocker.value && !actions.isBusy.value)
const canPush = computed(() => onBranch.value && !!status.value?.has_commits && !actions.isBusy.value)
const canCreatePullRequest = computed(() =>
    !!pullRequestInfo.value?.available && !openPullRequest.value && canPush.value,
)

const busyLabel = computed(() => {
    if (actions.stage.isLoading.value) return 'Staging…'
    if (actions.commit.isLoading.value) return 'Committing…'
    if (actions.push.isLoading.value) return 'Pushing…'
    return null
})

const commitLabel = computed(() => `Commit ${staged.value.length} ${staged.value.length === 1 ? 'file' : 'files'}`)

// Failures surface through actions.error, so the awaited rejections need no handling here.
async function run(action: () => Promise<unknown>) {
    actions.resetErrors()
    try {
        await action()
    } catch {}
}

const setStaged = (staged: boolean, paths: string[] | 'all') => {
    const target: GitPaths = paths === 'all' ? { all: true } : { paths }
    return run(() => (staged ? actions.stage : actions.unstage).mutateAsync(target))
}

const commit = (push: boolean) =>
    run(async () => {
        await actions.commit.mutateAsync(message.value.trim())
        message.value = ''
        if (push) await actions.push.mutateAsync()
    })

const push = () => run(() => actions.push.mutateAsync())
const createPullRequest = () => run(() => actions.createPullRequest.mutateAsync())

function onMessageKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
    const push = event.shiftKey
    if (!canCommit.value || (push && !onBranch.value)) return
    event.preventDefault()
    commit(push)
}

const queryCache = useQueryCache()
const refreshing = ref(false)
async function refresh() {
    refreshing.value = true
    try {
        await queryCache.invalidateQueries({ key: gitKeys.project(projectId()) })
    } finally {
        refreshing.value = false
    }
}

const openRow = (row: ChangeRow) => openDiff(row.file, row.state === 'staged')

function openDiff(file: GitFileChange, staged: boolean, committed = false) {
    if (!target.value) return
    const nested = staged || committed ? undefined : nestedWorktrees.value[file.path]
    if (nested) return selectWorktree(nested.path)
    const worktree = selectedWorktree.value
    diffs.open(target.value, file.path, staged, {
        worktreeLabel: worktree && !worktree.is_current ? worktreeLabel(worktree) : null,
        untracked: file.untracked,
        committed,
        base: committed ? comparedBase.value : null,
    })
}

function openFile(file: GitFileChange) {
    editor.open(props.project.id, file.path)
}

const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

const headerButton = 'p-1 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200/70 transition-colors cursor-pointer disabled:text-zinc-300 disabled:cursor-default disabled:hover:bg-transparent'
const outlineButton = 'shrink-0 h-10 flex items-center justify-center gap-1.5 px-4 rounded-lg border border-stroke bg-surface text-ui-13 font-medium transition-colors'
</script>

<template>
    <div class="flex-1 min-h-0 flex flex-col min-w-0 text-ui-12 text-zinc-700" data-testid="source-control">
        <div class="relative flex items-center gap-2 h-12 px-3 shrink-0 border-b border-stroke">
            <WorktreePicker
                v-if="status?.is_repo"
                class="min-w-0 flex-1"
                :worktrees="worktrees"
                :selected="selectedWorktree"
                :branch-label="branchLabel"
                :title="branchTitle"
                :changes="worktreeChanges"
                @select="selectWorktree"
            />
            <span v-else class="flex-1" />
            <span
                v-if="status?.ahead || status?.behind"
                class="shrink-0 flex items-center gap-1 font-mono text-ui-11 text-zinc-500"
                :title="`${status.ahead} to push, ${status.behind} to pull`"
            >
                <span v-if="status.ahead" class="flex items-center"><ArrowUp :size="11" />{{ status.ahead }}</span>
                <span v-if="status.behind" class="flex items-center"><ArrowDown :size="11" />{{ status.behind }}</span>
            </span>

            <div class="flex items-center shrink-0">
                <PanelMenu v-model:open="historyOpen" label="Recent commits" menu-class="w-56 max-h-80 overflow-y-auto">
                    <template #trigger="{ toggle: toggleHistory }">
                        <button type="button" :class="headerButton" title="Recent commits" aria-label="Recent commits" :disabled="!isRepo" @click="toggleHistory">
                            <History :size="14" />
                        </button>
                    </template>
                    <p v-if="!status?.has_commits" class="px-3 py-2 text-zinc-400">No commits yet</p>
                    <p v-else-if="commitsQuery.isLoading.value" class="px-3 py-2 text-zinc-400">Loading…</p>
                    <p v-else-if="commitsQuery.error.value" class="px-3 py-2 text-danger">{{ commitsQuery.error.value.message }}</p>
                    <template v-else>
                        <div v-for="entry in commitsQuery.data.value" :key="entry.sha" class="px-3 py-1.5" :title="entry.sha">
                            <p class="truncate text-zinc-800">{{ entry.subject }}</p>
                            <p class="text-ui-11 text-zinc-400">
                                <span class="font-mono">{{ entry.short_sha }}</span> · {{ entry.author }} · {{ formatDate(entry.date) }}
                            </p>
                        </div>
                    </template>
                </PanelMenu>

                <PanelMenu label="More actions">
                    <template #trigger="{ toggle: toggleMore }">
                        <button type="button" :class="headerButton" title="More actions" aria-label="More actions" :disabled="!isRepo" @click="toggleMore">
                            <Ellipsis :size="14" />
                        </button>
                    </template>
                    <template #default="{ close }">
                        <button type="button" role="menuitem" :class="menuItemClass" :disabled="!changes.length || actions.isBusy.value" @click="close(); setStaged(true, 'all')">
                            Stage all changes
                        </button>
                        <button type="button" role="menuitem" :class="menuItemClass" :disabled="!staged.length || actions.isBusy.value" @click="close(); setStaged(false, 'all')">
                            Unstage all changes
                        </button>
                        <button type="button" role="menuitem" :class="menuItemClass" :disabled="!canPush" @click="close(); push()">
                            Push
                        </button>
                    </template>
                </PanelMenu>

                <button
                    type="button"
                    data-testid="refresh-source-control"
                    aria-label="Refresh source control"
                    title="Refresh"
                    :aria-busy="refreshing"
                    :disabled="refreshing"
                    :class="headerButton"
                    @click="refresh"
                >
                    <RefreshCw :size="14" :class="refreshing && 'animate-spin'" />
                </button>
            </div>

            <BasePicker
                v-if="hasCommits && branchQuery.data.value"
                class="min-w-0 shrink-0"
                :branches="comparisonBase.branches.value"
                :current="comparedBase"
                :default-base="comparisonBase.defaultBase.value"
                @select="comparisonBase.select"
            />
        </div>

        <p v-if="(isLoading || !target) && !status" class="px-3 py-2 text-zinc-400">Loading…</p>

        <div v-else-if="statusError && !status" role="alert" class="px-3 py-2 space-y-1.5">
            <p class="text-danger">{{ statusError.message }}</p>
            <button type="button" class="text-accent hover:underline cursor-pointer" @click="refetch()">Try again</button>
        </div>

        <div
            v-else-if="status && !status.is_repo"
            data-testid="not-a-repo"
            class="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center text-zinc-400"
        >
            <GitBranch :size="22" />
            <p class="text-ui-13 text-zinc-600">Not a git repository</p>
            <p class="break-all font-mono text-ui-11">{{ project.path }}</p>
        </div>

        <template v-else-if="status">
            <div class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pt-1">
                <p v-if="branchQuery.error.value" role="alert" class="px-3 py-2 text-danger">
                    {{ branchQuery.error.value.message }}
                    <button type="button" class="text-accent hover:underline cursor-pointer" @click="branchQuery.refetch()">Try again</button>
                </p>
                <p v-else-if="branchQuery.isLoading.value && !branchQuery.data.value" class="px-3 py-2 text-zinc-400">Loading branch changes…</p>
                <p v-else-if="branchQuery.data.value && !branchQuery.data.value.merge_base" class="px-3 py-2 text-zinc-500">
                    {{ !status?.has_commits ? 'No commits yet.' : 'No shared base branch found for comparison.' }}
                </p>
                <div
                    v-if="cleanTree"
                    data-testid="clean-tree"
                    class="flex flex-col items-center gap-1.5 px-6 py-8 text-center text-zinc-400"
                >
                    <CircleCheck :size="20" />
                    <p class="text-ui-13 text-zinc-600">No changes</p>
                    <p>Nothing to commit in {{ checkoutName }}.</p>
                </div>
                <p
                    v-else-if="workingTreeClean && !isLoading"
                    data-testid="no-uncommitted"
                    class="px-3 py-2 text-zinc-400"
                >
                    No uncommitted changes in {{ checkoutName }}.
                </p>
                <DirtyWorktrees
                    v-if="workingTreeClean && dirtyWorktrees.length"
                    :worktrees="dirtyWorktrees"
                    :changes="worktreeChanges"
                    @select="selectWorktree"
                />
                <ChangeList
                    v-if="rows.length"
                    title="Changes"
                    :rows="rows"
                    :disabled="actions.isBusy.value"
                    :can-open-file="canOpenFile"
                    :worktree-labels="nestedWorktreeLabels"
                    @toggle="(paths, stage) => setStaged(stage, paths)"
                    @open="openRow"
                    @open-file="openFile"
                />
                <ChangeList
                    v-if="showCommitted"
                    title="Committed"
                    :rows="committedRows"
                    committed
                    :disabled="false"
                    :can-open-file="false"
                    @open="row => openDiff(row.file, false, true)"
                >
                    <template #description>{{ aheadCount }}</template>
                </ChangeList>
            </div>

            <div class="shrink-0 px-3 pt-3 pb-2 space-y-2.5 border-t border-stroke">
                <textarea
                    v-model="message"
                    rows="3"
                    placeholder="Commit message"
                    aria-label="Commit message"
                    class="block w-full resize-none rounded-lg border border-stroke bg-surface px-3 py-2.5 text-ui-13 leading-snug text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400"
                    @keydown="onMessageKeydown"
                />

                <div
                    v-if="actions.error.value"
                    role="alert"
                    data-testid="action-error"
                    class="flex items-start gap-1.5 px-2 py-1.5 rounded-md bg-red-50 text-danger"
                >
                    <span class="flex-1 min-w-0 whitespace-pre-wrap break-words">{{ actions.error.value.message }}</span>
                    <button type="button" aria-label="Dismiss" class="p-0.5 rounded hover:bg-red-100 cursor-pointer" @click="actions.resetErrors()">
                        <X :size="11" />
                    </button>
                </div>

                <div class="flex items-stretch gap-2 min-w-0">
                    <div class="flex-1 min-w-0 flex h-10 rounded-lg bg-zinc-900 text-white">
                        <button
                            type="button"
                            data-testid="primary-action"
                            class="flex-1 min-w-0 px-2 truncate rounded-l-lg text-ui-13 font-semibold hover:bg-zinc-800 cursor-pointer disabled:text-zinc-400 disabled:cursor-default disabled:hover:bg-transparent"
                            :disabled="!canCommit"
                            :title="commitBlocker ?? 'Commit staged changes'"
                            @click="commit(false)"
                        >
                            {{ busyLabel ?? commitLabel }}
                        </button>
                        <span class="w-px my-2 bg-white/20" />
                        <PanelMenu label="Commit actions">
                            <template #trigger="{ toggle: toggleActions }">
                                <button
                                    type="button"
                                    class="w-9 flex items-center justify-center rounded-r-lg text-zinc-300 hover:bg-zinc-800 cursor-pointer"
                                    title="More commit actions"
                                    aria-label="More commit actions"
                                    @click="toggleActions"
                                >
                                    <ChevronDown :size="14" />
                                </button>
                            </template>
                            <template #default="{ close }">
                                <button type="button" role="menuitem" :class="menuItemClass" :disabled="!canCommit || !onBranch" :title="commitBlocker ?? undefined" @click="close(); commit(true)">
                                    Commit &amp; Push
                                </button>
                                <button type="button" role="menuitem" :class="menuItemClass" :disabled="!canCreatePullRequest" @click="close(); createPullRequest()">
                                    Create PR
                                </button>
                            </template>
                        </PanelMenu>
                    </div>

                    <a
                        v-if="openPullRequest"
                        data-testid="pr-created"
                        :href="openPullRequest.url"
                        target="_blank"
                        rel="noopener noreferrer"
                        :title="`#${openPullRequest.number} ${openPullRequest.title}`"
                        :class="[outlineButton, 'text-success hover:bg-zinc-50']"
                    >
                        <CircleCheck :size="14" /> PR Created
                    </a>
                    <button
                        v-else-if="!pullRequestInfo || pullRequestInfo.available"
                        type="button"
                        data-testid="create-pr"
                        :class="[outlineButton, 'text-zinc-800 hover:bg-zinc-50 cursor-pointer disabled:text-zinc-400 disabled:cursor-default disabled:hover:bg-transparent']"
                        :disabled="!canCreatePullRequest"
                        :title="pullRequestQuery.isLoading.value ? 'Checking pull request…' : undefined"
                        @click="createPullRequest"
                    >
                        <GitPullRequest :size="14" />
                        {{ actions.createPullRequest.isLoading.value ? 'Creating…' : 'Create PR' }}
                    </button>
                </div>

                <p
                    v-if="!openPullRequest && pullRequestInfo && !pullRequestInfo.available"
                    data-testid="pr-unavailable"
                    class="flex items-start gap-1.5 text-ui-11 text-zinc-500"
                >
                    <CircleAlert :size="12" class="shrink-0 mt-px" />
                    <span class="min-w-0 break-words">{{ pullRequestInfo.error ?? 'GitHub CLI is unavailable' }}</span>
                </p>

                <div class="flex items-center gap-2 text-ui-11 text-zinc-400">
                    <span class="min-w-0 truncate">⌘↵ commit · ⌘⇧↵ commit &amp; push</span>
                    <span v-if="hasComparison" data-testid="ahead-of-base" class="ml-auto shrink-0">{{ ahead }} ahead of {{ comparedBase }}</span>
                </div>
            </div>
        </template>
    </div>
</template>

