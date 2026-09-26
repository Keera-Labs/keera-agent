<script setup lang="ts">
import '@xterm/xterm/css/xterm.css'
import { storeToRefs } from 'pinia'
import AppHeader from '@/layouts/app/AppHeader.vue'
import StatusBar from '@/layouts/app/StatusBar.vue'
import ModalLayer from '@/layouts/ModalLayer.vue'
import Sidebar from '@/layouts/sidebar/Sidebar.vue'
import { useAppLayoutStore } from '@/stores/appLayoutStore'

const layout = useAppLayoutStore()
const { sidebarOpen, rightPanelOpen, statusBarOpen } = storeToRefs(layout)

// Receives template refs as Element | ComponentPublicInstance; the holder is always a plain div.
function setHolder(el: unknown) {
    layout.setTerminalHolder(el as HTMLElement | null)
}
</script>

<!--
    Persistent Inertia layout: it never unmounts across navigations, so the
    terminal sessions owned by the app layout store survive page changes.
    Regions: header, left sidebar, center main (page content), a collapsible
    right panel and a bottom status bar. The right panel is an empty mount
    point (teleport target) until content is ported into it.
-->
<template>
    <div class="flex flex-col w-full h-screen overflow-hidden bg-canvas">
        <AppHeader />

        <div class="flex flex-1 overflow-hidden">
            <Sidebar v-show="sidebarOpen" id="app-sidebar" />

            <main class="flex-1 flex overflow-hidden bg-white">
                <slot />
            </main>

            <aside
                v-show="rightPanelOpen"
                id="app-right-panel"
                class="w-[272px] shrink-0 bg-canvas border-l border-stroke flex flex-col overflow-hidden"
            />
        </div>

        <footer v-show="statusBarOpen" id="app-status-bar" class="shrink-0">
            <StatusBar />
        </footer>

        <ModalLayer />

        <!-- Off-screen parking spot for live xterm instances not shown in any slot. -->
        <div
            :ref="setHolder"
            aria-hidden="true"
            class="absolute left-[-99999px] top-0 w-[900px] h-[600px] overflow-hidden pointer-events-none"
        />
    </div>
</template>
