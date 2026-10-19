import createDOMPurify, { type DOMPurify } from 'dompurify'
import { Marked, type Tokens } from 'marked'
import type { MonacoApi } from '@/editor/monaco'

const MARKDOWN_EXTENSION = /\.(md|markdown|mdx)$/i
const ABSOLUTE_IMAGE_SOURCE = /^(https?:)?\/\//i

export function isMarkdownPath(path: string): boolean {
    return MARKDOWN_EXTENSION.test(path)
}

function escapeHtml(text: string): string {
    return text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;')
}

const marked = new Marked({
    gfm: true,
    renderer: {
        html: ({ text }: Tokens.HTML | Tokens.Tag) => escapeHtml(text),
        image({ href, text }: Tokens.Image) {
            if (ABSOLUTE_IMAGE_SOURCE.test(href)) return false
            return `<span class="markdown-image-alt">${escapeHtml(text)}</span>`
        },
    },
})

let purifier: DOMPurify | null = null

function sanitizer(): DOMPurify {
    if (purifier) return purifier
    purifier = createDOMPurify(window)
    purifier.addHook('afterSanitizeAttributes', node => {
        if (node instanceof HTMLAnchorElement && node.hasAttribute('href')) {
            node.setAttribute('target', '_blank')
            node.setAttribute('rel', 'noopener noreferrer')
        }
        if (node instanceof HTMLInputElement) {
            if (node.type !== 'checkbox') node.remove()
            else node.setAttribute('disabled', '')
        }
    })
    return purifier
}

export function renderMarkdown(source: string): string {
    const html = marked.parse(source, { async: false })
    return sanitizer().sanitize(html, {
        USE_PROFILES: { html: true },
        ADD_ATTR: ['target'],
        FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select'],
    })
}

function resolveLanguage(monaco: MonacoApi, name: string): string | null {
    const wanted = name.toLowerCase()
    const match = monaco.languages.getLanguages().find(language =>
        language.id === wanted
        || language.aliases?.some(alias => alias.toLowerCase() === wanted)
        || language.extensions?.includes(`.${wanted}`),
    )
    return match?.id ?? null
}

export async function highlightCodeBlocks(root: HTMLElement, monaco: MonacoApi, theme: string): Promise<void> {
    const blocks = root.querySelectorAll<HTMLElement>('pre > code[class*="language-"]')
    await Promise.all([...blocks].map(block => {
        const name = [...block.classList].find(c => c.startsWith('language-'))?.slice('language-'.length)
        const language = name ? resolveLanguage(monaco, name) : null
        if (!language) return Promise.resolve()
        block.dataset.lang = language
        block.textContent = (block.textContent ?? '').replace(/\n$/, '')
        return monaco.editor.colorizeElement(block, { theme })
    }))
}
