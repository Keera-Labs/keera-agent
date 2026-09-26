<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Pusher from 'pusher-js'

interface BroadcastMessage {
    id: number
    event: string
    data: Record<string, unknown>
    receivedAt: Date
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

const CHANNEL_NAME = 'broadcasting-poc'

const PIPELINE_STEPS = ['Browser POST /api/broadcasting/ping', 'FastAPI broadcasts PingEvent', 'Reverb WebSocket', 'UI event log']

const STATUS_COLORS: Record<ConnectionStatus, { bg: string; text: string; dot: string }> = {
    connecting:   { bg: '#fef9c3', text: '#a16207', dot: '#eab308' },
    connected:    { bg: '#dcfce7', text: '#15803d', dot: '#22c55e' },
    disconnected: { bg: '#f1f5f9', text: '#64748b', dot: '#94a3b8' },
    error:        { bg: '#fee2e2', text: '#b91c1c', dot: '#ef4444' },
}

const status = ref<ConnectionStatus>('connecting')
const messages = ref<BroadcastMessage[]>([])
const input = ref('')
const sending = ref(false)
const error = ref<string | null>(null)
const bottom = ref<HTMLElement | null>(null)

const statusColor = computed(() => STATUS_COLORS[status.value])
const canPing = computed(() => !sending.value && status.value === 'connected')

let pusher: Pusher | null = null
let nextId = 0

onMounted(() => {
    const { hostname, port } = window.location
    pusher = new Pusher('local', {
        wsHost: hostname,
        wsPort: port ? Number(port) : 80,
        forceTLS: false,
        enabledTransports: ['ws'],
        cluster: 'mt1',
        wsPath: '/reverb',
    })

    pusher.connection.bind('connecting', () => { status.value = 'connecting' })
    pusher.connection.bind('connected', () => {
        status.value = 'connected'
        error.value = null
    })
    pusher.connection.bind('disconnected', () => { status.value = 'disconnected' })
    pusher.connection.bind('error', (err: unknown) => {
        status.value = 'error'
        error.value = String(err)
    })

    pusher.subscribe(CHANNEL_NAME).bind_global((eventName: string, data: Record<string, unknown>) => {
        if (eventName.startsWith('pusher:') || eventName.startsWith('pusher_internal:')) return
        messages.value = [...messages.value, { id: ++nextId, event: eventName, data, receivedAt: new Date() }]
    })
})

onBeforeUnmount(() => {
    if (!pusher) return
    pusher.channel(CHANNEL_NAME)?.unbind_all()
    pusher.unsubscribe(CHANNEL_NAME)
    pusher.disconnect()
    pusher = null
})

watch(messages, () => bottom.value?.scrollIntoView({ behavior: 'smooth' }), { flush: 'post' })

async function handlePing() {
    const message = input.value.trim() || 'ping'
    sending.value = true
    error.value = null
    try {
        const res = await fetch('/api/broadcasting/ping', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message }),
        })
        if (!res.ok) error.value = `Server error ${res.status}: ${await res.text()}`
        else input.value = ''
    } catch (e) {
        error.value = `Fetch failed: ${e}`
    } finally {
        sending.value = false
    }
}

function formatData(data: Record<string, unknown>) {
    return typeof data?.message === 'string' ? data.message : JSON.stringify(data)
}
</script>

