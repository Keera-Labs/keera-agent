<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import WorkspaceAddModal from '@/components/WorkspaceAddModal.vue'
import Icon from '@/components/ui/Icon.vue'
import useWorkspaces from '@/queries/workspacesQuery'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { color } from '@/tokens'

const workspaceStore = useWorkspaceStore()
const { workspaces } = useWorkspaces()
const open = ref(false)
const root = ref<HTMLElement | null>(null)

const selected = computed(() => workspaceStore.currentWorkspaceId)
const current = computed(() =>
    selected.value !== null ? workspaces.value.find(w => w.id === selected.value) ?? null : null,
)

function select(id: number | null) {
    workspaceStore.setCurrentWorkspaceId(id)
    open.value = false
}

function onClickOutside(e: MouseEvent) {
    if (root.value && !root.value.contains(e.target as Node)) open.value = false
}

watch(open, isOpen => {
    if (isOpen) document.addEventListener('mousedown', onClickOutside)
    else document.removeEventListener('mousedown', onClickOutside)
})
onBeforeUnmount(() => document.removeEventListener('mousedown', onClickOutside))
</script>

<template>
    <div ref="root" class="pt-2 px-2.5 pb-1.5 relative">
        <div class="pt-0 px-1 pb-1 text-[10px] font-bold tracking-[0.08em] uppercase text-zinc-400">
            Workspace
        </div>
        <button
            type="button"
            data-testid="workspace-picker"
            class="flex items-center gap-2 w-full py-[7px] px-2.5 rounded-md bg-surface border border-stroke cursor-pointer text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
            @click="open = !open"
        >
            <div class="w-[30px] h-[30px] rounded-[7px] bg-blue-600 flex items-center justify-center text-[13px] font-bold text-white shrink-0 tracking-[-0.01em]">
                {{ (current?.name[0] ?? 'P').toUpperCase() }}
            </div>
            <span class="text-zinc-900 text-[13px] font-semibold flex-1 truncate">
                {{ current?.name ?? 'Personal Workspace' }}
            </span>
            <Icon name="chevrons-up-down" :size="12" :color="color.textFaint" class="shrink-0" />
        </button>

        <!-- v-show, not v-if: the add-workspace modal lives in here and must stay
             mounted after the dropdown closes behind it. -->
        <div
            v-show="open"
            data-testid="workspace-menu"
            class="absolute top-[calc(100%-2px)] left-2.5 right-2.5 z-[200] bg-surface border border-stroke rounded-md shadow-[0_8px_24px_rgba(0,0,0,0.12)] py-1 px-0 overflow-hidden"
        >
            <button
                type="button"
                :class="['flex items-center gap-2 w-full py-[7px] px-3 bg-transparent border-0 cursor-pointer text-[12px] hover:bg-canvas', selected === null ? 'text-zinc-900' : 'text-zinc-700']"
                @click="select(null)"
            >
                All Projects
                <Icon v-if="selected === null" name="check" :size="10" :color="color.accent" class="ml-auto" />
            </button>

            <div v-for="w in workspaces" :key="w.id" class="flex items-center min-w-0">
                <button
                    type="button"
                    data-testid="workspace-option"
                    :class="['flex-1 min-w-0 flex items-center gap-2 py-[7px] px-3 bg-transparent border-0 cursor-pointer text-[12px] text-left hover:bg-canvas', selected === w.id ? 'text-zinc-900' : 'text-zinc-700']"
                    @click="select(w.id)"
                >
                    <span class="truncate">{{ w.name }}</span>
                    <Icon v-if="selected === w.id" name="check" :size="10" :color="color.accent" class="ml-auto shrink-0" />
                </button>
                <button
                    type="button"
                    title="Delete workspace"
                    class="bg-transparent border-0 cursor-pointer text-zinc-400 pt-[7px] pr-2.5 pb-[7px] pl-1 flex items-center hover:text-danger"
                    @click.stop="workspaceStore.setDeletingWorkspace(w); open = false"
                >
                    <Icon name="trash-2" :size="11" />
                </button>
            </div>

            <div class="h-px bg-stroke my-1 mx-0" />

            <WorkspaceAddModal @open-change="isOpen => { if (isOpen) open = false }">
                <template #trigger>
                    <button
                        type="button"
                        class="flex items-center gap-1.5 w-full py-[7px] px-3 bg-transparent border-0 cursor-pointer text-[12px] text-accent hover:bg-canvas"
                    >
                        <Icon name="plus" :size="10" />
                        New Workspace
                    </button>
                </template>
            </WorkspaceAddModal>
        </div>
    </div>
</template>
