import { useState, useEffect } from 'react'
import { PermissionsEditor } from './PermissionsEditor'

export function DefaultPermissionsModal({ onClose }: { onClose: () => void }) {
    const [allow, setAllow] = useState<string[]>([])
    const [deny,  setDeny]  = useState<string[]>([])
    const [error,   setError]   = useState('')
    const [fetching, setFetching] = useState(true)
    const [saving,   setSaving]   = useState(false)

    useEffect(() => {
        fetch('/api/default-permissions')
            .then(r => r.json())
            .then(d => {
                setAllow(d.allow ?? [])
                setDeny(d.deny ?? [])
            })
            .catch(() => setError('Failed to load defaults'))
            .finally(() => setFetching(false))
    }, [])

    function handleChange(field: 'allow' | 'deny', tags: string[]) {
        if (field === 'allow') setAllow(tags)
        else setDeny(tags)
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError('')
        setSaving(true)
        try {
            const res = await fetch('/api/default-permissions', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ allow, deny }),
            })
            const data = await res.json()
            if (!res.ok) { setError(data.error ?? 'Something went wrong'); return }
            setAllow(data.allow ?? [])
            setDeny(data.deny ?? [])
            onClose()
        } catch {
            setError('Network error')
        } finally {
            setSaving(false)
        }
    }

    return (
        <PermissionsEditor
            title="Default Permissions"
            subtitle="Saved to default_permissions.json and synced to all existing projects."
            allow={allow}
            deny={deny}
            onChange={handleChange}
            loading={saving}
            fetching={fetching}
            error={error}
            onSubmit={handleSubmit}
            onClose={onClose}
        />
    )
}
