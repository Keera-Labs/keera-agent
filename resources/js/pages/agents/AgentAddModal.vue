<script setup lang="ts">
import { usePage } from '@inertiajs/vue3'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import Modal from '@/components/ui/Modal.vue'
import { cancelBtnClass, inputClass, labelClass, submitBtnClass } from '@/components/ui/styles'
import { normalizeAgent, type AgentFlags } from '@/queries/agentQuery'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { useProjectStore } from '@/stores/projectStore'
import { color } from '@/tokens'
import { AGENT_TYPE_COLORS, AGENT_TYPE_LABELS, type AgentTemplate } from '@/types/agent'
import {
    FALLBACK_PROVIDERS,
    modelForProviderComplexity,
    modelsForProvider,
    savedModelForComplexity,
    type GlobalSettings,
} from '@/types/provider'
import AgentLaunchOptions from './AgentLaunchOptions.vue'

/**
 * Self-contained "Add Agent" modal. Renders its own `trigger` slot and owns
 * the open state via the reusable Modal. Reads the project, templates and
 * agent list from the layout store. Without an active project the trigger is
 * rendered inert (no modal), so callers can still show a disabled button.
 */
const emit = defineEmits<{ openChange: [open: boolean] }>()

const PANEL_CLASS = 'bg-modal border border-stroke rounded-lg p-6 w-[520px] max-h-[90vh] overflow-y-auto flex flex-col'
const DEFAULT_TYPE = 'software_engineer'

const page = usePage<{ global_settings?: GlobalSettings }>()
const layout = useAppLayoutStore()
const { agentTemplates, maxAgentsPerProject } = storeToRefs(layout)
const { activeProject } = storeToRefs(useProjectStore())

const settings = computed(() => page.props.global_settings)
const providers = computed(() => settings.value?.providers ?? FALLBACK_PROVIDERS)
const initialProvider = computed(() => (settings.value?.default_provider === 'claude' ? 'claude' : 'codex'))

const name = ref('')
const agentType = ref(DEFAULT_TYPE)
const description = ref('')
const provider = ref('codex')
const systemPrompt = ref('')
const complexity = ref('medium')
const flags = ref<AgentFlags>({})
const planMode = ref(false)
const selectedTemplateId = ref<number | null>(null)
const error = ref('')
const loading = ref(false)
const isOpen = ref(false)
// Templates load asynchronously; when they were missing on open, the first
// arrival still seeds the blank fields.
let seededFromTemplates = false

const model = computed(() => {
    const saved = savedModelForComplexity(settings.value, provider.value, complexity.value)
    return saved && modelsForProvider(providers.value, provider.value).includes(saved)
        ? saved
        : modelForProviderComplexity(provider.value, complexity.value)
})

const agentCount = computed(() => layout.agentHook.agents.value.length)
const isAtLimit = computed(() => agentCount.value >= maxAgentsPerProject.value)
const isBlankSelected = computed(() => selectedTemplateId.value === null && !systemPrompt.value)
const namePlaceholder = computed(() =>
    agentType.value === 'pm' ? 'e.g. Alice' : agentType.value === 'qa' ? 'e.g. QA Bot' : 'e.g. Dev Agent',
)

/** The builtin template for a type, preferring one without full-auto / plan-mode so its defaults are the natural ones. */
function findBuiltinForType(templates: AgentTemplate[], type: string): AgentTemplate | undefined {
    return templates.find(t => t.is_builtin && t.agent_type === type && !t.flags?.dangerously_skip_permissions && !t.plan_mode)
        ?? templates.find(t => t.is_builtin && t.agent_type === type)
}

function reset() {
    const builtin = findBuiltinForType(agentTemplates.value, DEFAULT_TYPE)
    name.value = ''
    agentType.value = DEFAULT_TYPE
    description.value = builtin?.description ?? ''
    provider.value = initialProvider.value
    systemPrompt.value = builtin?.system_prompt ?? ''
    complexity.value = 'medium'
    flags.value = {}
    planMode.value = false
    selectedTemplateId.value = null
    error.value = ''
    loading.value = false
    seededFromTemplates = agentTemplates.value.length > 0
}

