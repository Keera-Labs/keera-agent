<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import TagInput from '@/components/ui/TagInput.vue'
import { labelClass, submitBtnClass } from '@/components/ui/styles'
import { color } from '@/tokens'

const allow = ref<string[]>([])
const deny = ref<string[]>([])
const error = ref('')
const fetching = ref(true)
const saving = ref(false)
const saved = ref(false)
let savedTimer: ReturnType<typeof setTimeout> | undefined

onMounted(() => {
    fetch('/api/default-permissions')
        .then(r => r.json())
        .then(d => { allow.value = d.allow ?? []; deny.value = d.deny ?? [] })
        .catch(() => { error.value = 'Failed to load permissions' })
        .finally(() => { fetching.value = false })
})

onBeforeUnmount(() => clearTimeout(savedTimer))

async function save() {
    saving.value = true
    error.value = ''
    saved.value = false
    try {
        const res = await fetch('/api/default-permissions', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ allow: allow.value, deny: deny.value }),
        })
        const d = await res.json()
        if (!res.ok) { error.value = d.error ?? 'Save failed'; return }
        allow.value = d.allow ?? []
        deny.value = d.deny ?? []
        saved.value = true
        clearTimeout(savedTimer)
        savedTimer = setTimeout(() => { saved.value = false }, 2500)
    } catch {
        error.value = 'Network error'
    } finally {
        saving.value = false
    }
}
</script>

<template>
    <div class="flex-1 overflow-y-auto py-7 px-8">
        <div class="max-w-[560px] flex flex-col gap-[18px]">
            <div>
                <h3 class="mt-0 mx-0 mb-1.5 text-zinc-900 text-[14px] font-semibold">Default Permissions</h3>
                <p class="m-0 text-zinc-500 text-[12px] leading-[1.6]">
                    Allow/deny rules applied globally to all projects and agents. Changing these syncs to every project and agent in the database.
                </p>
            </div>

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

            <p class="m-0 text-zinc-400 text-[11px] leading-[1.6]">
                Rules follow Claude Code syntax, e.g.
                <code class="font-[monospace] text-accent">Bash(*)</code>,
                <code class="font-[monospace] text-accent">Bash(npm run *)</code>,
                <code class="font-[monospace] text-accent">Read</code>.
                Press Enter to add a rule. Leave both empty to rely on interactive prompts.
            </p>

            <div>
                <button
                    type="button"
                    :disabled="fetching || saving"
                    :class="[submitBtnClass, 'min-w-[140px]', fetching || saving ? 'opacity-60' : 'opacity-100']"
                    @click="save"
                >{{ saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Permissions' }}</button>
            </div>
        </div>
    </div>
</template>
