<script setup lang="ts">
import QuestionKindPill from '@/components/questions/QuestionKindPill.vue'
import type { AgentQuestion } from '@/queries/agentQuestionsQuery'
import { relativeTime } from '@/utils/relativeTime'
import InboxAvatar from './InboxAvatar.vue'
import InboxProjectMeta from './InboxProjectMeta.vue'

defineProps<{ questions: AgentQuestion[]; selectedId: number | null; now: number; emptyText: string }>()
defineEmits<{ select: [id: number] }>()

const timeOf = (question: AgentQuestion) => question.answered_at ?? question.created_at
</script>

<template>
    <p v-if="!questions.length" data-testid="inbox-empty" class="m-0 px-4 py-10 text-center text-zinc-500 text-ui-13">
        {{ emptyText }}
    </p>
    <ul v-else class="list-none m-0 p-2 flex flex-col gap-1.5">
        <li v-for="question in questions" :key="question.id">
            <button
                type="button"
                data-testid="inbox-item"
                :aria-current="question.id === selectedId ? 'true' : undefined"
                :class="[
                    'w-full flex flex-col gap-1.5 p-3 rounded-xl border text-left cursor-pointer transition-colors duration-100',
                    question.id === selectedId
                        ? 'bg-white border-blue-200 shadow-[0_0_0_3px_rgba(9,105,218,0.08)]'
                        : 'border-transparent hover:bg-white/70',
                ]"
                @click="$emit('select', question.id)"
            >
                <span class="flex items-center gap-2 min-w-0">
                    <InboxAvatar :name="question.agent_name ?? '?'" :agent-type="question.agent_type" size="sm" />
                    <span class="flex-1 min-w-0 truncate text-zinc-900 text-ui-13 font-semibold">{{ question.agent_name }}</span>
                    <span class="shrink-0 text-zinc-500 text-ui-12 tabular-nums">{{ relativeTime(timeOf(question), now) }}</span>
                </span>
                <span class="text-zinc-700 text-ui-13 line-clamp-2">{{ question.question }}</span>
                <span class="flex items-center gap-2 min-w-0">
                    <QuestionKindPill :kind="question.kind" />
                    <InboxProjectMeta :question="question" class="min-w-0" />
                </span>
            </button>
        </li>
    </ul>
</template>
