<script setup lang="ts">
import { usePage } from '@inertiajs/vue3'
import { computed, reactive, ref } from 'vue'
import { cancelBtnClass, flagRowClass, inputClass, labelClass, submitBtnClass, toggleClass } from '@/components/ui/styles'
import { useAgentTemplates } from '@/queries/agentTemplatesQuery'
import { color } from '@/tokens'
import type { AgentFlags, AgentTemplate } from '@/types/agent'
import { AGENT_TYPE_COLORS, DEFAULT_MODEL, DEFAULT_PROVIDER } from '@/types/agent'
import type { GlobalSettings } from '@/types/provider'
import { FALLBACK_PROVIDERS, modelsForProvider } from '@/types/provider'

// Narrower than the shared AGENT_TYPE_LABELS: these are the types a template can be created as.
const TEMPLATE_TYPE_LABELS: Record<string, string> = {
    pm: 'PM',
    software_engineer: 'Software Engineer',
    qa: 'QA',
}

const BOOLEAN_FLAGS = [
    { key: 'dangerously_skip_permissions', label: 'Skip Permissions', hint: '--dangerously-skip-permissions — no prompts' },
    { key: 'verbose', label: 'Verbose', hint: '--verbose — detailed output' },
] as const

const page = usePage<{ global_settings?: GlobalSettings }>()
const providers = computed(() => page.props.global_settings?.providers ?? FALLBACK_PROVIDERS)

const { agentTemplates: templates, setAgentTemplates, isLoading: loading, refetch } = useAgentTemplates()

const selected = ref<AgentTemplate | null>(null)
const isNew = ref(false)
const form = reactive({
    name: '',
    description: '',
    agent_type: 'software_engineer',
    provider: DEFAULT_PROVIDER,
    model: DEFAULT_MODEL,
    system_prompt: '',
    flags: {} as AgentFlags,
    plan_mode: false,
})
const formError = ref('')
const saving = ref(false)
const syncing = ref(false)

const showEditor = computed(() => isNew.value || selected.value !== null)
const canDelete = computed(() => !isNew.value && selected.value !== null && !selected.value.is_builtin)
const providerModels = computed(() => modelsForProvider(providers.value, form.provider))

function fillForm(tpl: AgentTemplate | null) {
    Object.assign(form, {
        name: tpl?.name ?? '',
        description: tpl?.description ?? '',
        agent_type: tpl?.agent_type ?? 'software_engineer',
        provider: tpl?.provider ?? DEFAULT_PROVIDER,
        model: tpl ? tpl.model : (modelsForProvider(providers.value, DEFAULT_PROVIDER)[0] ?? DEFAULT_MODEL),
        system_prompt: tpl?.system_prompt ?? '',
        flags: { ...(tpl?.flags ?? {}) },
        plan_mode: !!tpl?.plan_mode,
    })
    formError.value = ''
}

function loadTemplate(tpl: AgentTemplate) {
    selected.value = tpl
    isNew.value = false
    fillForm(tpl)
}

function startNew() {
    selected.value = null
    isNew.value = true
    fillForm(null)
}

function onProviderChange() {
    form.model = modelsForProvider(providers.value, form.provider)[0] ?? ''
}

function toggleFlag(key: (typeof BOOLEAN_FLAGS)[number]['key']) {
    form.flags = { ...form.flags, [key]: !form.flags[key] }
}

function onMaxTurnsInput(event: Event) {
    const value = (event.target as HTMLInputElement).value
    form.flags = { ...form.flags, max_turns: value ? parseInt(value, 10) : null }
}

async function syncFromDefaults() {
    syncing.value = true
    try {
        await fetch('/api/agent-templates/sync-defaults', { method: 'POST' })
        await refetch()
        selected.value = null
        isNew.value = false
    } finally {
        syncing.value = false
    }
}

async function saveTemplate() {
    if (!form.name.trim()) { formError.value = 'Name is required'; return }
    saving.value = true
    formError.value = ''
    try {
        const url = isNew.value ? '/api/agent-templates' : `/api/agent-templates/${selected.value!.id}`
        const res = await fetch(url, {
            method: isNew.value ? 'POST' : 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(form),
        })
        if (!res.ok) {
            const d = await res.json()
            formError.value = d.error ?? 'Save failed'
            return
        }
        const tpl: AgentTemplate = await res.json()
        setAgentTemplates(isNew.value
            ? [...templates.value, tpl]
            : templates.value.map(t => (t.id === tpl.id ? tpl : t)))
        isNew.value = false
        selected.value = tpl
    } finally {
        saving.value = false
    }
}

