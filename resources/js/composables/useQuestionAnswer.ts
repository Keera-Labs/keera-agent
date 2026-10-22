import { computed, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { useAnswerQuestion, type AgentQuestion } from '@/queries/agentQuestionsQuery'

export function useQuestionAnswer(questionSource: MaybeRefOrGetter<AgentQuestion | null>) {
    const question = () => toValue(questionSource)
    const selected = ref<string[]>([])
    const text = ref('')
    const error = ref('')
    const answer = useAnswerQuestion()

    watch(
        () => question()?.id,
        () => {
            selected.value = question()?.options.filter(option => option.recommended).map(option => option.label) ?? []
            text.value = ''
            error.value = ''
        },
        { immediate: true },
    )

    function toggle(label: string) {
        if (!question()?.multi_select) {
            selected.value = [label]
            return
        }
        selected.value = selected.value.includes(label)
            ? selected.value.filter(chosen => chosen !== label)
            : [...selected.value, label]
    }

    const sending = computed(() => answer.isLoading.value)
    const canSend = computed(() =>
        question() !== null && !sending.value && (selected.value.length > 0 || text.value.trim() !== ''),
    )

    async function send(): Promise<boolean> {
        const current = question()
        if (!current || !canSend.value) return false
        error.value = ''
        try {
            await answer.mutateAsync({
                questionId: current.id,
                answer: { choices: selected.value, text: text.value.trim() },
            })
            return true
        } catch (err) {
            error.value = err instanceof Error ? err.message : 'Failed to send the answer'
            return false
        }
    }

    return { selected, text, error, sending, canSend, toggle, send }
}
