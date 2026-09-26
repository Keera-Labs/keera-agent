<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { inputClass } from '@/components/ui/styles'
import { color } from '@/tokens'
import type { Project } from '@/types/type'

const HINTS = [['↑↓', 'navigate'], ['↵', 'open'], ['Esc', 'close']] as const

const props = defineProps<{ projects: Project[] }>()
const emit = defineEmits<{ close: []; select: [project: Project] }>()

const query = ref('')
const cursor = ref(0)
const input = ref<HTMLInputElement | null>(null)
const list = ref<HTMLElement | null>(null)

const filtered = computed(() => {
    const q = query.value.trim().toLowerCase()
    if (!q) return props.projects
    return props.projects.filter(p => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q))
})

watch(query, () => { cursor.value = 0 })

watch(cursor, async idx => {
    await nextTick()
    list.value?.querySelector<HTMLElement>(`[data-idx="${idx}"]`)?.scrollIntoView({ block: 'nearest' })
})

onMounted(() => input.value?.focus())

function choose(project: Project) {
    emit('select', project)
    emit('close')
}

function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
        e.preventDefault()
        cursor.value = Math.min(cursor.value + 1, filtered.value.length - 1)
    } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        cursor.value = Math.max(cursor.value - 1, 0)
    } else if (e.key === 'Enter') {
        e.preventDefault()
        const project = filtered.value[cursor.value]
        if (project) choose(project)
    } else if (e.key === 'Escape') {
        e.preventDefault()
        emit('close')
    }
}
</script>

<template>
    <div
        class="fixed inset-0 bg-black/50 flex items-start justify-center z-[500] pt-[15vh]"
        data-testid="search-backdrop"
        @click.self="emit('close')"
    >
        <div
            role="dialog"
            aria-label="Search projects"
            class="bg-modal border border-stroke rounded-[10px] w-[480px] max-w-[92vw] shadow-[0_16px_48px_rgba(0,0,0,0.14)] overflow-hidden flex flex-col"
        >
            <div class="flex items-center gap-2.5 py-3 px-3.5 border-b border-stroke">
                <Icon name="search" :size="14" :color="color.textMuted" class="shrink-0" />
                <input
                    ref="input"
                    v-model="query"
                    placeholder="Search projects..."
                    :class="[inputClass, 'flex-1']"
                    style="border: none; background: transparent; outline: none; padding: 0; font-size: 14px"
                    @keydown="onKey"
                >
                <button
                    v-if="query"
                    type="button"
                    aria-label="Clear search"
                    class="bg-transparent border-0 text-zinc-500 cursor-pointer p-0.5 flex items-center"
                    @click="query = ''"
                >
                    <Icon name="x" :size="12" />
                </button>
            </div>

            <div ref="list" class="max-h-[320px] overflow-y-auto py-1 px-0">
                <div v-if="filtered.length === 0" class="p-5 text-center text-zinc-400 text-[13px]">No projects found</div>
                <template v-else>
                    <div
                        v-for="(project, idx) in filtered"
                        :key="project.id"
                        :data-idx="idx"
                        data-testid="search-result"
                        :class="[
                            'flex items-center gap-2.5 py-2 px-3.5 cursor-pointer transition-colors duration-100',
                            idx === cursor ? 'bg-canvas' : 'bg-transparent',
                        ]"
                        @click="choose(project)"
                        @mouseenter="cursor = idx"
                    >
                        <Icon name="folder" :size="13" :color="color.textMuted" class="shrink-0" />
                        <div class="flex-1 min-w-0">
                            <div class="text-[13px] font-medium text-zinc-900 truncate">{{ project.name }}</div>
                            <div class="text-[11px] text-zinc-400 truncate font-mono">{{ project.path }}</div>
                        </div>
                        <span v-if="idx === cursor" class="text-[10px] text-zinc-400 shrink-0">↵</span>
                    </div>
                </template>
            </div>

            <div class="border-t border-stroke py-1.5 px-3.5 flex gap-3">
                <span v-for="[key, label] in HINTS" :key="key" class="flex items-center gap-1 text-[11px] text-zinc-400">
                    <kbd class="bg-canvas border border-stroke rounded-[3px] py-px px-1 text-[10px] font-[inherit]">{{ key }}</kbd>
                    {{ label }}
                </span>
            </div>
        </div>
    </div>
</template>
