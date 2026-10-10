const LANGUAGES_BY_EXTENSION: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    mts: 'typescript',
    cts: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    vue: 'vue',
}

export function languageForPath(path: string): string | null {
    const name = path.split('/').pop() ?? ''
    const dot = name.lastIndexOf('.')
    if (dot <= 0) return null
    return LANGUAGES_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null
}
