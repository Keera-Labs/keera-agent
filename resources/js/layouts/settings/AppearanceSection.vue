<script setup lang="ts">
import { storeToRefs } from 'pinia'
import Icon from '@/components/ui/Icon.vue'
import { useAppearanceSettingsStore } from '@/stores/appearanceSettingsStore'
import { DEFAULT_UI_FONT_SIZE, MAX_UI_FONT_SIZE, MIN_UI_FONT_SIZE } from '@/utils/uiFontSize'

const appearance = useAppearanceSettingsStore()
const { draft, isDefault } = storeToRefs(appearance)

const PRESETS = [
    { size: 11, label: 'Compact' },
    { size: DEFAULT_UI_FONT_SIZE, label: 'Default' },
    { size: 15, label: 'Comfort' },
    { size: MAX_UI_FONT_SIZE, label: 'Large' },
]

const previewRows = [
    { icon: 'folder', label: 'keera-agent', meta: '3 agents' },
    { icon: 'git-branch', label: 'task/appearance-ui-font-size', meta: 'dev' },
    { icon: 'terminal', label: 'Frontend Engineer', meta: 'running' },
] as const

const card = 'border border-stroke rounded-lg bg-white p-4 flex flex-col gap-3'
const badge = 'rounded px-1.5 py-px text-ui-10 font-medium bg-accent/10 text-accent'
const stepButton = 'w-7 h-7 flex items-center justify-center text-zinc-600 hover:bg-black/[0.04] cursor-pointer disabled:opacity-40 disabled:cursor-default'
</script>

<template>
    <div class="flex flex-col gap-4" data-testid="appearance-section">
        <div class="pb-3 border-b border-stroke">
            <h2 class="m-0 text-zinc-900 text-ui-16 font-semibold">Appearance</h2>
            <p class="mt-1 mb-0 text-zinc-500 text-ui-12">
                Adjust the text size of the sidebar, toolbars, panels, pages and dialogs.
            </p>
        </div>

        <section :class="card" aria-labelledby="ui-font-size-heading">
            <div class="flex items-start gap-4">
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                        <h3 id="ui-font-size-heading" class="m-0 text-zinc-900 text-ui-13 font-semibold">UI Font Size</h3>
                        <span :class="badge" data-testid="ui-font-size-badge">{{ draft }}px</span>
                    </div>
                    <p class="mt-1 mb-0 text-zinc-500 text-ui-12">
                        Changes preview across the app as you adjust them. The file editor and terminals keep their own size, set under Editor.
                    </p>
                </div>
                <div class="flex items-center border border-stroke rounded-md overflow-hidden shrink-0 bg-white">
                    <button
                        type="button"
                        aria-label="Decrease UI font size"
                        :class="stepButton"
                        :disabled="draft <= MIN_UI_FONT_SIZE"
                        @click="appearance.setSize(draft - 1)"
                    >−</button>
                    <input
                        data-testid="ui-font-size-input"
                        type="number"
                        aria-label="UI font size in pixels"
                        :min="MIN_UI_FONT_SIZE"
                        :max="MAX_UI_FONT_SIZE"
                        class="w-12 h-7 border-x border-stroke text-center text-ui-13 text-zinc-900 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                        :value="draft"
                        @change="appearance.setSize(Number(($event.target as HTMLInputElement).value))"
                    >
                    <button
                        type="button"
                        aria-label="Increase UI font size"
                        :class="stepButton"
                        :disabled="draft >= MAX_UI_FONT_SIZE"
                        @click="appearance.setSize(draft + 1)"
                    >+</button>
                </div>
            </div>

            <input
                data-testid="ui-font-size-slider"
                type="range"
                aria-label="UI font size"
                class="w-full accent-accent cursor-pointer"
                :min="MIN_UI_FONT_SIZE"
                :max="MAX_UI_FONT_SIZE"
                step="1"
                :value="draft"
                @input="appearance.setSize(Number(($event.target as HTMLInputElement).value))"
            >

            <div class="flex flex-wrap items-center gap-1.5">
                <div class="flex flex-wrap gap-1.5" role="group" aria-label="UI font size presets">
                    <button
                        v-for="preset in PRESETS"
                        :key="preset.size"
                        type="button"
                        :data-ui-preset="preset.size"
                        :aria-pressed="draft === preset.size"
                        :class="[
                            'rounded-md border px-2.5 py-1 text-ui-11 font-mono cursor-pointer transition-colors duration-100',
                            draft === preset.size
                                ? 'border-accent bg-accent/10 text-accent font-semibold'
                                : 'border-stroke text-zinc-500 hover:bg-black/[0.03]',
                        ]"
                        @click="appearance.setSize(preset.size)"
                    >
                        {{ preset.size }}px ({{ preset.label }})
                    </button>
                </div>
                <button
                    type="button"
                    data-testid="ui-font-size-reset"
                    class="ml-auto flex items-center gap-1.5 rounded-md border border-stroke px-2.5 py-1 text-ui-11 text-zinc-600 cursor-pointer hover:bg-black/[0.03] disabled:opacity-40 disabled:cursor-default"
                    :disabled="isDefault"
                    @click="appearance.reset()"
                >
                    <Icon name="rotate-cw" :size="12" />
                    Reset to default
                </button>
            </div>

            <div class="flex flex-col gap-1.5">
                <div class="flex items-center justify-between text-ui-10 uppercase tracking-[0.06em]">
                    <span class="text-zinc-500 font-semibold">Preview</span>
                    <span class="text-zinc-400 font-mono normal-case">{{ draft }}px</span>
                </div>
                <div data-testid="ui-font-size-preview" class="rounded-md border border-stroke bg-canvas p-1.5 flex flex-col gap-0.5">
                    <div
                        v-for="row in previewRows"
                        :key="row.label"
                        class="flex items-center gap-2 min-h-7 px-2 rounded-md text-zinc-700 even:bg-white"
                    >
                        <Icon :name="row.icon" :size="14" class="shrink-0 text-zinc-400" />
                        <span class="flex-1 min-w-0 truncate text-ui-13">{{ row.label }}</span>
                        <span class="shrink-0 text-ui-11 text-zinc-400">{{ row.meta }}</span>
                    </div>
                </div>
            </div>
        </section>
    </div>
</template>
