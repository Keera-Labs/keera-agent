<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import {
    clampFontSize,
    FONT_OPTIONS,
    FONT_SIZE_PRESETS,
    fontLabel,
    fontStack,
    isFontAvailable,
    MAX_FONT_SIZE,
    MIN_FONT_SIZE,
    type FontFamilyId,
} from '@/editor/fonts'
import { useEditorSettingsStore } from '@/stores/editorSettingsStore'

const { draft } = storeToRefs(useEditorSettingsStore())

// Measured once per modal open; a font installed meanwhile shows up on reopen.
const fontOptions = FONT_OPTIONS.map(option => ({ ...option, available: isFontAvailable(option) }))

const previewStyle = computed(() => ({
    fontFamily: fontStack(draft.value.font_family),
    fontSize: `${draft.value.font_size}px`,
}))

function setFamily(id: string) {
    draft.value.font_family = id as FontFamilyId
}

function setSize(size: number) {
    draft.value.font_size = clampFontSize(size)
}

const card = 'border border-stroke rounded-lg bg-white p-4 flex flex-col gap-3'
const badge = 'rounded px-1.5 py-px text-[10px] font-medium bg-accent/10 text-accent'
const stepButton = 'w-7 h-7 flex items-center justify-center text-zinc-600 hover:bg-black/[0.04] cursor-pointer disabled:opacity-40 disabled:cursor-default'
</script>

<template>
    <div class="flex flex-col gap-4" data-testid="editor-section">
        <div class="pb-3 border-b border-stroke">
            <h2 class="m-0 text-zinc-900 text-[16px] font-semibold">Editor Configuration</h2>
            <p class="mt-1 mb-0 text-zinc-500 text-[12px]">
                Configure code typography and font sizing for the file editor and terminals.
            </p>
        </div>

        <section :class="card" aria-labelledby="font-family-heading">
            <div class="flex items-start gap-4">
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                        <h3 id="font-family-heading" class="m-0 text-zinc-900 text-[13px] font-semibold">Font Family</h3>
                        <span :class="badge">Monospace</span>
                    </div>
                    <p class="mt-1 mb-0 text-zinc-500 text-[12px]">
                        Primary font for syntax highlighting and terminal buffers.
                    </p>
                </div>
                <select
                    data-testid="font-family"
                    aria-labelledby="font-family-heading"
                    class="w-[200px] shrink-0 bg-white border border-stroke rounded-md text-zinc-900 text-[13px] px-2.5 py-1.5 outline-none cursor-pointer focus:border-accent"
                    :style="{ fontFamily: fontStack(draft.font_family) }"
                    :value="draft.font_family"
                    @change="setFamily(($event.target as HTMLSelectElement).value)"
                >
                    <option
                        v-for="option in fontOptions"
                        :key="option.id"
                        :value="option.id"
                        :disabled="!option.available && option.id !== draft.font_family"
                    >
                        {{ option.label }}{{ option.available ? '' : ' (not installed)' }}
                    </option>
                </select>
            </div>

            <div class="flex flex-col gap-1.5">
                <div class="flex items-center justify-between text-[10px] uppercase tracking-[0.06em]">
                    <span class="text-zinc-500 font-semibold">Typography preview</span>
                    <span class="text-zinc-400 font-mono normal-case">{{ fontLabel(draft.font_family) }} · {{ draft.font_size }}px</span>
                </div>
                <pre
                    data-testid="font-preview"
                    class="m-0 rounded-md border border-stroke bg-canvas px-4 py-3 overflow-x-auto leading-[1.6] text-zinc-800"
                    :style="previewStyle"
                ><span class="text-zinc-400 italic">// Live typography sample with syntax coloring</span>
<span class="text-[#cf222e]">const</span> <span class="text-[#8250df]">calculateVat</span> = (<span class="text-[#953800]">cart</span>: <span class="text-[#0550ae]">CartState</span>): <span class="text-[#0550ae]">number</span> =&gt; {
  <span class="text-[#cf222e]">const</span> <span class="text-[#953800]">rate</span> = cart.region === <span class="text-[#0a3069]">'EU'</span> ? <span class="text-[#0550ae]">0.20</span> : <span class="text-[#0550ae]">0.00</span>;
  <span class="text-[#cf222e]">return</span> Math.<span class="text-[#8250df]">round</span>(cart.subtotal * rate * <span class="text-[#0550ae]">100</span>) / <span class="text-[#0550ae]">100</span>;
};</pre>
            </div>
        </section>

        <section :class="card" aria-labelledby="font-size-heading">
            <div class="flex items-start gap-4">
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                        <h3 id="font-size-heading" class="m-0 text-zinc-900 text-[13px] font-semibold">Font Size</h3>
                        <span :class="badge" data-testid="font-size-badge">{{ draft.font_size }}px</span>
                    </div>
                    <p class="mt-1 mb-0 text-zinc-500 text-[12px]">
                        Applies to the file editor and to agent terminals.
                    </p>
                </div>
                <div class="flex items-center border border-stroke rounded-md overflow-hidden shrink-0 bg-white">
                    <button
                        type="button"
                        aria-label="Decrease font size"
                        :class="stepButton"
                        :disabled="draft.font_size <= MIN_FONT_SIZE"
                        @click="setSize(draft.font_size - 1)"
                    >−</button>
                    <input
                        data-testid="font-size-input"
                        type="number"
                        aria-label="Font size in pixels"
                        :min="MIN_FONT_SIZE"
                        :max="MAX_FONT_SIZE"
                        class="w-12 h-7 border-x border-stroke text-center text-[13px] text-zinc-900 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                        :value="draft.font_size"
                        @change="setSize(Number(($event.target as HTMLInputElement).value))"
                    >
                    <button
                        type="button"
                        aria-label="Increase font size"
                        :class="stepButton"
                        :disabled="draft.font_size >= MAX_FONT_SIZE"
                        @click="setSize(draft.font_size + 1)"
                    >+</button>
                </div>
            </div>

            <input
                data-testid="font-size-slider"
                type="range"
                aria-label="Font size"
                class="w-full accent-accent cursor-pointer"
                :min="MIN_FONT_SIZE"
                :max="MAX_FONT_SIZE"
                step="1"
                :value="draft.font_size"
                @input="setSize(Number(($event.target as HTMLInputElement).value))"
            >

            <div class="flex flex-wrap gap-1.5" role="group" aria-label="Font size presets">
                <button
                    v-for="preset in FONT_SIZE_PRESETS"
                    :key="preset.size"
                    type="button"
                    :data-preset="preset.size"
                    :aria-pressed="draft.font_size === preset.size"
                    :class="[
                        'rounded-md border px-2.5 py-1 text-[11px] font-mono cursor-pointer transition-colors duration-100',
                        draft.font_size === preset.size
                            ? 'border-accent bg-accent/10 text-accent font-semibold'
                            : 'border-stroke text-zinc-500 hover:bg-black/[0.03]',
                    ]"
                    @click="setSize(preset.size)"
                >
                    {{ preset.size }}px ({{ preset.label }})
                </button>
            </div>
        </section>
    </div>
</template>
