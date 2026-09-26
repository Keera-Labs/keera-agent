<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

withDefaults(defineProps<{ label: string; menuClass?: string; align?: 'left' | 'right' }>(), { menuClass: 'min-w-44', align: 'right' })
const open = defineModel<boolean>('open', { default: false })

const root = ref<HTMLElement | null>(null)
const close = () => { open.value = false }

function onPointerDown(event: MouseEvent) {
    if (!root.value?.contains(event.target as Node)) close()
}

function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') close()
}

function listen(active: boolean) {
    if (active) {
        document.addEventListener('mousedown', onPointerDown)
        document.addEventListener('keydown', onKeydown)
    } else {
        document.removeEventListener('mousedown', onPointerDown)
        document.removeEventListener('keydown', onKeydown)
    }
}

watch(open, listen)
onBeforeUnmount(() => listen(false))
</script>

<template>
    <div ref="root" class="relative flex">
        <slot name="trigger" :toggle="() => (open = !open)" :open="open" />
        <div
            v-if="open"
            role="menu"
            :aria-label="label"
            :class="['absolute top-full', align === 'left' ? 'left-0' : 'right-0', 'mt-1 z-20 py-1 rounded-md bg-surface border border-stroke shadow-lg', menuClass]"
        >
            <slot :close="close" />
        </div>
    </div>
</template>