<template>
    <div class="flex flex-col h-full max-w-[720px] mx-auto py-8 px-6 gap-6 box-border">
        <div class="flex items-center gap-3">
            <h1 class="m-0 text-[20px] font-bold text-[#111]">Broadcasting POC</h1>

            <span
                data-testid="connection-status"
                class="inline-flex items-center gap-1.5 py-[3px] px-2.5 rounded-full text-[12px] font-semibold"
                :style="{ background: statusColor.bg, color: statusColor.text }"
            >
                <span
                    class="w-[7px] h-[7px] rounded-full"
                    :style="{
                        background: statusColor.dot,
                        boxShadow: status === 'connected' ? `0 0 0 2px ${statusColor.dot}40` : 'none',
                    }"
                />
                {{ status }}
            </span>

            <span class="text-[12px] text-[#94a3b8] ml-auto">
                channel: <code class="bg-[#f1f5f9] py-px px-[5px] rounded-sm">{{ CHANNEL_NAME }}</code>
            </span>
        </div>

        <p class="m-0 text-[13px] text-[#64748b] leading-[1.6]">
            This page proves the full broadcast pipeline:
            <strong>HTTP POST → server broadcasts event → Reverb WebSocket → UI updates live.</strong>
            Type a message and click <strong>Ping</strong>; the event should appear in the log below within
            milliseconds.
        </p>

        <div class="flex gap-2">
            <input
                v-model="input"
                type="text"
                placeholder='Message (default: "ping")'
                :disabled="sending"
                class="flex-1 py-2 px-3 border border-[#e2e8f0] rounded text-[14px] text-[#1e293b] bg-[#fff] outline-none"
                @keydown.enter="handlePing"
            />
            <button
                :disabled="!canPing"
                :class="[
                    'py-2 px-5 rounded border-none text-white font-semibold text-[14px] transition-colors duration-150',
                    canPing ? 'bg-[#6c47ff] cursor-pointer' : 'bg-[#94a3b8] cursor-not-allowed',
                ]"
                @click="handlePing"
            >
                {{ sending ? 'Sending…' : 'Ping' }}
            </button>
        </div>

        <div v-if="error" class="py-2 px-3 bg-[#fee2e2] border border-[#fca5a5] rounded text-[#b91c1c] text-[13px]">
            ⚠ {{ error }}
        </div>

        <div class="flex-1 overflow-y-auto border border-[#e2e8f0] rounded-md bg-[#f8fafc] min-h-[200px]">
            <div v-if="messages.length === 0" class="p-8 text-center text-[#94a3b8] text-[13px]">
                {{ status === 'connected' ? 'No events yet — click Ping to send one.' : 'Waiting for WebSocket connection…' }}
            </div>
            <table v-else class="w-full border-collapse text-[13px]">
                <thead>
                    <tr class="bg-[#f1f5f9] border-b border-b-[#e2e8f0]">
                        <th class="py-2 px-3 text-left text-[#64748b] font-semibold w-10">#</th>
                        <th class="py-2 px-3 text-left text-[#64748b] font-semibold">Event</th>
                        <th class="py-2 px-3 text-left text-[#64748b] font-semibold">Data</th>
                        <th class="py-2 px-3 text-right text-[#64748b] font-semibold whitespace-nowrap">Received at</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="msg in messages" :key="msg.id" class="border-b border-b-[#e2e8f0] bg-[#fff]">
                        <td class="py-2 px-3 text-[#94a3b8]">{{ msg.id }}</td>
                        <td class="py-2 px-3">
                            <code class="bg-[#ede9fe] text-[#6c47ff] py-px px-1.5 rounded-sm font-semibold">{{ msg.event }}</code>
                        </td>
                        <td class="py-2 px-3 text-[#374151] [word-break:break-word]">{{ formatData(msg.data) }}</td>
                        <td class="py-2 px-3 text-right text-[#94a3b8] [font-variant-numeric:tabular-nums] whitespace-nowrap">
                            {{ msg.receivedAt.toLocaleTimeString() }}
                        </td>
                    </tr>
                </tbody>
            </table>
            <div ref="bottom" />
        </div>

        <div class="flex items-center gap-2 text-[11px] text-[#94a3b8] justify-center py-2">
            <template v-for="(step, i) in PIPELINE_STEPS" :key="step">
                <span v-if="i > 0">→</span>
                <span class="py-[3px] px-2 bg-[#f1f5f9] rounded-sm font-medium text-[#64748b]">{{ step }}</span>
            </template>
        </div>
    </div>
</template>
