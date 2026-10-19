import { describe, expect, it } from 'vitest'
import { languageForPath } from './languages'

describe('languageForPath', () => {
    it.each([
        ['src/app.ts', 'typescript'],
        ['src/App.tsx', 'typescript'],
        ['vite.config.mts', 'typescript'],
        ['src/index.js', 'javascript'],
        ['src/Button.jsx', 'javascript'],
        ['scripts/build.mjs', 'javascript'],
        ['scripts/legacy.cjs', 'javascript'],
        ['resources/js/pages/Dashboard.vue', 'vue'],
        ['SRC/MAIN.TS', 'typescript'],
    ])('detects %s as %s', (path, language) => {
        expect(languageForPath(path)).toBe(language)
    })

    it.each(['app/models/Project.py', 'README.md', 'Makefile', '.gitignore', 'src/types.d.ts.bak'])(
        'leaves %s to the server or Monaco',
        path => {
            expect(languageForPath(path)).toBeNull()
        },
    )
})
