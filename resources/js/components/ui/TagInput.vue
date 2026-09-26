<script setup lang="ts">
import { ref, useTemplateRef } from 'vue'

const tags = defineModel<string[]>({ required: true })

const props = defineProps<{
    placeholder?: string
    disabled?: boolean
    tagColor: string
    // Off by default: permission rules such as `Bash(echo a, b)` contain commas.
    splitOnComma?: boolean
}>()

const input = ref('')
const inputEl = useTemplateRef<HTMLInputElement>('inputEl')

function addTag(raw: string) {
    const value = raw.trim()
    if (value && !tags.value.includes(value)) {
        tags.value = [...tags.value, value]
    }
    input.value = ''
}

function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || (props.splitOnComma && e.key === ',')) {
        e.preventDefault()
        addTag(input.value)
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && input.value === '' && tags.value.length > 0) {
        tags.value = tags.value.slice(0, -1)
    }
}

function removeTag(idx: number) {
    tags.value = tags.value.filter((_, i) => i !== idx)
}

function onBlur() {
    if (input.value.trim()) addTag(input.value)
}
</script>

<template>
    <div
        :class="[
            'flex flex-wrap gap-[5px] items-center bg-canvas border border-stroke rounded py-1.5 px-2 min-h-[38px] cursor-text',
            disabled ? 'opacity-50' : 'opacity-100',
        ]"
        @click="inputEl?.focus()"
    >
        <span
            v-for="(tag, i) in tags"
            :key="tag"
            class="inline-flex items-center gap-1 border rounded-sm py-0.5 px-1.5 font-mono text-[11px] leading-[1.4]"
            :style="{ background: `${tagColor}22`, borderColor: `${tagColor}55`, color: tagColor }"
        >
            {{ tag }}
            <button
                v-if="!disabled"
                type="button"
                :aria-label="`Remove ${tag}`"
                class="bg-transparent border-0 cursor-pointer p-0 leading-none text-[12px] flex items-center opacity-70"
                :style="{ color: tagColor }"
                @click.stop="removeTag(i)"
            >×</button>
        </span>
        <input
            v-if="!disabled"
            ref="inputEl"
            v-model="input"
            :placeholder="tags.length === 0 ? placeholder : ''"
            class="bg-transparent border-0 outline-none py-0.5 px-0 font-mono text-[11px] text-zinc-900 min-w-[120px] flex-1"
            @keydown="onKeydown"
            @blur="onBlur"
        >
        <span v-if="disabled && tags.length === 0" class="text-zinc-400 text-[11px] font-mono">
            Loading…
        </span>
    </div>
</template>
