<script setup lang="ts">
// Lucide icon geometry, inlined so the Vue port needs no extra icon package
// (and no lockfile churn) while rendering pixel-identical to lucide-react.
type IconNode =
    | ['path', { d: string }]
    | ['circle', { cx: string; cy: string; r: string }]
    | ['rect', { width: string; height: string; x: string; y: string; rx: string; ry?: string }]

const ICONS = {
    'arrow-left': [['path', { d: 'm12 19-7-7 7-7' }], ['path', { d: 'M19 12H5' }]],
    'arrow-right': [['path', { d: 'M5 12h14' }], ['path', { d: 'm12 5 7 7-7 7' }]],
    check: [['path', { d: 'M20 6 9 17l-5-5' }]],
    'chevrons-up-down': [['path', { d: 'm7 15 5 5 5-5' }], ['path', { d: 'm7 9 5-5 5 5' }]],
    'chevron-right': [['path', { d: 'm9 18 6-6-6-6' }]],
    'circle-dot': [['circle', { cx: '12', cy: '12', r: '10' }], ['circle', { cx: '12', cy: '12', r: '1' }]],
    'ellipsis-vertical': [
        ['circle', { cx: '12', cy: '12', r: '1' }],
        ['circle', { cx: '12', cy: '5', r: '1' }],
        ['circle', { cx: '12', cy: '19', r: '1' }],
    ],
    ellipsis: [
        ['circle', { cx: '12', cy: '12', r: '1' }],
        ['circle', { cx: '19', cy: '12', r: '1' }],
        ['circle', { cx: '5', cy: '12', r: '1' }],
    ],
    'file-text': [
        ['path', { d: 'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z' }],
        ['path', { d: 'M14 2v5a1 1 0 0 0 1 1h5' }],
        ['path', { d: 'M10 9H8' }],
        ['path', { d: 'M16 13H8' }],
        ['path', { d: 'M16 17H8' }],
    ],
    folder: [['path', { d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z' }]],
    'git-merge': [
        ['circle', { cx: '18', cy: '18', r: '3' }],
        ['circle', { cx: '6', cy: '6', r: '3' }],
        ['path', { d: 'M6 21V9a9 9 0 0 0 9 9' }],
    ],
    funnel: [['path', { d: 'M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z' }]],
    image: [
        ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2', ry: '2' }],
        ['circle', { cx: '9', cy: '9', r: '2' }],
        ['path', { d: 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21' }],
    ],
    info: [['circle', { cx: '12', cy: '12', r: '10' }], ['path', { d: 'M12 16v-4' }], ['path', { d: 'M12 8h.01' }]],
    play: [['path', { d: 'M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z' }]],
    plus: [['path', { d: 'M5 12h14' }], ['path', { d: 'M12 5v14' }]],
    'refresh-cw': [
        ['path', { d: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8' }],
        ['path', { d: 'M21 3v5h-5' }],
        ['path', { d: 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16' }],
        ['path', { d: 'M8 16H3v5' }],
    ],
    'rotate-cw': [['path', { d: 'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8' }], ['path', { d: 'M21 3v5h-5' }]],
    search: [['path', { d: 'm21 21-4.34-4.34' }], ['circle', { cx: '11', cy: '11', r: '8' }]],
    settings: [
        ['path', { d: 'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915' }],
        ['circle', { cx: '12', cy: '12', r: '3' }],
    ],
    square: [['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2' }]],
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
    x: [['path', { d: 'M18 6 6 18' }], ['path', { d: 'm6 6 12 12' }]],
} satisfies Record<string, IconNode[]>

export type IconName = keyof typeof ICONS

const props = withDefaults(defineProps<{ name: IconName; size?: number; color?: string; fill?: string }>(), {
    size: 24,
    color: 'currentColor',
    fill: 'none',
})
</script>

<template>
    <svg
        xmlns="http://www.w3.org/2000/svg"
        :width="props.size"
        :height="props.size"
        viewBox="0 0 24 24"
        :fill="props.fill"
        :stroke="props.color"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
    >
        <component :is="tag" v-for="([tag, attrs], i) in ICONS[props.name]" :key="i" v-bind="attrs" />
    </svg>
</template>
