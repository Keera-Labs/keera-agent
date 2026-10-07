import { ref, shallowReactive, toValue, type MaybeRefOrGetter } from 'vue'

export type FileEntry = { name: string; path: string; type: 'dir' | 'file' }

type Listing = { entries: FileEntry[]; truncated: boolean }

export type TreeRow =
    | { kind: 'entry'; entry: FileEntry; depth: number; expanded: boolean; loading: boolean }
    | { kind: 'notice'; key: string; depth: number; text: string; tone: 'muted' | 'error' }

const ROOT = ''

// Names conventionally excluded from version control, used only to mute them.
// Hiding happens in the backend listing, which asks git (Settings > Editor > Files).
const IGNORED_NAMES = new Set([
    '__pycache__', 'node_modules', '.venv', 'venv', '.idea', '.vscode', '.worktrees',
    '.pytest_cache', '.ruff_cache', '.mypy_cache', '.DS_Store', 'dist', 'build',
])

export const isIgnored = (name: string) => IGNORED_NAMES.has(name)
export const isMuted = (name: string) => name.startsWith('.') || isIgnored(name)

const STATUS_MESSAGES: Record<number, string> = {
    400: 'Invalid path',
    403: 'Permission denied',
    404: 'Folder not found',
}

export class ListingError extends Error {}

export async function fetchDirectory(projectId: number, path: string): Promise<Listing> {
    const res = await fetch(`/api/projects/${projectId}/files?path=${encodeURIComponent(path)}`)
    if (!res.ok) throw new ListingError(STATUS_MESSAGES[res.status] ?? 'Could not load files')
    const { entries, truncated } = (await res.json()) as Listing
    return { entries, truncated }
}

const errorMessage = (e: unknown) => (e instanceof ListingError ? e.message : 'Could not load files')

/** Lazily loaded directory tree of a project: a folder's entries are fetched on first expand. */
export function useFileTree(projectId: MaybeRefOrGetter<number>) {
    const listings = shallowReactive(new Map<string, Listing>())
    const errors = shallowReactive(new Map<string, string>())
    const expanded = shallowReactive(new Set<string>())
    const loading = shallowReactive(new Set<string>())
    const rootError = ref<string | null>(null)

    async function load(path: string) {
        loading.add(path)
        try {
            listings.set(path, await fetchDirectory(toValue(projectId), path))
            errors.delete(path)
        } catch (e) {
            listings.delete(path)
            errors.set(path, errorMessage(e))
        } finally {
            loading.delete(path)
        }
        rootError.value = errors.get(ROOT) ?? null
    }

    function toggle(entry: FileEntry) {
        if (entry.type !== 'dir') return
        if (expanded.delete(entry.path)) return
        expanded.add(entry.path)
        if (!listings.has(entry.path)) void load(entry.path)
    }

    /** Reload the root and every open folder, dropping cached listings of closed ones. */
    async function refresh() {
        for (const path of [...listings.keys(), ...errors.keys()]) {
            if (path !== ROOT && !expanded.has(path)) {
                listings.delete(path)
                errors.delete(path)
            }
        }
        await Promise.all([ROOT, ...expanded].map(load))
    }

    /**
     * Flatten the loaded tree into rows. With a query, only entries whose name
     * matches (or that contain a loaded match) are kept, and folders holding a
     * match are shown open. Unloaded folders cannot be searched.
     */
    function visibleRows(query: string): TreeRow[] {
        const q = query.trim().toLowerCase()
        const containsMatch = new Map<string, boolean>()

        const nameMatches = (e: FileEntry) => e.name.toLowerCase().includes(q)
        const hasDescendantMatch = (e: FileEntry): boolean => {
            if (e.type !== 'dir') return false
            let found = containsMatch.get(e.path)
            if (found === undefined) {
                found = (listings.get(e.path)?.entries ?? [])
                    .some(c => nameMatches(c) || hasDescendantMatch(c))
                containsMatch.set(e.path, found)
            }
            return found
        }

        const rows: TreeRow[] = []
        const walk = (path: string, depth: number) => {
            const listing = listings.get(path)
            const error = errors.get(path)
            if (error && path !== ROOT) {
                rows.push({ kind: 'notice', key: `${path}#error`, depth, text: error, tone: 'error' })
            }
            for (const entry of listing?.entries ?? []) {
                const descendantMatch = q !== '' && hasDescendantMatch(entry)
                if (q !== '' && !nameMatches(entry) && !descendantMatch) continue
                const isOpen = descendantMatch || expanded.has(entry.path)
                rows.push({ kind: 'entry', entry, depth, expanded: isOpen, loading: loading.has(entry.path) })
                if (isOpen) walk(entry.path, depth + 1)
            }
            if (listing?.truncated) {
                const text = `Showing first ${listing.entries.length} entries`
                rows.push({ kind: 'notice', key: `${path}#truncated`, depth, text, tone: 'muted' })
            }
        }
        walk(ROOT, 0)
        return rows
    }

    return {
        rootError,
        isLoadingRoot: () => loading.has(ROOT) && !listings.has(ROOT),
        toggle,
        refresh,
        visibleRows,
    }
}
