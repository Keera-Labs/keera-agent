<script setup lang="ts">
import type { AgentQuestion } from '@/queries/agentQuestionsQuery'

const props = defineProps<{
    question: AgentQuestion
    selected: string[]
    layout: 'row' | 'column'
}>()
defineEmits<{ toggle: [label: string] }>()

const isSelected = (label: string) => props.selected.includes(label)
</script>

<template>
    <div
        v-if="question.options.length"
        :role="question.multi_select ? 'group' : 'radiogroup'"
        :aria-label="question.question"
        :class="layout === 'row' ? 'grid grid-cols-1 @lg:grid-cols-2 gap-2' : 'flex flex-col gap-2'"
    >
        <button
            v-for="option in question.options"
            :key="option.label"
            type="button"
            data-testid="question-option"
            :role="question.multi_select ? 'checkbox' : 'radio'"
            :aria-checked="isSelected(option.label)"
            :data-recommended="option.recommended"
            :class="[
                'flex items-start gap-3 w-full min-w-0 text-left rounded-lg border bg-white cursor-pointer transition-colors duration-100',
                layout === 'row' ? 'px-3 py-2' : 'px-4 py-3',
                isSelected(option.label)
                    ? 'border-zinc-900 shadow-[0_0_0_1px_var(--color-zinc-900)]'
                    : 'border-stroke hover:border-zinc-400',
            ]"
            @click="$emit('toggle', option.label)"
        >
            <span
                :class="[
                    'mt-0.5 w-4 h-4 shrink-0 flex items-center justify-center border',
                    question.multi_select ? 'rounded' : 'rounded-full',
                    isSelected(option.label) ? 'border-zinc-900' : 'border-zinc-400',
                ]"
            >
                <span
                    v-if="isSelected(option.label)"
                    :class="['w-2 h-2 bg-zinc-900', question.multi_select ? 'rounded-sm' : 'rounded-full']"
                />
            </span>
            <span class="flex flex-col min-w-0 gap-0.5">
                <span class="flex items-center gap-2 min-w-0">
                    <span class="text-zinc-900 text-ui-13 font-semibold truncate">{{ option.label }}</span>
                    <span
                        v-if="option.recommended && layout === 'column'"
                        data-testid="agent-pick"
                        class="shrink-0 px-1.5 rounded bg-emerald-50 text-emerald-700 text-ui-10 font-bold tracking-[0.06em] uppercase"
                    >
                        Agent's pick
                    </span>
                </span>
                <span v-if="layout === 'row' && (option.recommended || option.description)" class="text-zinc-500 text-ui-12 truncate">
                    <template v-if="option.recommended">
                        <span data-testid="agent-pick">Agent's pick</span>{{ option.description ? ' · ' : '' }}
                    </template>{{ option.description }}
                </span>
                <span v-else-if="option.description" class="text-zinc-500 text-ui-12">{{ option.description }}</span>
            </span>
        </button>
    </div>
</template>
