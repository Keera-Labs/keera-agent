<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import DefaultPermissionsTab from '@/pages/settings/DefaultPermissionsTab.vue'
import ProvidersTab from '@/pages/settings/ProvidersTab.vue'
import TemplatesTab from '@/pages/settings/TemplatesTab.vue'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { useEditorSettingsStore } from '@/stores/editorSettingsStore'
import EditorSection from './EditorSection.vue'
import GeneralSection from './GeneralSection.vue'
import { filterSections, SETTINGS_SECTIONS, type SettingsSectionId } from './sections'

type AiTab = 'providers' | 'templates' | 'permissions'

const AI_TABS: { id: AiTab; label: string }[] = [
    { id: 'providers', label: 'Providers' },
    { id: 'templates', label: 'Agent Templates' },
    { id: 'permissions', label: 'Default Permissions' },
]

const layout = useAppLayoutStore()
const { settingsSection } = storeToRefs(layout)
const editorSettings = useEditorSettingsStore()
const { dirty, saveState, error } = storeToRefs(editorSettings)

const query = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const aiTab = ref<AiTab>('providers')

const sections = computed(() => filterSections(query.value))
const current = computed(() => SETTINGS_SECTIONS.find(s => s.id === settingsSection.value) ?? SETTINGS_SECTIONS[0])
// Sections that embed a full-height tab manage their own padding and scrolling.
const embedsTab = computed(() => current.value.id === 'ai' || current.value.id === 'general')

const EMPTY_STATE: Partial<Record<SettingsSectionId, string>> = {
    git: 'Git and version control preferences will appear here.',
    workspaces: 'Workspace and sync preferences will appear here.',
    keybindings: 'Custom keybindings will appear here.',
    billing: 'Usage limits and billing will appear here.',
}

function select(id: SettingsSectionId) {
    settingsSection.value = id
}

function close() {
    // Unsaved edits are dropped, never applied on the way out.
    editorSettings.discard()
    layout.closeSettings()
}

function onSearchEnter() {
    const first = sections.value[0]
    if (first) select(first.id)
}

function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
        e.preventDefault()
        close()
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchInput.value?.focus()
    }
}

onMounted(() => window.addEventListener('keydown', onKeyDown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown))

const statusText = computed(() => {
    if (saveState.value === 'saving') return 'Saving…'
    if (saveState.value === 'error') return error.value || 'Could not save preferences'
    if (dirty.value) return 'Unsaved changes'
    return 'Saved to Keera settings'
})

const navItem = (active: boolean) => [
    'flex items-center gap-2.5 h-8 px-2.5 w-full rounded-md text-[13px] text-left cursor-pointer transition-colors duration-100',
    active ? 'bg-white text-accent font-medium shadow-[0_0_0_1px_var(--color-stroke)]' : 'text-zinc-600 hover:bg-black/[0.04] hover:text-zinc-900',
]
</script>

