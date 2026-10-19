<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { useRefetchInterval } from '@/composables/useRefetchInterval'
import Icon from '@/components/ui/Icon.vue'
import { formatTokens, limitDetail, tokenBreakdown, useProjectUsage } from '@/queries/usageQuery'
import { useAppLayoutStore } from '@/stores/appLayoutStore'
import { useProjectStore } from '@/stores/projectStore'

const layout = useAppLayoutStore()
const { claudeStatus, liveSessionCount } = storeToRefs(layout)

const runningCount = computed(() => Object.values(claudeStatus.value).filter(s => s === 'running').length)

const { activeProject } = storeToRefs(useProjectStore())
const { usage } = useProjectUsage(() => activeProject.value?.id)
const today = computed(() => (usage.value?.today.total ? usage.value.today : null))

const now = ref(Date.now())
useRefetchInterval(() => { now.value = Date.now() }, 30_000)

const limitWindows = computed(() => {
    const grouped = usage.value?.provider_limits
        ?? (usage.value?.limits ? { claude: usage.value.limits } : {})
    return Object.entries(grouped).flatMap(([provider, limits]) => {
        const providerName = provider === 'codex' ? 'Codex' : provider === 'claude' ? 'Claude' : provider
        const windows = [
            { key: 'five_hour', name: '5h limit', window: limits.five_hour, reset: 'clock' as const },
            { key: 'seven_day', name: 'Weekly limit', window: limits.seven_day, reset: 'countdown' as const },
        ]
        return windows.flatMap(({ window, key, name, reset }) =>
            window && (window.resets_at == null || window.resets_at * 1000 > now.value)
                ? [{ key: `${provider}-${key}`, provider, windowKey: key, title: `${providerName}: ${limitDetail(name, window, now.value, reset)}` }]
                : [],
        )
    })
})
</script>

<!--
    Memory is not tracked by Keera yet; its slot is a muted placeholder so the
    bar keeps its final shape.
-->
<template>
    <div
        data-testid="status-bar"
        class="h-6 flex items-center gap-4 px-3 bg-canvas border-t border-stroke text-ui-11 text-zinc-500 whitespace-nowrap overflow-x-auto"
    >
        <span
            v-if="today"
            data-testid="usage-today"
            class="flex items-center gap-1.5"
            :title="`Tokens today in this project\n${tokenBreakdown(today)}`"
        >
            Today {{ formatTokens(today.total) }}
        </span>
        <span
            v-else
            data-testid="usage-placeholder"
            class="flex items-center gap-1.5 text-zinc-400"
            title="No usage recorded today"
        >
            <span class="w-6 h-[5px] rounded-full bg-zinc-200" />
            <span>Usage —</span>
        </span>

        <span
            v-for="bar in limitWindows"
            :key="bar.key"
            :data-testid="`limit-${bar.windowKey}`"
            :data-provider="bar.provider"
            class="flex items-center gap-1.5"
            :title="bar.title"
        >
            {{ bar.title }}
        </span>

        <div class="ml-auto flex items-center gap-4">
            <span
                data-testid="running-count"
                :class="['flex items-center gap-1.5', runningCount > 0 ? 'text-amber-700' : '']"
                :title="`${runningCount} session${runningCount === 1 ? '' : 's'} running`"
            >
                <span :class="['w-1.5 h-1.5 rounded-full', runningCount > 0 ? 'bg-amber-500 animate-pulse' : 'bg-zinc-300']" />
                {{ runningCount }} running
            </span>

            <span class="max-sm:hidden text-zinc-400" title="Memory usage is not tracked yet">— MB</span>

            <span
                data-testid="terminal-count"
                class="flex items-center gap-1"
                :title="`${liveSessionCount} open terminal${liveSessionCount === 1 ? '' : 's'}`"
            >
                <Icon name="terminal" :size="11" />
                {{ liveSessionCount }}
            </span>
        </div>
    </div>
</template>
