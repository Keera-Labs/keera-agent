<script setup lang="ts">
import { usePage } from '@inertiajs/vue3'
import { computed, ref, watch } from 'vue'
import { cancelBtnClass, flagRowClass, inputClass, labelClass, submitBtnClass, toggleClass } from '@/components/ui/styles'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { color } from '@/tokens'
import type { AgentFlags, AgentTemplate } from '@/types/agent'
import { AGENT_TYPE_COLORS, AGENT_TYPE_LABELS, DEFAULT_MODEL, DEFAULT_PROVIDER } from '@/types/agent'
import type { GlobalSettings } from '@/types/provider'
import { FALLBACK_PROVIDERS, modelsForProvider } from '@/types/provider'

/**
 * Per-project agent-template manager. The list is the project's EFFECTIVE
 * templates (overrides resolved over globals). Editing is copy-on-write: saving
 * a global forks a project override on the backend; saving an override updates
 * it in place. "Revert" drops a single override; "Reset all" drops every
 * override so the project falls back entirely to the globals.
 */
const props = defineProps<{ projectId: number; projectName: string }>()
const emit = defineEmits<{ close: [] }>()

const page = usePage<{ global_settings?: GlobalSettings }>()
const providers = computed(() => page.props.global_settings?.providers ?? FALLBACK_PROVIDERS)
const layout = useAppLayoutStore()

const templates = ref<AgentTemplate[]>([])
const loading = ref(true)
const selected = ref<AgentTemplate | null>(null)
const isNew = ref(false)

const name = ref('')
const desc = ref('')
const type = ref('software_engineer')
const provider = ref(DEFAULT_PROVIDER)
const model = ref(DEFAULT_MODEL)
const prompt = ref('')
const flags = ref<AgentFlags>({})
const planMode = ref(false)
const error = ref('')
const saving = ref(false)

const showEditor = computed(() => isNew.value || selected.value !== null)
const models = computed(() => modelsForProvider(providers.value, provider.value))
const dangerStyle = { color: color.danger, borderColor: color.danger }

async function reload() {
    const res = await fetch(`/api/projects/${props.projectId}/agent-templates`)
    const data: AgentTemplate[] = res.ok ? await res.json() : []
    templates.value = data
    loading.value = false
    layout.refetchAgentTemplates()
    return data
}

watch(() => props.projectId, reload, { immediate: true })

function load(tpl: AgentTemplate) {
    selected.value = tpl
    isNew.value = false
    error.value = ''
    name.value = tpl.name
    desc.value = tpl.description ?? ''
    type.value = tpl.agent_type
    provider.value = tpl.provider ?? DEFAULT_PROVIDER
    model.value = tpl.model ?? DEFAULT_MODEL
    prompt.value = tpl.system_prompt ?? ''
    flags.value = tpl.flags ?? {}
    planMode.value = !!tpl.plan_mode
}

function startNew() {
    selected.value = null
    isNew.value = true
    error.value = ''
    name.value = ''
    desc.value = ''
    type.value = 'software_engineer'
    provider.value = DEFAULT_PROVIDER
    model.value = modelsForProvider(providers.value, DEFAULT_PROVIDER)[0] ?? DEFAULT_MODEL
    prompt.value = ''
    flags.value = {}
    planMode.value = false
}

function changeProvider(slug: string) {
    provider.value = slug
    model.value = modelsForProvider(providers.value, slug)[0] ?? ''
}

function toggleSkipPermissions() {
    flags.value = { ...flags.value, dangerously_skip_permissions: !flags.value.dangerously_skip_permissions }
}

