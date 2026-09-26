<script setup lang="ts">
import '@xterm/xterm/css/xterm.css'
import { storeToRefs } from 'pinia'
import { defineAsyncComponent, ref, watch } from 'vue'
import AppHeader from '@/layouts/app/AppHeader.vue'
import StatusBar from '@/layouts/app/StatusBar.vue'
import ModalLayer from '@/layouts/ModalLayer.vue'
import FileExplorer from '@/layouts/right-panel/FileExplorer.vue'
import Sidebar from '@/layouts/sidebar/Sidebar.vue'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

const layout = useAppLayoutStore()
const { sidebarOpen, rightPanelOpen, statusBarOpen } = storeToRefs(layout)
const { activeProject } = storeToRefs(useProjectStore())
const { activeTab: activeEditorTab } = storeToRefs(useEditorStore())

// Loaded with the first opened file (Monaco is its own large chunk), then kept
// mounted so switching back to a file does not rebuild the editor.
const EditorPane = defineAsyncComponent(() => import('@/layouts/editor/EditorPane.vue'))
const editorMounted = ref(false)
watch(activeEditorTab, tab => { if (tab) editorMounted.value = true })

// Receives template refs as Element | ComponentPublicInstance; the holder is always a plain div.
function setHolder(el: unknown) {
    layout.setTerminalHolder(el as HTMLElement | null)
}
</script>

<!--
    Persistent Inertia layout: it never unmounts across navigations, so the
    terminal sessions owned by the app layout store survive page changes.
    Regions: header, left sidebar, center main (page content, or the file
    editor above it while a file tab is active), a collapsible
    right panel (the active project's file explorer) and a bottom status bar.
-->
<template>
    <div class="flex flex-col w-full h-screen overflow-hidden bg-canvas">
        <AppHeader />

        <div class="flex flex-1 overflow-hidden">
            <Sidebar v-show="sidebarOpen" id="app-sidebar" />

            <main class="relative flex-1 flex overflow-hidden bg-white">
                <slot />
                <!-- Overlays the page instead of hiding it, so terminals below keep their size. -->
                <EditorPane v-if="editorMounted" v-show="activeEditorTab" />
            </main>

            <aside
                v-show="rightPanelOpen"
                id="app-right-panel"
                class="w-[272px] shrink-0 bg-canvas border-l border-stroke flex flex-col overflow-hidden"
            >
                <!-- Mounted on first open, then kept alive per project so each tree keeps its expanded folders. -->
                <KeepAlive :max="8">
                    <FileExplorer v-if="rightPanelOpen && activeProject" :key="activeProject.id" :project="activeProject" />
                </KeepAlive>
            </aside>
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
