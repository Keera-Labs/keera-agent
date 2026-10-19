<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { EDITOR_THEME, loadMonaco } from '@/editor/monaco'
import { highlightCodeBlocks, renderMarkdown } from '@/editor/markdown'

const props = defineProps<{ source: string }>()

const article = ref<HTMLElement | null>(null)
const html = computed(() => renderMarkdown(props.source))

watch(html, async () => {
    await nextTick()
    const root = article.value
    if (!root || !root.querySelector('pre > code[class*="language-"]')) return
    const monaco = await loadMonaco()
    if (article.value === root) await highlightCodeBlocks(root, monaco, EDITOR_THEME)
}, { immediate: true })
</script>

<template>
    <div class="flex-1 min-h-0 overflow-auto bg-surface" data-testid="markdown-preview">
        <article ref="article" class="markdown-preview" v-html="html" />
    </div>
</template>

<style scoped>
.markdown-preview {
    --md-text: #1f2328;
    --md-muted: #59636e;
    --md-border: #d1d9e0;
    --md-subtle: #f6f8fa;
    --md-link: #0969da;
    --md-quote: #59636e;

    max-width: 52rem;
    margin: 0 auto;
    padding: 1.5rem 2rem 3rem;
    color: var(--md-text);
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    line-height: 1.6;
    overflow-wrap: break-word;
}

:global(.dark) .markdown-preview {
    --md-text: #f0f6fc;
    --md-muted: #9198a1;
    --md-border: #3d444d;
    --md-subtle: #151b23;
    --md-link: #4493f8;
    --md-quote: #9198a1;
}

.markdown-preview > :deep(:first-child) { margin-top: 0; }

.markdown-preview :deep(h1),
.markdown-preview :deep(h2),
.markdown-preview :deep(h3),
.markdown-preview :deep(h4),
.markdown-preview :deep(h5),
.markdown-preview :deep(h6) {
    margin: 1.5em 0 0.75em;
    font-weight: 600;
    line-height: 1.25;
}

.markdown-preview :deep(h1) { font-size: 2em; padding-bottom: 0.3em; border-bottom: 1px solid var(--md-border); }
.markdown-preview :deep(h2) { font-size: 1.5em; padding-bottom: 0.3em; border-bottom: 1px solid var(--md-border); }
.markdown-preview :deep(h3) { font-size: 1.25em; }
.markdown-preview :deep(h4) { font-size: 1em; }
.markdown-preview :deep(h5) { font-size: 0.875em; }
.markdown-preview :deep(h6) { font-size: 0.85em; color: var(--md-muted); }

.markdown-preview :deep(p),
.markdown-preview :deep(ul),
.markdown-preview :deep(ol),
.markdown-preview :deep(blockquote),
.markdown-preview :deep(pre),
.markdown-preview :deep(table) {
    margin: 0 0 1em;
}

.markdown-preview :deep(ul) { list-style: disc; padding-left: 2em; }
.markdown-preview :deep(ol) { list-style: decimal; padding-left: 2em; }
.markdown-preview :deep(li + li) { margin-top: 0.25em; }
.markdown-preview :deep(li > ul),
.markdown-preview :deep(li > ol) { margin: 0.25em 0 0; }
.markdown-preview :deep(li:has(> input[type="checkbox"])) { list-style: none; }
.markdown-preview :deep(li > input[type="checkbox"]) { margin: 0 0.4em 0 -1.4em; vertical-align: middle; }

.markdown-preview :deep(a) { color: var(--md-link); text-decoration: none; }
.markdown-preview :deep(a:hover) { text-decoration: underline; }

.markdown-preview :deep(blockquote) {
    padding: 0 1em;
    color: var(--md-quote);
    border-left: 0.25em solid var(--md-border);
}

.markdown-preview :deep(hr) { height: 0.25em; margin: 1.5em 0; background: var(--md-border); border: 0; }

.markdown-preview :deep(code) {
    padding: 0.2em 0.4em;
    font-family: var(--font-mono);
    font-size: 85%;
    background: var(--md-subtle);
    border-radius: 6px;
}

.markdown-preview :deep(pre) {
    padding: 1em;
    overflow: auto;
    line-height: 1.45;
    background: var(--md-subtle);
    border-radius: 6px;
}

.markdown-preview :deep(pre > code) { padding: 0; font-size: 85%; background: transparent; white-space: pre; }

.markdown-preview :deep(table) { display: block; width: max-content; max-width: 100%; overflow: auto; border-collapse: collapse; }
.markdown-preview :deep(th),
.markdown-preview :deep(td) { padding: 0.375em 0.8em; border: 1px solid var(--md-border); }
.markdown-preview :deep(th) { font-weight: 600; }
.markdown-preview :deep(tr:nth-child(2n)) { background: var(--md-subtle); }

.markdown-preview :deep(img) { max-width: 100%; }

.markdown-preview :deep(.markdown-image-alt) {
    padding: 0 0.3em;
    color: var(--md-muted);
    font-style: italic;
    border: 1px dashed var(--md-border);
    border-radius: 4px;
}
</style>
