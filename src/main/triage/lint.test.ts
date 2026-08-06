import { groupSubsumes, lintRules, ruleShadows } from './lint.js'
import { parseRules } from './parser.js'
import type { AndGroup, Rule } from './types.js'

const FALLBACK = '* -> move:000 Unknown, suggest'

const lint = (body: string, options = {}) => lintRules(parseRules(`## Inbound\n\n\`\`\`rules v1\n${body}\n\`\`\`\n`), options)

const codes = (body: string, options = {}): string[] => lint(body, options).map((f) => f.code)

const find = (body: string, code: string, options = {}) => lint(body, options).find((f) => f.code === code)

const ruleOf = (text: string): Rule => parseRules(`## Inbound\n\n\`\`\`rules v1\n${text}\n\`\`\`\n`).blocks[0]?.rules[0] as Rule

const groupOf = (text: string): AndGroup => ruleOf(text).groups[0] as AndGroup

describe('groupSubsumes', () => {
  it('recognises an identical condition', () => {
    expect(groupSubsumes(groupOf('sender:*@x.com -> move:A'), groupOf('sender:*@x.com -> move:B'))).toBe(true)
  })

  it('recognises a domain wildcard claiming a specific address', () => {
    expect(groupSubsumes(groupOf('sender:*@x.com -> move:A'), groupOf('sender:a@x.com -> move:B'))).toBe(true)
    expect(groupSubsumes(groupOf('sender:a@x.com -> move:A'), groupOf('sender:*@x.com -> move:B'))).toBe(false)
  })

  it('recognises a subdomain wildcard claiming a subdomain', () => {
    expect(groupSubsumes(groupOf('sender:*@*.x.com -> move:A'), groupOf('sender:*@mail.x.com -> move:B'))).toBe(true)
  })

  it('recognises that a direction-specific match implies party', () => {
    expect(groupSubsumes(groupOf('party:*@x.com -> move:A'), groupOf('sender:*@x.com -> move:B'))).toBe(true)
    expect(groupSubsumes(groupOf('sender:*@x.com -> move:A'), groupOf('party:*@x.com -> move:B'))).toBe(false)
  })

  it('does not cross incompatible directions', () => {
    expect(groupSubsumes(groupOf('to:*@x.com -> move:A'), groupOf('cc:*@x.com -> move:B'))).toBe(false)
  })

  it('recognises that a longer phrase contains a shorter one', () => {
    expect(groupSubsumes(groupOf('subject:BFBS -> move:A'), groupOf('subject:"BFBS Follow up" -> move:B'))).toBe(true)
    expect(groupSubsumes(groupOf('subject:"BFBS Follow up" -> move:A'), groupOf('subject:BFBS -> move:B'))).toBe(false)
  })

  it('treats the match-everything term as claiming everything', () => {
    expect(groupSubsumes(groupOf('* -> move:A'), groupOf('sender:a@x.com -> move:B'))).toBe(true)
  })

  it('refuses to reason about a negation in the earlier rule', () => {
    expect(groupSubsumes(groupOf('sender:*@x.com !subject:sign -> move:A'), groupOf('sender:*@x.com -> move:B'))).toBe(false)
  })

  it('ignores a negated term when using the later rule as evidence', () => {
    expect(groupSubsumes(groupOf('sender:*@x.com -> move:A'), groupOf('sender:*@x.com !subject:sign -> move:B'))).toBe(true)
  })

  it('does not relate unrelated keys', () => {
    expect(groupSubsumes(groupOf('type:calendar-invite -> move:A'), groupOf('subject:BFBS -> move:B'))).toBe(false)
  })
})

describe('ruleShadows', () => {
  it('needs every OR-arm of the later rule to be claimed', () => {
    const earlier = ruleOf('subject:alpha -> move:A')
    expect(ruleShadows(earlier, ruleOf('subject:"alpha one" | subject:"alpha two" -> move:B'))).toBe(true)
    expect(ruleShadows(earlier, ruleOf('subject:"alpha one" | subject:beta -> move:B'))).toBe(false)
  })
})

describe('lintRules — fallback', () => {
  it('accepts a block ending in the fallback', () => {
    expect(codes(`sender:*@x.com -> move:A\n${FALLBACK}`)).toEqual([])
  })

  it('fails a block with no fallback', () => {
    expect(find('sender:*@x.com -> move:A', 'missing-fallback')?.severity).toBe('error')
  })

  it('fails an empty block', () => {
    expect(find('# nothing here', 'missing-fallback')).toBeDefined()
  })

  it('flags a fallback that is not last', () => {
    const findings = lint(`${FALLBACK}\nsender:*@x.com -> move:A`)
    expect(findings.find((f) => f.code === 'misplaced-fallback')?.message).toMatch(/position 1 of 2/)
  })

  it('only requires a fallback in the blocks asked for', () => {
    const parsed = parseRules('## Aged\n\n```rules v1\nfolder:"981 Delete" age:7d -> delete\n```\n')
    expect(lintRules(parsed, { requireFallbackIn: [] }).map((f) => f.code)).toEqual([])
  })
})

