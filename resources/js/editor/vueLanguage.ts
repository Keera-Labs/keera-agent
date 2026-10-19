import type { languages } from 'monaco-editor'

export const VUE_LANGUAGE_ID = 'vue'

const attributes: languages.IMonarchLanguageRule[] = [
    [/"[^"]*"|'[^']*'/, 'attribute.value'],
    [/[\w\-:@#.[\]]+/, 'attribute.name'],
    [/=/, 'delimiter'],
    [/\s+/, ''],
]

function embeddedBlock(tag: 'script' | 'style', langs: Record<string, string>): languages.IMonarchLanguageRule[] {
    const switches: languages.IMonarchLanguageRule[] = Object.entries(langs).map(([lang, mimeType]) => [
        new RegExp(`(lang)(\\s*=\\s*)("${lang}"|'${lang}')`),
        ['attribute.name', 'delimiter', { token: 'attribute.value', switchTo: `@${tag}.${mimeType}` }],
    ])
    return [
        ...switches,
        ...attributes,
        [/>/, { token: 'delimiter', next: `@${tag}Embedded`, nextEmbedded: '$S2' }],
        [new RegExp(`(</)(${tag}\\s*)(>)`), ['delimiter', 'tag', { token: 'delimiter', next: '@pop' }]],
    ]
}

export const vueLanguage: languages.IMonarchLanguage = {
    defaultToken: '',
    tokenPostfix: '.vue',
    ignoreCase: true,
    tokenizer: {
        root: [
            [/<!--/, 'comment', '@comment'],
            [/(<)(script)/, ['delimiter', { token: 'tag', next: '@script.text/javascript' }]],
            [/(<)(style)/, ['delimiter', { token: 'tag', next: '@style.text/css' }]],
            [/(<\/?)([\w\-.:]+)/, ['delimiter', { token: 'tag', next: '@tag' }]],
            [/\{\{/, { token: 'delimiter.bracket', next: '@interpolation', nextEmbedded: 'text/typescript' }],
            [/</, 'delimiter'],
            [/[^<{]+|\{/, ''],
        ],
        comment: [
            [/-->/, 'comment', '@pop'],
            [/[^-]+|-/, 'comment'],
        ],
        tag: [[/\/?>/, 'delimiter', '@pop'], ...attributes],
        interpolation: [
            [/\}\}/, { token: 'delimiter.bracket', next: '@pop', nextEmbedded: '@pop' }],
            [/[^}]+|\}/, ''],
        ],
        script: embeddedBlock('script', { ts: 'text/typescript', tsx: 'text/typescript' }),
        scriptEmbedded: [
            [/<\/script/, { token: '@rematch', next: '@pop', nextEmbedded: '@pop' }],
            [/[^<]+|</, ''],
        ],
        style: embeddedBlock('style', { scss: 'text/x-scss', sass: 'text/x-scss', less: 'text/x-less' }),
        styleEmbedded: [
            [/<\/style/, { token: '@rematch', next: '@pop', nextEmbedded: '@pop' }],
            [/[^<]+|</, ''],
        ],
    },
}

export const vueLanguageConfiguration: languages.LanguageConfiguration = {
    comments: { blockComment: ['<!--', '-->'] },
    brackets: [
        ['<!--', '-->'],
        ['<', '>'],
        ['{', '}'],
        ['(', ')'],
    ],
    autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
    ],
}
