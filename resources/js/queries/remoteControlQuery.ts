import { useQuery } from '@pinia/colada'

export const REMOTE_CONTROL_URL = '/api/settings/remote-control'
export const REMOTE_CONTROL_QUERY_KEY = ['settings', 'remote-control']

export interface RemoteControlSetting {
    enabled: boolean
    /** The Claude config file it is saved in; follows CLAUDE_CONFIG_DIR. */
    path: string
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
    const data = await res.json().catch(() => ({}))
    return data.error ?? fallback
}

async function fetchRemoteControl(): Promise<RemoteControlSetting> {
    const res = await fetch(REMOTE_CONTROL_URL)
    if (!res.ok) throw new Error(await errorMessage(res, 'Could not read the Remote Control setting'))
    return (await res.json()).data.attributes
}

export async function saveRemoteControl(enabled: boolean): Promise<RemoteControlSetting> {
    const res = await fetch(REMOTE_CONTROL_URL, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
    })
    if (!res.ok) throw new Error(await errorMessage(res, 'Could not save the Remote Control setting'))
    return (await res.json()).data.attributes
}

/** Claude Code's `remoteControlAtStartup`, read from the Claude config file. */
export function useRemoteControlSetting() {
    return useQuery({ key: REMOTE_CONTROL_QUERY_KEY, query: fetchRemoteControl })
}
