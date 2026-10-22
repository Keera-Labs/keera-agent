<script setup lang="ts">
import { router } from '@inertiajs/vue3'
import { computed, onBeforeUnmount, onMounted } from 'vue'
import QuestionKindPill from '@/components/questions/QuestionKindPill.vue'
import QuestionOptions from '@/components/questions/QuestionOptions.vue'
import { useQuestionAnswer } from '@/composables/useQuestionAnswer'
import type { AgentQuestion } from '@/queries/agentQuestionsQuery'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { relativeTime } from '@/utils/relativeTime'
import InboxAvatar from './InboxAvatar.vue'
import InboxProjectMeta from './InboxProjectMeta.vue'

const props = defineProps<{ question: AgentQuestion; now: number }>()
const emit = defineEmits<{ later: [] }>()

const layout = useAppLayoutStore()
const { selected, text, error, sending, canSend, toggle, send } = useQuestionAnswer(() => props.question)

const isPending = computed(() => props.question.status === 'pending')
const waited = computed(() => relativeTime(props.question.created_at, props.now))
const answeredAgo = computed(() => relativeTime(props.question.answered_at, props.now))
const canOpenChat = computed(() => Boolean(props.question.project_slug))

function openChat() {
    if (!props.question.project_slug) return
    layout.setActiveAgentId(props.question.agent_id)
    router.visit(`/${props.question.project_slug}/agents/${props.question.agent_id}`)
}

function onKeydown(event: KeyboardEvent) {
    if (isPending.value && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        send()
    }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
    <article data-testid="inbox-detail" class="flex flex-col gap-4 p-6 max-w-[760px]">
        <header class="flex flex-wrap items-center gap-3">
            <InboxAvatar :name="question.agent_name ?? '?'" :agent-type="question.agent_type" size="lg" />
            <div class="flex-1 min-w-[12rem] flex flex-col gap-0.5">
                <span class="text-zinc-900 text-ui-15 font-semibold truncate">{{ question.agent_name }}</span>
                <InboxProjectMeta :question="question" show-worktree />
            </div>
            <span
                v-if="isPending"
                data-testid="inbox-paused"
                class="shrink-0 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-orange-50 text-orange-800 text-ui-12 font-medium"
            >
                <span class="w-1.5 h-1.5 rounded-full bg-orange-500" />
                Paused · waiting {{ waited }}
            </span>
            <span
                v-else
                class="shrink-0 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-emerald-50 text-emerald-800 text-ui-12 font-medium"
            >
                Answered {{ answeredAgo === 'now' ? 'just now' : `${answeredAgo} ago` }}
            </span>
            <button
                v-if="canOpenChat"
                type="button"
                data-testid="open-chat"
                class="shrink-0 text-accent text-ui-13 font-semibold cursor-pointer hover:underline"
                @click="openChat"
            >
                Open chat
            </button>
        </header>

        <div class="flex flex-col gap-2">
            <QuestionKindPill :kind="question.kind" class="self-start" />
            <h2 class="m-0 text-zinc-900 text-ui-17 font-semibold leading-snug">{{ question.question }}</h2>
            <p v-if="question.header && question.kind === 'question'" class="m-0 text-zinc-500 text-ui-13">{{ question.header }}</p>
        </div>

        <template v-if="isPending">
            <QuestionOptions :question="question" :selected="selected" layout="column" @toggle="toggle" />

            <label class="flex flex-col gap-2">
                <span class="text-zinc-900 text-ui-13 font-semibold">
                    {{ question.options.length ? 'Something else? (optional)' : 'Your answer' }}
                </span>
                <textarea
                    v-model="text"
                    data-testid="question-free-text"
                    rows="3"
                    placeholder="Add details or answer in your own words…"
                    class="w-full px-3 py-2 rounded-lg border border-stroke bg-white text-ui-13 text-zinc-900 outline-none resize-y focus:border-zinc-500"
                />
            </label>

            <div class="flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    data-testid="send-answer"
                    :disabled="!canSend"
                    class="h-10 px-4 rounded-lg bg-zinc-900 text-white text-ui-13 font-semibold cursor-pointer hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed"
                    @click="send"
                >
                    {{ sending ? 'Sending…' : 'Send answer' }}
                </button>
                <button
                    type="button"
                    data-testid="answer-later"
                    class="h-10 px-4 rounded-lg border border-stroke bg-white text-zinc-800 text-ui-13 cursor-pointer hover:bg-zinc-50"
                    @click="emit('later')"
                >
                    Later
                </button>
                <span class="ml-auto text-zinc-500 text-ui-12">⌘↵ to send · the agent resumes right away</span>
            </div>
            <p v-if="error" role="alert" class="m-0 text-danger text-ui-12">{{ error }}</p>
        </template>

        <div v-else data-testid="inbox-answer" class="flex flex-col gap-1 p-4 rounded-lg border border-stroke bg-canvas">
            <span class="text-zinc-500 text-ui-12 font-semibold">Your answer</span>
            <span class="text-zinc-900 text-ui-13">{{ question.answer ?? 'Answered in the terminal' }}</span>
        </div>
    </article>
</template>
