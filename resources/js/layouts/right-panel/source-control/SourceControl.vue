<script setup lang="ts">
import {
    ArrowDown, ArrowUp, Check, ChevronDown, CircleAlert, CircleCheck, Ellipsis, GitBranch, GitPullRequest, History, Plus, X,
} from '@lucide/vue'
import { computed, ref } from 'vue'
import { useGitWorktree, worktreeLabel } from '@/composables/useGitWorktree'
import {
    isOpenPullRequest, useGitActions, useGitCommits, useGitPullRequest, useGitStatus, type GitFileChange, type GitPaths, type GitWorktree,
} from '@/queries/gitQuery'
import { useDiffStore } from '@/stores/diffStore'
import { useEditorStore } from '@/stores/editorStore'
import type { Project } from '@/types/type'
import ChangeList from './ChangeList.vue'
import PanelMenu from './PanelMenu.vue'
import { menuItemClass, useCommitDraft } from './sourceControl'
import WorktreePicker from './WorktreePicker.vue'

const props = defineProps<{ project: Project }>()
const projectId = () => props.project.id

const { worktrees, selected: selectedWorktree, target, select: selectWorktree } = useGitWorktree(projectId)
const { status, error: statusError, isLoading, refetch } = useGitStatus(target)
const isRepo = computed(() => status.value?.is_repo === true)
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

// The main button follows the reference: stage while there is anything unstaged, then commit.
const primary = computed(() =>
    changes.value.length > 0
        ? { label: 'Stage All', icon: Plus, disabled: actions.isBusy.value, title: 'Stage all changes', run: () => setStaged(true, 'all') }
        : { label: 'Commit', icon: Check, disabled: !canCommit.value, title: commitBlocker.value ?? 'Commit staged changes', run: () => commit(false) },
)

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
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && canCommit.value) {
        event.preventDefault()
        commit(false)
    }
}

function openDiff(file: GitFileChange, staged: boolean) {
    if (!target.value) return
    const nested = staged ? undefined : nestedWorktrees.value[file.path]
    if (nested) return selectWorktree(nested.path)
    const worktree = selectedWorktree.value
    diffs.open(target.value, file.path, staged, worktree && !worktree.is_current ? worktreeLabel(worktree) : null)
}

function openFile(file: GitFileChange) {
    editor.open(props.project.id, file.path)
}

const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

const headerButton = 'p-1 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-200/70 transition-colors cursor-pointer disabled:text-zinc-300 disabled:cursor-default disabled:hover:bg-transparent'
const blockButton = 'w-full h-8 flex items-center justify-center gap-1.5 rounded-md border border-stroke bg-surface text-[13px] transition-colors'
</script>

