<script setup lang="ts">
import { ref } from 'vue'
import GeneralTab from '@/components/modals/global-settings/GeneralTab.vue'
import PermissionsTab from '@/components/modals/global-settings/PermissionsTab.vue'
import TemplatesTab from '@/components/modals/global-settings/TemplatesTab.vue'

type SettingsTab = 'general' | 'templates' | 'permissions'

const TABS: { id: SettingsTab; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'templates', label: 'Templates' },
    { id: 'permissions', label: 'Default Permissions' },
]

const emit = defineEmits<{ close: [] }>()
const tab = ref<SettingsTab>('general')

function closeOnBackdrop(event: MouseEvent) {
    if (event.target === event.currentTarget) emit('close')
}
</script>

<template>
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-[200]" @click="closeOnBackdrop">
        <div
            role="dialog"
            aria-label="Settings"
            class="bg-modal border border-stroke rounded-lg w-[880px] h-[620px] flex flex-col overflow-hidden"
        >
            <div class="flex items-center py-3.5 px-5 border-b border-stroke gap-3 shrink-0">
                <span class="text-zinc-900 text-[14px] font-semibold">Settings</span>
                <div class="flex gap-1 flex-1">
                    <button
                        v-for="t in TABS"
                        :key="t.id"
                        :class="[
                            'rounded text-[12px] py-1 px-3.5 cursor-pointer border',
                            tab === t.id ? 'bg-canvas border-stroke text-zinc-900' : 'bg-transparent border-transparent text-zinc-500',
                        ]"
                        @click="tab = t.id"
                    >
                        {{ t.label }}
                    </button>
                </div>
                <button
                    aria-label="Close"
                    class="bg-transparent border-none text-zinc-400 cursor-pointer text-[18px] leading-none py-0 px-1"
                    @click="emit('close')"
                >×</button>
            </div>

            <!-- v-show keeps unsaved edits alive across tab switches, as the single-state React modal did. -->
            <GeneralTab v-show="tab === 'general'" />
            <TemplatesTab v-show="tab === 'templates'" />
            <PermissionsTab v-show="tab === 'permissions'" />
        </div>
    </div>
</template>
