<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

/**
 * Trigger-based modal. Renders the `trigger` slot inline; clicking it (or
 * pressing Enter/Space while focused) opens an overlay + centered panel. The
 * modal owns its own open state. The default slot receives `close` so the body
 * can dismiss the modal itself (e.g. after a successful submit). Closes on
 * Escape and backdrop click.
 */
const props = withDefaults(defineProps<{
    panelClass?: string
    ariaLabel?: string
}>(), {
    panelClass: 'bg-modal border border-stroke rounded-lg p-6 w-[340px] flex flex-col gap-3.5',
})

const emit = defineEmits<{ openChange: [open: boolean] }>()

defineSlots<{
    trigger(): unknown
    default(props: { close: () => void }): unknown
}>()

const open = ref(false)

function setOpen(next: boolean) {
    open.value = next
    emit('openChange', next)
}

const openModal = () => setOpen(true)
const close = () => setOpen(false)

function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') close()
}

watch(open, isOpen => {
    if (isOpen) window.addEventListener('keydown', onKey)
    else window.removeEventListener('keydown', onKey)
})

onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
    <div
        role="button"
        tabindex="0"
        :aria-label="props.ariaLabel"
        @click="openModal"
        @keydown.enter.prevent="openModal"
        @keydown.space.prevent="openModal"
    >
        <slot name="trigger" />
    </div>
    <Teleport to="body">
        <div
            v-if="open"
            class="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]"
            data-testid="modal-backdrop"
            @click.self="close"
        >
            <div :class="props.panelClass" role="dialog" aria-modal="true">
                <slot :close="close" />
            </div>
        </div>
    </Teleport>
</template>
