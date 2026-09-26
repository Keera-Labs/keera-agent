<script setup lang="ts">
import { computed } from 'vue'
import { flagRowClass, inputClass, labelClass, toggleClass } from '@/components/ui/styles'
import type { AgentFlags } from '@/queries/agentQuery'

const flags = defineModel<AgentFlags>('flags', { required: true })
const planMode = defineModel<boolean>('planMode', { required: true })

type Toggle = { key: string; label: string; hint: string; title: string; on: boolean; toggle: () => void }

function setFlag(key: keyof AgentFlags, value: boolean | number | null) {
    flags.value = { ...flags.value, [key]: value }
}

const toggles = computed<Toggle[]>(() => [
    {
        key: 'skip',
        label: 'Skip Permissions',
        hint: '--dangerously-skip-permissions — no prompts',
        title: 'Toggle --dangerously-skip-permissions',
        on: !!flags.value.dangerously_skip_permissions,
        toggle: () => setFlag('dangerously_skip_permissions', !flags.value.dangerously_skip_permissions),
    },
    {
        key: 'plan',
        label: 'Plan Mode',
        hint: 'Read-only — analyse and plan, never edit files',
        title: 'Toggle plan mode',
        on: planMode.value,
        toggle: () => { planMode.value = !planMode.value },
    },
    {
        key: 'verbose',
        label: 'Verbose',
        hint: '--verbose — detailed claude output',
        title: 'Toggle --verbose',
        on: !!flags.value.verbose,
        toggle: () => setFlag('verbose', !flags.value.verbose),
    },
])

function onMaxTurns(e: Event) {
    const value = (e.target as HTMLInputElement).value
    setFlag('max_turns', value ? parseInt(value, 10) : null)
}
</script>

<template>
    <div class="flex flex-col gap-1.5">
        <span :class="labelClass">Launch Options</span>

        <div v-for="t in toggles" :key="t.key" :class="flagRowClass" @click="t.toggle">
            <div>
                <div class="text-[12px] font-medium text-zinc-700">{{ t.label }}</div>
                <div class="text-[10px] text-zinc-400">{{ t.hint }}</div>
            </div>
            <button
                type="button"
                :class="toggleClass(t.on)"
                :title="t.title"
                :aria-pressed="t.on"
                @click.stop="t.toggle"
            >
                <span
                    class="absolute top-[3px] w-3 h-3 rounded-full bg-white transition-[left] duration-150"
                    :style="{ left: t.on ? '17px' : '3px' }"
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
                :min="1"
                :max="500"
                placeholder="∞"
                :value="flags.max_turns ?? ''"
                :class="[inputClass, 'w-[72px] text-center']"
                style="padding: 4px 8px"
                @input="onMaxTurns"
            >
        </div>
    </div>
</template>
