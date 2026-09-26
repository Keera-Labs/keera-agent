<script setup lang="ts">
import TagInput from '@/components/ui/TagInput.vue'
import { color } from '@/tokens'

const allow = defineModel<string[]>('allow', { required: true })
const deny = defineModel<string[]>('deny', { required: true })

defineProps<{
    subtitle: string
    loading: boolean
    fetching?: boolean
    error: string
}>()

const emit = defineEmits<{ submit: []; close: [] }>()

defineSlots<{ title(): unknown }>()
</script>

<template>
    <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]">
        <div class="bg-[#1c1f26] border border-[#2a2f3a] rounded-md p-6 w-[480px] flex flex-col gap-3.5 shadow-[0_16px_48px_rgba(0,0,0,0.5)]">
            <form class="flex flex-col gap-3.5" @submit.prevent="emit('submit')">
                <div>
                    <h2 class="mt-0 mx-0 mb-1 text-[#f0f6fc] text-[15px] font-semibold">
                        <slot name="title" />
                    </h2>
                    <p class="m-0 text-[#8b949e] text-[11px]">{{ subtitle }}</p>
                </div>
                <span v-if="error" class="text-danger text-[12px]">{{ error }}</span>
                <div class="flex flex-col gap-1">
                    <span class="text-[#8b949e] text-[11px] uppercase tracking-[0.05em]">Allow</span>
                    <TagInput
                        v-model="allow"
                        :placeholder="fetching ? '' : 'Type a rule and press Enter…'"
                        :disabled="fetching"
                        :tag-color="color.success"
                    />
                </div>
                <div class="flex flex-col gap-1">
                    <span class="text-[#8b949e] text-[11px] uppercase tracking-[0.05em]">Deny</span>
                    <TagInput
                        v-model="deny"
                        :placeholder="fetching ? '' : 'Type a rule and press Enter…'"
                        :disabled="fetching"
                        :tag-color="color.danger"
                    />
                </div>
                <p class="m-0 text-[#6e7681] text-[10px] leading-normal">
                    Rules follow Claude Code syntax, e.g. <code class="font-mono text-[#8b949e]">Bash(*)</code>,
                    <code class="font-mono text-[#8b949e]">Bash(npm run *)</code>,
                    <code class="font-mono text-[#8b949e]">Read</code>.
                    Press Enter to add. Leave both empty to rely on interactive prompts.
                </p>
                <div class="flex gap-2 justify-end">
                    <button
                        type="button"
                        class="bg-transparent border border-[#2a2f3a] rounded text-[#8b949e] text-[12px] py-1.5 px-3.5 cursor-pointer"
                        @click="emit('close')"
                    >Cancel</button>
                    <button
                        type="submit"
                        :disabled="fetching || loading"
                        :class="[
                            'bg-blue-600 border-0 rounded text-white text-[12px] font-semibold py-1.5 px-3.5',
                            fetching || loading ? 'cursor-default' : 'cursor-pointer',
                            loading ? 'opacity-70' : 'opacity-100',
                        ]"
                    >
                        {{ loading ? 'Saving…' : 'Save' }}
                    </button>
                </div>
            </form>
        </div>
    </div>
</template>