watch(agentTemplates, templates => {
    if (!isOpen.value || seededFromTemplates || templates.length === 0) return
    seededFromTemplates = true
    const tpl = findBuiltinForType(templates, agentType.value)
    if (!tpl) return
    description.value ||= tpl.description ?? ''
    systemPrompt.value ||= tpl.system_prompt ?? ''
    provider.value = tpl.provider ?? 'codex'
})

function onOpenChange(open: boolean) {
    isOpen.value = open
    if (open) reset()
    emit('openChange', open)
}

function applyTemplate(tpl: AgentTemplate | null) {
    if (!tpl) {
        selectedTemplateId.value = null
        agentType.value = DEFAULT_TYPE
        description.value = ''
        provider.value = initialProvider.value
        systemPrompt.value = ''
        flags.value = {}
        planMode.value = false
        return
    }
    selectedTemplateId.value = tpl.id
    agentType.value = tpl.agent_type
    provider.value = tpl.provider ?? 'codex'
    flags.value = tpl.flags ?? {}
    planMode.value = !!tpl.plan_mode
    description.value = tpl.description ?? ''
    systemPrompt.value = tpl.system_prompt ?? ''
}

async function handleSubmit(projectId: number, close: () => void) {
    error.value = ''
    loading.value = true
    try {
        const res = await fetch(`/api/projects/${projectId}/agents`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name.value,
                agent_type: agentType.value,
                description: description.value,
                provider: provider.value,
                model: model.value,
                system_prompt: systemPrompt.value,
                complexity: complexity.value,
                flags: flags.value,
                plan_mode: planMode.value,
            }),
        })
        const data = await res.json()
        if (!res.ok) { error.value = data.error ?? 'Something went wrong'; return }
        layout.agentHook.addAgent(normalizeAgent(data.data))
        close()
    } catch {
        error.value = 'Network error'
    } finally {
        loading.value = false
    }
}

const templateCardClass = (active: boolean) => [
    'py-2 px-2.5 rounded border cursor-pointer shrink-0 min-w-[100px] max-w-[140px] text-left',
    active ? 'border-accent' : 'border-stroke bg-canvas',
]
const activeCardStyle = { background: `${color.accent}18` }
</script>