async function save() {
    if (!name.value.trim()) { error.value = 'Name is required'; return }
    saving.value = true
    error.value = ''
    const payload = {
        name: name.value.trim(),
        description: desc.value.trim() || null,
        agent_type: type.value,
        provider: provider.value,
        model: model.value,
        system_prompt: prompt.value.trim() || null,
        flags: flags.value,
        plan_mode: planMode.value,
    }
    const creating = isNew.value || !selected.value
    try {
        // Copy-on-write: PATCH against the effective row id forks/updates the
        // project override; POST creates a project-only template.
        const url = creating
            ? `/api/projects/${props.projectId}/agent-templates`
            : `/api/projects/${props.projectId}/agent-templates/${selected.value!.id}`
        const res = await fetch(url, {
            method: creating ? 'POST' : 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        })
        if (!res.ok) { error.value = (await res.json()).error ?? 'Save failed'; return }
        const saved: AgentTemplate = await res.json()
        const list = await reload()
        selected.value = list.find(t => t.id === saved.id) ?? saved
        isNew.value = false
    } catch {
        error.value = 'Network error'
    } finally {
        saving.value = false
    }
}

async function revertOverride(tpl: AgentTemplate) {
    await fetch(`/api/projects/${props.projectId}/agent-templates/${tpl.id}`, { method: 'DELETE' })
    await reload()
    selected.value = null
    isNew.value = false
}

async function resetAll() {
    await fetch(`/api/projects/${props.projectId}/agent-templates/reset`, { method: 'POST' })
    await reload()
    selected.value = null
    isNew.value = false
}

const knobClass = (on: boolean) => [
    'absolute top-[3px] w-3 h-3 rounded-full bg-white transition-[left] duration-150',
    on ? 'left-[17px]' : 'left-[3px]',
]
</script>

