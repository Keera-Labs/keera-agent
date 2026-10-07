<script setup lang="ts">
import { usePermissionsForm } from '@/composables/usePermissionsForm'
import type { Project } from '@/types/type'
import PermissionsEditor from './PermissionsEditor.vue'

// The modal layer keys this component by project id, so a new project remounts it and reloads.
const props = defineProps<{ project: Project }>()
const emit = defineEmits<{ close: [] }>()

const { allow, deny, error, fetching, saving, save } = usePermissionsForm(
    `/api/projects/${props.project.id}/permissions`,
    'Failed to load permissions',
)

async function handleSubmit() {
    if (await save()) emit('close')
}
</script>

<template>
    <PermissionsEditor
        v-model:allow="allow"
        v-model:deny="deny"
        subtitle="Saved to the project's .claude/settings.json and database. Takes effect on next agent start."
        :loading="saving"
        :fetching="fetching"
        :error="error"
        @submit="handleSubmit"
        @close="emit('close')"
    >
        <template #title>Permissions — <span class="font-mono text-accent">{{ project.name }}</span></template>
    </PermissionsEditor>
</template>
