<script setup lang="ts">
import { Check, ChevronDown } from '@lucide/vue'
import { computed, ref } from 'vue'
import PanelMenu from './PanelMenu.vue'
import { menuItemClass } from './sourceControl'

const props = defineProps<{ branches: string[]; current: string | null; defaultBase: string | null }>()
const emit = defineEmits<{ select: [branch: string] }>()

const open = ref(false)
const filter = ref('')
const matches = computed(() => {
    const needle = filter.value.trim().toLowerCase()
    return needle ? props.branches.filter(branch => branch.toLowerCase().includes(needle)) : props.branches
})

function choose(branch: string, close: () => void) {
    close()
    filter.value = ''
    emit('select', branch)
}
</script>

<template>
    <PanelMenu v-model:open="open" label="Compare with branch" full-width menu-class="max-h-72 flex flex-col text-left">
        <template #trigger="{ toggle }">
            <button
                type="button"
                class="min-w-0 max-w-32 flex items-center gap-1 h-7 px-2 rounded-md border border-stroke bg-surface text-ui-12 text-zinc-600 hover:bg-zinc-50 cursor-pointer"
                :title="`Compare with ${current ?? 'base'}`"
                aria-label="Change base branch"
                @click="toggle"
            >
                <span class="shrink-0">into</span>
                <span data-testid="base-picker" class="min-w-0 truncate font-semibold text-zinc-900">{{ current ?? 'base' }}</span>
                <ChevronDown :size="12" class="shrink-0 text-zinc-500" />
            </button>
        </template>
        <template #default="{ close }">
            <input
                v-model="filter"
                type="search"
                placeholder="Filter branches"
                aria-label="Filter branches"
                class="mx-2 mb-1 h-7 shrink-0 rounded border border-stroke bg-surface px-2 text-ui-12 outline-none focus:border-accent"
            >
            <div class="min-h-0 overflow-y-auto">
                <button
                    v-for="branch in matches"
                    :key="branch"
                    type="button"
                    role="menuitemradio"
                    data-testid="base-option"
                    :aria-checked="branch === current"
                    :class="menuItemClass"
                    @click="choose(branch, close)"
                >
                    <Check :size="12" :class="['shrink-0', branch === current ? 'text-accent' : 'invisible']" />
                    <span class="min-w-0 flex-1 truncate font-mono">{{ branch }}</span>
                    <span v-if="branch === defaultBase" class="shrink-0 text-ui-11 text-zinc-400">default</span>
                </button>
                <p v-if="!matches.length" class="px-3 py-1.5 text-zinc-400">No matching branches</p>
            </div>
        </template>
    </PanelMenu>
</template>
