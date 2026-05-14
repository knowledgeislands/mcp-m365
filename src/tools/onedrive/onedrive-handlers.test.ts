/**
 * Coverage tests for OneDrive handlers.
 */
import { EventEmitter } from 'node:events'
import https from 'node:https'
import type { Mock, MockInstance } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callGraphAPI } from '../../utils/graph-api.js'
import { ensureAuthenticated } from '../auth/index.js'
import { handleDownload } from './download.js'
import { handleCreateFolder, handleDeleteItem } from './folder.js'
import { handleListFiles } from './list.js'
import { handleSearchFiles } from './search.js'
import { handleShare } from './share.js'
import { handleUpload } from './upload.js'
import { handleUploadLarge } from './upload-large.js'

vi.mock('../../utils/graph-api')
vi.mock('../auth')
vi.mock('node:https', () => ({
  default: { request: vi.fn() }
}))

const mockCallGraphAPI = callGraphAPI as Mock
const mockEnsureAuthenticated = ensureAuthenticated as Mock

let consoleErrorSpy: MockInstance

beforeEach(() => {
  mockCallGraphAPI.mockReset()
  mockEnsureAuthenticated.mockReset()
  ;(https.request as unknown as Mock).mockReset()
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
})

describe('handleListFiles', () => {
  it('lists root contents by default', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({
      value: [
        { id: 'a', name: 'doc.md', size: 100, lastModifiedDateTime: '2026-01-01T00:00:00Z' },
        { id: 'b', name: 'Pictures', folder: { childCount: 0 }, lastModifiedDateTime: '2026-01-02T00:00:00Z' }
      ]
    })
    const r = await handleListFiles({})
    expect(mockCallGraphAPI).toHaveBeenCalledWith('tok', 'GET', 'me/drive/root/children', null, expect.any(Object))
    expect(r.content[0].text).toContain('Found 2 items in root')
    expect(r.content[0].text).toContain('[FOLDER]')
    expect(r.content[0].text).toContain('[FILE]')
  })

  it('lists by path', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ value: [{ id: 'x', name: 'x.txt', size: 0, lastModifiedDateTime: '2026-01-01T00:00:00Z' }] })
    await handleListFiles({ path: '/Documents/' })
    expect(mockCallGraphAPI).toHaveBeenCalledWith('tok', 'GET', 'me/drive/root:/Documents:/children', null, expect.any(Object))
  })

  it('reports empty when value is empty', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ value: [] })
    const r = await handleListFiles({})
    expect(r.content[0].text).toBe('No files found in root.')
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleListFiles({})
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles Graph API errors', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error('boom'))
    const r = await handleListFiles({})
    expect(r.content[0].text).toMatch(/Error listing files: boom/)
  })
})

describe('handleSearchFiles', () => {
  it('rejects when query is missing', async () => {
    const r = await handleSearchFiles({})
    expect(r.content[0].text).toBe('Search query is required.')
  })

  it('searches and reports matches', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({
      value: [{ id: 'a', name: 'spec.pdf', size: 4096, lastModifiedDateTime: '2026-01-01T00:00:00Z', parentReference: { path: '/drive/root:/Documents' } }]
    })
    const r = await handleSearchFiles({ query: 'spec' })
    expect(mockCallGraphAPI).toHaveBeenCalledWith('tok', 'GET', "me/drive/search(q='spec')", null, expect.any(Object))
    expect(r.content[0].text).toContain('Found 1 items matching "spec"')
    expect(r.content[0].text).toContain('Path: /Documents')
  })

  it('reports no matches', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ value: [] })
    const r = await handleSearchFiles({ query: 'unknown' })
    expect(r.content[0].text).toBe('No files found matching "unknown".')
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleSearchFiles({ query: 'x' })
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles Graph API errors', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error('boom'))
    const r = await handleSearchFiles({ query: 'x' })
    expect(r.content[0].text).toMatch(/Error searching files: boom/)
  })
})

describe('handleDownload', () => {
  it('rejects when neither itemId nor path is supplied', async () => {
    const r = await handleDownload({})
    expect(r.content[0].text).toBe('Either itemId or path is required.')
  })

  it('returns the download URL by itemId', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ id: 'a', name: 'doc.md', size: 100, '@microsoft.graph.downloadUrl': 'https://blob/x' })
    const r = await handleDownload({ itemId: 'a' })
    expect(r.content[0].text).toContain('Download URL for "doc.md"')
    expect(r.content[0].text).toContain('https://blob/x')
  })

  it('returns the download URL by path', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ id: 'a', name: 'x.txt', size: 0, '@microsoft.graph.downloadUrl': 'https://blob/y' })
    await handleDownload({ path: '/x.txt' })
    expect(mockCallGraphAPI).toHaveBeenCalledWith('tok', 'GET', 'me/drive/root:/x.txt', null, expect.any(Object))
  })

  it('reports a folder is not directly downloadable', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ id: 'a', name: 'Pictures', folder: { childCount: 1 } })
    const r = await handleDownload({ itemId: 'a' })
    expect(r.content[0].text).toMatch(/is a folder and cannot be downloaded/)
  })

  it('reports when no download URL was returned', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ id: 'a', name: 'x' })
    const r = await handleDownload({ itemId: 'a' })
    expect(r.content[0].text).toMatch(/Could not get download URL/)
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleDownload({ itemId: 'a' })
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles Graph API errors', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error('boom'))
    const r = await handleDownload({ itemId: 'a' })
    expect(r.content[0].text).toMatch(/Error getting download URL: boom/)
  })
})

