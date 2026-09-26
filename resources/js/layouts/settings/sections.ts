import type { IconName } from '@/components/ui/Icon.vue'

export type SettingsSectionId =
    | 'ai'
    | 'general'
    | 'editor'
    | 'terminal'
    | 'git'
    | 'workspaces'
    | 'keybindings'
    | 'billing'

export interface SettingsSection {
    id: SettingsSectionId
    label: string
    icon: IconName
    /** Extra words the search box matches, so e.g. "font" finds the Editor. */
    keywords: string
}

export const SETTINGS_SECTIONS: SettingsSection[] = [
    { id: 'ai', label: 'AI Models & Agents', icon: 'asterisk', keywords: 'providers models templates permissions claude codex complexity agents max agents limit' },
    { id: 'general', label: 'General', icon: 'settings', keywords: 'plugins' },
    { id: 'editor', label: 'Editor', icon: 'code', keywords: 'font family size typography monaco preview' },
    { id: 'terminal', label: 'Terminal & Shell', icon: 'terminal', keywords: 'xterm shell font' },
    { id: 'git', label: 'Git & Version Control', icon: 'git-branch', keywords: 'commit branch source control' },
    { id: 'workspaces', label: 'Workspaces & Sync', icon: 'folder', keywords: 'workspace sync' },
    { id: 'keybindings', label: 'Keybindings', icon: 'command', keywords: 'shortcuts keyboard hotkeys' },
    { id: 'billing', label: 'Billing & Limits', icon: 'layout-grid', keywords: 'plan usage limits' },
]

export function isSettingsSection(value: unknown): value is SettingsSectionId {
    return SETTINGS_SECTIONS.some(s => s.id === value)
}

export function filterSections(query: string): SettingsSection[] {
    const needle = query.trim().toLowerCase()
    if (!needle) return SETTINGS_SECTIONS
    return SETTINGS_SECTIONS.filter(s => `${s.label} ${s.keywords}`.toLowerCase().includes(needle))
}
