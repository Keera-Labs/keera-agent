<script setup lang="ts">
// Lucide icon geometry, inlined so the Vue port needs no extra icon package
// (and no lockfile churn) while rendering pixel-identical to lucide-react.
type IconNode = ['path', { d: string }] | ['circle', { cx: string; cy: string; r: string }]

const ICONS = {
    'arrow-right': [['path', { d: 'M5 12h14' }], ['path', { d: 'm12 5 7 7-7 7' }]],
    check: [['path', { d: 'M20 6 9 17l-5-5' }]],
    'chevrons-up-down': [['path', { d: 'm7 15 5 5 5-5' }], ['path', { d: 'm7 9 5-5 5 5' }]],
    'ellipsis-vertical': [
        ['circle', { cx: '12', cy: '12', r: '1' }],
        ['circle', { cx: '12', cy: '5', r: '1' }],
        ['circle', { cx: '12', cy: '19', r: '1' }],
    ],
    folder: [['path', { d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z' }]],
    info: [['circle', { cx: '12', cy: '12', r: '10' }], ['path', { d: 'M12 16v-4' }], ['path', { d: 'M12 8h.01' }]],
    plus: [['path', { d: 'M5 12h14' }], ['path', { d: 'M12 5v14' }]],
    settings: [
        ['path', { d: 'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915' }],
        ['circle', { cx: '12', cy: '12', r: '3' }],
    ],
    'square-check-big': [
        ['path', { d: 'M21 10.656V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12.344' }],
        ['path', { d: 'm9 11 3 3L22 4' }],
    ],
    terminal: [['path', { d: 'M12 19h8' }], ['path', { d: 'm4 17 6-6-6-6' }]],
    'trash-2': [
        ['path', { d: 'M10 11v6' }],
        ['path', { d: 'M14 11v6' }],
        ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }],
        ['path', { d: 'M3 6h18' }],
        ['path', { d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }],
    ],
} satisfies Record<string, IconNode[]>

export type IconName = keyof typeof ICONS

const props = withDefaults(defineProps<{ name: IconName; size?: number; color?: string }>(), {
    size: 24,
    color: 'currentColor',
})
</script>

<template>
    <svg
        xmlns="http://www.w3.org/2000/svg"
        :width="props.size"
        :height="props.size"
        viewBox="0 0 24 24"
        fill="none"
        :stroke="props.color"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
    >
        <component :is="tag" v-for="([tag, attrs], i) in ICONS[props.name]" :key="i" v-bind="attrs" />
    </svg>
</template>
