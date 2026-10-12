import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWorktreeFiles, saveWorktreeFiles } from './worktreeFilesQuery'

const respond = (status: number, body: unknown) =>
    Promise.resolve({ ok: status < 400, status, json: async () => body } as Response)

afterEach(() => vi.unstubAllGlobals())

describe('worktreeFilesQuery', () => {
    it('reads the paths from the resource document', async () => {
        vi.stubGlobal('fetch', vi.fn(() => respond(200, { data: { paths: ['.env'] } })))

        expect(await fetchWorktreeFiles(7)).toEqual(['.env'])
        expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/projects/7/worktree-files')
    })

    it('saves the paths with PUT and returns the stored list', async () => {
        vi.stubGlobal('fetch', vi.fn(() => respond(200, { data: { paths: ['.env', 'storage'] } })))

        expect(await saveWorktreeFiles(7, ['.env', 'storage'])).toEqual(['.env', 'storage'])
        expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({
            method: 'PUT',
            body: JSON.stringify({ paths: ['.env', 'storage'] }),
        })
    })

    it('surfaces the validation message of a rejected path', async () => {
        vi.stubGlobal('fetch', vi.fn(() => respond(422, {
            detail: [{ msg: "Value error, '../.env' must be a path relative to the project root" }],
        })))

        await expect(saveWorktreeFiles(7, ['../.env'])).rejects.toThrow("'../.env' must be a path relative to the project root")
    })

    it('falls back to a generic message for other failures', async () => {
        vi.stubGlobal('fetch', vi.fn(() => respond(500, null)))

        await expect(saveWorktreeFiles(7, [])).rejects.toThrow('Failed to save worktree files')
    })
})
