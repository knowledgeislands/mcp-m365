import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { assertWithinRoots, expandHome, parseRoots, realpathOfNearestExisting } from './paths.js'

let base: string
let root: string
let outside: string

beforeEach(async () => {
  // realpath the temp dir itself — on macOS /tmp is a symlink to /private/tmp,
  // which would otherwise make every expectation compare unresolved to resolved.
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'paths-')))
  root = path.join(base, 'repo')
  outside = path.join(base, 'elsewhere')
  await fs.mkdir(path.join(root, 'Admin'), { recursive: true })
  await fs.mkdir(outside, { recursive: true })
  await fs.writeFile(path.join(root, 'Admin', 'rules.md'), '# rules')
  await fs.writeFile(path.join(outside, 'secrets.txt'), 'not for you')
})

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

describe('expandHome', () => {
  it("expands a leading tilde, as every sibling server's config uses", () => {
    expect(expandHome('~/workspaces/hnr')).toBe(path.join(os.homedir(), 'workspaces/hnr'))
  })

  it('expands a bare tilde', () => {
    expect(expandHome('~')).toBe(os.homedir())
  })

  it('leaves a tilde that is part of a name alone', () => {
    expect(expandHome('/tmp/~notahome')).toBe('/tmp/~notahome')
  })

  it('resolves a relative path', () => {
    expect(expandHome('rel')).toBe(path.resolve('rel'))
  })
})

describe('parseRoots', () => {
  it('splits on the platform delimiter and resolves each entry', () => {
    expect(parseRoots(`/a${path.delimiter}/b`)).toEqual(['/a', '/b'])
  })

  it('trims, drops blanks, and de-duplicates', () => {
    expect(parseRoots(` /a ${path.delimiter}${path.delimiter} /a `)).toEqual(['/a'])
  })

  it('resolves a relative entry against the working directory', () => {
    expect(parseRoots('rel')[0]).toBe(path.resolve('rel'))
  })

  it("expands tildes in the list, matching the sibling servers' config style", () => {
    expect(parseRoots(`~/a${path.delimiter}~/b`)).toEqual([path.join(os.homedir(), 'a'), path.join(os.homedir(), 'b')])
  })

  it('treats unset or blank as no roots at all', () => {
    expect(parseRoots(undefined)).toEqual([])
    expect(parseRoots('   ')).toEqual([])
  })
})

describe('realpathOfNearestExisting', () => {
  it('resolves a path that exists', async () => {
    expect(await realpathOfNearestExisting(path.join(root, 'Admin'))).toBe(path.join(root, 'Admin'))
  })

  it('reattaches segments that do not exist yet', async () => {
    const target = path.join(root, 'Admin', 'not', 'yet', 'tracking.json5')
    expect(await realpathOfNearestExisting(target)).toBe(target)
  })

  it('resolves symlinks in the existing portion', async () => {
    await fs.symlink(path.join(root, 'Admin'), path.join(root, 'link'))
    expect(await realpathOfNearestExisting(path.join(root, 'link', 'new.json5'))).toBe(
      path.join(root, 'Admin', 'new.json5')
    )
  })
})

describe('assertWithinRoots', () => {
  it('accepts a path inside a root and returns it resolved', async () => {
    expect(await assertWithinRoots([root], path.join(root, 'Admin', 'rules.md'), 'rule file')).toBe(
      path.join(root, 'Admin', 'rules.md')
    )
  })

  it('accepts the root itself', async () => {
    expect(await assertWithinRoots([root], root, 'rule file')).toBe(root)
  })

  it('accepts a file that does not exist yet, so a cache can be created on first write', async () => {
    const target = path.join(root, '.mcp-m365', 'email-triage', 'tracking.json5')
    expect(await assertWithinRoots([root], target, 'tracking cache')).toBe(target)
  })

  it('refuses a sibling directory that merely shares a prefix', async () => {
    const sibling = `${root}-other`
    await fs.mkdir(sibling, { recursive: true })
    await expect(assertWithinRoots([root], path.join(sibling, 'x'), 'rule file')).rejects.toThrow(
      /resolves outside the configured roots/
    )
  })

  it('refuses an absolute path elsewhere on disk', async () => {
    await expect(assertWithinRoots([root], path.join(outside, 'secrets.txt'), 'rule file')).rejects.toThrow(
      /resolves outside/
    )
  })

  it('refuses a traversal out of the root', async () => {
    await expect(
      assertWithinRoots([root], path.join(root, '..', 'elsewhere', 'secrets.txt'), 'rule file')
    ).rejects.toThrow(/resolves outside/)
  })

  it('refuses a symlink inside the root that points out of it', async () => {
    // The lexical check passes here — this is the case only realpath catches,
    // and the knowledge base genuinely contains symlinks into another repo.
    await fs.symlink(path.join(outside, 'secrets.txt'), path.join(root, 'escape.md'))
    await expect(assertWithinRoots([root], path.join(root, 'escape.md'), 'rule file')).rejects.toThrow(
      /resolves outside/
    )
  })

  it('accepts a root that is itself reached through a symlink', async () => {
    const linked = path.join(base, 'linked-repo')
    await fs.symlink(root, linked)
    expect(await assertWithinRoots([linked], path.join(linked, 'Admin', 'rules.md'), 'rule file')).toBe(
      path.join(root, 'Admin', 'rules.md')
    )
  })

  it('expands a tilde-prefixed candidate before checking it against the roots', async () => {
    // The only honest way to prove expansion: make the root the home directory
    // itself. Unexpanded, `~/x` would resolve relative to the working directory
    // and be refused — accepting it means the tilde was expanded.
    const target = path.join(os.homedir(), 'definitely-not-a-real-file-xyz')
    expect(await assertWithinRoots([os.homedir()], '~/definitely-not-a-real-file-xyz', 'rule file')).toBe(target)
  })

  it('reports a rejected path as the caller wrote it, tilde and all', async () => {
    // The message echoes the input rather than the expansion, so a misconfigured
    // value is recognisable in the error.
    await expect(assertWithinRoots([root], '~/somewhere-else', 'rule file')).rejects.toThrow(/at "~\/somewhere-else"/)
  })

  it('accepts a path under any one of several roots', async () => {
    expect(await assertWithinRoots([outside, root], path.join(root, 'Admin', 'rules.md'), 'rule file')).toBe(
      path.join(root, 'Admin', 'rules.md')
    )
  })

  it('refuses everything when no roots are configured', async () => {
    await expect(assertWithinRoots([], path.join(root, 'Admin', 'rules.md'), 'rule file')).rejects.toThrow(
      /no roots are configured/
    )
  })

  it('names the purpose and the rejected path, but never file contents', async () => {
    const secret = path.join(outside, 'secrets.txt')
    await expect(assertWithinRoots([root], secret, 'tracking cache')).rejects.toThrow(
      new RegExp(`Refusing to access the tracking cache at "${secret.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}"`)
    )
    await expect(assertWithinRoots([root], secret, 'tracking cache')).rejects.not.toThrow(/not for you/)
  })
})
