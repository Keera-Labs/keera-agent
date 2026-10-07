<script setup lang="ts">
import type { ResizablePanel } from '@/composables/useResizablePanel'

defineProps<{
    panel: ResizablePanel
    label: string
}>()
</script>

<!--
    Zero-width flex item placed between a side panel and the main area, so the
    handle straddles the shared border without being clipped by either side.
-->
<template>
    <div class="relative w-0 shrink-0">
        <div
            role="separator"
            aria-orientation="vertical"
            tabindex="0"
            :aria-label="label"
            :aria-valuenow="panel.width.value"
            title="Drag to resize, double-click to reset"
            data-testid="resize-handle"
            :data-dragging="panel.isDragging.value || undefined"
            class="group absolute inset-y-0 -left-[3px] w-1.5 z-30 flex justify-center cursor-col-resize outline-none touch-none"
            @pointerdown="panel.startResize"
            @dblclick="panel.reset"
            @keydown="panel.onKeydown"
        >
            <span
                class="w-0.5 h-full transition-colors duration-100 group-hover:bg-accent/40 group-focus-visible:bg-accent/60 group-data-[dragging]:bg-accent"
            />
        </div>
    </div>
</template>
