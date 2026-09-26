import { defineQueryOptions } from '@pinia/colada'

export type FileContent = { path: string; content: string; etag: string; size: number; encoding: string }
export type SavedFile = { path: string; etag: string; size: number }

export class FileContentError extends Error {
    constructor(
        readonly status: number,
        message: string,
        // Set on 409: the etag of the file as it is now on disk.
        readonly etag?: string,
    ) {
        super(message)
    }
}

// Without Accept: application/json a validation error comes back as a 303
// redirect instead of a 422.
const JSON_HEADERS = { Accept: 'application/json', 'Content-Type': 'application/json' }

const contentUrl = (projectId: number, path: string) =>
    `/api/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`

async function readError(res: Response): Promise<FileContentError> {
    const body = await res.json().catch(() => ({})) as { error?: unknown; detail?: unknown; etag?: string }
    const message = typeof body.error === 'string' ? body.error : `Request failed (${res.status})`
    return new FileContentError(res.status, message, body.etag)
}

export async function fetchFileContent(projectId: number, path: string): Promise<FileContent> {
    const res = await fetch(contentUrl(projectId, path), { headers: JSON_HEADERS })
    if (!res.ok) throw await readError(res)
    return res.json()
}

export async function saveFileContent(
    projectId: number,
    path: string,
    content: string,
    etag: string,
    { keepalive = false } = {},
): Promise<SavedFile> {
    const res = await fetch(contentUrl(projectId, path), {
        method: 'PUT',
        headers: JSON_HEADERS,
        body: JSON.stringify({ content, etag }),
        keepalive,
    })
    if (!res.ok) throw await readError(res)
    return res.json()
}

export const fileContentQuery = defineQueryOptions(({ projectId, path }: { projectId: number; path: string }) => ({
    key: ['projects', projectId, 'files', 'content', path],
    query: () => fetchFileContent(projectId, path),
    // The open buffer is the source of truth once loaded; every read must hit the disk.
    staleTime: 0,
    gcTime: 0,
}))
