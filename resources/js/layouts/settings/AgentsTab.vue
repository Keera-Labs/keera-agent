<script setup lang="ts">
import { onMounted } from 'vue'
import { flagRowClass, inputClass, labelClass, toggleClass } from '@/components/ui/styles'
import { MAX_AGENTS, MIN_AGENTS, useAgentSettingsStore } from '@/stores/agentSettingsStore'
import { useRemoteControlSettingsStore } from '@/stores/remoteControlSettingsStore'

const agents = useAgentSettingsStore()
const remoteControl = useRemoteControlSettingsStore()

onMounted(() => remoteControl.refresh())

function onChange(input: HTMLInputElement) {
    agents.setMaxAgents(Number(input.value))
    // A clamped value equal to the current draft would not re-render, so write it back.
    input.value = String(agents.maxAgents)
}

function toggleRemoteControl() {
    if (remoteControl.ready) remoteControl.setEnabled(!remoteControl.enabled)
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
            <section class="border border-stroke rounded-md bg-canvas p-4 flex flex-col gap-1.5">
                <div :class="flagRowClass" @click="toggleRemoteControl">
                    <div>
                        <div class="text-[12px] font-medium text-zinc-700">Enable Remote Control for all sessions</div>
                        <div class="text-[10px] text-zinc-400">
                            Applies to new Claude sessions; running agents are unaffected.
                        </div>
                    </div>
                    <button
                        type="button"
                        data-testid="remote-control"
                        aria-label="Enable Remote Control for all sessions"
                        :aria-pressed="remoteControl.enabled"
                        :disabled="!remoteControl.ready"
                        :class="[toggleClass(remoteControl.enabled), 'disabled:opacity-50 disabled:cursor-default']"
                    >
                        <span
                            :class="[
                                'absolute top-[3px] w-3 h-3 rounded-full bg-white transition-[left] duration-150',
                                remoteControl.enabled ? 'left-[17px]' : 'left-[3px]',
                            ]"
                        />
                    </button>
                </div>
                <span v-if="remoteControl.loadError" data-testid="remote-control-error" class="text-danger text-[11px]">
                    {{ remoteControl.loadError }}
                </span>
                <span v-else class="text-zinc-400 text-[11px] leading-normal">
                    Saved as <code class="font-mono">remoteControlAtStartup</code> in ~/.claude.json, the same as Claude Code's /config.
                </span>
            </section>
        </div>
    </div>
</template>
