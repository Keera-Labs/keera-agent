import { useEffect, useState } from 'react'
import { color } from '@/tokens'
import { toggleStyle } from '@/components/ui/styles'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Plugin {
    slug: string
    name: string
    description: string | null
    version: string | null
    path: string | null
    active: boolean
}

// ─── Plugins tab ──────────────────────────────────────────────────────────────
// WordPress-style list of discovered plugins, each with an activate/deactivate
// toggle. Backed by GET /api/plugins and POST /api/plugins/{slug}/(de)activate.

export default function PluginsTab() {
    const [plugins, setPlugins] = useState<Plugin[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    // Slugs with an in-flight toggle — used to disable the control and avoid
    // firing overlapping activate/deactivate requests for the same plugin.
    const [pending, setPending] = useState<Record<string, boolean>>({})

    useEffect(() => {
        fetch('/api/plugins')
            .then(r => r.json())
            .then(d => setPlugins(d.data ?? []))
            .catch(() => setError('Failed to load plugins'))
            .finally(() => setLoading(false))
    }, [])

    async function toggle(plugin: Plugin) {
        if (pending[plugin.slug]) return
        const next = !plugin.active
        setError('')
        setPending(p => ({ ...p, [plugin.slug]: true }))
        // Optimistic flip so the row reflects the new state immediately; the
        // server response is authoritative and rolls back on failure.
        setPlugins(prev => prev.map(p => (p.slug === plugin.slug ? { ...p, active: next } : p)))
        try {
            const res = await fetch(`/api/plugins/${plugin.slug}/${next ? 'activate' : 'deactivate'}`, {
                method: 'POST',
            })
            if (!res.ok) throw new Error()
            const d = await res.json()
            setPlugins(prev => prev.map(p => (p.slug === plugin.slug ? { ...p, ...(d.data as Plugin) } : p)))
        } catch {
            setPlugins(prev => prev.map(p => (p.slug === plugin.slug ? { ...p, active: plugin.active } : p)))
            setError(`Could not ${next ? 'activate' : 'deactivate'} ${plugin.name}. Please try again.`)
        } finally {
            setPending(p => ({ ...p, [plugin.slug]: false }))
        }
    }

    return (
        <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>
            <div style={{ maxWidth: '720px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
                <div>
                    <h3 style={{ margin: '0 0 6px', color: color.textPrimary, fontSize: '14px', fontWeight: 600 }}>Plugins</h3>
                    <p style={{ margin: 0, color: color.textMuted, fontSize: '12px', lineHeight: 1.6 }}>
                        Plugins are auto-discovered from the <code style={{ fontFamily: 'monospace', color: color.accent }}>plugins/</code> folder.
                        Activate one to mount its routes and expose its tools live — no restart required.
                    </p>
                </div>

                {error && <span style={{ color: color.danger, fontSize: '12px' }}>{error}</span>}

                {loading ? (
                    <div style={{ color: color.textFaint, fontSize: '12px' }}>Loading…</div>
                ) : plugins.length === 0 ? (
                    <div style={{
                        border: `1px dashed ${color.borderMuted}`, borderRadius: '8px',
                        padding: '32px 24px', textAlign: 'center',
                        color: color.textFaint, fontSize: '12px', lineHeight: 1.6,
                    }}>
                        No plugins discovered.<br />
                        Drop a folder with a <code style={{ fontFamily: 'monospace' }}>provider.py</code> into <code style={{ fontFamily: 'monospace' }}>plugins/</code>.
                    </div>
                ) : (
                    <div style={{
                        border: `1px solid ${color.border}`, borderRadius: '8px', overflow: 'hidden',
                        display: 'flex', flexDirection: 'column',
                    }}>
                        {plugins.map((plugin, i) => {
                            const busy = !!pending[plugin.slug]
                            return (
                                <div
                                    key={plugin.slug}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '16px',
                                        padding: '14px 18px',
                                        borderTop: i === 0 ? 'none' : `1px solid ${color.border}`,
                                        background: plugin.active ? color.accentSubtle : color.bgSurface,
                                        transition: 'background 0.15s',
                                    }}
                                >
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                                            <span style={{ color: color.textPrimary, fontSize: '13px', fontWeight: 600 }}>
                                                {plugin.name}
                                            </span>
                                            {plugin.version && (
                                                <span style={{ color: color.textFaint, fontSize: '11px', fontFamily: '"JetBrains Mono", monospace' }}>
                                                    v{plugin.version}
                                                </span>
                                            )}
                                        </div>
                                        {plugin.description && (
                                            <p style={{ margin: '3px 0 0', color: color.textMuted, fontSize: '12px', lineHeight: 1.5 }}>
                                                {plugin.description}
                                            </p>
                                        )}
                                    </div>

                                    <span style={{
                                        fontSize: '11px', fontWeight: 500, flexShrink: 0,
                                        color: plugin.active ? color.success : color.textFaint,
                                    }}>
                                        {plugin.active ? 'Active' : 'Inactive'}
                                    </span>

                                    <button
                                        type="button"
                                        onClick={() => toggle(plugin)}
                                        disabled={busy}
                                        title={plugin.active ? 'Deactivate' : 'Activate'}
                                        aria-pressed={plugin.active}
                                        style={{ ...toggleStyle(plugin.active), opacity: busy ? 0.5 : 1 }}
                                    >
                                        <span style={{
                                            position: 'absolute', top: '3px', left: plugin.active ? '17px' : '3px',
                                            width: '12px', height: '12px', borderRadius: '50%',
                                            background: '#fff', transition: 'left 0.15s',
                                        }} />
                                    </button>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    )
}
