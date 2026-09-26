<script setup lang="ts">
import { router, usePage } from '@inertiajs/vue3'
import { ref } from 'vue'
import { cancelBtnClass, inputClass, labelClass, submitBtnClass } from '@/components/ui/styles'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { FALLBACK_PROVIDERS, type GlobalSettings } from '@/types/provider'

// Seeded from Inertia props, so the tab needs no fetch of its own.
const page = usePage<{ global_settings?: GlobalSettings }>()
const settings = page.props.global_settings
const providers = settings?.providers ?? FALLBACK_PROVIDERS
const layout = useAppLayoutStore()

const maxAgents = ref(settings?.max_agents_per_project ?? 10)
const enforceDefaultProvider = ref(settings?.enforce_default_provider ?? false)
const providerModels = ref<Record<string, string[]>>(
    Object.fromEntries(providers.map(provider => [provider.slug, [...provider.models]])),
)
const saving = ref(false)
const saved = ref(false)
const error = ref('')

function setMaxAgents(raw: string) {
    maxAgents.value = Math.max(1, parseInt(raw, 10) || 1)
}

function addModel(slug: string) {
    providerModels.value[slug] = [...(providerModels.value[slug] ?? []), '']
}

function removeModel(slug: string, index: number) {
    providerModels.value[slug] = providerModels.value[slug].filter((_, i) => i !== index)
}

async function save() {
    saving.value = true
    error.value = ''
    saved.value = false
    try {
        const res = await fetch('/api/global-settings', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                max_agents_per_project: maxAgents.value,
                enforce_default_provider: enforceDefaultProvider.value,
                provider_models: Object.fromEntries(
                    providers.map(provider => [
                        provider.slug,
                        (providerModels.value[provider.slug] ?? []).map(model => model.trim()).filter(Boolean),
                    ]),
                ),
            }),
        })
        const d = await res.json()
        if (!res.ok) {
            error.value = d.error ?? 'Save failed'
            return
        }
        saved.value = true
        setTimeout(() => { saved.value = false }, 2000)
        // Set immediately so the add-agent limit warning updates before the reload lands.
        layout.maxAgentsPerProject = d.max_agents_per_project ?? maxAgents.value
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
        <div class="flex flex-col gap-5 max-w-[620px]">
            <p class="m-0 text-zinc-500 text-[11px]">Global settings that apply across all projects.</p>
            <span v-if="error" class="text-danger text-[12px]">{{ error }}</span>
            <label class="flex flex-col gap-1">
                <span :class="labelClass">Max agents per project</span>
                <input
                    type="number"
                    min="1"
                    max="100"
                    :value="maxAgents"
                    :class="`${inputClass} w-[120px]`"
                    @input="setMaxAgents(($event.target as HTMLInputElement).value)"
                />
                <span class="text-zinc-400 text-[10px] leading-normal">
                    Maximum number of agents (excluding deleted) allowed in a single project. Default: 10.
                </span>
            </label>
            <div class="h-px bg-stroke" />
            <label class="flex items-start gap-2.5 cursor-pointer">
                <input v-model="enforceDefaultProvider" type="checkbox" class="mt-0.5" />
                <span class="flex flex-col gap-0.5">
                    <span :class="labelClass">Enforce default provider</span>
                    <span class="text-zinc-400 text-[10px] leading-normal">New agents must use the configured default provider.</span>
                </span>
            </label>
            <div class="h-px bg-stroke" />
            <div class="flex flex-col gap-3">
                <div>
                    <div class="text-zinc-800 text-[12px] font-semibold">Provider models</div>
                    <p class="m-0 mt-1 text-zinc-400 text-[10px] leading-normal">
                        These model identifiers appear in agent and template forms.
                    </p>
                </div>
                <div
                    v-for="provider in providers"
                    :key="provider.slug"
                    class="rounded-md border border-stroke bg-canvas p-3 flex flex-col gap-2"
                >
                    <div class="flex items-center justify-between">
                        <span class="text-zinc-800 text-[12px] font-medium">{{ provider.name }}</span>
                        <span class="text-zinc-400 text-[10px] font-mono">{{ provider.slug }}</span>
                    </div>
                    <div v-for="(model, index) in providerModels[provider.slug] ?? []" :key="`${provider.slug}-${index}`" class="flex gap-1.5">
                        <input
                            v-model="providerModels[provider.slug][index]"
                            :aria-label="`${provider.name} model ${index + 1}`"
                            :class="`${inputClass} flex-1 font-mono text-[11px]`"
                        />
                        <button
                            type="button"
                            :class="`${cancelBtnClass} w-8`"
                            :aria-label="`Remove ${model}`"
                            @click="removeModel(provider.slug, index)"
                        >×</button>
                    </div>
                    <button type="button" :class="`${cancelBtnClass} self-start`" @click="addModel(provider.slug)">+ Add model</button>
                </div>
            </div>
            <div>
                <button
                    :disabled="saving"
                    :class="`${submitBtnClass} min-w-[120px]`"
                    :style="{ opacity: saving ? 0.6 : 1 }"
                    @click="save"
                >
                    {{ saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Settings' }}
                </button>
            </div>
        </div>
    </div>
</template>