describe('handleUpload', () => {
  it('rejects when path is missing', async () => {
    const r = await handleUpload({ content: 'x' })
    expect(r.content[0].text).toMatch(/Path is required/)
  })

  it('rejects when content is missing', async () => {
    const r = await handleUpload({ path: '/x.txt' })
    expect(r.content[0].text).toBe('Content is required.')
  })

  it('rejects when content exceeds 4MB threshold', async () => {
    const big = 'x'.repeat(5 * 1024 * 1024)
    const r = await handleUpload({ path: '/big.txt', content: big })
    expect(r.content[0].text).toMatch(/too large for simple upload/)
  })

  it('uploads and reports success', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ id: 'i', name: 'a.txt', size: 5, webUrl: 'https://x' })
    const r = await handleUpload({ path: '/a.txt', content: 'hello' })
    expect(mockCallGraphAPI).toHaveBeenCalledWith('tok', 'PUT', 'me/drive/root:/a.txt:/content', 'hello', { '@microsoft.graph.conflictBehavior': 'rename' })
    expect(r.content[0].text).toMatch(/Successfully uploaded/)
  })

  it('reports failure when no id is returned', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({})
    const r = await handleUpload({ path: '/a.txt', content: 'hello' })
    expect(r.content[0].text).toMatch(/Upload failed - no response/)
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleUpload({ path: '/a.txt', content: 'x' })
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles Graph API errors', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error('boom'))
    const r = await handleUpload({ path: '/a.txt', content: 'x' })
    expect(r.content[0].text).toMatch(/Error uploading file: boom/)
  })
})

describe('handleShare', () => {
  it('rejects when neither itemId nor path is supplied', async () => {
    const r = await handleShare({})
    expect(r.content[0].text).toBe('Either itemId or path is required.')
  })

  it('creates a sharing link by itemId', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ link: { webUrl: 'https://share/x' } })
    const r = await handleShare({ itemId: 'a' })
    expect(mockCallGraphAPI).toHaveBeenCalledWith('tok', 'POST', 'me/drive/items/a/createLink', { type: 'view', scope: 'anonymous' })
    expect(r.content[0].text).toContain('https://share/x')
  })

  it('resolves path → id then creates a link', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValueOnce({ id: 'b', name: 'doc' })
    mockCallGraphAPI.mockResolvedValueOnce({ link: { webUrl: 'https://share/y' } })
    const r = await handleShare({ path: '/doc.md', type: 'edit', scope: 'organization' })
    expect(r.content[0].text).toContain('Sharing link created for "doc"')
    expect(r.content[0].text).toContain('Type: edit')
    expect(r.content[0].text).toContain('Scope: organization')
  })

  it('reports not-found when path resolution returns no id', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValueOnce({})
    const r = await handleShare({ path: '/x.md' })
    expect(r.content[0].text).toMatch(/File not found at path/)
  })

  it('reports failure when createLink response has no link', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({})
    const r = await handleShare({ itemId: 'a' })
    expect(r.content[0].text).toBe('Failed to create sharing link.')
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleShare({ itemId: 'a' })
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles Graph API errors', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error('boom'))
    const r = await handleShare({ itemId: 'a' })
    expect(r.content[0].text).toMatch(/Error creating sharing link: boom/)
  })
})

describe('handleCreateFolder (onedrive)', () => {
  it('rejects when name is missing', async () => {
    const r = await handleCreateFolder({})
    expect(r.content[0].text).toBe('Folder name is required.')
  })

  it('creates a folder at root by default', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ id: 'f', name: 'New', webUrl: 'https://x' })
    const r = await handleCreateFolder({ name: 'New' })
    expect(mockCallGraphAPI).toHaveBeenCalledWith('tok', 'POST', 'me/drive/root/children', expect.objectContaining({ name: 'New' }))
    expect(r.content[0].text).toMatch(/Successfully created folder/)
  })

  it('creates a folder under a path', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ id: 'f', name: 'New', webUrl: 'https://x' })
    await handleCreateFolder({ name: 'New', path: '/Documents' })
    expect(mockCallGraphAPI).toHaveBeenCalledWith('tok', 'POST', 'me/drive/root:/Documents:/children', expect.any(Object))
  })

  it('reports failure when no id is returned', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({})
    const r = await handleCreateFolder({ name: 'X' })
    expect(r.content[0].text).toBe('Failed to create folder.')
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleCreateFolder({ name: 'X' })
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles Graph API errors', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error('boom'))
    const r = await handleCreateFolder({ name: 'X' })
    expect(r.content[0].text).toMatch(/Error creating folder: boom/)
  })
})

