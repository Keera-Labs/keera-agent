<script setup lang="ts">
import { router, usePage } from '@inertiajs/vue3'
import { computed, ref } from 'vue'
import { cancelBtnClass, flagRowClass, inputClass, labelClass, submitBtnClass, toggleClass } from '@/components/ui/styles'
import type { Complexity, ComplexityModels, GlobalSettings } from '@/types/provider'
import { FALLBACK_PROVIDERS, reconcileComplexityModels } from '@/types/provider'

const COMPLEXITY_LABELS: [Complexity, string][] = [
    ['easy', 'Easy'],
    ['medium', 'Medium'],
    ['hard', 'Complex / Hard'],
]

const page = usePage<{ global_settings?: GlobalSettings }>()
const settings = page.props.global_settings
const providers = computed(() => page.props.global_settings?.providers ?? FALLBACK_PROVIDERS)

const models = ref<Record<string, string[]>>(
    Object.fromEntries(providers.value.map(provider => [provider.slug, [...provider.models]])),
)
const defaultProvider = ref(settings?.default_provider === 'claude' ? 'claude' : 'codex')
const enforceDefaultProvider = ref(settings?.enforce_default_provider ?? false)
const complexityModels = ref<Record<string, Partial<ComplexityModels>>>({ ...(settings?.complexity_models ?? {}) })
const saving = ref(false)
const saved = ref(false)
const error = ref('')

function cleanModels(list: string[] | undefined): string[] {
    return (list ?? []).map(model => model.trim()).filter(Boolean)
}

// Re-resolved on every render so a tier never points at a model that was just removed from the list.
function resolvedComplexityModels(slug: string): ComplexityModels {
    return reconcileComplexityModels(slug, cleanModels(models.value[slug]), complexityModels.value[slug] ?? {})
}

function setTier(slug: string, complexity: Complexity, model: string) {
    complexityModels.value = {
        ...complexityModels.value,
        [slug]: { ...resolvedComplexityModels(slug), [complexity]: model },
    }
}

function addModel(slug: string) {
    models.value = { ...models.value, [slug]: [...(models.value[slug] ?? []), ''] }
}

function removeModel(slug: string, index: number) {
    models.value = { ...models.value, [slug]: models.value[slug].filter((_, i) => i !== index) }
}

async function save() {
    saving.value = true
    saved.value = false
    error.value = ''
    try {
        const response = await fetch('/api/global-settings', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                provider_models: Object.fromEntries(
                    providers.value.map(provider => [provider.slug, cleanModels(models.value[provider.slug])]),
                ),
                default_provider: defaultProvider.value,
                enforce_default_provider: enforceDefaultProvider.value,
                complexity_models: Object.fromEntries(
                    providers.value.map(provider => [provider.slug, resolvedComplexityModels(provider.slug)]),
                ),
            }),
        })
        const data = await response.json()
        if (!response.ok) { error.value = data.error ?? 'Save failed'; return }
        models.value = data.provider_models
        defaultProvider.value = data.default_provider
        enforceDefaultProvider.value = data.enforce_default_provider
        complexityModels.value = data.complexity_models
        saved.value = true
        router.reload({ only: ['global_settings'] })
    } catch {
        error.value = 'Network error'
    } finally {
        saving.value = false
    }
}
</script>

<template>
    <div class="flex-1 overflow-y-auto p-6">
        <div class="max-w-[680px] flex flex-col gap-4">
            <div>
                <h2 class="m-0 text-zinc-900 text-[15px] font-semibold">Provider settings</h2>
                <p class="mt-1 mb-0 text-zinc-500 text-[12px]">
                    Choose the default provider, each provider's models, and the model used for each task complexity.
                </p>
            </div>
            <span v-if="error" class="text-danger text-[12px]">{{ error }}</span>
            <section class="border border-stroke rounded-md bg-canvas p-4 flex flex-col gap-3">
                <label class="flex flex-col gap-1.5 max-w-[320px]">
                    <span :class="labelClass">Default provider</span>
                    <select v-model="defaultProvider" aria-label="Default provider" :class="inputClass">
                        <option v-for="provider in providers" :key="provider.slug" :value="provider.slug">{{ provider.name }}</option>
                    </select>
                </label>
                <div :class="flagRowClass" @click="enforceDefaultProvider = !enforceDefaultProvider">
                    <div>
                        <div class="text-[12px] font-medium text-zinc-700">Enforce default provider</div>
                        <div class="text-[10px] text-zinc-400">New agents must use the configured default provider.</div>
                    </div>
                    <button
                        type="button"
                        aria-label="Enforce default provider"
                        :aria-pressed="enforceDefaultProvider"
                        :class="toggleClass(enforceDefaultProvider)"
                    >
                        <span
                            :class="[
                                'absolute top-[3px] w-3 h-3 rounded-full bg-white transition-[left] duration-150',
                                enforceDefaultProvider ? 'left-[17px]' : 'left-[3px]',
                            ]"
                        />
                    </button>
                </div>
            </section>
            <section
                v-for="provider in providers"
                :key="provider.slug"
                class="border border-stroke rounded-md bg-canvas p-4 flex flex-col gap-2.5"
            >
                <div class="flex items-center justify-between">
                    <span class="text-zinc-900 text-[13px] font-semibold">{{ provider.name }}</span>
                    <span class="font-mono text-zinc-400 text-[10px]">{{ provider.slug }}</span>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <label v-for="[complexity, label] in COMPLEXITY_LABELS" :key="complexity" class="flex flex-col gap-1.5 min-w-0">
                        <span :class="labelClass">{{ label }}</span>
                        <select
                            :aria-label="`${provider.name} ${label} model`"
                            :value="resolvedComplexityModels(provider.slug)[complexity]"
                            :class="[inputClass, 'w-full']"
                            @change="setTier(provider.slug, complexity, ($event.target as HTMLSelectElement).value)"
                        >
                            <option v-for="model in cleanModels(models[provider.slug])" :key="model" :value="model">{{ model }}</option>
                        </select>
                    </label>
                </div>
                <span :class="labelClass">Models</span>
                <div v-for="(model, index) in models[provider.slug] ?? []" :key="`${provider.slug}-${index}`" class="flex gap-2">
                    <input
                        v-model="models[provider.slug][index]"
                        :aria-label="`${provider.name} model ${index + 1}`"
                        :class="[inputClass, 'flex-1']"
                    >
                    <button
                        type="button"
                        :class="[cancelBtnClass, 'w-9']"
                        :aria-label="`Remove ${model}`"
                        @click="removeModel(provider.slug, index)"
                    >×</button>
                </div>
                <button type="button" :class="[cancelBtnClass, 'self-start']" @click="addModel(provider.slug)">+ Add model</button>
            </section>
            <button type="button" :disabled="saving" :class="[submitBtnClass, 'self-start min-w-[130px]']" @click="save">
                {{ saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save provider settings' }}
            </button>
        </div>
    </div>
</template>
