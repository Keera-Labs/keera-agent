<script setup lang="ts">
import type { AgentQuestionKind } from '@/queries/agentQuestionsQuery'

defineProps<{ kind: AgentQuestionKind }>()
</script>

<template>
    <span
        data-testid="question-kind-pill"
        :data-kind="kind"
        :class="[
            'inline-flex items-center shrink-0 h-5 px-1.5 rounded text-ui-11 font-semibold',
            kind === 'permission' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700',
        ]"
    >
        {{ kind === 'permission' ? 'Permission' : 'Question' }}
    </span>
</template>
