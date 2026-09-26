import { useQuery } from '@pinia/colada'

export const REMOTE_CONTROL_URL = '/api/settings/remote-control'
export const REMOTE_CONTROL_QUERY_KEY = ['settings', 'remote-control']

async function errorMessage(res: Response, fallback: string): Promise<string> {
    const data = await res.json().catch(() => ({}))
    return data.error ?? fallback
}

async function fetchRemoteControl(): Promise<boolean> {
    const res = await fetch(REMOTE_CONTROL_URL)
    if (!res.ok) throw new Error(await errorMessage(res, 'Could not read the Remote Control setting'))
    return (await res.json()).data.attributes.enabled
}

export async function saveRemoteControl(enabled: boolean): Promise<boolean> {
    const res = await fetch(REMOTE_CONTROL_URL, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
    })
    if (!res.ok) throw new Error(await errorMessage(res, 'Could not save the Remote Control setting'))
    return (await res.json()).data.attributes.enabled
}

/** Claude Code's `remoteControlAtStartup`, read from ~/.claude.json. */
export function useRemoteControlSetting() {
    return useQuery({ key: REMOTE_CONTROL_QUERY_KEY, query: fetchRemoteControl })
}