describe('handleDeleteItem', () => {
  it('rejects when neither itemId nor path is supplied', async () => {
    const r = await handleDeleteItem({})
    expect(r.content[0].text).toBe('Either itemId or path is required.')
  })

  it('deletes a file by itemId', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValueOnce({ id: 'i', name: 'doc.md' })
    mockCallGraphAPI.mockResolvedValueOnce({})
    const r = await handleDeleteItem({ itemId: 'i', dry_run: false })
    expect(r.content[0].text).toMatch(/Successfully deleted file "doc.md"/)
  })

  it('deletes a folder by path', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValueOnce({ id: 'i', name: 'Old', folder: { childCount: 0 } })
    mockCallGraphAPI.mockResolvedValueOnce({})
    const r = await handleDeleteItem({ path: '/Old', dry_run: false })
    expect(r.content[0].text).toMatch(/Successfully deleted folder "Old"/)
  })

  it('returns a [dry_run] preview without deleting by default', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValueOnce({ id: 'i', name: 'doc.md', size: 1234 })
    const r = await handleDeleteItem({ itemId: 'i' })
    expect(mockCallGraphAPI).toHaveBeenCalledTimes(1)
    expect(r.content[0].text).toMatch(/^\[dry_run\] would delete file "doc\.md"/)
  })

  it('reports not-found when GET returns no id', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({})
    const r = await handleDeleteItem({ itemId: 'i', dry_run: false })
    expect(r.content[0].text).toBe('Item not found.')
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleDeleteItem({ itemId: 'i', dry_run: false })
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles Graph API errors', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error('boom'))
    const r = await handleDeleteItem({ itemId: 'i', dry_run: false })
    expect(r.content[0].text).toMatch(/Error deleting item: boom/)
  })
})

// --- handleUploadLarge needs https mocking for the per-chunk PUT. ---

const mockChunkPutOnce = (opts: { statusCode: number; body?: string; emitNetworkError?: Error }) => {
  const res = new EventEmitter() as EventEmitter & { statusCode: number }
  res.statusCode = opts.statusCode
  const req = new EventEmitter() as EventEmitter & { write: (data: Buffer) => void; end: () => void }
  req.write = () => {}
  req.end = () => {
    if (opts.emitNetworkError) {
      setImmediate(() => req.emit('error', opts.emitNetworkError))
      return
    }
    setImmediate(() => {
      if (opts.body !== undefined) res.emit('data', opts.body)
      res.emit('end')
    })
  }
  ;(https.request as unknown as Mock).mockImplementationOnce((_url: string, _options: object, callback: (r: typeof res) => void) => {
    callback(res)
    return req
  })
}

describe('handleUploadLarge', () => {
  it('rejects when path is missing', async () => {
    const r = await handleUploadLarge({ content: 'x' })
    expect(r.content[0].text).toMatch(/Path is required/)
  })

  it('rejects when content is missing', async () => {
    const r = await handleUploadLarge({ path: '/x.bin' })
    expect(r.content[0].text).toBe('Content is required.')
  })

  it('uploads in chunks and reports success', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ uploadUrl: 'https://upload/x' })
    // The chunk size is large (~3MB) so a small content uploads in a single chunk
    mockChunkPutOnce({ statusCode: 201, body: JSON.stringify({ id: 'i', name: 'f.bin', size: 5, webUrl: 'https://x' }) })
    const r = await handleUploadLarge({ path: '/big.bin', content: 'hello' })
    expect(r.content[0].text).toMatch(/Successfully uploaded/)
  })

  it('reports failure when createUploadSession returns no uploadUrl', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({})
    const r = await handleUploadLarge({ path: '/big.bin', content: 'hello' })
    expect(r.content[0].text).toBe('Failed to create upload session.')
  })

  it('reports per-chunk upload errors', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ uploadUrl: 'https://upload/x' })
    mockChunkPutOnce({ statusCode: 500, body: 'server error' })
    const r = await handleUploadLarge({ path: '/big.bin', content: 'hello' })
    expect(r.content[0].text).toMatch(/Upload failed at byte 0: Status 500/)
  })

  it('reports completion-without-id when final chunk has no id', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ uploadUrl: 'https://upload/x' })
    mockChunkPutOnce({ statusCode: 200, body: JSON.stringify({}) })
    const r = await handleUploadLarge({ path: '/big.bin', content: 'hello' })
    expect(r.content[0].text).toBe('Upload completed but no file info returned.')
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleUploadLarge({ path: '/big.bin', content: 'hello' })
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles Graph API errors during session creation', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error('boom'))
    const r = await handleUploadLarge({ path: '/big.bin', content: 'hello' })
    expect(r.content[0].text).toMatch(/Error uploading large file: boom/)
  })
})
