<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import WorkspaceAddModal from '@/components/WorkspaceAddModal.vue'
import Icon from '@/components/ui/Icon.vue'
import useWorkspaces from '@/queries/workspacesQuery'
import { useWorkspaceStore } from '@/stores/workspaceStore'

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
    <div ref="root" class="relative px-2 pt-2 pb-1 border-t border-stroke">
        <div class="flex items-center h-6 pl-1.5 pr-0.5 mb-1">
            <span class="flex-1 text-[11px] font-semibold tracking-[0.06em] uppercase text-zinc-500">Workspaces</span>
            <WorkspaceAddModal @open-change="isOpen => { if (isOpen) open = false }">
                <template #trigger>
                    <button
                        type="button"
                        title="New workspace"
                        class="flex items-center justify-center w-6 h-6 rounded-md text-zinc-500 cursor-pointer hover:bg-black/[0.05] hover:text-zinc-800"
                    >
                        <Icon name="plus" :size="13" />
                    </button>
                </template>
            </WorkspaceAddModal>
        </div>

        <button
            type="button"
            data-testid="workspace-picker"
            :aria-expanded="open"
            class="flex items-center gap-2 w-full py-1.5 px-2 rounded-lg bg-surface border border-stroke cursor-pointer text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:border-zinc-300"
            @click="open = !open"
        >
            <div class="w-6 h-6 rounded-md bg-violet-600 flex items-center justify-center text-[12px] font-semibold text-white shrink-0">
                {{ (current?.name[0] ?? 'P').toUpperCase() }}
            </div>
            <div class="flex-1 min-w-0">
                <div class="text-zinc-900 text-[12.5px] font-semibold truncate leading-tight">
                    {{ current?.name ?? 'Personal Workspace' }}
                </div>
                <!-- No project count: the projects query is paginated, so its length is not a total. -->
                <div data-testid="workspace-subtitle" class="text-zinc-500 text-[11px] truncate leading-tight">
                    {{ current ? 'Workspace' : 'All projects' }}
                </div>
            </div>
            <Icon name="chevrons-up-down" :size="12" class="shrink-0 text-zinc-400" />
        </button>

        <!-- v-show, not v-if: the add-workspace modal lives in here and must stay
             mounted after the dropdown closes behind it. Opens upward because the
             picker sits at the bottom of the sidebar. -->
        <div
            v-show="open"
            data-testid="workspace-menu"
            class="absolute bottom-full left-2 right-2 mb-1 z-[200] bg-surface border border-stroke rounded-lg shadow-[0_8px_24px_rgba(0,0,0,0.12)] p-1 overflow-hidden"
        >
            <button
                type="button"
                :class="['flex items-center gap-2 w-full h-7 px-2 rounded-md bg-transparent border-0 cursor-pointer text-[12.5px] hover:bg-black/[0.04]', selected === null ? 'text-zinc-900 font-medium' : 'text-zinc-700']"
                @click="select(null)"
            >
                All Projects
                <Icon v-if="selected === null" name="check" :size="12" class="ml-auto text-accent" />
            </button>

            <div v-for="w in workspaces" :key="w.id" class="group flex items-center min-w-0 rounded-md hover:bg-black/[0.04]">
                <button
                    type="button"
                    data-testid="workspace-option"
                    :class="['flex-1 min-w-0 flex items-center gap-2 h-7 px-2 bg-transparent border-0 cursor-pointer text-[12.5px] text-left', selected === w.id ? 'text-zinc-900 font-medium' : 'text-zinc-700']"
                    @click="select(w.id)"
                >
                    <span class="truncate">{{ w.name }}</span>
                    <Icon v-if="selected === w.id" name="check" :size="12" class="ml-auto shrink-0 text-accent" />
                </button>
                <button
                    type="button"
                    title="Delete workspace"
                    class="bg-transparent border-0 cursor-pointer text-zinc-400 h-7 pr-2 pl-1 flex items-center opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-danger"
                    @click.stop="workspaceStore.setDeletingWorkspace(w); open = false"
                >
                    <Icon name="trash-2" :size="12" />
                </button>
            </div>

            <div class="h-px bg-stroke my-1 -mx-1" />

            <WorkspaceAddModal @open-change="isOpen => { if (isOpen) open = false }">
                <template #trigger>
                    <button
                        type="button"
                        class="flex items-center gap-1.5 w-full h-7 px-2 rounded-md bg-transparent border-0 cursor-pointer text-[12.5px] text-accent hover:bg-black/[0.04]"
                    >
                        <Icon name="plus" :size="12" />
                        New Workspace
                    </button>
                </template>
            </WorkspaceAddModal>
        </div>
    </div>
</template>
