<script setup lang="ts">
import { router } from '@inertiajs/vue3'
import { onBeforeUnmount, ref, watch } from 'vue'
import DotsIndicator from '@/components/ui/DotsIndicator.vue'
import Icon from '@/components/ui/Icon.vue'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { color } from '@/tokens'
import type { Project } from '@/types/type'

const props = defineProps<{
    project: Project
    active: boolean
    status?: 'running' | 'done'
}>()

const layout = useAppLayoutStore()
const hovered = ref(false)
const menuOpen = ref(false)
const menu = ref<HTMLElement | null>(null)

const menuItemClass = (danger = false) =>
    `flex items-center gap-2 py-1.5 px-3 cursor-pointer text-[12px] ${danger ? 'text-danger' : 'text-zinc-700'} bg-transparent border-0 w-full text-left whitespace-nowrap hover:bg-canvas`

function visit() {
    router.visit(`/${props.project.slug}`)
}

// The project edit/move/delete modals are ported separately.
function openPendingModal(name: string) {
    menuOpen.value = false
    layout.migratingModal = name
}

function openDirectory() {
    menuOpen.value = false
    fetch(`/api/projects/${props.project.id}/open-directory`, { method: 'POST' })
}

function onClickOutside(e: MouseEvent) {
    if (menu.value && !menu.value.contains(e.target as Node)) menuOpen.value = false
}

watch(menuOpen, isOpen => {
    if (isOpen) document.addEventListener('mousedown', onClickOutside)
    else document.removeEventListener('mousedown', onClickOutside)
})
onBeforeUnmount(() => document.removeEventListener('mousedown', onClickOutside))
</script>

<template>
    <div class="relative flex py-px px-1.5" @mouseenter="hovered = true" @mouseleave="hovered = false">
        <div
            role="button"
            tabindex="0"
            data-testid="project-item"
            :class="[
                'flex-1 min-w-0 flex flex-row items-center gap-[7px] pt-1.5 pr-7 pb-1.5 pl-2 rounded cursor-pointer text-left transition-colors duration-100',
                props.active ? 'bg-[#EEF2FF]' : hovered ? 'bg-[#F5F7FF]' : 'bg-transparent',
            ]"
            @click="visit"
            @keydown.enter="visit"
        >
            <Icon name="folder" :size="14" :color="props.active ? '#4F46E5' : color.textMuted" class="shrink-0" />

            <span
                :class="['text-[13px] truncate flex-1', props.active ? 'text-[#4338CA] font-semibold' : 'text-zinc-700 font-normal']"
                :title="props.project.name"
            >
                {{ props.project.name }}
            </span>

            <div class="shrink-0 flex items-center">
                <DotsIndicator v-if="props.status === 'running'" />
                <span v-else-if="props.status === 'done'" class="w-[7px] h-[7px] rounded-full bg-success" />
            </div>
        </div>

        <button
            v-if="hovered || menuOpen"
            type="button"
            aria-label="Project actions"
            :class="[
                'absolute right-1.5 top-1/2 -translate-y-1/2 border rounded-sm cursor-pointer text-zinc-500 py-0.5 px-1 flex items-center leading-none',
                menuOpen ? 'bg-surface border-stroke' : 'bg-transparent border-transparent hover:bg-surface',
            ]"
            @mousedown.stop
            @click.stop="menuOpen = !menuOpen"
        >
            <Icon name="ellipsis-vertical" :size="12" />
        </button>

        <div
            v-if="menuOpen"
            ref="menu"
            class="absolute right-0 top-full z-[200] bg-surface border border-stroke rounded shadow-[0_8px_24px_rgba(0,0,0,0.12)] min-w-[170px] py-1 px-0"
        >
            <button type="button" :class="menuItemClass()" @click.stop="openPendingModal('Edit project')">
                <Icon name="settings" :size="12" class="shrink-0" />
                Edit project
            </button>
            <button type="button" :class="menuItemClass()" @click.stop="openPendingModal('Move project')">
                <Icon name="arrow-right" :size="12" class="shrink-0" />
                Move to workspace
            </button>
            <button type="button" :class="menuItemClass()" @click.stop="openDirectory">
                <Icon name="folder" :size="12" class="shrink-0" />
                Open in directory
            </button>
            <div class="h-px bg-stroke my-1 mx-0" />
            <button type="button" :class="menuItemClass(true)" @click.stop="openPendingModal('Delete project')">
                <Icon name="trash-2" :size="12" class="shrink-0" />
                Delete project
            </button>
        </div>
    </div>
</template>
