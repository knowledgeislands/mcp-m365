/**
 * Guard: no real email domain may appear anywhere in the repository.
 *
 * This server's whole subject matter is one person's mailbox, so a routing
 * fixture or a "realistic" test case is a map of its owner's correspondents —
 * clients, investors, lawyers, suppliers — and this repository is public. A
 * real rule file was committed here once; the history had to be rewritten to
 * remove it. This test exists so that cannot happen quietly a second time.
 *
 * Every address in tests and fixtures must use a domain reserved for the
 * purpose by RFC 2606 (`example.com` / `.net` / `.org`, and the `.test`,
 * `.example`, `.invalid`, `.localhost` TLDs). Those can never be registered,
 * so they cannot identify anyone.
 *
 * If this fails, do NOT add the domain to the allowlist below unless it is
 * genuinely a protocol constant (`graph.microsoft.com`). Rewrite the case to
 * use a reserved domain instead — a test that needs a real correspondent to be
 * meaningful is testing the wrong thing.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const REPO_ROOT = path.resolve(import.meta.dirname, '../..')

/** Reserved for documentation and testing — RFC 2606 §2 and §3, RFC 6761. */
const RESERVED = /(^|\.)(example\.(com|net|org)|test|example|invalid|localhost)$/

/**
 * Domains that are protocol or vendor constants rather than correspondents:
 * they identify an API this server talks to, not a person it receives mail
 * from. Additions need a reason of that kind.
 */
const ALLOWED = new Set([
  'graph.microsoft.com', // the Graph endpoint itself
  'login.microsoftonline.com', // the OAuth authority
  'schemas.microsoft.com',
  'microsoft.graph', // an OData type prefix, not a hostname
  'odata.context',
  'odata.count',
  'odata.nextLink',
  'odata.type',
  'odata.id',
  'odata.etag'
])

/** Obvious throwaways used as structural placeholders in unit tests. */
const PLACEHOLDER = /^(a|b|c|x|y|z|acme|evil|junk|nowhere|unknown|somewhere|mail\.x)(\.[a-z]+)*\.(com|net|org)$/

/**
 * The maintainer's own published contact address, in SECURITY.md and
 * package.json. Deliberately public — it is how vulnerabilities get reported —
 * and it is the only address here belonging to a real person.
 */
const MAINTAINER = 'kris@kris.me.uk'

const isSafe = (domain: string): boolean => RESERVED.test(domain) || ALLOWED.has(domain) || PLACEHOLDER.test(domain)

/** Files git tracks, minus generated output and lockfiles. */
const trackedFiles = (): string[] =>
  execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((f) => !f.startsWith('src/generated/') && !/(^|\/)(bun\.lock|package-lock\.json)$/.test(f))

const ADDRESS = /[a-zA-Z0-9._%+*-]+@((?:[a-zA-Z0-9*-]+\.)+[a-zA-Z]{2,})/g

describe('no real correspondent data in the repository', () => {
  it('uses only reserved domains in every tracked file', () => {
    const offenders: string[] = []

    for (const file of trackedFiles()) {
      let content: string
      try {
        content = readFileSync(path.join(REPO_ROOT, file), 'utf8')
      } catch {
        continue // unreadable or binary — nothing addressable in it
      }

      for (const match of content.matchAll(ADDRESS)) {
        if (match[0].toLowerCase() === MAINTAINER) continue
        // Strip any leading wildcard label from patterns like `*@*.cloud.example.net`.
        const domain = (match[1] as string).replace(/^\*\./, '').toLowerCase()
        if (!isSafe(domain)) offenders.push(`${file}: ${match[0]}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('keeps the routing fixture synthetic', () => {
    // The fixture is the highest-risk file in the repo: it is the one shaped
    // like a real rule file, so it is the one most likely to be replaced with a
    // real rule file "just to check something".
    const fixture = readFileSync(path.join(REPO_ROOT, 'fixtures/routing/example-rules.md'), 'utf8')
    const domains = [...fixture.matchAll(ADDRESS)].map((m) => (m[1] as string).replace(/^\*\./, '').toLowerCase())

    expect(domains.length).toBeGreaterThan(0)
    expect(domains.filter((d) => !RESERVED.test(d))).toEqual([])
  })
})
