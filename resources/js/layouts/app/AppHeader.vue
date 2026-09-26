<script setup lang="ts">
import { router } from '@inertiajs/vue3'
import { storeToRefs } from 'pinia'
import Icon, { type IconName } from '@/components/ui/Icon.vue'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import SessionTabs from './SessionTabs.vue'

const layout = useAppLayoutStore()
const { sidebarOpen, statusBarOpen, rightPanelOpen, showProjectSearch } = storeToRefs(layout)

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const commandShortcut = isMac ? '⌘P' : 'Ctrl+P'

const PANEL_TOGGLES: { label: string; icon: IconName; open: typeof sidebarOpen }[] = [
    { label: 'Toggle sidebar', icon: 'panel-left', open: sidebarOpen },
    { label: 'Toggle status bar', icon: 'panel-bottom', open: statusBarOpen },
    { label: 'Toggle right panel', icon: 'panel-right', open: rightPanelOpen },
]
</script>

<template>
    <header class="shrink-0 bg-canvas flex items-stretch h-10 border-b border-stroke z-20">
        <!-- Logo zone: same width as the sidebar; doubles as the Dashboard (home) link -->
        <button
            type="button"
            aria-label="Go to Dashboard"
            title="Dashboard"
            :class="[
                'shrink-0 flex items-center gap-2 px-3.5 text-left cursor-pointer transition-colors hover:bg-black/[0.03]',
                sidebarOpen ? 'w-[220px] border-r border-stroke' : '',
            ]"
            @click="router.visit('/')"
        >
            <div class="w-6 h-6 rounded-md flex items-center justify-center shrink-0 bg-accent">
                <Icon name="info" :size="13" color="white" />
            </div>
            <span class="font-semibold text-[13px] text-zinc-900 tracking-[-0.01em] whitespace-nowrap">Keera Agent</span>
        </button>

        <SessionTabs />

        <div class="shrink-0 flex items-center gap-1 pl-2 pr-2.5">
            <button
                type="button"
                data-testid="command-button"
                :aria-pressed="showProjectSearch"
                :title="`Command (${commandShortcut})`"
                class="h-6 flex items-center gap-1.5 px-2 mr-1.5 rounded-md border border-stroke bg-white text-[12px] text-zinc-600 cursor-pointer transition-colors hover:text-zinc-900 hover:border-zinc-300"
                @click="showProjectSearch = !showProjectSearch"
            >
                <Icon name="command" :size="11" />
                <span class="max-sm:hidden">Command</span>
            </button>

            <button
                v-for="toggle in PANEL_TOGGLES"
                :key="toggle.icon"
                type="button"
                :data-testid="`toggle-${toggle.icon}`"
                :aria-label="toggle.label"
                :aria-pressed="toggle.open.value"
                :title="toggle.label"
                :class="[
                    'w-[26px] h-[26px] flex items-center justify-center rounded-md cursor-pointer transition-colors hover:bg-black/[0.05]',
                    toggle.open.value ? 'text-zinc-700' : 'text-zinc-400',
                ]"
                @click="toggle.open.value = !toggle.open.value"
            >
                <Icon :name="toggle.icon" :size="15" />
            </button>
        </div>
    </header>
</template>
