<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { toggleClass } from '@/components/ui/styles'

interface Plugin {
    slug: string
    name: string
    description: string | null
    version: string | null
    path: string | null
    active: boolean
}

const plugins = ref<Plugin[]>([])
const loading = ref(true)
const error = ref('')
// Slugs with an in-flight toggle, so overlapping activate/deactivate requests
// for the same plugin are never fired.
const pending = ref<Record<string, boolean>>({})

onMounted(() => {
    fetch('/api/plugins')
        .then(r => r.json())
        .then(d => { plugins.value = d.data ?? [] })
        .catch(() => { error.value = 'Failed to load plugins' })
        .finally(() => { loading.value = false })
})

function patchPlugin(slug: string, changes: Partial<Plugin>) {
    plugins.value = plugins.value.map(p => (p.slug === slug ? { ...p, ...changes } : p))
}

async function toggle(plugin: Plugin) {
    if (pending.value[plugin.slug]) return
    const next = !plugin.active
    error.value = ''
    pending.value = { ...pending.value, [plugin.slug]: true }
    // Optimistic flip; the server response is authoritative and failures roll back.
    patchPlugin(plugin.slug, { active: next })
    try {
        const res = await fetch(`/api/plugins/${plugin.slug}/${next ? 'activate' : 'deactivate'}`, { method: 'POST' })
        if (!res.ok) throw new Error()
        const d = await res.json()
        patchPlugin(plugin.slug, d.data as Plugin)
    } catch {
        patchPlugin(plugin.slug, { active: plugin.active })
        error.value = `Could not ${next ? 'activate' : 'deactivate'} ${plugin.name}. Please try again.`
    } finally {
        pending.value = { ...pending.value, [plugin.slug]: false }
    }
}
</script>

<template>
    <div class="flex-1 overflow-y-auto py-7 px-8">
        <div class="max-w-[720px] flex flex-col gap-[18px]">
            <div>
                <h3 class="mt-0 mx-0 mb-1.5 text-zinc-900 text-[14px] font-semibold">Plugins</h3>
                <p class="m-0 text-zinc-500 text-[12px] leading-[1.6]">
                    Plugins are auto-discovered from the <code class="font-[monospace] text-accent">plugins/</code> folder.
                    Activate one to mount its routes and expose its tools live — no restart required.
                </p>
            </div>

            <span v-if="error" class="text-danger text-[12px]">{{ error }}</span>

            <div v-if="loading" class="text-zinc-400 text-[12px]">Loading…</div>
            <div
                v-else-if="plugins.length === 0"
                class="border border-dashed border-stroke rounded-md py-8 px-6 text-center text-zinc-400 text-[12px] leading-[1.6]"
            >
                No plugins discovered.<br>
                Drop a folder with a <code class="font-[monospace]">provider.py</code> into <code class="font-[monospace]">plugins/</code>.
            </div>
            <div v-else class="border border-stroke rounded-md overflow-hidden flex flex-col">
                <div
                    v-for="(plugin, i) in plugins"
                    :key="plugin.slug"
                    :data-plugin="plugin.slug"
                    :class="[
                        'flex items-center gap-4 py-3.5 px-[18px] transition-colors duration-150',
                        i === 0 ? '' : 'border-t border-stroke',
                        plugin.active ? 'bg-blue-50' : 'bg-surface',
                    ]"
                >
                    <div class="flex-1 min-w-0">
                        <div class="flex items-baseline gap-2">
                            <span class="text-zinc-900 text-[13px] font-semibold">{{ plugin.name }}</span>
                            <span v-if="plugin.version" class="text-zinc-400 text-[11px] font-mono">v{{ plugin.version }}</span>
                        </div>
                        <p v-if="plugin.description" class="mt-[3px] mx-0 mb-0 text-zinc-500 text-[12px] leading-[1.5]">
                            {{ plugin.description }}
                        </p>
                    </div>

                    <span :class="['text-[11px] font-medium shrink-0', plugin.active ? 'text-success' : 'text-zinc-400']">
                        {{ plugin.active ? 'Active' : 'Inactive' }}
                    </span>

                    <button
                        type="button"
                        :disabled="pending[plugin.slug]"
                        :title="plugin.active ? 'Deactivate' : 'Activate'"
                        :aria-pressed="plugin.active"
                        :class="toggleClass(plugin.active)"
                        :style="{ opacity: pending[plugin.slug] ? 0.5 : 1 }"
                        @click="toggle(plugin)"
                    >
                        <span
                            :class="[
                                'absolute top-[3px] w-3 h-3 rounded-full bg-white transition-[left] duration-150',
                                plugin.active ? 'left-[17px]' : 'left-[3px]',
                            ]"
                        />
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>
