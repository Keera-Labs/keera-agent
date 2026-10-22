<script setup lang="ts">
import { router } from '@inertiajs/vue3'
import { computed } from 'vue'
import QuestionDetail from '@/components/questions/QuestionDetail.vue'
import QuestionKindPill from '@/components/questions/QuestionKindPill.vue'
import QuestionOptions from '@/components/questions/QuestionOptions.vue'
import { useNow } from '@/composables/useNow'
import { useQuestionAnswer } from '@/composables/useQuestionAnswer'
import type { AgentQuestion } from '@/queries/agentQuestionsQuery'
import { relativeTime } from '@/utils/relativeTime'

const props = defineProps<{ question: AgentQuestion; agentName: string }>()

const { selected, text, error, sending, canSend, needsChoice, toggle, send } = useQuestionAnswer(() => props.question)
const now = useNow()

const textLabel = computed(() => {
    if (needsChoice.value) return 'Note for the agent (optional)'
    return props.question.options.length ? 'Something else? (optional)' : 'Type your answer'
})

const askedAgo = computed(() => {
    const elapsed = relativeTime(props.question.created_at, now.value)
    if (!elapsed) return ''
    return elapsed === 'now' ? 'asked just now' : `asked ${elapsed} ago`
})

function openInInbox() {
    router.visit(`/inbox?item=${props.question.id}`)
}
</script>

<template>
    <div class="shrink-0 flex flex-col gap-2 px-4 pt-2 pb-3 bg-white">
        <p data-testid="agent-question-waiting" class="m-0 font-mono text-ui-12 text-blue-700">
            <span aria-hidden="true">⏸</span> Waiting for your answer…
            <span v-if="askedAgo" class="text-zinc-500">({{ askedAgo }})</span>
        </p>
        <form
            data-testid="agent-question-card"
            class="@container flex flex-col gap-3 p-3 rounded-xl border border-blue-200 bg-blue-50/50"
            @submit.prevent="send"
        >
            <div class="flex items-center gap-2 min-w-0">
                <QuestionKindPill :kind="question.kind" />
                <span class="flex-1 min-w-0 truncate text-zinc-600 text-ui-12">{{ agentName }} is paused until you answer</span>
                <button
                    type="button"
                    data-testid="open-in-inbox"
                    class="shrink-0 text-accent text-ui-12 font-semibold cursor-pointer hover:underline"
                    @click="openInInbox"
                >
                    Open in Inbox
                </button>
            </div>
            <p class="m-0 text-zinc-900 text-ui-14 font-semibold">{{ question.question }}</p>
            <QuestionDetail v-if="question.detail" :detail="question.detail" />
            <QuestionOptions :question="question" :selected="selected" layout="row" @toggle="toggle" />
            <div class="flex flex-wrap gap-2">
                <input
                    v-model="text"
                    data-testid="question-free-text"
                    type="text"
                    :placeholder="textLabel"
                    :aria-label="textLabel"
                    class="flex-1 min-w-[12rem] h-9 px-3 rounded-lg border border-stroke bg-white text-ui-13 text-zinc-900 outline-none focus:border-zinc-500"
                >
                <button
                    type="submit"
                    data-testid="send-answer"
                    :disabled="!canSend"
                    class="shrink-0 h-9 px-4 rounded-lg bg-zinc-900 text-white text-ui-13 font-semibold cursor-pointer hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    {{ sending ? 'Sending…' : 'Send answer' }}
                </button>
            </div>
            <p v-if="error" role="alert" class="m-0 text-danger text-ui-12">{{ error }}</p>
        </form>
    </div>
</template>
