<script setup lang="ts">
import { usePage } from '@inertiajs/vue3'
import { computed, ref, watch } from 'vue'
import { useNow } from '@/composables/useNow'
import { InboxDetail, InboxList } from '@/pages/inbox/index'
import { useInboxQuestions, type AgentQuestionStatus } from '@/queries/agentQuestionsQuery'

const page = usePage<{ selected_question_id?: number | null }>()
const pending = useInboxQuestions('pending')
const answered = useInboxQuestions('answered')
const now = useNow()

const tab = ref<AgentQuestionStatus>('pending')
const selectedId = ref<number | null>(page.props.selected_question_id ?? null)
const deferredIds = ref<number[]>([])

watch(
    () => answered.questions.value,
    questions => {
        const requested = page.props.selected_question_id
        if (requested && questions.some(question => question.id === requested)
            && !pending.questions.value.some(question => question.id === requested)) {
            tab.value = 'answered'
        }
    },
    { once: true },
)

const items = computed(() => {
    if (tab.value === 'answered') return answered.questions.value
    const deferred = deferredIds.value
    return [...pending.questions.value].sort((a, b) => deferred.indexOf(a.id) - deferred.indexOf(b.id))
})
const selected = computed(() => items.value.find(question => question.id === selectedId.value) ?? items.value[0] ?? null)

function showTab(next: AgentQuestionStatus) {
    tab.value = next
    selectedId.value = null
}

function later() {
    const current = selected.value
    if (!current) return
    const index = items.value.indexOf(current)
    const next = items.value[index + 1] ?? items.value[0]
    deferredIds.value = [...deferredIds.value.filter(id => id !== current.id), current.id]
    selectedId.value = next?.id ?? null
}

const tabClass = (active: boolean) => [
    'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-ui-13 cursor-pointer transition-colors duration-100',
    active ? 'bg-zinc-900 text-white font-semibold' : 'text-zinc-600 hover:bg-black/[0.04]',
]
</script>

<template>
    <section data-testid="inbox-page" class="flex-1 min-w-0 flex flex-col overflow-hidden bg-white">
        <header class="shrink-0 flex flex-col gap-3 px-6 pt-5 pb-3 border-b border-stroke">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1 class="m-0 text-zinc-900 text-ui-20 font-bold tracking-[-0.01em]">Inbox</h1>
                <span
                    data-testid="inbox-pending-pill"
                    class="inline-flex items-center gap-1.5 h-6 px-2 rounded-md bg-blue-50 text-blue-700 text-ui-12 font-medium"
                >
                    <span class="w-1.5 h-1.5 rounded-full bg-blue-600" />
                    {{ pending.questions.value.length }} pending
                </span>
                <span class="text-zinc-500 text-ui-12">Agents pause here until you answer</span>
            </div>
            <div role="tablist" class="flex items-center gap-1">
                <button
                    type="button"
                    role="tab"
                    data-testid="inbox-tab-pending"
                    :aria-selected="tab === 'pending'"
                    :class="tabClass(tab === 'pending')"
                    @click="showTab('pending')"
                >
                    Pending <span class="tabular-nums opacity-70">{{ pending.questions.value.length }}</span>
                </button>
                <button
                    type="button"
                    role="tab"
                    data-testid="inbox-tab-answered"
                    :aria-selected="tab === 'answered'"
                    :class="tabClass(tab === 'answered')"
                    @click="showTab('answered')"
                >
                    Answered <span class="tabular-nums opacity-70">{{ answered.questions.value.length }}</span>
                </button>
            </div>
        </header>

        <div class="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
            <div class="shrink-0 md:w-[320px] max-h-[40%] md:max-h-none overflow-y-auto bg-canvas border-b md:border-b-0 md:border-r border-stroke">
                <InboxList
                    :questions="items"
                    :selected-id="selected?.id ?? null"
                    :now="now"
                    :empty-text="tab === 'pending' ? 'Nothing waiting on you. Agents will show up here when they pause.' : 'No answered questions yet.'"
                    @select="id => (selectedId = id)"
                />
            </div>
            <div class="flex-1 min-w-0 overflow-y-auto">
                <InboxDetail v-if="selected" :key="selected.id" :question="selected" :now="now" @later="later" />
                <p v-else class="m-0 p-10 text-center text-zinc-400 text-ui-13">Select an item to see it here.</p>
            </div>
        </div>
    </section>
</template>
