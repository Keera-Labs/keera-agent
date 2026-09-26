<script setup lang="ts">
import { router } from '@inertiajs/vue3'
import { storeToRefs } from 'pinia'
import { ref } from 'vue'
import { inputClass, labelClass, submitBtnClass } from '@/components/ui/styles'
import PluginsTab from '@/pages/settings/PluginsTab.vue'
import { useAppLayoutStore } from '@/stores/appLayoutStore'

const MIN_AGENTS = 1
const MAX_AGENTS = 100

const layout = useAppLayoutStore()
const { maxAgentsPerProject } = storeToRefs(layout)

const maxAgents = ref(maxAgentsPerProject.value)
const saving = ref(false)
const saved = ref(false)
const error = ref('')

function setMaxAgents(raw: string) {
    const value = parseInt(raw, 10) || MIN_AGENTS
    maxAgents.value = Math.min(MAX_AGENTS, Math.max(MIN_AGENTS, value))
}

async function save() {
    saving.value = true
    saved.value = false
    error.value = ''
    try {
        const res = await fetch('/api/global-settings', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ max_agents_per_project: maxAgents.value }),
        })
        const data = await res.json()
        if (!res.ok) {
            error.value = data.error ?? 'Save failed'
            return
        }
        // Set immediately so the add-agent limit warning updates before the reload lands.
        maxAgentsPerProject.value = data.max_agents_per_project ?? maxAgents.value
        saved.value = true
        setTimeout(() => { saved.value = false }, 2000)
        router.reload({ only: ['global_settings'] })
    } catch {
        error.value = 'Network error'
    } finally {
        saving.value = false
    }
}
</script>

<template>
    <div class="flex-1 overflow-y-auto" data-testid="general-section">
        <div class="pt-7 px-8 max-w-[784px] flex flex-col gap-3">
            <div>
                <h3 class="mt-0 mx-0 mb-1.5 text-zinc-900 text-[14px] font-semibold">Agents</h3>
                <p class="m-0 text-zinc-500 text-[12px] leading-[1.6]">Limits that apply across all projects.</p>
            </div>
            <span v-if="error" class="text-danger text-[12px]" data-testid="max-agents-error">{{ error }}</span>
            <section class="border border-stroke rounded-md bg-canvas p-4 flex items-end gap-3">
                <label class="flex flex-col gap-1.5">
                    <span :class="labelClass">Max agents per project</span>
                    <input
                        type="number"
                        data-testid="max-agents"
                        :min="MIN_AGENTS"
                        :max="MAX_AGENTS"
                        :value="maxAgents"
                        :class="[inputClass, 'w-[120px]']"
                        @change="setMaxAgents(($event.target as HTMLInputElement).value)"
                    >
                </label>
                <button
                    type="button"
                    data-testid="max-agents-save"
                    :disabled="saving || maxAgents === maxAgentsPerProject"
                    :class="[submitBtnClass, 'min-w-[90px] disabled:opacity-50']"
                    @click="save"
                >{{ saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save' }}</button>
                <span class="ml-auto self-center max-w-[260px] text-zinc-400 text-[11px] leading-normal">
                    Agents that aren't deleted count toward the limit. Default: 10.
                </span>
            </section>
        </div>
        <PluginsTab />
    </div>
</template>