<template>
    <div class="flex-1 min-h-0 flex flex-col min-w-0 text-[12px] text-zinc-700" data-testid="source-control">
        <div class="relative flex items-center gap-2 h-10 pl-3 pr-2 shrink-0">
            <h2 class="shrink-0 text-[13px] font-medium text-zinc-900">Source Control</h2>
            <WorktreePicker
                v-if="status?.is_repo"
                class="min-w-0"
                :worktrees="worktrees"
                :selected="selectedWorktree"
                :branch-label="branchLabel"
                :title="branchTitle"
                @select="selectWorktree"
            />
            <span
                v-if="status?.ahead || status?.behind"
                class="shrink-0 flex items-center gap-1 font-mono text-[11px] text-zinc-500"
                :title="`${status.ahead} to push, ${status.behind} to pull`"
            >
                <span v-if="status.ahead" class="flex items-center"><ArrowUp :size="11" />{{ status.ahead }}</span>
                <span v-if="status.behind" class="flex items-center"><ArrowDown :size="11" />{{ status.behind }}</span>
            </span>

            <div class="ml-auto flex items-center gap-0.5 shrink-0">
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
                            <p class="text-[11px] text-zinc-400">
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
            </div>
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
            <p class="text-[13px] text-zinc-600">Not a git repository</p>
            <p class="break-all font-mono text-[11px]">{{ project.path }}</p>
        </div>

        <template v-else-if="status">
            <div class="shrink-0 px-3 pb-3 space-y-2 border-b border-stroke">
                <textarea
                    v-model="message"
                    rows="3"
                    placeholder="Commit message (⌘⏎ to commit)"
                    aria-label="Commit message"
                    class="block w-full resize-none rounded-md border border-stroke bg-surface px-3 py-2 text-[13px] leading-snug text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-accent"
                    @keydown="onMessageKeydown"
                />

                <div class="flex h-8 rounded-md border border-stroke bg-surface">
                    <button
                        type="button"
                        data-testid="primary-action"
                        class="flex-1 min-w-0 flex items-center justify-center gap-1.5 rounded-l-md text-[13px] text-zinc-800 hover:bg-zinc-50 cursor-pointer disabled:text-zinc-400 disabled:cursor-default disabled:hover:bg-transparent"
                        :disabled="primary.disabled"
                        :title="primary.title"
                        @click="primary.run"
                    >
                        <component :is="primary.icon" v-if="!busyLabel" :size="14" />
                        {{ busyLabel ?? primary.label }}
                    </button>
                    <span class="w-px my-1.5 bg-stroke" />
                    <PanelMenu label="Commit actions">
                        <template #trigger="{ toggle: toggleActions }">
                            <button
                                type="button"
                                class="w-8 flex items-center justify-center rounded-r-md text-zinc-500 hover:bg-zinc-50 cursor-pointer"
                                title="More commit actions"
                                aria-label="More commit actions"
                                @click="toggleActions"
                            >
                                <ChevronDown :size="14" />
                            </button>
                        </template>
                        <template #default="{ close }">
                            <button type="button" role="menuitem" :class="menuItemClass" :disabled="!canCommit" :title="commitBlocker ?? undefined" @click="close(); commit(false)">
                                Commit
                            </button>
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
                    :class="[blockButton, 'text-success hover:bg-zinc-50']"
                >
                    <CircleCheck :size="14" /> PR Created
                </a>
                <p
                    v-else-if="pullRequestInfo && !pullRequestInfo.available"
                    data-testid="pr-unavailable"
                    class="flex items-start justify-center gap-1.5 px-3 py-2 rounded-md border border-dashed border-stroke text-center text-zinc-500"
                >
                    <CircleAlert :size="13" class="shrink-0 mt-px" />
                    <span class="min-w-0 break-words">{{ pullRequestInfo.error ?? 'GitHub CLI is unavailable' }}</span>
                </p>
                <button
                    v-else
                    type="button"
                    data-testid="create-pr"
                    :class="[blockButton, 'text-zinc-800 hover:bg-zinc-50 cursor-pointer disabled:text-zinc-400 disabled:cursor-default disabled:hover:bg-transparent']"
                    :disabled="!canCreatePullRequest"
                    @click="createPullRequest"
                >
                    <GitPullRequest :size="14" />
                    <template v-if="actions.createPullRequest.isLoading.value">Creating PR…</template>
                    <template v-else-if="pullRequestQuery.isLoading.value">Checking pull request…</template>
                    <template v-else>Create PR</template>
                </button>

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
            </div>

            <div class="flex-1 min-h-0 overflow-y-auto pt-2">
                <div
                    v-if="!staged.length && !changes.length"
                    data-testid="clean-tree"
                    class="flex flex-col items-center gap-1.5 px-6 py-8 text-center text-zinc-400"
                >
                    <CircleCheck :size="20" />
                    <p class="text-[13px] text-zinc-600">No changes</p>
                    <p>The working tree is clean.</p>
                </div>
                <ChangeList
                    v-if="staged.length"
                    title="Staged changes"
                    :files="staged"
                    staged
                    :disabled="actions.isBusy.value"
                    :can-open-file="canOpenFile"
                    @toggle="paths => setStaged(false, paths)"
                    @open="file => openDiff(file, true)"
                    @open-file="openFile"
                />
                <ChangeList
                    v-if="changes.length"
                    title="Changes"
                    :files="changes"
                    :staged="false"
                    :disabled="actions.isBusy.value"
                    :can-open-file="canOpenFile"
                    :worktree-labels="nestedWorktreeLabels"
                    @toggle="paths => setStaged(true, paths)"
                    @open="file => openDiff(file, false)"
                    @open-file="openFile"
                />
            </div>
        </template>
    </div>
</template>
