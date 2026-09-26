<script setup lang="ts">
import { usePermissionsForm } from '@/composables/usePermissionsForm'
import PermissionsEditor from './PermissionsEditor.vue'

const emit = defineEmits<{ close: [] }>()

const { allow, deny, error, fetching, saving, save } = usePermissionsForm('/api/default-permissions', 'Failed to load defaults')

async function handleSubmit() {
    if (await save()) emit('close')
}
</script>

<template>
    <PermissionsEditor
        v-model:allow="allow"
        v-model:deny="deny"
        subtitle="Saved to default_permissions.json and synced to all existing projects."
        :loading="saving"
        :fetching="fetching"
        :error="error"
        @submit="handleSubmit"
        @close="emit('close')"
    >
        <template #title>Default Permissions</template>
    </PermissionsEditor>
</template>
