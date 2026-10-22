<script setup lang="ts">
import { computed } from 'vue'
import { AGENT_TYPE_COLORS } from '@/types/agent'
import { agentColor } from '@/utils/agentColor'

const props = defineProps<{ name: string; agentType?: string; size: 'sm' | 'lg' }>()

const background = computed(() => (props.agentType && AGENT_TYPE_COLORS[props.agentType]) || agentColor(props.name))
</script>

<template>
    <span
        aria-hidden="true"
        :class="[
            'shrink-0 flex items-center justify-center rounded-md text-white font-bold',
            size === 'lg' ? 'w-9 h-9 text-ui-15' : 'w-5 h-5 text-ui-11',
        ]"
        :style="{ background }"
    >
        {{ name.charAt(0).toUpperCase() }}
    </span>
</template>
