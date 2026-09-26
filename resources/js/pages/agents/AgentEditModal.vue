<script setup lang="ts">
import { usePage } from '@inertiajs/vue3'
import { computed, ref } from 'vue'
import Modal from '@/components/ui/Modal.vue'
import { cancelBtnClass, inputClass, labelClass, submitBtnClass } from '@/components/ui/styles'
import type { AgentFlags, ProjectAgent } from '@/queries/agentQuery'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { color } from '@/tokens'
import { AGENT_TYPE_COLORS, AGENT_TYPE_LABELS, DEFAULT_MODEL, DEFAULT_PROVIDER } from '@/types/agent'
import { FALLBACK_PROVIDERS, modelsForProvider, type GlobalSettings } from '@/types/provider'
import AgentLaunchOptions from './AgentLaunchOptions.vue'

/**
 * Self-contained "Edit Agent" modal. Renders its own `trigger` slot and owns
 * the open state via the reusable Modal. Wrap the trigger in a
 * stop-propagation container when it lives inside a clickable row so opening
 * the modal doesn't also trigger the row.
 */
const props = defineProps<{ agent: ProjectAgent }>()
const emit = defineEmits<{ openChange: [open: boolean] }>()

const PANEL_CLASS = 'bg-modal border border-stroke rounded-lg p-6 w-[600px] max-w-[95vw] max-h-[90vh] overflow-y-auto flex flex-col'

const page = usePage<{ global_settings?: GlobalSettings }>()
const layout = useAppLayoutStore()
const providers = computed(() => page.props.global_settings?.providers ?? FALLBACK_PROVIDERS)

const name = ref('')
const agentType = ref('')
const description = ref('')
const provider = ref('')
const model = ref('')
const systemPrompt = ref('')
const flags = ref<AgentFlags>({})
const planMode = ref(false)
const error = ref('')
const loading = ref(false)

const models = computed(() => modelsForProvider(providers.value, provider.value))

function loadFromAgent() {
    const a = props.agent
    name.value = a.name
    agentType.value = a.agent_type
    description.value = a.description ?? ''
    provider.value = a.provider ?? DEFAULT_PROVIDER
    model.value = a.model ?? DEFAULT_MODEL
    systemPrompt.value = a.system_prompt ?? ''
    flags.value = a.flags ?? {}
    planMode.value = !!a.plan_mode
    error.value = ''
    loading.value = false
}

function onOpenChange(open: boolean) {
    if (open) loadFromAgent()
    emit('openChange', open)
}

function onProviderChange() {
    model.value = models.value[0] ?? ''
}

function typeStyle(type: string) {
    const typeColor = AGENT_TYPE_COLORS[type] ?? color.accent
    const active = agentType.value === type
    return {
        borderColor: active ? typeColor : color.borderMuted,
        background: active ? `${typeColor}18` : 'transparent',
        color: active ? typeColor : color.textMuted,
    }
}

async function handleSubmit(close: () => void) {
    const trimmedName = name.value.trim()
    if (!trimmedName) { error.value = 'Name is required'; return }
    error.value = ''
    loading.value = true
    try {
        const res = await fetch(`/api/agents/${props.agent.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: trimmedName,
                agent_type: agentType.value,
                description: description.value.trim() || null,
                provider: provider.value,
                model: model.value,
                system_prompt: systemPrompt.value.trim() || null,
                flags: flags.value,
                plan_mode: planMode.value,
            }),
        })
        const data = await res.json()
        if (!res.ok) { error.value = data.error ?? 'Something went wrong'; return }
        layout.agentHook.invalidate()
        close()
    } catch {
        error.value = 'Network error'
    } finally {
        loading.value = false
    }
}
</script>

<template>
    <Modal aria-label="Edit agent" :panel-class="PANEL_CLASS" @open-change="onOpenChange">
        <template #trigger><slot name="trigger" /></template>
        <template #default="{ close }">
            <form class="flex flex-col gap-3.5" @submit.prevent="handleSubmit(close)">
                <h2 class="m-0 text-zinc-900 text-[15px] font-semibold">Edit Agent</h2>

                <span v-if="error" class="text-danger text-[12px]">{{ error }}</span>

                <div class="flex flex-col gap-1.5">
                    <span :class="labelClass">Type</span>
                    <div class="flex gap-2 flex-wrap">
                        <button
                            v-for="(label, type) in AGENT_TYPE_LABELS"
                            :key="type"
                            type="button"
                            data-testid="agent-type"
                            :class="['py-[5px] px-3 rounded border text-[12px] cursor-pointer', agentType === type ? 'font-semibold' : 'font-normal']"
                            :style="typeStyle(type)"
                            @click="agentType = type"
                        >
                            {{ label }}
                        </button>
                    </div>
                </div>

                <label class="flex flex-col gap-1">
                    <span :class="labelClass">Name</span>
                    <input v-model="name" name="name" autofocus placeholder="Agent name" required :class="[inputClass, 'w-full box-border']">
                </label>

                <label class="flex flex-col gap-1">
                    <span :class="labelClass">Description</span>
                    <input v-model="description" name="description" placeholder="Short description" :class="[inputClass, 'w-full box-border']">
                </label>

                <div class="flex gap-2.5">
                    <label class="w-[180px] flex flex-col gap-1">
                        <span :class="labelClass">Provider</span>
                        <select v-model="provider" name="provider" :class="[inputClass, 'w-full box-border']" @change="onProviderChange">
                            <option v-for="item in providers" :key="item.slug" :value="item.slug">{{ item.name }}</option>
                        </select>
                    </label>
                    <label class="flex-1 flex flex-col gap-1">
                        <span :class="labelClass">Model</span>
                        <select v-model="model" name="model" :class="[inputClass, 'w-full box-border']">
                            <option v-for="item in models" :key="item" :value="item">{{ item }}</option>
                        </select>
                    </label>
                </div>

                <label class="flex flex-col gap-1">
                    <span :class="labelClass">System Prompt</span>
                    <textarea
                        v-model="systemPrompt"
                        name="system_prompt"
                        placeholder="Instructions for this agent… (leave blank to use none)"
                        :rows="6"
                        :class="[inputClass, 'w-full box-border resize-y leading-normal']"
                    />
                </label>

                <AgentLaunchOptions v-model:flags="flags" v-model:plan-mode="planMode" />

                <div class="flex gap-2 justify-end pt-1">
                    <button type="button" :class="cancelBtnClass" @click="close">Cancel</button>
                    <button type="submit" :disabled="loading" :class="submitBtnClass" :style="{ opacity: loading ? 0.7 : 1 }">
                        {{ loading ? 'Saving…' : 'Save Changes' }}
                    </button>
                </div>
            </form>
        </template>
    </Modal>
</template>
