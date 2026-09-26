<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
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

const limitBars = computed(() => {
    const limits = usage.value?.limits
    if (!limits) return []
    const windows = [
        { key: 'five_hour', label: '5h', name: '5-hour limit', window: limits.five_hour },
        { key: 'seven_day', label: 'Week', name: 'Weekly limit', window: limits.seven_day },
    ]
    return windows.flatMap(({ window, ...rest }) =>
        window
            ? [{ ...rest, percent: Math.min(100, Math.round(window.used_percentage)), title: limitDetail(rest.name, window) }]
            : [],
    )
})

function barColor(percent: number): string {
    if (percent >= 90) return 'bg-red-500'
    if (percent >= 70) return 'bg-amber-500'
    return 'bg-emerald-500'
}
</script>

<!--
    Memory is not tracked by Keera yet; its slot is a muted placeholder so the
    bar keeps its final shape.
-->
<template>
    <div
        data-testid="status-bar"
        class="h-6 flex items-center gap-4 px-3 bg-canvas border-t border-stroke text-[11px] text-zinc-500 whitespace-nowrap overflow-hidden"
    >
        <span
            v-if="today"
            data-testid="usage-today"
            class="flex items-center gap-1.5"
            :title="`Claude tokens today in this project\n${tokenBreakdown(today)}`"
        >
            Today {{ formatTokens(today.total) }}
        </span>
        <span
            v-else
            data-testid="usage-placeholder"
            class="flex items-center gap-1.5 text-zinc-400"
            title="No Claude usage recorded today"
        >
            <span class="w-6 h-[5px] rounded-full bg-zinc-200" />
            <span>Usage —</span>
        </span>

        <span
            v-for="bar in limitBars"
            :key="bar.key"
            :data-testid="`limit-${bar.key}`"
            class="flex items-center gap-1.5"
            :title="bar.title"
        >
            {{ bar.label }}
            <span class="w-10 h-[5px] rounded-full bg-zinc-200 overflow-hidden">
                <span :class="['block h-full rounded-full', barColor(bar.percent)]" :style="{ width: `${bar.percent}%` }" />
            </span>
            {{ bar.percent }}%
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
