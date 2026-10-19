<script setup lang="ts">
import { useAgentQuestions, type AgentQuestion } from '@/queries/agentQuestionsQuery'

const props = defineProps<{ agentId: number }>()

const { questions } = useAgentQuestions(() => props.agentId)

function chosenLabels(question: AgentQuestion): string[] {
    if (!question.answer) return []
    return question.multi_select ? question.answer.split(',').map(label => label.trim()) : [question.answer]
}

function isChosen(question: AgentQuestion, label: string): boolean {
    return chosenLabels(question).includes(label)
}
</script>

<template>
    <aside
        v-if="questions.length"
        data-testid="agent-questions"
        class="w-[320px] shrink-0 flex flex-col border-l border-stroke bg-canvas overflow-hidden"
    >
        <div class="h-10 shrink-0 flex items-center px-4 border-b border-stroke bg-white text-zinc-900 text-ui-13 font-semibold">
            Questions
        </div>
        <ol class="flex-1 overflow-y-auto p-3 flex flex-col gap-3 m-0 list-none">
            <li
                v-for="question in questions"
                :key="question.id"
                data-testid="agent-question"
                :data-status="question.status"
                class="flex flex-col gap-1.5"
            >
                <div class="max-w-[92%] self-start rounded-lg rounded-tl-sm bg-white border border-stroke p-3 flex flex-col gap-2">
                    <div class="flex items-center gap-2">
                        <span
                            v-if="question.header"
                            class="text-ui-11 font-semibold py-0.5 px-1.5 rounded bg-zinc-100 text-zinc-700 tracking-[0.04em]"
                        >
                            {{ question.header }}
                        </span>
                        <span v-if="question.multi_select" class="text-ui-11 text-zinc-500">Select any</span>
                    </div>
                    <p class="m-0 text-zinc-900 text-ui-13 font-medium">{{ question.question }}</p>
                    <ul class="m-0 p-0 list-none flex flex-col gap-1">
                        <li
                            v-for="option in question.options"
                            :key="option.label"
                            data-testid="agent-question-option"
                            :data-chosen="isChosen(question, option.label)"
                            class="flex items-start gap-2 rounded-md px-2 py-1.5 border"
                            :class="isChosen(question, option.label) ? 'border-accent bg-blue-50' : 'border-transparent bg-zinc-50'"
                        >
                            <span
                                class="mt-0.5 w-3 h-3 shrink-0 border border-zinc-400"
                                :class="[question.multi_select ? 'rounded-sm' : 'rounded-full', isChosen(question, option.label) && 'bg-accent border-accent']"
                            />
                            <span class="flex flex-col min-w-0">
                                <span class="text-zinc-900 text-ui-12 font-medium">{{ option.label }}</span>
                                <span v-if="option.description" class="text-zinc-500 text-ui-11">{{ option.description }}</span>
                            </span>
                        </li>
                    </ul>
                </div>
                <div
                    v-if="question.status === 'answered'"
                    data-testid="agent-question-answer"
                    class="max-w-[80%] self-end rounded-lg rounded-tr-sm bg-accent text-white text-ui-12 px-3 py-2"
                >
                    {{ question.answer ?? 'Answered' }}
                </div>
                <span v-else class="self-start text-amber-700 text-ui-11">Waiting for an answer in the terminal</span>
            </li>
        </ol>
    </aside>
</template>
