export interface AIProvider {
    slug: string
    name: string
    models: string[]
}

export interface GlobalSettings {
    max_agents_per_project?: number
    providers?: AIProvider[]
}

export const FALLBACK_PROVIDERS: AIProvider[] = [
    { slug: 'codex', name: 'Codex', models: ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'] },
    {
        slug: 'claude',
        name: 'Claude',
        models: ['claude-opus-5', 'claude-opus-4-8', 'claude-sonnet-5', 'claude-fable-5'],
    },
]

export function modelsForProvider(providers: AIProvider[], slug: string): string[] {
    return providers.find(provider => provider.slug === slug)?.models ?? []
}

const COMPLEXITY_MODELS: Record<string, Record<string, string>> = {
    codex: {
        easy: 'gpt-5.6-luna',
        medium: 'gpt-5.6-terra',
        hard: 'gpt-5.6-sol',
    },
    claude: {
        easy: 'claude-sonnet-5',
        medium: 'claude-opus-5',
        hard: 'claude-fable-5',
    },
}

export function modelForProviderComplexity(provider: string, complexity: string): string {
    return COMPLEXITY_MODELS[provider]?.[complexity] ?? ''
}
