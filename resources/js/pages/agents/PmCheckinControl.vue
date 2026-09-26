<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { useAgentCheckin } from '@/queries/agentCheckinQuery'

/**
 * Start/stop toggle + interval input for the PM check-in scheduler. Used for
 * the PM agent only — as a full block on the overview card, or via `compact`
 * inline in the agent detail header. The scheduler pings the PM every N
 * minutes while a task is in_progress and auto-stops once none remain.
 */
const props = withDefaults(defineProps<{ agentId: number; compact?: boolean }>(), { compact: false })

const { checkin, update } = useAgentCheckin(() => props.agentId)
const { mutate, isLoading: updating } = update

const minutes = ref(5)

// Follow the server value whenever it changes (initial load, auto-stop, or another tab toggling it).
watch(() => checkin.value?.interval_minutes, value => {
    if (value !== undefined) minutes.value = value
}, { immediate: true })

const running = computed(() => checkin.value?.running ?? false)

function toggle() {
    mutate({ enabled: !running.value, interval_minutes: Math.max(1, minutes.value) })
}

function onMinutesInput(e: Event) {
    minutes.value = Number((e.target as HTMLInputElement).value)
}

const toggleTone = computed(() =>
    running.value ? 'bg-transparent border-stroke text-zinc-700' : 'bg-[#111318] border-transparent text-white',
)
const dotColor = computed(() => (running.value ? '#16a34a' : '#d4d4d8'))
</script>

<template>
    <!-- Compact: single row inline with the agent detail header chrome. -->
    <div v-if="props.compact" class="flex items-center gap-1.5">
        <span
            class="w-1.5 h-1.5 rounded-full shrink-0"
            :style="{ background: dotColor }"
            :title="running ? 'Check-in running' : 'Check-in stopped'"
        />
        <label class="flex items-center gap-1 text-[11px] text-zinc-500">
            Every
            <input
                type="number"
                :min="1"
                :max="1440"
                :value="minutes"
                :disabled="running"
                class="w-10 border border-stroke rounded py-0.5 px-1 text-[11px] text-zinc-900 disabled:bg-zinc-100 disabled:text-zinc-400"
                @input="onMinutesInput"
            >
            min
        </label>
        <button
            type="button"
            :disabled="updating"
            :title="running ? 'Stop PM check-in' : 'Start PM check-in'"
            :class="['inline-flex items-center gap-1 rounded-md py-1 px-2 text-[11px] font-semibold border cursor-pointer transition-opacity duration-100 hover:opacity-[0.85] disabled:opacity-50', toggleTone]"
            @click="toggle"
        >
            <Icon :name="running ? 'square' : 'play'" :size="11" />
            {{ running ? 'Stop' : 'Start' }}
        </button>
    </div>

    <div v-else class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
            <span class="text-[10px] font-semibold uppercase tracking-[0.07em] text-zinc-400">
                PM Check-in
            </span>
            <span
                class="inline-flex items-center gap-1.5 text-[11px] font-semibold"
                :style="{ color: running ? '#16a34a' : '#a1a1aa' }"
            >
                <span class="w-1.5 h-1.5 rounded-full" :style="{ background: dotColor }" />
                {{ running ? 'Running' : 'Stopped' }}
            </span>
        </div>

        <div class="flex items-center gap-2">
            <label class="flex items-center gap-1.5 text-[12.5px] text-zinc-600">
                Every
                <input
                    type="number"
                    :min="1"
                    :max="1440"
                    :value="minutes"
                    :disabled="running"
                    class="w-14 border border-stroke rounded-md py-1 px-2 text-[12.5px] text-zinc-900 disabled:bg-zinc-100 disabled:text-zinc-400"
                    @input="onMinutesInput"
                >
                min
            </label>

            <button
                type="button"
                :disabled="updating"
                :class="['ml-auto inline-flex items-center gap-1.5 rounded-md py-1.5 px-3 text-[12.5px] font-semibold border cursor-pointer transition-opacity duration-100 hover:opacity-[0.85] disabled:opacity-50', toggleTone]"
                @click="toggle"
            >
                <Icon :name="running ? 'square' : 'play'" :size="12" />
                {{ running ? 'Stop' : 'Start' }}
            </button>
        </div>
    </div>
</template>
