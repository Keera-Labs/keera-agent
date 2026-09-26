<script setup lang="ts">
import { computed } from 'vue'
import Modal from '@/components/ui/Modal.vue'
import PriorityBadge from '@/components/ui/PriorityBadge.vue'
import { labelClass } from '@/components/ui/styles'
import { color } from '@/tokens'
import { STATUS_COLORS, STATUS_LABELS } from '@/types/task'
import type { Task } from '@/types/type'

const props = defineProps<{ task: Task }>()

defineSlots<{ trigger(): unknown }>()

const statusColor = computed(() => STATUS_COLORS[props.task.status])

const planningSections = computed(() => [
    { label: 'Acceptance Criteria', items: props.task.acceptance_criteria, icon: '✓', color: color.success, iconClass: 'text-success' },
    { label: 'Testing Methods', items: props.task.testing_methods, icon: '⬡', color: color.accent, iconClass: 'text-accent' },
    { label: 'Validation Steps', items: props.task.validation_steps, icon: '◎', color: color.warning, iconClass: 'text-warning' },
].filter(section => section.items.length > 0))
</script>

<template>
    <Modal
        :aria-label="`Open task ${task.title}`"
        panel-class="bg-modal border border-stroke rounded-md w-[540px] max-h-[80vh] flex flex-col overflow-hidden"
    >
        <template #trigger>
            <slot name="trigger" />
        </template>

        <template #default="{ close }">
            <div class="py-4 px-5 border-b border-stroke flex items-start gap-2.5 shrink-0">
                <div class="flex-1 min-w-0">
                    <div class="text-[15px] font-semibold text-zinc-900 leading-[1.4] break-words">
                        {{ task.title }}
                    </div>
                    <div class="mt-1.5 flex items-center gap-2 flex-wrap">
                        <span
                            class="text-[10px] font-semibold py-0.5 px-2 rounded-lg uppercase tracking-[0.05em]"
                            :style="{ background: `${statusColor}20`, border: `1px solid ${statusColor}40`, color: statusColor }"
                        >
                            {{ STATUS_LABELS[task.status] }}
                        </span>
                        <PriorityBadge :priority="task.priority" />
                    </div>
                </div>
                <button
                    type="button"
                    aria-label="Close"
                    class="shrink-0 bg-transparent border-none text-zinc-400 cursor-pointer p-0.5 text-[20px] leading-none hover:text-zinc-900"
                    @click="close"
                >
                    ×
                </button>
            </div>

            <div class="flex-1 overflow-y-auto py-4 px-5 flex flex-col gap-4">
                <div v-if="task.body">
                    <div :class="[labelClass, 'mb-1.5']">Description</div>
                    <div class="text-[13px] text-zinc-500 leading-[1.6] whitespace-pre-wrap break-words">
                        {{ task.body }}
                    </div>
                </div>
                <div v-else class="text-[12px] text-zinc-400 italic">No description</div>

                <div v-if="task.assignees.length > 0">
                    <div :class="[labelClass, 'mb-1.5']">Assignees</div>
                    <div class="flex flex-wrap gap-1.5">
                        <span
                            v-for="assignee in task.assignees"
                            :key="assignee"
                            class="bg-blue-50 border border-blue-600 rounded-lg py-0.5 px-2 text-blue-600 text-[11px]"
                        >{{ assignee }}</span>
                    </div>
                </div>

                <div v-for="section in planningSections" :key="section.label">
                    <div :class="[labelClass, 'mb-1.5']" :style="{ color: section.color }">{{ section.label }}</div>
                    <ul class="m-0 p-0 list-none flex flex-col gap-1.5">
                        <li
                            v-for="(item, i) in section.items"
                            :key="i"
                            class="flex gap-2 text-[12px] text-zinc-500 leading-normal"
                        >
                            <span :class="[section.iconClass, 'shrink-0']">{{ section.icon }}</span>
                            <span>{{ item }}</span>
                        </li>
                    </ul>
                </div>
            </div>
        </template>
    </Modal>
</template>