<template>
    <slot v-if="activeProject?.id == null" name="trigger" />
    <Modal v-else aria-label="Add agent" :panel-class="PANEL_CLASS" @open-change="onOpenChange">
        <template #trigger><slot name="trigger" /></template>
        <template #default="{ close }">
            <form class="flex flex-col gap-3.5" @submit.prevent="handleSubmit(activeProject.id, close)">
                <h2 class="m-0 text-zinc-900 text-[15px] font-semibold">Add Agent</h2>
                <div
                    v-if="isAtLimit"
                    class="text-danger text-[12px] py-2 px-3 rounded"
                    :style="{ background: `${color.danger}14`, border: `1px solid ${color.danger}40` }"
                >
                    Agent limit reached ({{ agentCount }}/{{ maxAgentsPerProject }}). Delete an existing agent before adding a new one.
                </div>
                <span v-if="error" class="text-danger text-[12px]">{{ error }}</span>

                <div v-if="agentTemplates.length > 0" class="flex flex-col gap-1.5">
                    <span :class="labelClass">Template</span>
                    <div class="flex gap-2 overflow-x-auto pb-1">
                        <button
                            type="button"
                            :class="templateCardClass(isBlankSelected)"
                            :style="isBlankSelected ? activeCardStyle : undefined"
                            @click="applyTemplate(null)"
                        >
                            <div class="text-[11px] font-semibold text-zinc-700">Blank</div>
                            <div class="text-[10px] text-zinc-400 mt-0.5">Start from scratch</div>
                        </button>
                        <button
                            v-for="tpl in agentTemplates"
                            :key="tpl.id"
                            type="button"
                            data-testid="template-card"
                            :class="templateCardClass(selectedTemplateId === tpl.id)"
                            :style="selectedTemplateId === tpl.id ? activeCardStyle : undefined"
                            @click="applyTemplate(tpl)"
                        >
                            <div :class="['text-[11px] font-semibold', selectedTemplateId === tpl.id ? 'text-accent' : 'text-zinc-700']">
                                {{ tpl.name }}
                            </div>
                            <div class="text-[10px] mt-0.5" :style="{ color: AGENT_TYPE_COLORS[tpl.agent_type] ?? color.textMuted }">
                                {{ AGENT_TYPE_LABELS[tpl.agent_type] ?? tpl.agent_type }}
                            </div>
                            <div v-if="tpl.flags?.dangerously_skip_permissions || tpl.plan_mode" class="flex gap-[3px] mt-1 flex-wrap">
                                <span
                                    v-if="tpl.flags?.dangerously_skip_permissions"
                                    class="text-[9px] py-px px-1 rounded-[3px] bg-[#ff6b3518] text-[#ff6b35] font-semibold"
                                >FULL AUTO</span>
                                <span
                                    v-if="tpl.plan_mode"
                                    class="text-[9px] py-px px-1 rounded-[3px] text-accent font-semibold"
                                    :style="activeCardStyle"
                                >PLAN ONLY</span>
                            </div>
                        </button>
                    </div>
                </div>

                <label class="flex flex-col gap-1">
                    <span :class="labelClass">Name</span>
                    <input v-model="name" name="name" :placeholder="namePlaceholder" required :class="inputClass">
                </label>

                <label class="flex flex-col gap-1">
                    <span :class="labelClass">Description</span>
                    <input v-model="description" name="description" placeholder="Short description" :class="inputClass">
                </label>

                <div class="flex gap-2.5">
                    <label class="w-[160px] flex flex-col gap-1">
                        <span :class="labelClass">Provider</span>
                        <select v-model="provider" name="provider" :class="inputClass">
                            <option v-for="item in providers" :key="item.slug" :value="item.slug">{{ item.name }}</option>
                        </select>
                    </label>
                    <label class="flex-1 flex flex-col gap-1">
                        <span :class="labelClass">Model (derived)</span>
                        <output :class="[inputClass, 'w-full text-zinc-500 cursor-default']">{{ model }}</output>
                    </label>
                </div>

                <label class="flex flex-col gap-1">
                    <span :class="labelClass">Complexity</span>
                    <select v-model="complexity" name="complexity" :class="inputClass">
                        <option value="easy">Easy</option>
                        <option value="medium">Medium</option>
                        <option value="hard">Hard</option>
                    </select>
                </label>

                <label class="flex flex-col gap-1">
                    <span :class="labelClass">System Prompt</span>
                    <textarea
                        v-model="systemPrompt"
                        name="system_prompt"
                        placeholder="Instructions for this agent…"
                        :rows="6"
                        :class="[inputClass, 'resize-y leading-normal']"
                    />
                </label>

                <AgentLaunchOptions v-model:flags="flags" v-model:plan-mode="planMode" />

                <div class="flex gap-2 justify-end">
                    <button type="button" :class="cancelBtnClass" @click="close">Cancel</button>
                    <button
                        type="submit"
                        :disabled="loading || isAtLimit"
                        :class="submitBtnClass"
                        :style="{ opacity: loading || isAtLimit ? 0.5 : 1, cursor: isAtLimit ? 'not-allowed' : 'pointer' }"
                    >
                        {{ loading ? 'Adding…' : 'Add Agent' }}
                    </button>
                </div>
            </form>
        </template>
    </Modal>
</template>
