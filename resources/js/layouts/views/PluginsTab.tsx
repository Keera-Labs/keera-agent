import { useEffect, useState } from 'react'
import { toggleClass } from '@/components/ui/styles'

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
        <div className="flex-1 overflow-y-auto py-7 px-8">
            <div className="max-w-[720px] flex flex-col gap-[18px]">
                <div>
                    <h3 className="mt-0 mx-0 mb-1.5 text-zinc-900 text-[14px] font-semibold">Plugins</h3>
                    <p className="m-0 text-zinc-500 text-[12px] leading-[1.6]">
                        Plugins are auto-discovered from the <code className="font-[monospace] text-accent">plugins/</code> folder.
                        Activate one to mount its routes and expose its tools live — no restart required.
                    </p>
                </div>

                {error && <span className="text-danger text-[12px]">{error}</span>}

                {loading ? (
                    <div className="text-zinc-400 text-[12px]">Loading…</div>
                ) : plugins.length === 0 ? (
                    <div className="border border-dashed border-stroke rounded-md py-8 px-6 text-center text-zinc-400 text-[12px] leading-[1.6]">
                        No plugins discovered.<br />
                        Drop a folder with a <code className="font-[monospace]">provider.py</code> into <code className="font-[monospace]">plugins/</code>.
                    </div>
                ) : (
                    <div className="border border-stroke rounded-md overflow-hidden flex flex-col">
                        {plugins.map((plugin, i) => {
                            const busy = !!pending[plugin.slug]
                            return (
                                <div
                                    key={plugin.slug}
                                    className={`flex items-center gap-4 py-3.5 px-[18px] transition-colors duration-150 ${i === 0 ? '' : 'border-t border-stroke'} ${plugin.active ? 'bg-blue-50' : 'bg-surface'}`}
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-baseline gap-2">
                                            <span className="text-zinc-900 text-[13px] font-semibold">
                                                {plugin.name}
                                            </span>
                                            {plugin.version && (
                                                <span className="text-zinc-400 text-[11px] font-mono">
                                                    v{plugin.version}
                                                </span>
                                            )}
                                        </div>
                                        {plugin.description && (
                                            <p className="mt-[3px] mx-0 mb-0 text-zinc-500 text-[12px] leading-[1.5]">
                                                {plugin.description}
                                            </p>
                                        )}
                                    </div>

                                    <span className={`text-[11px] font-medium shrink-0 ${plugin.active ? 'text-success' : 'text-zinc-400'}`}>
                                        {plugin.active ? 'Active' : 'Inactive'}
                                    </span>

                                    <button
                                        type="button"
                                        onClick={() => toggle(plugin)}
                                        disabled={busy}
                                        title={plugin.active ? 'Deactivate' : 'Activate'}
                                        aria-pressed={plugin.active}
                                        className={toggleClass(plugin.active)}
                                        style={{ opacity: busy ? 0.5 : 1 }}
                                    >
                                        <span
                                            className={`absolute top-[3px] w-3 h-3 rounded-full bg-white transition-[left] duration-150 ${plugin.active ? 'left-[17px]' : 'left-[3px]'}`}
                                        />
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
