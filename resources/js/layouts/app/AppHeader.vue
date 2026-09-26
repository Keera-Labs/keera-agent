<script setup lang="ts">
import { storeToRefs } from 'pinia'
import Icon from '@/components/ui/Icon.vue'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import SessionTabs from './SessionTabs.vue'

const layout = useAppLayoutStore()
const { sidebarOpen, rightPanelOpen, showProjectSearch } = storeToRefs(layout)

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const commandShortcut = isMac ? '⌘P' : 'Ctrl+P'

const reopenButtonClass = 'shrink-0 self-center w-[26px] h-[26px] flex items-center justify-center rounded-md text-zinc-500 cursor-pointer transition-colors hover:bg-black/[0.05] hover:text-zinc-800'
</script>

<template>
    <header class="shrink-0 bg-canvas flex items-stretch h-10 border-b border-stroke z-20">
        <!-- Each panel hides itself from its own toolbar, so the header only offers the way back. -->
        <button
            v-if="!sidebarOpen"
            type="button"
            data-testid="show-panel-left"
            aria-label="Show sidebar"
            title="Show sidebar"
            :class="[reopenButtonClass, 'ml-2']"
            @click="sidebarOpen = true"
        >
            <Icon name="panel-left" :size="15" />
        </button>

        <SessionTabs />

        <div class="shrink-0 flex items-center gap-1 pl-2 pr-2.5">
            <button
                type="button"
                data-testid="command-button"
                :aria-pressed="showProjectSearch"
                :title="`Command (${commandShortcut})`"
                class="h-6 flex items-center gap-1.5 px-2 rounded-md border border-stroke bg-white text-[12px] text-zinc-600 cursor-pointer transition-colors hover:text-zinc-900 hover:border-zinc-300"
                @click="showProjectSearch = !showProjectSearch"
            >
                <Icon name="command" :size="11" />
                <span class="max-sm:hidden">Command</span>
            </button>

            <button
                v-if="!rightPanelOpen"
                type="button"
                data-testid="show-panel-right"
                aria-label="Show right panel"
                title="Show right panel"
                :class="reopenButtonClass"
                @click="rightPanelOpen = true"
            >
                <Icon name="panel-right" :size="15" />
            </button>
        </div>
    </header>
</template>
