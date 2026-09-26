<script setup lang="ts">
import { Head } from '@inertiajs/vue3'
import { ref } from 'vue'
import DefaultPermissionsTab from './DefaultPermissionsTab.vue'
import PluginsTab from './PluginsTab.vue'
import ProvidersTab from './ProvidersTab.vue'
import TemplatesTab from './TemplatesTab.vue'

type SettingsTab = 'providers' | 'templates' | 'permissions' | 'plugins'

const TABS: { key: SettingsTab; label: string }[] = [
    { key: 'providers', label: 'Providers' },
    { key: 'templates', label: 'Templates' },
    { key: 'permissions', label: 'Default Permissions' },
    { key: 'plugins', label: 'Plugins' },
]

const tab = ref<SettingsTab>('providers')
</script>

<template>
    <Head title="Settings" />
    <div class="flex-1 flex flex-col overflow-hidden bg-surface">
        <div class="py-3.5 px-6 border-b border-stroke flex items-center gap-4 shrink-0 bg-canvas">
            <span class="text-zinc-900 text-[15px] font-semibold">Settings</span>
            <div class="flex gap-1">
                <button
                    v-for="t in TABS"
                    :key="t.key"
                    type="button"
                    :data-tab="t.key"
                    :class="[
                        'rounded text-[12px] py-1 px-4 cursor-pointer',
                        tab === t.key
                            ? 'bg-canvas border border-stroke text-zinc-900'
                            : 'bg-transparent border border-transparent text-zinc-500',
                    ]"
                    @click="tab = t.key"
                >{{ t.label }}</button>
            </div>
        </div>

        <ProvidersTab v-if="tab === 'providers'" />
        <TemplatesTab v-else-if="tab === 'templates'" />
        <DefaultPermissionsTab v-else-if="tab === 'permissions'" />
        <PluginsTab v-else />
    </div>
</template>
