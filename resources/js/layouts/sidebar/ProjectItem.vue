<script setup lang="ts">
import { router } from '@inertiajs/vue3'
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import ProjectDeleteModal from '@/pages/project/ProjectDeleteModal.vue'
import ProjectEditModal from '@/pages/project/ProjectEditModal.vue'
import ProjectMoveModal from '@/pages/project/ProjectMoveModal.vue'
import useProjects from '@/queries/projectsQuery'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import type { Project } from '@/types/type'
import { placeMenu } from './menuPlacement'
import type { ProjectColor } from './projectColor'

const props = defineProps<{
    project: Project
    color: ProjectColor
    active: boolean
    status?: 'running' | 'done'
}>()

const hovered = ref(false)
const menuOpen = ref(false)
const menu = ref<HTMLElement | null>(null)
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const modalOpen = ref(false)
const menuPosition = ref({ top: 0, left: 0 })

async function toggleMenu() {
    if (menuOpen.value) {
        menuOpen.value = false
        return
    }
    menuOpen.value = true
    await nextTick()
    if (!menu.value || !root.value) return
    // Fixed, so neither the scrolling list nor the sidebar can clip it. Placed after
    // rendering because its size grows with the UI font size; this runs before the
    // next paint, so it never shows at the wrong spot first.
    const { width, height } = menu.value.getBoundingClientRect()
    menuPosition.value = placeMenu(root.value.getBoundingClientRect(), { width, height }, { width: window.innerWidth, height: window.innerHeight })
}

const menuItemClass = (danger = false) =>
    `flex items-center gap-2 h-7 px-2 rounded-md cursor-pointer text-ui-12.5 ${danger ? 'text-danger' : 'text-zinc-700'} bg-transparent border-0 w-full text-left whitespace-nowrap hover:bg-black/[0.04]`

const STATUS_DOT: Record<'running' | 'done' | 'idle', string> = {
    running: 'bg-orange-500 animate-pulse',
    done: 'bg-emerald-500',
    idle: 'hidden',
}

const layout = useAppLayoutStore()

// With no Agents nav item, the project row is the way back to the agents overview.
function visit() {
    layout.setActiveAgentId(null)
    router.visit(`/${props.project.slug}`)
}

// The modals live inside the menu, so it stays open until the modal closes.
function onModalOpenChange(open: boolean) {
    modalOpen.value = open
    if (!open) menuOpen.value = false
}

const { handleProjectHidden } = useProjects()

function hide() {
    menuOpen.value = false
    handleProjectHidden(props.project).catch(() => {})
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

// A fixed menu would stay put while its row scrolls away, so it closes instead.
function onViewportChange(e: Event) {
    if (modalOpen.value || (e.target instanceof Node && menu.value?.contains(e.target))) return
    menuOpen.value = false
}

function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || modalOpen.value) return
    menuOpen.value = false
    trigger.value?.focus()
}

function stopListening() {
    document.removeEventListener('keydown', onKeydown)
    document.removeEventListener('mousedown', onClickOutside)
    document.removeEventListener('scroll', onViewportChange, true)
    window.removeEventListener('resize', onViewportChange)
}

watch(menuOpen, isOpen => {
    if (!isOpen) return stopListening()
    document.addEventListener('keydown', onKeydown)
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('scroll', onViewportChange, true)
    window.addEventListener('resize', onViewportChange)
})
onBeforeUnmount(stopListening)
</script>

<template>
    <div ref="root" class="relative flex" @mouseenter="hovered = true" @mouseleave="hovered = false">
        <div
            role="button"
            tabindex="0"
            data-testid="project-item"
            :aria-current="props.active ? 'page' : undefined"
            :title="props.project.path"
            class="flex-1 min-w-0 flex items-center gap-2 h-9 pl-1.5 pr-2.5 rounded-lg cursor-pointer text-left text-zinc-900 transition-colors duration-100 hover:bg-black/[0.03]"
            @click="visit"
            @keydown.enter="visit"
        >
            <slot name="toggle">
                <span class="w-5 shrink-0" />
            </slot>
            <span
                data-testid="project-tile"
                :class="['w-5 h-5 rounded-md shrink-0 flex items-center justify-center text-ui-11 font-bold', props.color.tile, props.color.tileText]"
                aria-hidden="true"
            >
                {{ props.project.name.charAt(0).toUpperCase() }}
            </span>
            <span
                data-testid="project-name"
                :class="['flex-1 min-w-0 truncate text-ui-13 leading-5', props.active ? 'font-semibold' : 'font-medium']"
                :title="props.project.name"
            >
                {{ props.project.name }}
            </span>
            <span
                data-testid="project-status"
                :data-status="props.status ?? 'idle'"
                :class="['w-1.5 h-1.5 rounded-full shrink-0', STATUS_DOT[props.status ?? 'idle']]"
            />
            <slot name="badge" />
        </div>

        <!-- Hidden rather than unmounted, so focus can return here after Escape. -->
        <button
            ref="trigger"
            type="button"
            aria-label="Project actions"
            :aria-expanded="menuOpen"
            :class="[
                'absolute right-1 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md cursor-pointer flex items-center justify-center text-zinc-600',
                props.color.tint,
                !(hovered || menuOpen) && 'opacity-0 focus-visible:opacity-100',
                menuOpen ? 'brightness-90' : 'hover:brightness-95',
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
            :style="{ top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }"
            :class="[
                'fixed z-[200]',
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
            <button type="button" :class="menuItemClass()" @click.stop="hide">
                <Icon name="eye-off" :size="13" class="shrink-0" />
                Hide project
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
