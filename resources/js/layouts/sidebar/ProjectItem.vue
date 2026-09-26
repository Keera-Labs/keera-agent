<script setup lang="ts">
import { router } from '@inertiajs/vue3'
import { onBeforeUnmount, ref, watch } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import ProjectDeleteModal from '@/pages/project/ProjectDeleteModal.vue'
import ProjectEditModal from '@/pages/project/ProjectEditModal.vue'
import ProjectMoveModal from '@/pages/project/ProjectMoveModal.vue'
import type { Project } from '@/types/type'

const props = defineProps<{
    project: Project
    active: boolean
    status?: 'running' | 'done'
}>()

const hovered = ref(false)
const menuOpen = ref(false)
const menu = ref<HTMLElement | null>(null)
const root = ref<HTMLElement | null>(null)
const modalOpen = ref(false)
const openUp = ref(false)

const MENU_HEIGHT = 160

function toggleMenu() {
    if (!menuOpen.value && root.value) {
        // The list scrolls, so a menu dropping below its last rows would be clipped.
        const scroller = root.value.closest('.overflow-y-auto') ?? document.documentElement
        const spaceBelow = scroller.getBoundingClientRect().bottom - root.value.getBoundingClientRect().bottom
        openUp.value = spaceBelow < MENU_HEIGHT
    }
    menuOpen.value = !menuOpen.value
}

const menuItemClass = (danger = false) =>
    `flex items-center gap-2 h-7 px-2 rounded-md cursor-pointer text-[12.5px] ${danger ? 'text-danger' : 'text-zinc-700'} bg-transparent border-0 w-full text-left whitespace-nowrap hover:bg-black/[0.04]`

const STATUS_DOT: Record<'running' | 'done' | 'idle', string> = {
    running: 'bg-amber-500 animate-pulse',
    done: 'bg-success',
    idle: 'bg-zinc-300',
}

function visit() {
    router.visit(`/${props.project.slug}`)
}

// The modals live inside the menu, so it stays open until the modal closes.
function onModalOpenChange(open: boolean) {
    modalOpen.value = open
    if (!open) menuOpen.value = false
}

function openDirectory() {
    menuOpen.value = false
    fetch(`/api/projects/${props.project.id}/open-directory`, { method: 'POST' })
}

function onClickOutside(e: MouseEvent) {
    // A modal is teleported to <body>, so clicks inside it land "outside" the menu.
    if (modalOpen.value) return
    if (menu.value && !menu.value.contains(e.target as Node)) menuOpen.value = false
}

watch(menuOpen, isOpen => {
    if (isOpen) document.addEventListener('mousedown', onClickOutside)
    else document.removeEventListener('mousedown', onClickOutside)
})
onBeforeUnmount(() => document.removeEventListener('mousedown', onClickOutside))
</script>

<template>
    <div ref="root" class="relative flex" @mouseenter="hovered = true" @mouseleave="hovered = false">
        <div
            role="button"
            tabindex="0"
            data-testid="project-item"
            :aria-current="props.active ? 'page' : undefined"
            :class="[
                'flex-1 min-w-0 flex items-center gap-2 py-1 pl-2 pr-7 rounded-md cursor-pointer text-left transition-colors duration-100',
                props.active
                    ? 'bg-surface shadow-[0_1px_2px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.04]'
                    : 'hover:bg-black/[0.04]',
            ]"
            @click="visit"
            @keydown.enter="visit"
        >
            <span
                data-testid="project-status"
                :data-status="props.status ?? 'idle'"
                :class="['w-[7px] h-[7px] rounded-full shrink-0', STATUS_DOT[props.status ?? 'idle']]"
            />

            <div class="flex-1 min-w-0">
                <div
                    :class="['text-[13px] truncate leading-5', props.active ? 'text-zinc-900 font-medium' : 'text-zinc-700']"
                    :title="props.project.name"
                >
                    {{ props.project.name }}
                </div>
                <div v-if="props.active" class="text-[11px] text-zinc-500 truncate leading-4" :title="props.project.path">
                    {{ props.project.path }}
                </div>
            </div>
        </div>

        <button
            v-if="hovered || menuOpen"
            type="button"
            aria-label="Project actions"
            :class="[
                'absolute right-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md cursor-pointer text-zinc-500 flex items-center justify-center hover:text-zinc-800',
                menuOpen ? 'bg-black/[0.06]' : 'hover:bg-black/[0.05]',
            ]"
            @mousedown.stop
            @click.stop="toggleMenu"
        >
            <Icon name="ellipsis-vertical" :size="13" />
        </button>

        <div
            v-if="menuOpen"
            ref="menu"
            data-testid="project-menu"
            :class="[
                'absolute right-0 z-[200]',
                openUp ? 'bottom-full mb-1' : 'top-full mt-1',
                'bg-surface border border-stroke rounded-lg shadow-[0_8px_24px_rgba(0,0,0,0.12)] min-w-[180px] p-1',
                // Stays mounted so the modal instance survives, but must not paint above the modal backdrop.
                modalOpen && 'invisible pointer-events-none',
            ]"
        >
            <ProjectEditModal :project="props.project" @open-change="onModalOpenChange">
                <template #trigger>
                    <button type="button" :class="menuItemClass()">
                        <Icon name="settings" :size="13" class="shrink-0" />
                        Edit project
                    </button>
                </template>
            </ProjectEditModal>
            <ProjectMoveModal :project="props.project" @open-change="onModalOpenChange">
                <template #trigger>
                    <button type="button" :class="menuItemClass()">
                        <Icon name="arrow-right" :size="13" class="shrink-0" />
                        Move to workspace
                    </button>
                </template>
            </ProjectMoveModal>
            <button type="button" :class="menuItemClass()" @click.stop="openDirectory">
                <Icon name="folder" :size="13" class="shrink-0" />
                Open in directory
            </button>
            <div class="h-px bg-stroke my-1 -mx-1" />
            <ProjectDeleteModal :project="props.project" @open-change="onModalOpenChange">
                <template #trigger>
                    <button type="button" :class="menuItemClass(true)">
                        <Icon name="trash-2" :size="13" class="shrink-0" />
                        Delete project
                    </button>
                </template>
            </ProjectDeleteModal>
        </div>
    </div>
</template>