describe('lintRules — shadowing', () => {
  it('catches a seeded shadowing case', () => {
    const finding = find(`sender:*@x.com -> move:981 Delete\nsender:billing@x.com -> move:282 Finance\n${FALLBACK}`, 'shadowed-rule')
    expect(finding?.severity).toBe('error')
    expect(finding?.message).toMatch(/unreachable/)
    expect(finding?.message).toMatch(/mail intended for "_TRIAGE\/282 Finance" is going to "_TRIAGE\/981 Delete"/)
  })

  it('catches the calendar-invite / project-route collision when the ordering is reverted', () => {
    // The Phase 2 fix put the project block above the action block. Reverting it
    // does not make the project rule *unreachable* — invites are only some of
    // its traffic — so the broad-rule check is what must catch it.
    const reverted = `type:calendar-invite -> move:101 Do\nsubject:"BFBS" -> move:111 Partner\n${FALLBACK}`
    const finding = find(reverted, 'broad-rule-collision')
    expect(finding?.message).toMatch(/_TRIAGE\/111 Partner/)
  })

  it('omits the destination clause when both rules land in the same folder', () => {
    const finding = find(`sender:*@x.com -> move:981 Delete\nsender:billing@x.com -> move:981 Delete\n${FALLBACK}`, 'shadowed-rule')
    expect(finding?.message).not.toMatch(/mail intended for/)
  })

  it('reports only the first rule that shadows a given rule', () => {
    const findings = lint(`sender:*@x.com -> move:A\nsender:*@x.com -> move:B\nsender:c@x.com -> move:C\n${FALLBACK}`)
    expect(findings.filter((f) => f.code === 'shadowed-rule')).toHaveLength(2)
  })

  it('never reports the fallback as shadowed', () => {
    expect(codes(`sender:*@x.com -> move:A\n${FALLBACK}`)).not.toContain('shadowed-rule')
  })
})

describe('lintRules — broad-rule collisions', () => {
  it('suppresses the finding when the precedence has been reviewed', () => {
    const body = `status:flagged -> move:102 Urgent   # lint:allow-collision — a manual flag beats topic routing\nparty:*@partner.example.com -> move:111 Partner\n${FALLBACK}`
    expect(codes(body)).not.toContain('broad-rule-collision')
  })

  it('does not flag a broad rule with nothing but the fallback below it', () => {
    expect(codes(`type:calendar-invite -> move:101 Do\n${FALLBACK}`)).not.toContain('broad-rule-collision')
  })

  it('does not count other broad rules as pre-empted', () => {
    expect(codes(`type:calendar-invite -> move:101 Do\nstatus:flagged -> move:102 Urgent\n${FALLBACK}`)).not.toContain('broad-rule-collision')
  })

  it('truncates a long destination list', () => {
    const targets = ['A', 'B', 'C', 'D', 'E', 'F'].map((n, i) => `subject:s${i} -> move:${n}`).join('\n')
    expect(find(`type:calendar-invite -> move:101 Do\n${targets}\n${FALLBACK}`, 'broad-rule-collision')?.message).toMatch(/, …\)/)
  })

  it('handles a broad rule with no move action', () => {
    expect(find(`status:flagged -> mark:read\nsubject:x -> move:A\n${FALLBACK}`, 'broad-rule-collision')?.message).toMatch(/goes to "its actions"/)
  })
})

describe('lintRules — hygiene', () => {
  it('reports an exact duplicate', () => {
    const finding = find(`sender:*@x.com -> move:A\nsender:*@x.com -> move:A\n${FALLBACK}`, 'duplicate-rule')
    expect(finding?.severity).toBe('warning')
    expect(finding?.message).toMatch(/duplicates the rule at line 4/)
  })

  it('suggests consolidating sender and to rules over one domain', () => {
    const finding = find(`sender:*@x.com -> move:A\nto:*@x.com -> move:A\n${FALLBACK}`, 'party-consolidation')
    expect(finding?.message).toMatch(/a single `party:\*@x\.com` rule would cover them/)
  })

  it('does not suggest consolidation across different destinations', () => {
    expect(codes(`sender:*@x.com -> move:A\nto:*@x.com -> move:B\n${FALLBACK}`)).not.toContain('party-consolidation')
  })

  it('does not suggest consolidation without a sender rule', () => {
    expect(codes(`to:*@x.com -> move:A\ncc:*@x.com -> move:A\n${FALLBACK}`)).not.toContain('party-consolidation')
  })

  it('ignores multi-term and negated groups when consolidating', () => {
    expect(codes(`sender:*@x.com subject:y -> move:A\n!to:*@x.com -> move:A\n${FALLBACK}`)).not.toContain('party-consolidation')
  })

  it('ignores rules with no move target when consolidating', () => {
    expect(codes(`sender:*@x.com -> mark:read\nto:*@x.com -> mark:read\n${FALLBACK}`)).not.toContain('party-consolidation')
  })

  it('flags an address predicate with no @', () => {
    expect(find(`sender:db.example.net -> move:A\n${FALLBACK}`, 'malformed-address')?.message).toMatch(/will never match/)
  })

  it('checks move targets against a supplied folder list', () => {
    const findings = lint(`sender:*@x.com -> move:111 Partner\n${FALLBACK}`, { knownFolders: ['_TRIAGE/111 Partner'] })
    expect(findings.find((f) => f.code === 'unknown-folder')?.message).toMatch(/"_TRIAGE\/000 Unknown" is not among the 1 known folders/)
  })

  it('skips the folder check when no taxonomy is supplied', () => {
    expect(codes(`sender:*@x.com -> move:Nowhere\n${FALLBACK}`)).not.toContain('unknown-folder')
  })

  it('surfaces parse errors as findings with their source line', () => {
    const finding = find(`theme:x -> move:A\n${FALLBACK}`, 'parse-error')
    expect(finding).toMatchObject({ severity: 'error', line: 4, source: 'theme:x -> move:A' })
  })

  it('surfaces a source-less parse error', () => {
    expect(lintRules(parseRules('```rules v9\n* -> move:A\n```')).map((f) => f.code)).toEqual(['parse-error'])
  })

  it('orders findings by line', () => {
    const lines = lint(`sender:*@x.com -> move:A\nsender:a@x.com -> move:B\nsender:db.example.net -> move:C\n${FALLBACK}`).map((f) => f.line)
    expect(lines).toEqual([...lines].sort((a, b) => a - b))
  })
})
