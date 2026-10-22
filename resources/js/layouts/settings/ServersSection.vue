<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { useServers, type KeeraServer, type ServerKind } from '@/queries/serversQuery'

const { servers, isPending, create, update, remove } = useServers()

const editingId = ref<number | null>(null)
const error = ref('')
const form = reactive({ name: '', kind: 'cloud' as ServerKind, base_url: '', token: '' })

const saving = computed(() => create.isLoading.value || update.isLoading.value)
const canSave = computed(() =>
    form.name.trim() !== '' && form.base_url.trim() !== '' && (editingId.value !== null || form.token.trim() !== ''),
)

function reset() {
    editingId.value = null
    Object.assign(form, { name: '', kind: 'cloud', base_url: '', token: '' })
    error.value = ''
}

function edit(server: KeeraServer) {
    editingId.value = server.id
    Object.assign(form, { name: server.name, kind: server.kind, base_url: server.base_url, token: '' })
    error.value = ''
}

async function save() {
    if (!canSave.value || saving.value) return
    const input = { name: form.name.trim(), kind: form.kind, base_url: form.base_url.trim() }
    const token = form.token.trim()
    try {
        if (editingId.value === null) await create.mutateAsync({ ...input, token })
        else await update.mutateAsync({ id: editingId.value, ...input, ...(token ? { token } : {}) })
        reset()
    } catch (err) {
        error.value = err instanceof Error ? err.message : 'Failed to save the server'
    }
}

async function destroy(server: KeeraServer) {
    if (!window.confirm(`Remove ${server.name}? Agents already handed off keep their record.`)) return
    try {
        await remove.mutateAsync(server.id)
        if (editingId.value === server.id) reset()
    } catch (err) {
        error.value = err instanceof Error ? err.message : 'Failed to remove the server'
    }
}

const inputClass = 'h-8 px-2.5 rounded-md border border-stroke bg-white text-ui-12 text-zinc-900 outline-none focus:border-accent'
</script>

<template>
    <div class="flex flex-col gap-5" data-testid="servers-section">
        <div class="flex flex-col gap-1">
            <h2 class="m-0 text-zinc-900 text-ui-16 font-semibold">Servers</h2>
            <p class="m-0 text-zinc-500 text-ui-12">
                Other Keera servers you can push agents to. The token is the target's
                <code class="font-mono">KEERA_HANDOFF_TOKEN</code>; it is stored here and never shown again.
            </p>
        </div>

        <p v-if="isPending" class="m-0 text-ui-12 text-zinc-400">Loading servers…</p>
        <p v-else-if="!servers.length" data-testid="servers-empty" class="m-0 text-ui-12 text-zinc-400">
            No servers yet. Add one below to enable “Push to server” on agents.
        </p>
        <ul v-else class="m-0 p-0 list-none flex flex-col border border-stroke rounded-lg divide-y divide-stroke">
            <li
                v-for="server in servers"
                :key="server.id"
                data-testid="server-row"
                class="flex items-center gap-3 px-3 py-2.5"
            >
                <Icon name="server" :size="15" class="text-zinc-400 shrink-0" />
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                        <span class="text-ui-13 font-medium text-zinc-900 truncate">{{ server.name }}</span>
                        <span class="text-ui-10 uppercase tracking-[0.06em] font-semibold px-1.5 py-px rounded bg-canvas border border-stroke text-zinc-500">
                            {{ server.kind }}
                        </span>
                    </div>
                    <div class="text-ui-12 font-mono text-zinc-500 truncate">{{ server.base_url }}</div>
                </div>
                <button
                    type="button"
                    data-testid="server-edit"
                    class="text-ui-12 text-zinc-600 hover:text-zinc-900 cursor-pointer bg-transparent border-0"
                    @click="edit(server)"
                >Edit</button>
                <button
                    type="button"
                    data-testid="server-remove"
                    :aria-label="`Remove ${server.name}`"
                    class="w-7 h-7 flex items-center justify-center rounded-md text-zinc-400 hover:text-danger hover:bg-black/[0.04] cursor-pointer bg-transparent border-0"
                    @click="destroy(server)"
                >
                    <Icon name="trash-2" :size="14" />
                </button>
            </li>
        </ul>

        <form class="flex flex-col gap-3 border border-stroke rounded-lg p-3 bg-canvas" data-testid="server-form" @submit.prevent="save">
            <h3 class="m-0 text-ui-13 font-semibold text-zinc-900">{{ editingId === null ? 'Add server' : 'Edit server' }}</h3>
            <div class="grid grid-cols-2 gap-3">
                <label class="flex flex-col gap-1 text-ui-11 text-zinc-500">
                    Name
                    <input v-model="form.name" data-testid="server-name" :class="inputClass" placeholder="Cloud box">
                </label>
                <label class="flex flex-col gap-1 text-ui-11 text-zinc-500">
                    Kind
                    <select v-model="form.kind" data-testid="server-kind" :class="inputClass">
                        <option value="local">Local</option>
                        <option value="cloud">Cloud</option>
                    </select>
                </label>
                <label class="flex flex-col gap-1 text-ui-11 text-zinc-500">
                    Base URL
                    <input v-model="form.base_url" data-testid="server-url" :class="inputClass" placeholder="https://keera.example.com">
                </label>
                <label class="flex flex-col gap-1 text-ui-11 text-zinc-500">
                    Token
                    <input
                        v-model="form.token"
                        data-testid="server-token"
                        type="password"
                        autocomplete="off"
                        :class="inputClass"
                        :placeholder="editingId === null ? 'Target handoff token' : 'Leave blank to keep the current token'"
                    >
                </label>
            </div>
            <p v-if="error" data-testid="server-error" class="m-0 text-ui-12 text-danger">{{ error }}</p>
            <div class="flex items-center gap-2 justify-end">
                <button
                    v-if="editingId !== null"
                    type="button"
                    class="rounded-md border border-stroke bg-white px-3 py-1.5 text-ui-12 text-zinc-700 cursor-pointer"
                    @click="reset"
                >Cancel</button>
                <button
                    type="submit"
                    data-testid="server-save"
                    class="rounded-md border border-accent bg-accent px-3 py-1.5 text-ui-12 font-medium text-white cursor-pointer disabled:opacity-50 disabled:cursor-default"
                    :disabled="!canSave || saving"
                >{{ editingId === null ? 'Add server' : 'Save server' }}</button>
            </div>
        </form>
    </div>
</template>