<template>
    <div
        class="fixed inset-0 bg-black/40 flex items-center justify-center z-[200] px-4"
        data-testid="settings-backdrop"
        @click.self="close"
    >
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            class="bg-white border border-stroke rounded-xl shadow-2xl w-full max-w-[960px] h-[min(680px,calc(100vh-32px))] flex flex-col overflow-hidden"
        >
            <header class="flex items-center gap-3 h-14 px-4 border-b border-stroke shrink-0">
                <h1 class="m-0 text-zinc-900 text-[15px] font-semibold">Settings</h1>
                <label class="flex items-center gap-2 h-8 w-[280px] max-w-full px-2.5 rounded-md border border-stroke bg-canvas text-zinc-400 focus-within:border-accent">
                    <Icon name="search" :size="13" />
                    <input
                        ref="searchInput"
                        v-model="query"
                        data-testid="settings-search"
                        type="search"
                        placeholder="Search settings (⌘K)"
                        aria-label="Search settings"
                        class="flex-1 min-w-0 bg-transparent border-0 outline-none text-[12px] text-zinc-900 placeholder:text-zinc-400"
                        @keydown.enter.prevent="onSearchEnter"
                    >
                </label>
                <span class="ml-auto rounded border border-stroke px-1.5 py-px text-[10px] text-zinc-400 font-mono">ESC</span>
                <button
                    type="button"
                    aria-label="Close settings"
                    class="w-7 h-7 flex items-center justify-center rounded-md text-zinc-500 hover:bg-black/[0.05] cursor-pointer"
                    @click="close"
                >
                    <Icon name="x" :size="15" />
                </button>
            </header>

            <div class="flex flex-1 min-h-0">
                <nav class="w-[220px] shrink-0 bg-canvas border-r border-stroke p-2 flex flex-col gap-0.5 overflow-y-auto" aria-label="Settings sections">
                    <button
                        v-for="section in sections"
                        :key="section.id"
                        type="button"
                        :data-section="section.id"
                        :aria-current="section.id === current.id ? 'page' : undefined"
                        :class="navItem(section.id === current.id)"
                        @click="select(section.id)"
                    >
                        <Icon :name="section.icon" :size="14" class="shrink-0" />
                        <span class="truncate">{{ section.label }}</span>
                    </button>
                    <p v-if="!sections.length" data-testid="settings-no-match" class="m-0 px-2.5 py-2 text-[12px] text-zinc-400">
                        No settings match “{{ query }}”.
                    </p>
                </nav>

                <div v-if="embedsTab" class="flex-1 min-w-0 flex flex-col overflow-hidden bg-surface" :data-pane="current.id">
                    <template v-if="current.id === 'ai'">
                        <div class="flex gap-1 px-6 pt-4 pb-3 border-b border-stroke shrink-0">
                            <button
                                v-for="tab in AI_TABS"
                                :key="tab.id"
                                type="button"
                                :data-ai-tab="tab.id"
                                :class="[
                                    'rounded text-[12px] py-1 px-3 cursor-pointer border',
                                    aiTab === tab.id ? 'bg-canvas border-stroke text-zinc-900' : 'bg-transparent border-transparent text-zinc-500',
                                ]"
                                @click="aiTab = tab.id"
                            >{{ tab.label }}</button>
                        </div>
                        <ProvidersTab v-if="aiTab === 'providers'" />
                        <TemplatesTab v-else-if="aiTab === 'templates'" />
                        <DefaultPermissionsTab v-else />
                    </template>
                    <GeneralSection v-else />
                </div>

                <div v-else class="flex-1 min-w-0 overflow-y-auto px-6 py-5" :data-pane="current.id">
                    <EditorSection v-if="current.id === 'editor'" />

                    <div v-else-if="current.id === 'terminal'" class="flex flex-col gap-3">
                        <h2 class="m-0 text-zinc-900 text-[16px] font-semibold">Terminal & Shell</h2>
                        <p class="m-0 text-zinc-500 text-[12px]">
                            Agent terminals use the font family and size chosen under Editor.
                        </p>
                        <button
                            type="button"
                            class="self-start rounded-md border border-stroke px-3 py-1.5 text-[12px] text-zinc-700 hover:bg-black/[0.03] cursor-pointer"
                            @click="select('editor')"
                        >Open Editor settings</button>
                    </div>

                    <div v-else data-testid="settings-empty" class="h-full flex flex-col items-center justify-center gap-2 text-center">
                        <Icon :name="current.icon" :size="22" class="text-zinc-300" />
                        <h2 class="m-0 text-zinc-900 text-[14px] font-semibold">{{ current.label }}</h2>
                        <p class="m-0 text-zinc-500 text-[12px] max-w-[320px]">
                            {{ EMPTY_STATE[current.id] ?? 'Nothing to configure here yet.' }}
                        </p>
                    </div>
                </div>
            </div>

            <footer class="flex items-center gap-3 h-14 px-4 border-t border-stroke shrink-0 bg-canvas">
                <span
                    data-testid="settings-status"
                    :class="['flex items-center gap-1.5 text-[12px] font-mono', saveState === 'error' ? 'text-danger' : 'text-zinc-500']"
                >
                    <Icon v-if="!dirty && saveState !== 'error'" name="check" :size="13" class="text-success" />
                    {{ statusText }}
                </span>
                <button
                    type="button"
                    data-testid="settings-discard"
                    class="ml-auto rounded-md border border-stroke bg-white px-3.5 py-1.5 text-[12px] text-zinc-700 cursor-pointer hover:bg-black/[0.03] disabled:opacity-50 disabled:cursor-default"
                    :disabled="!dirty || saveState === 'saving'"
                    @click="editorSettings.discard()"
                >Discard</button>
                <button
                    type="button"
                    data-testid="settings-save"
                    class="rounded-md border border-accent bg-accent px-3.5 py-1.5 text-[12px] font-medium text-white cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-default"
                    :disabled="!dirty || saveState === 'saving'"
                    @click="editorSettings.save()"
                >Save Preferences</button>
            </footer>
        </div>
    </div>
</template>
