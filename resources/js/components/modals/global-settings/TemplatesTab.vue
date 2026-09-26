<script setup lang="ts">
import { usePage } from '@inertiajs/vue3'
import { computed, ref } from 'vue'
import { cancelBtnClass, flagRowClass, inputClass, labelClass, submitBtnClass, toggleClass } from '@/components/ui/styles'
import type { AgentFlags } from '@/queries/agentQuery'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { color } from '@/tokens'
import { AGENT_TYPE_COLORS, AGENT_TYPE_LABELS, DEFAULT_MODEL, DEFAULT_PROVIDER, type AgentTemplate } from '@/types/agent'
import { FALLBACK_PROVIDERS, modelsForProvider, type GlobalSettings } from '@/types/provider'

const FLAG_TOGGLES = [
    { key: 'dangerously_skip_permissions', label: 'Skip Permissions', hint: '--dangerously-skip-permissions — no prompts' },
    { key: 'verbose', label: 'Verbose', hint: '--verbose — detailed output' },
] as const

const page = usePage<{ global_settings?: GlobalSettings }>()
const providers = page.props.global_settings?.providers ?? FALLBACK_PROVIDERS
const layout = useAppLayoutStore()

const templates = ref<AgentTemplate[]>([...layout.agentTemplates])
const selected = ref<AgentTemplate | null>(null)
const isNew = ref(false)
const syncing = ref(false)
const saving = ref(false)
const formError = ref('')

const name = ref('')
const description = ref('')
const agentType = ref('software_engineer')
const provider = ref(DEFAULT_PROVIDER)
const model = ref(DEFAULT_MODEL)
const systemPrompt = ref('')
const flags = ref<AgentFlags>({})
const planMode = ref(false)

const canEdit = computed(() => isNew.value || (selected.value !== null && !selected.value.is_builtin))
const showEditor = computed(() => isNew.value || selected.value !== null)
const providerModels = computed(() => modelsForProvider(providers, provider.value))
const fieldClass = computed(() => `${inputClass} w-full box-border ${canEdit.value ? 'opacity-100' : 'opacity-[0.55]'}`)

// This is the GLOBAL editor, so it always loads the global list (project_id NULL),
// never the store's project-resolved effective list, which it refreshes after each change.
async function reloadGlobals() {
    const res = await fetch('/api/agent-templates')
    templates.value = res.ok ? await res.json() : []
    layout.refetchAgentTemplates()
}

reloadGlobals()

function clearSelection() {
    selected.value = null
    isNew.value = false
}

async function syncFromDefaults() {
    syncing.value = true
    try {
        await fetch('/api/agent-templates/sync-defaults', { method: 'POST' })
        await reloadGlobals()
        clearSelection()
    } finally {
        syncing.value = false
    }
}

function loadTemplate(tpl: AgentTemplate) {
    selected.value = tpl
    isNew.value = false
    name.value = tpl.name
    description.value = tpl.description ?? ''
    agentType.value = tpl.agent_type
    provider.value = tpl.provider ?? DEFAULT_PROVIDER
    model.value = tpl.model
    systemPrompt.value = tpl.system_prompt ?? ''
    flags.value = { ...(tpl.flags ?? {}) }
    planMode.value = !!tpl.plan_mode
    formError.value = ''
}

function startNew() {
    selected.value = null
    isNew.value = true
    name.value = ''
    description.value = ''
    agentType.value = 'software_engineer'
    provider.value = DEFAULT_PROVIDER
    model.value = modelsForProvider(providers, DEFAULT_PROVIDER)[0] ?? DEFAULT_MODEL
    systemPrompt.value = ''
    flags.value = {}
    planMode.value = false
    formError.value = ''
}

function changeProvider(slug: string) {
    provider.value = slug
    model.value = modelsForProvider(providers, slug)[0] ?? ''
}

function toggleFlag(key: (typeof FLAG_TOGGLES)[number]['key']) {
    flags.value = { ...flags.value, [key]: !flags.value[key] }
}

function setMaxTurns(raw: string) {
    flags.value = { ...flags.value, max_turns: raw ? parseInt(raw, 10) : null }
}