async function deleteTemplate() {
    const tpl = selected.value
    if (!tpl || tpl.is_builtin) return
    const res = await fetch(`/api/agent-templates/${tpl.id}`, { method: 'DELETE' })
    if (!res.ok) return
    setAgentTemplates(templates.value.filter(t => t.id !== tpl.id))
    selected.value = null
    isNew.value = false
}
</script>

<template>
    <div class="flex-1 flex overflow-hidden">
        <div class="w-[220px] shrink-0 border-r border-stroke flex flex-col overflow-hidden">
            <div class="p-2.5 border-b border-stroke flex flex-col gap-1.5">
                <button type="button" :class="[submitBtnClass, 'w-full text-center py-1.5 px-0']" @click="startNew">
                    + New Template
                </button>
                <button
                    type="button"
                    :disabled="syncing"
                    title="Re-pull code defaults into the built-in templates, overwriting manual edits"
                    :class="[cancelBtnClass, 'w-full text-center py-1.5 px-0', syncing ? 'opacity-60' : 'opacity-100']"
                    @click="syncFromDefaults"
                >{{ syncing ? 'Syncing…' : 'Sync from defaults' }}</button>
            </div>
            <div class="flex-1 overflow-y-auto">
                <div v-if="loading" class="py-3 px-4 text-zinc-400 text-[12px]">Loading…</div>
                <button
                    v-for="tpl in templates"
                    :key="tpl.id"
                    type="button"
                    :data-template="tpl.id"
                    :class="[
                        'w-full text-left border-l-2 py-[9px] px-3 cursor-pointer flex flex-col gap-[3px]',
                        !isNew && selected?.id === tpl.id ? 'bg-canvas border-accent' : 'bg-transparent border-transparent',
                    ]"
                    @click="loadTemplate(tpl)"
                >
                    <div class="flex items-center gap-1.5 w-full">
                        <span class="text-zinc-900 text-[12px] font-medium flex-1 truncate">{{ tpl.name }}</span>
                        <span v-if="tpl.is_builtin" class="text-zinc-400 text-[9px] tracking-[0.03em]">built-in</span>
                    </div>
                    <span class="text-[10px]" :style="{ color: AGENT_TYPE_COLORS[tpl.agent_type] ?? color.textFaint }">
                        {{ TEMPLATE_TYPE_LABELS[tpl.agent_type] ?? tpl.agent_type }}
                    </span>
                </button>
            </div>
        </div>

        <div v-if="showEditor" class="flex-1 flex flex-col overflow-hidden">
            <div v-if="selected?.is_builtin" class="py-[7px] px-4 bg-canvas border-b border-stroke text-zinc-500 text-[11px]">
                Built-in template — your edits are saved and persist across restarts. It can’t be deleted.
            </div>
            <div class="flex-1 overflow-y-auto py-[18px] px-6 flex flex-col gap-3.5">
                <span v-if="formError" class="text-danger text-[12px]">{{ formError }}</span>

                <div class="flex gap-2.5">
                    <label class="flex-1 flex flex-col gap-1">
                        <span :class="labelClass">Name *</span>
                        <input v-model="form.name" name="name" :class="[inputClass, 'w-full box-border']">
                    </label>
                    <label class="flex-1 flex flex-col gap-1">
                        <span :class="labelClass">Type</span>
                        <select v-model="form.agent_type" name="agent_type" :class="[inputClass, 'w-full box-border']">
                            <option v-for="(label, key) in TEMPLATE_TYPE_LABELS" :key="key" :value="key">{{ label }}</option>
                        </select>
                    </label>
                </div>

                <label class="flex flex-col gap-1">
                    <span :class="labelClass">Description</span>
                    <input
                        v-model="form.description"
                        name="description"
                        placeholder="Short description of this template's role…"
                        :class="[inputClass, 'w-full box-border']"
                    >
                </label>

                <div class="flex gap-2.5">
                    <label class="w-[170px] flex flex-col gap-1">
                        <span :class="labelClass">Provider</span>
                        <select v-model="form.provider" name="provider" :class="[inputClass, 'w-full box-border']" @change="onProviderChange">
                            <option v-for="provider in providers" :key="provider.slug" :value="provider.slug">{{ provider.name }}</option>
                        </select>
                    </label>
                    <label class="flex-1 flex flex-col gap-1">
                        <span :class="labelClass">Model</span>
                        <select v-model="form.model" name="model" :class="[inputClass, 'w-full box-border']">
                            <option v-for="model in providerModels" :key="model" :value="model">{{ model }}</option>
                        </select>
                    </label>
                </div>

                <label class="flex flex-col gap-1">
                    <span :class="labelClass">System Prompt</span>
                    <textarea
                        v-model="form.system_prompt"
                        name="system_prompt"
                        placeholder="Instructions passed to Claude when an agent using this template starts…"
                        rows="9"
                        :class="[inputClass, 'w-full box-border resize-y leading-[1.6] font-mono text-[11px]']"
                    />
                </label>

                <div class="flex flex-col gap-1.5">
                    <span :class="labelClass">Launch Flags</span>
                    <div v-for="flag in BOOLEAN_FLAGS" :key="flag.key" :class="flagRowClass" @click="toggleFlag(flag.key)">
                        <div>
                            <div class="text-[12px] font-medium text-zinc-700">{{ flag.label }}</div>
                            <div class="text-[10px] text-zinc-400">{{ flag.hint }}</div>
                        </div>
                        <button
                            type="button"
                            :aria-label="flag.label"
                            :aria-pressed="!!form.flags[flag.key]"
                            :class="toggleClass(!!form.flags[flag.key])"
                        >
                            <span
                                :class="[
                                    'absolute top-[3px] w-3 h-3 rounded-full bg-white transition-[left] duration-150',
                                    form.flags[flag.key] ? 'left-[17px]' : 'left-[3px]',
                                ]"
                            />
                        </button>
                    </div>
                    <div :class="flagRowClass" @click="form.plan_mode = !form.plan_mode">
                        <div>
                            <div class="text-[12px] font-medium text-zinc-700">Plan Mode</div>
                            <div class="text-[10px] text-zinc-400">Read-only — analyse and plan, never edit files</div>
                        </div>
                        <button type="button" aria-label="Plan Mode" :aria-pressed="form.plan_mode" :class="toggleClass(form.plan_mode)">
                            <span
                                :class="[
                                    'absolute top-[3px] w-3 h-3 rounded-full bg-white transition-[left] duration-150',
                                    form.plan_mode ? 'left-[17px]' : 'left-[3px]',
                                ]"
                            />
                        </button>
                    </div>
                    <div :class="[flagRowClass, 'gap-3']">
                        <div class="flex-1">
                            <div class="text-[12px] font-medium text-zinc-700">Max Turns</div>
                            <div class="text-[10px] text-zinc-400">--max-turns N — limit conversation turns</div>
                        </div>
                        <input
                            type="number"
                            name="max_turns"
                            min="1"
                            max="500"
                            placeholder="∞"
                            :value="form.flags.max_turns ?? ''"
                            :class="[inputClass, 'w-[72px] text-center py-1 px-2']"
                            @input="onMaxTurnsInput"
                        >
                    </div>
                </div>
            </div>
            <div class="py-3 px-6 border-t border-stroke flex gap-2 justify-end shrink-0">
                <button v-if="canDelete" type="button" :class="[cancelBtnClass, 'text-danger border-danger']" @click="deleteTemplate">
                    Delete
                </button>
                <button
                    type="button"
                    :disabled="saving"
                    :class="[submitBtnClass, saving ? 'opacity-60' : 'opacity-100']"
                    @click="saveTemplate"
                >{{ saving ? 'Saving…' : isNew ? 'Create Template' : 'Save Changes' }}</button>
            </div>
        </div>
        <div v-else class="flex-1 flex items-center justify-center">
            <span class="text-zinc-400 text-[13px]">Select a template to view, or create a new one</span>
        </div>
    </div>
</template>
