<script setup lang="ts">
import { inputClass, labelClass } from '@/components/ui/styles'
import { MAX_AGENTS, MIN_AGENTS, useAgentSettingsStore } from '@/stores/agentSettingsStore'

const agents = useAgentSettingsStore()

function onChange(input: HTMLInputElement) {
    agents.setMaxAgents(Number(input.value))
    // A clamped value equal to the current draft would not re-render, so write it back.
    input.value = String(agents.maxAgents)
}
</script>

<template>
    <div class="flex-1 overflow-y-auto p-6" data-testid="agents-tab">
        <div class="max-w-[680px] flex flex-col gap-4">
            <div>
                <h2 class="m-0 text-zinc-900 text-[15px] font-semibold">Agents</h2>
                <p class="mt-1 mb-0 text-zinc-500 text-[12px]">Limits that apply to agents across all projects.</p>
            </div>
            <section class="border border-stroke rounded-md bg-canvas p-4 flex flex-col gap-1.5">
                <label class="flex flex-col gap-1.5">
                    <span :class="labelClass">Max agents per project</span>
                    <input
                        type="number"
                        data-testid="max-agents"
                        :min="MIN_AGENTS"
                        :max="MAX_AGENTS"
                        :value="agents.maxAgents"
                        :class="[inputClass, 'w-[120px]']"
                        @change="onChange($event.target as HTMLInputElement)"
                    >
                </label>
                <span class="text-zinc-400 text-[11px] leading-normal">
                    Agents that aren't deleted count toward the limit. Default: 10.
                </span>
            </section>
        </div>
    </div>
</template>
