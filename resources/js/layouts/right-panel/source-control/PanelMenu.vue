<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

withDefaults(defineProps<{
    label: string
    menuClass?: string
    /** Opens across the nearest positioned ancestor instead of hanging off the trigger's right edge. */
    fullWidth?: boolean
}>(), { menuClass: 'min-w-44', fullWidth: false })
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
    <div ref="root" :class="['flex', !fullWidth && 'relative']">
        <slot name="trigger" :toggle="() => (open = !open)" :open="open" />
        <div
            v-if="open"
            role="menu"
            :aria-label="label"
            :class="['absolute top-full', fullWidth ? 'inset-x-2' : 'right-0', 'mt-1 z-20 py-1 rounded-md bg-surface border border-stroke shadow-lg', menuClass]"
        >
            <slot :close="close" />
        </div>
    </div>
</template>