async function saveTemplate() {
    if (!name.value.trim()) {
        formError.value = 'Name is required'
        return
    }
    saving.value = true
    formError.value = ''
    try {
        const body = {
            name: name.value,
            description: description.value,
            agent_type: agentType.value,
            provider: provider.value,
            model: model.value,
            system_prompt: systemPrompt.value,
            flags: flags.value,
            plan_mode: planMode.value,
        }
        const url = isNew.value ? '/api/agent-templates' : `/api/agent-templates/${selected.value!.id}`
        const res = await fetch(url, {
            method: isNew.value ? 'POST' : 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })
        if (!res.ok) {
            const d = await res.json()
            formError.value = d.error ?? 'Save failed'
            return
        }
        const tpl: AgentTemplate = await res.json()
        await reloadGlobals()
        isNew.value = false
        selected.value = tpl
    } finally {
        saving.value = false
    }
}

async function deleteTemplate() {
    if (!selected.value || selected.value.is_builtin) return
    const res = await fetch(`/api/agent-templates/${selected.value.id}`, { method: 'DELETE' })
    if (!res.ok) return
    await reloadGlobals()
    clearSelection()
}
</script>

<template>
    <div class="flex-1 flex overflow-hidden">
        <div class="w-[220px] shrink-0 border-r border-stroke flex flex-col overflow-hidden">
            <div class="p-2.5 border-b border-stroke flex flex-col gap-1.5">
                <button :class="`${submitBtnClass} w-full text-center`" style="padding: 6px 0" @click="startNew">
                    + New Template
                </button>
                <button
                    :disabled="syncing"
                    title="Re-pull code defaults into the built-in templates, overwriting manual edits"
                    :class="`${cancelBtnClass} w-full text-center`"
                    :style="{ padding: '6px 0', opacity: syncing ? 0.6 : 1 }"
                    @click="syncFromDefaults"
                >
                    {{ syncing ? 'Syncing…' : 'Sync from defaults' }}
                </button>
            </div>
            <div class="flex-1 overflow-y-auto">
                <button
                    v-for="tpl in templates"
                    :key="tpl.id"
                    :class="[
                        'w-full text-left border-0 border-l-2 border-solid py-[9px] px-3 cursor-pointer flex flex-col gap-[3px]',
                        !isNew && selected?.id === tpl.id ? 'bg-canvas border-l-accent' : 'bg-transparent border-l-transparent',
                    ]"
                    @click="loadTemplate(tpl)"
                >
                    <div class="flex items-center gap-1.5">
                        <span class="text-zinc-900 text-[12px] font-medium flex-1 truncate">{{ tpl.name }}</span>
                        <span v-if="tpl.is_builtin" class="text-zinc-400 text-[9px] tracking-[0.03em]">built-in</span>
                    </div>
                    <span class="text-[10px]" :style="{ color: AGENT_TYPE_COLORS[tpl.agent_type] ?? color.textFaint }">
                        {{ AGENT_TYPE_LABELS[tpl.agent_type] ?? tpl.agent_type }}
                    </span>
                </button>
            </div>
        </div>

        <div v-if="showEditor" class="flex-1 flex flex-col overflow-hidden">
            <div v-if="selected?.is_builtin" class="py-[7px] px-4 bg-canvas border-b border-stroke text-zinc-500 text-[11px]">
                Built-in templates are read-only.
            </div>
            <div class="flex-1 overflow-y-auto py-[18px] px-5 flex flex-col gap-3.5">
                <span v-if="formError" class="text-danger text-[12px]">{{ formError }}</span>

                <div class="flex gap-2.5">
                    <label class="flex-1 flex flex-col gap-1">
                        <span :class="labelClass">Name *</span>
                        <input v-model="name" :disabled="!canEdit" :class="fieldClass" />
                    </label>
                    <label class="flex-1 flex flex-col gap-1">
                        <span :class="labelClass">Type</span>
                        <select v-model="agentType" :disabled="!canEdit" :class="fieldClass">
                            <option v-for="(label, key) in AGENT_TYPE_LABELS" :key="key" :value="key">{{ label }}</option>
                        </select>
                    </label>
                </div>

                <label class="flex flex-col gap-1">
                    <span :class="labelClass">Description</span>
                    <input
                        v-model="description"
                        :disabled="!canEdit"
                        placeholder="Short description of this template's role…"
                        :class="fieldClass"
                    />
                </label>

                <div class="flex gap-2.5">
                    <label class="w-[160px] flex flex-col gap-1">
                        <span :class="labelClass">Provider</span>
                        <select
                            :value="provider"
                            :disabled="!canEdit"
                            :class="fieldClass"
                            @change="changeProvider(($event.target as HTMLSelectElement).value)"
                        >
                            <option v-for="p in providers" :key="p.slug" :value="p.slug">{{ p.name }}</option>
                        </select>
                    </label>
                    <label class="flex-1 flex flex-col gap-1">
                        <span :class="labelClass">Model</span>
                        <select v-model="model" :disabled="!canEdit" :class="fieldClass">
                            <option v-for="m in providerModels" :key="m" :value="m">{{ m }}</option>
                        </select>
                    </label>
                </div>

                <label class="flex flex-col gap-1">
                    <span :class="labelClass">System Prompt</span>
                    <textarea
                        v-model="systemPrompt"
                        :disabled="!canEdit"
                        placeholder="Instructions passed to Claude when an agent using this template starts…"
                        rows="9"
                        :class="`${fieldClass} resize-y leading-[1.6]`"
                        style="font-family: 'JetBrains Mono', monospace; font-size: 11px"
                    />
                </label>

                <div v-if="canEdit" class="flex flex-col gap-1.5">
                    <span :class="labelClass">Launch Flags</span>
                    <div v-for="flag in FLAG_TOGGLES" :key="flag.key" :class="flagRowClass" @click="toggleFlag(flag.key)">
                        <div>
                            <div class="text-[12px] font-medium text-zinc-700">{{ flag.label }}</div>
                            <div class="text-[10px] text-zinc-400">{{ flag.hint }}</div>
                        </div>
                        <button type="button" :aria-pressed="!!flags[flag.key]" :class="toggleClass(!!flags[flag.key])">
                            <span
                                :class="[
                                    'absolute top-[3px] w-3 h-3 rounded-full bg-white transition-[left] duration-150',
                                    flags[flag.key] ? 'left-[17px]' : 'left-[3px]',
                                ]"
                            />
                        </button>
                    </div>
                    <div :class="flagRowClass" @click="planMode = !planMode">
                        <div>
                            <div class="text-[12px] font-medium text-zinc-700">Plan Mode</div>
                            <div class="text-[10px] text-zinc-400">Read-only — analyse and plan, never edit files</div>
                        </div>
                        <button type="button" :aria-pressed="planMode" :class="toggleClass(planMode)">
                            <span
                                :class="[
                                    'absolute top-[3px] w-3 h-3 rounded-full bg-white transition-[left] duration-150',
                                    planMode ? 'left-[17px]' : 'left-[3px]',
                                ]"
                            />
                        </button>
                    </div>
                    <div :class="`${flagRowClass} gap-3`">
                        <div class="flex-1">
                            <div class="text-[12px] font-medium text-zinc-700">Max Turns</div>
                            <div class="text-[10px] text-zinc-400">--max-turns N — limit conversation turns</div>
                        </div>
                        <input
                            type="number"
                            min="1"
                            max="500"
                            placeholder="∞"
                            :value="flags.max_turns ?? ''"
                            :class="`${inputClass} w-[72px] text-center`"
                            style="padding: 4px 8px"
                            @input="setMaxTurns(($event.target as HTMLInputElement).value)"
                            @click.stop
                        />
                    </div>
                </div>
            </div>
            <div v-if="canEdit" class="py-3 px-5 border-t border-stroke flex gap-2 justify-end shrink-0">
                <button
                    v-if="!isNew"
                    :class="cancelBtnClass"
                    :style="{ color: color.danger, borderColor: color.danger }"
                    @click="deleteTemplate"
                >
                    Delete
                </button>
                <button :disabled="saving" :class="submitBtnClass" :style="{ opacity: saving ? 0.6 : 1 }" @click="saveTemplate">
                    {{ saving ? 'Saving…' : isNew ? 'Create Template' : 'Save Changes' }}
                </button>
            </div>
        </div>
        <div v-else class="flex-1 flex items-center justify-center">
            <span class="text-zinc-400 text-[13px]">Select a template to view, or create a new one</span>
        </div>
    </div>
</template>
