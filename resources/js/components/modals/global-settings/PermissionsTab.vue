<script setup lang="ts">
import { ref } from 'vue'
import TagInput from '@/components/ui/TagInput.vue'
import { labelClass, submitBtnClass } from '@/components/ui/styles'
import { usePermissionsForm } from '@/composables/usePermissionsForm'
import { color } from '@/tokens'

const { allow, deny, error, fetching, saving, save: savePermissions } = usePermissionsForm(
    '/api/default-permissions',
    'Failed to load',
    'Save failed',
)
const saved = ref(false)

async function save() {
    saved.value = false
    if (!(await savePermissions())) return
    saved.value = true
    setTimeout(() => { saved.value = false }, 2000)
}
</script>

<template>
    <div class="flex-1 overflow-y-auto p-6">
        <div class="flex flex-col gap-3.5 max-w-[520px]">
            <p class="m-0 text-zinc-500 text-[11px]">
                Default allow/deny rules applied to all projects and agents. Changing these syncs to every project and agent in the database.
            </p>
            <span v-if="error" class="text-danger text-[12px]">{{ error }}</span>
            <div class="flex flex-col gap-1">
                <span :class="labelClass">Allow</span>
                <TagInput
                    v-model="allow"
                    :placeholder="fetching ? '' : 'e.g. Bash(npm run *)'"
                    :disabled="fetching"
                    :tag-color="color.success"
                />
            </div>
            <div class="flex flex-col gap-1">
                <span :class="labelClass">Deny</span>
                <TagInput
                    v-model="deny"
                    :placeholder="fetching ? '' : 'e.g. Bash(rm *)'"
                    :disabled="fetching"
                    :tag-color="color.danger"
                />
            </div>
            <p class="m-0 text-zinc-400 text-[10px] leading-normal">
                Rules follow Claude Code syntax, e.g.
                <code class="font-[monospace]">Bash(*)</code>,
                <code class="font-[monospace]">Bash(npm run *)</code>,
                <code class="font-[monospace]">Read</code>.
                Leave both empty to rely on interactive prompts.
            </p>
            <div>
                <button
                    :disabled="fetching || saving"
                    :class="`${submitBtnClass} min-w-[120px]`"
                    :style="{ opacity: fetching || saving ? 0.6 : 1 }"
                    @click="save"
                >
                    {{ saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Permissions' }}
                </button>
            </div>
        </div>
    </div>
</template>
