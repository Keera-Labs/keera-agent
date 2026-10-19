<script setup lang="ts">
import { RotateCw } from '@lucide/vue'
import { storeToRefs } from 'pinia'
import { computed, nextTick, watch } from 'vue'
import { shellKey, useShellStore } from '@/stores/shellStore'
import { usePanelWorktree } from './usePanelWorktree'

const props = defineProps<{ visible: boolean }>()

const store = useShellStore()
const { shells } = storeToRefs(store)
const { activeProject, path, place, branch, status, ready } = usePanelWorktree()

const currentKey = computed(() =>
    activeProject.value && ready.value ? shellKey({ projectSlug: activeProject.value.slug, worktree: path.value }) : null)
const current = computed(() => shells.value.find(s => s.key === currentKey.value) ?? null)

watch([() => props.visible, currentKey], async ([visible]) => {
    if (!visible || !activeProject.value || !ready.value) return
    store.open({ projectSlug: activeProject.value.slug, worktree: path.value, place: place.value })
    await nextTick()
    if (currentKey.value) store.focus(currentKey.value)
}, { immediate: true })
</script>

<template>
    <section v-show="visible" data-testid="terminal-view" aria-label="Terminal" class="flex-1 min-h-0 min-w-0 flex flex-col">
        <div class="shrink-0 flex items-center gap-2 px-4 pt-3 pb-2 text-ui-11 text-zinc-400">
            <span data-testid="terminal-place" class="flex-1 min-w-0 truncate" :title="branch ? `${place} · ${branch}` : place">
                Shell in {{ place }}<template v-if="branch"> · <span class="font-mono">{{ branch }}</span></template>
            </span>
            <button
                v-if="current && !current.alive"
                type="button"
                data-testid="terminal-restart"
                class="shrink-0 h-6 px-1.5 flex items-center gap-1 rounded-md text-ui-12 text-zinc-600 cursor-pointer hover:bg-black/[0.05] hover:text-zinc-900"
                @click="store.restart(current.key)"
            >
                <RotateCw :size="11" /> Restart shell
            </button>
        </div>
        <p v-if="status === 'missing'" data-testid="terminal-no-worktree" class="shrink-0 px-4 pb-2 text-ui-12 text-zinc-500">
            This agent has no worktree.
        </p>
        <div :class="['relative min-h-0 overflow-hidden mx-3 mb-3 rounded-lg border border-stroke bg-white', current ? 'flex-1' : 'hidden']">
            <div
                v-for="shell in shells"
                :key="shell.key"
                :ref="el => store.setHost(shell.key, el as HTMLElement | null)"
                :data-shell="shell.key"
                :class="['absolute inset-0 terminal-host', shell.key === current?.key ? 'block' : 'hidden']"
                @click="store.focus(shell.key)"
            />
        </div>
    </section>
</template>