<template>
    <div
        class="fixed inset-0 bg-black/50 flex items-center justify-center z-[300]"
        data-testid="templates-backdrop"
        @click.self="emit('close')"
    >
        <div class="bg-modal border border-stroke rounded-md w-[760px] max-w-[95vw] h-[560px] max-h-[90vh] flex flex-col overflow-hidden">
            <div class="py-4 px-5 border-b border-stroke flex items-center justify-between">
                <div>
                    <h2 class="m-0 text-zinc-900 text-[15px] font-semibold">Agent Templates</h2>
                    <p class="mt-0.5 mx-0 mb-0 text-zinc-500 text-[12px]">
                        Project: <span class="text-accent">{{ props.projectName }}</span> — edits here stay in this project (copy-on-write).
                    </p>
                </div>
                <button
                    type="button"
                    :class="cancelBtnClass"
                    :style="dangerStyle"
                    title="Remove all project overrides and revert to global templates"
                    @click="resetAll"
                >
                    Reset all to global
                </button>
            </div>

            <div class="flex-1 flex overflow-hidden">
                <div class="w-[240px] shrink-0 border-r border-stroke flex flex-col overflow-hidden">
                    <div class="p-2.5">
                        <button type="button" :class="[submitBtnClass, 'w-full']" style="padding: 6px 0" @click="startNew">
                            + New (project only)
                        </button>
                    </div>
                    <div class="flex-1 overflow-y-auto">
                        <div v-if="loading" class="p-3 text-zinc-400 text-[12px]">Loading…</div>
                        <button
                            v-for="tpl in templates"
                            :key="tpl.id"
                            type="button"
                            data-testid="template-item"
                            :class="[
                                'w-full text-left border-0 border-l-2 border-solid py-[9px] px-3 cursor-pointer flex flex-col gap-[3px]',
                                !isNew && selected?.id === tpl.id ? 'bg-canvas border-l-accent' : 'bg-transparent border-l-transparent',
                            ]"
                            @click="load(tpl)"
                        >
                            <div class="flex items-center gap-1.5">
                                <span class="text-zinc-900 text-[12px] font-medium flex-1 truncate">{{ tpl.name }}</span>
                                <span v-if="tpl.is_override" class="text-accent text-[9px] font-semibold">OVERRIDE</span>
                                <span v-else-if="tpl.is_builtin" class="text-zinc-400 text-[9px]">global</span>
                            </div>
                            <span class="text-[10px]" :style="{ color: AGENT_TYPE_COLORS[tpl.agent_type] ?? color.textFaint }">
                                {{ AGENT_TYPE_LABELS[tpl.agent_type] ?? tpl.agent_type }}
                            </span>
                        </button>
                    </div>
                </div>

                <div class="flex-1 flex flex-col overflow-hidden">
                    <template v-if="showEditor">
                        <div class="flex-1 overflow-y-auto py-4 px-5 flex flex-col gap-3">
                            <span v-if="error" class="text-danger text-[12px]">{{ error }}</span>
                            <div
                                v-if="selected?.is_override"
                                class="text-[11px] text-zinc-500 bg-canvas border border-stroke rounded py-[7px] px-2.5"
                            >
                                Project override — shadows a global template. Use Revert to drop it.
                            </div>
                            <div class="flex gap-2.5">
                                <label class="flex-1 flex flex-col gap-1">
                                    <span :class="labelClass">Name</span>
                                    <input v-model="name" name="name" :class="inputClass">
                                </label>
                                <label class="flex-1 flex flex-col gap-1">
                                    <span :class="labelClass">Type</span>
                                    <select v-model="type" name="type" :class="inputClass">
                                        <option v-for="(label, key) in AGENT_TYPE_LABELS" :key="key" :value="key">{{ label }}</option>
                                    </select>
                                </label>
                            </div>
                            <label class="flex flex-col gap-1">
                                <span :class="labelClass">Description</span>
                                <input v-model="desc" name="description" :class="inputClass">
                            </label>
                            <div class="flex gap-2.5">
                                <label class="w-[150px] flex flex-col gap-1">
                                    <span :class="labelClass">Provider</span>
                                    <select
                                        name="provider"
                                        :value="provider"
                                        :class="inputClass"
                                        @change="changeProvider(($event.target as HTMLSelectElement).value)"
                                    >
                                        <option v-for="item in providers" :key="item.slug" :value="item.slug">{{ item.name }}</option>
                                    </select>
                                </label>
                                <label class="flex-1 flex flex-col gap-1">
                                    <span :class="labelClass">Model</span>
                                    <select v-model="model" name="model" :class="inputClass">
                                        <option v-for="item in models" :key="item" :value="item">{{ item }}</option>
                                    </select>
                                </label>
                            </div>
                            <label class="flex flex-col gap-1">
                                <span :class="labelClass">System Prompt</span>
                                <textarea v-model="prompt" name="system_prompt" rows="6" :class="[inputClass, 'resize-y leading-normal']" />
                            </label>
                            <div :class="flagRowClass" data-testid="flag-skip-permissions" @click="toggleSkipPermissions">
                                <div>
                                    <div class="text-[12px] font-medium text-zinc-700">Skip Permissions</div>
                                    <div class="text-[10px] text-zinc-400">--dangerously-skip-permissions — no prompts</div>
                                </div>
                                <button type="button" :class="toggleClass(!!flags.dangerously_skip_permissions)" @click.stop>
                                    <span :class="knobClass(!!flags.dangerously_skip_permissions)" />
                                </button>
                            </div>
                            <div :class="flagRowClass" data-testid="flag-plan-mode" @click="planMode = !planMode">
                                <div>
                                    <div class="text-[12px] font-medium text-zinc-700">Plan Mode</div>
                                    <div class="text-[10px] text-zinc-400">Read-only — analyse and plan, never edit files</div>
                                </div>
                                <button type="button" :class="toggleClass(planMode)" @click.stop>
                                    <span :class="knobClass(planMode)" />
                                </button>
                            </div>
                        </div>
                        <div class="py-3 px-5 border-t border-stroke flex gap-2 justify-end">
                            <button
                                v-if="selected?.is_override"
                                type="button"
                                :class="[cancelBtnClass, 'mr-auto']"
                                :style="dangerStyle"
                                @click="revertOverride(selected)"
                            >
                                Revert to global
                            </button>
                            <button type="button" :class="cancelBtnClass" @click="emit('close')">Close</button>
                            <button
                                type="button"
                                :disabled="saving"
                                :class="submitBtnClass"
                                :style="{ opacity: saving ? 0.6 : 1 }"
                                @click="save"
                            >
                                {{ saving ? 'Saving…' : selected && !selected.is_override ? 'Save (creates override)' : 'Save' }}
                            </button>
                        </div>
                    </template>
                    <div v-else class="flex-1 flex items-center justify-center text-zinc-400 text-[13px] p-5 text-center">
                        Select a template to edit it for this project, or create a project-only one.
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
