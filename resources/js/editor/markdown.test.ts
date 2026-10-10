// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { MonacoApi } from '@/editor/monaco'
import { highlightCodeBlocks, isMarkdownPath, renderMarkdown } from './markdown'

function rendered(source: string): HTMLElement {
    const root = document.createElement('div')
    root.innerHTML = renderMarkdown(source)
    return root
}

describe('isMarkdownPath', () => {
    it.each(['README.md', 'docs/Guide.MARKDOWN', 'pages/intro.mdx'])('accepts %s', path => {
        expect(isMarkdownPath(path)).toBe(true)
    })

    it.each(['notes.txt', 'md', 'src/markdown.ts', 'README.md.bak'])('rejects %s', path => {
        expect(isMarkdownPath(path)).toBe(false)
    })
})

describe('renderMarkdown', () => {
    it('renders GitHub-flavoured markdown', () => {
        const root = rendered([
            '# Title',
            '',
            '- [x] done',
            '- [ ] todo',
            '',
            '| a | b |',
            '| - | - |',
            '| 1 | 2 |',
            '',
            '> quoted',
            '',
            '~~gone~~',
        ].join('\n'))

        expect(root.querySelector('h1')?.textContent).toBe('Title')
        const boxes = root.querySelectorAll<HTMLInputElement>('li > input[type="checkbox"]')
        expect([...boxes].map(b => b.checked)).toEqual([true, false])
        expect([...boxes].every(b => b.disabled)).toBe(true)
        expect(root.querySelectorAll('table td')).toHaveLength(2)
        expect(root.querySelector('blockquote')?.textContent?.trim()).toBe('quoted')
        expect(root.querySelector('del')?.textContent).toBe('gone')
    })

    it('shows raw HTML as text instead of rendering it', () => {
        const root = rendered('<script>window.pwned = true</script>\n\nhi <img src=x onerror="alert(1)"> <b>bold</b>')

        expect(root.querySelector('script, img, b')).toBeNull()
        expect(root.textContent).toContain('<script>window.pwned = true</script>')
        expect(root.textContent).toContain('<b>bold</b>')
    })

    it('drops script URLs from links and images', () => {
        const root = rendered('[click](javascript:alert(1)) ![x](javascript:alert(1))')

        expect(root.innerHTML).not.toContain('javascript:')
    })

    it('opens links in a new tab without an opener', () => {
        const link = rendered('[docs](https://example.com/docs)').querySelector('a')

        expect(link?.getAttribute('href')).toBe('https://example.com/docs')
        expect(link?.getAttribute('target')).toBe('_blank')
        expect(link?.getAttribute('rel')).toBe('noopener noreferrer')
    })

    it('shows the alt text of relative images and renders absolute ones', () => {
        const root = rendered('![Diagram](docs/flow.png) ![Badge](https://img.shields.io/badge.svg)')

        expect(root.querySelector('.markdown-image-alt')?.textContent).toBe('Diagram')
        expect([...root.querySelectorAll('img')].map(i => i.getAttribute('src'))).toEqual(['https://img.shields.io/badge.svg'])
    })

    it('escapes markup in relative image alt text', () => {
        const root = rendered('![<b>x</b>](a.png)')

        expect(root.querySelector('b')).toBeNull()
    })
})

describe('highlightCodeBlocks', () => {
    it('colorizes fenced blocks whose language Monaco knows, by id, alias or extension', async () => {
        const root = rendered('```ts\nconst a = 1\n```\n\n```Python\nx = 1\n```\n\n```nope\n?\n```\n\n    indented')
        const colorizeElement = vi.fn((_el: HTMLElement, _options: { theme: string }) => Promise.resolve())
        const monaco = {
            languages: {
                getLanguages: () => [
                    { id: 'typescript', aliases: ['TypeScript'], extensions: ['.ts'] },
                    { id: 'python', aliases: ['Python', 'py'], extensions: ['.py'] },
                ],
            },
            editor: { colorizeElement },
        } as unknown as MonacoApi

        await highlightCodeBlocks(root, monaco, 'github-light')

        expect(colorizeElement.mock.calls.map(([el]) => el.dataset.lang)).toEqual(['typescript', 'python'])
        expect(colorizeElement.mock.calls[0][1]).toEqual({ theme: 'github-light' })
    })
})
