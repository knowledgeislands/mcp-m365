import { assembleLines, parseRule, parseRules, renderAction, renderGroup, renderPredicates, selectBlock, splitOutsideQuotes, stripComment } from './parser.js'
import type { AndGroup, Rule } from './types.js'

const block = (body: string, label = 'Inbound'): string => `## ${label}\n\n\`\`\`rules v1\n${body}\n\`\`\`\n`

const firstRule = (body: string): Rule => {
  const parsed = parseRules(block(body))
  expect(parsed.errors).toEqual([])
  return parsed.blocks[0]?.rules[0] as Rule
}

const errorsFor = (body: string): string[] => parseRules(block(body)).errors.map((e) => e.message)

describe('splitOutsideQuotes', () => {
  it('splits on a separator outside quotes', () => {
    expect(splitOutsideQuotes('a|b|c', '|')).toEqual(['a', 'b', 'c'])
  })

  it('leaves a separator inside quotes alone', () => {
    expect(splitOutsideQuotes('subject:"a|b"|c', '|')).toEqual(['subject:"a|b"', 'c'])
  })

  it('handles multi-character separators', () => {
    expect(splitOutsideQuotes('a -> b', '->')).toEqual(['a ', ' b'])
  })
})

describe('stripComment', () => {
  it('splits a trailing comment off', () => {
    expect(stripComment('a -> b # why')).toEqual({ body: 'a -> b ', comment: 'why' })
  })

  it('ignores a hash inside a quoted value', () => {
    expect(stripComment('subject:"a#b" -> move:X')).toEqual({ body: 'subject:"a#b" -> move:X' })
  })
})

describe('parseRules — structure', () => {
  it('labels blocks from the nearest preceding heading', () => {
    const source = `${block('* -> move:000 Unknown, suggest', 'Inbound')}\n${block('folder:"981 Delete" age:7d -> delete', 'Aged')}`
    const parsed = parseRules(source)
    expect(parsed.blocks.map((b) => b.label)).toEqual(['inbound', 'aged'])
    expect(parsed.errors).toEqual([])
  })

  it('falls back to an ordinal label when a fence has no heading above it', () => {
    const parsed = parseRules('```rules v1\n* -> move:000 Unknown\n```')
    expect(parsed.blocks[0]?.label).toBe('block1')
  })

  it('accepts a bare rule list introduced by a header line', () => {
    const parsed = parseRules('rules v1\nsender:a@b.com -> move:X')
    expect(parsed.errors).toEqual([])
    expect(parsed.blocks[0]?.label).toBe('default')
    expect(parsed.blocks[0]?.rules).toHaveLength(1)
  })

  it('reports a source with neither a fence nor a header', () => {
    expect(parseRules('sender:a@b.com -> move:X').errors[0]?.message).toMatch(/no ```rules block found/)
  })

  it('reports an entirely blank source', () => {
    expect(parseRules('   \n  ').errors[0]?.message).toMatch(/no ```rules block found/)
  })

  it('rejects an unrecognised version rather than guessing at a parse', () => {
    const parsed = parseRules(block('sender:a@b.com -> move:X').replace('rules v1', 'rules v2'))
    expect(parsed.blocks).toHaveLength(0)
    expect(parsed.errors[0]?.message).toMatch(/unsupported rules version "v2"/)
  })

  it('rejects an unterminated fence rather than running a possibly truncated rule list', () => {
    // Order is the entire specification, so a rule list that may have been cut
    // short cannot be trusted even if every rule in it parses.
    const parsed = parseRules('## Inbound\n\n```rules v1\nsender:a@b.com -> move:X\n* -> delete')
    expect(parsed.errors[0]?.message).toMatch(/unterminated ```rules block/)
    expect(parsed.blocks).toHaveLength(0)
  })

  it('accepts a closed fence with the same content', () => {
    expect(parseRules('## Inbound\n\n```rules v1\nsender:a@b.com -> move:X\n```').errors).toEqual([])
  })

  it('treats blank and comment lines as formatting only', () => {
    const parsed = parseRules(block('# a section header\n\nsender:a@b.com -> move:X\n\n# trailing note'))
    expect(parsed.blocks[0]?.rules).toHaveLength(1)
  })

  it('reports line numbers relative to the whole source', () => {
    const rule = firstRule('sender:a@b.com -> move:X')
    expect(rule.line).toBe(4)
  })
})

describe('parseRules — rule shape', () => {
  it('parses juxtaposition as AND', () => {
    const rule = firstRule('sender:*@x.com subject:"Sign in" -> move:981 Delete')
    expect(rule.groups).toHaveLength(1)
    expect(rule.groups[0]?.terms).toHaveLength(2)
  })

  it('parses `|` as OR across whole AND-groups', () => {
    const rule = firstRule('subject:a subject:b | subject:c -> move:X')
    expect(rule.groups.map((g) => g.terms.length)).toEqual([2, 1])
  })

  it('parses negation on a single predicate', () => {
    const rule = firstRule('sender:*@vendor.example.com !subject:sign -> move:981 Delete')
    const terms = rule.groups[0]?.terms ?? []
    expect(terms[1]).toMatchObject({ key: 'subject', value: 'sign', negated: true })
  })

  it('parses the match-everything fallback', () => {
    const rule = firstRule('* -> move:000 Unknown, suggest')
    expect(rule.groups[0]?.terms[0]).toEqual({ kind: 'any' })
    expect(rule.actions).toEqual([{ kind: 'move', value: '000 Unknown', quoted: false }, { kind: 'suggest' }])
  })

  it('keeps unquoted spaces in a move target', () => {
    expect(firstRule('sender:a@b.com -> move:111 Partner').actions[0]).toEqual({ kind: 'move', value: '111 Partner', quoted: false })
  })

  it('records that a value was quoted', () => {
    expect(firstRule('sender:a@b.com -> move:"Junk Email"').actions[0]).toEqual({ kind: 'move', value: 'Junk Email', quoted: true })
  })

  it('parses multiple comma-separated actions in order', () => {
    const rule = firstRule('folder:"111 Partner" age:7d -> move:_ARCHIVE/Success/Partner, tag:Partner, mark:read')
    expect(rule.actions.map((a) => a.kind)).toEqual(['move', 'tag', 'mark'])
  })

  it('captures the trailing comment', () => {
    expect(firstRule('sender:a@b.com -> move:X # because').comment).toBe('because')
  })

  it('reassembles a rule that wraps before its arrow', () => {
    const rule = firstRule('subject:"Partner" | subject:"Partner"\n                     -> move:111 Partner   # variants')
    expect(rule.groups).toHaveLength(2)
    expect(rule.line).toBe(4)
    expect(rule.comment).toBe('variants')
  })
})

describe('parseRules — diagnostics', () => {
  it('reports a rule with no arrow', () => {
    expect(errorsFor('sender:a@b.com move:X')[0]).toMatch(/no `->`/)
  })

  it('reports more than one arrow', () => {
    expect(errorsFor('a:b -> c -> d')[0]).toMatch(/more than one `->`/)
  })

  it('reports an empty predicate side', () => {
    expect(errorsFor('-> move:X')[0]).toMatch(/no predicates before/)
  })

  it('reports an empty action side', () => {
    expect(errorsFor('sender:a@b.com ->')[0]).toMatch(/no actions after/)
  })

  it('reports an unknown predicate key', () => {
    expect(errorsFor('theme:5G -> move:X')[0]).toMatch(/unknown predicate key "theme"/)
  })

  it('reports a term that is not key:value', () => {
    expect(errorsFor('sender -> move:X')[0]).toMatch(/expected key:value/)
  })

  it('reports an empty predicate value', () => {
    expect(errorsFor('sender: -> move:X')[0]).toMatch(/empty value for "sender:"/)
  })

  it('reports a stray OR bar', () => {
    expect(errorsFor('sender:a@b.com | -> move:X')[0]).toMatch(/empty predicate group/)
  })

  it.each([
    ['type:meeting -> move:X', /invalid type/],
    ['importance:urgent -> move:X', /invalid importance/],
    ['status:starred -> move:X', /invalid status/],
    ['age:7 -> move:X', /invalid age/]
  ])('rejects an invalid enumerated value in %s', (body, expected) => {
    expect(errorsFor(body)[0]).toMatch(expected)
  })

  it('rejects a negated match-everything term', () => {
    expect(errorsFor('!* -> move:X')[0]).toMatch(/cannot be negated/)
  })

  it('rejects `*` alongside another term', () => {
    expect(errorsFor('* sender:a@b.com -> move:X')[0]).toMatch(/sole term/)
  })

  it('rejects `*` in one arm of an OR', () => {
    expect(errorsFor('sender:a@b.com | * -> move:X')[0]).toMatch(/sole term/)
  })

  it('reports a stray action comma', () => {
    expect(errorsFor('sender:a@b.com -> move:X,')[0]).toMatch(/empty action/)
  })

  it('reports an action that is not key:value', () => {
    expect(errorsFor('sender:a@b.com -> archive')[0]).toMatch(/expected an action of the form/)
  })

  it('reports an unknown action', () => {
    expect(errorsFor('sender:a@b.com -> forward:x@y.com')[0]).toMatch(/unknown action "forward"/)
  })

  it('reports an empty action value', () => {
    expect(errorsFor('sender:a@b.com -> move:')[0]).toMatch(/empty value for "move:"/)
  })

  it('reports an invalid mark value', () => {
    expect(errorsFor('sender:a@b.com -> mark:archived')[0]).toMatch(/invalid mark/)
  })

  it('collects every error rather than stopping at the first', () => {
    expect(errorsFor('theme:x -> move:A\nsender:b@c.com -> forward:d')).toHaveLength(2)
  })
})

describe('assembleLines', () => {
  it('reports an unterminated wrapped rule', () => {
    const { logical, errors } = assembleLines(['subject:"a" |', 'subject:"b"'], 0)
    expect(logical).toEqual([])
    expect(errors[0]?.message).toMatch(/no `->`/)
  })

  it('does not drop a blank line inside a part-assembled rule', () => {
    const { logical } = assembleLines(['subject:a |', '', 'subject:b -> move:X'], 0)
    expect(logical).toHaveLength(1)
    expect(logical[0]?.text).toBe('subject:a |  subject:b -> move:X')
  })
})

describe('parseRule', () => {
  it('is callable on an already-assembled line', () => {
    const parsed = parseRule({ line: 9, text: 'sender:a@b.com -> move:X' })
    expect('rule' in parsed && parsed.rule.line).toBe(9)
  })
})

describe('selectBlock', () => {
  const two = parseRules(`${block('* -> move:000 Unknown', 'Inbound')}\n${block('folder:"981 Delete" -> delete', 'Aged')}`)

  it('selects by label', () => {
    const selected = selectBlock(two, 'aged')
    expect('block' in selected && selected.block.rules[0]?.actions[0]?.kind).toBe('delete')
  })

  it('falls back to the sole block when a bare list was supplied', () => {
    const one = parseRules('rules v1\nsender:a@b.com -> move:X')
    expect('block' in selectBlock(one, 'inbound')).toBe(true)
  })

  it('reports when the requested label is absent and there is more than one block', () => {
    const selected = selectBlock(two, 'archive')
    expect('error' in selected && selected.error).toMatch(/no "archive" rules block found \(blocks present: inbound, aged\)/)
  })

  it('reports when there are no blocks at all', () => {
    const selected = selectBlock({ blocks: [], errors: [] }, 'inbound')
    expect('error' in selected && selected.error).toMatch(/blocks present: none/)
  })
})

describe('rendering', () => {
  it('renders a group back to DSL text', () => {
    const rule = firstRule('sender:*@x.com !subject:"Sign in" -> move:X')
    expect(renderGroup(rule.groups[0] as AndGroup)).toBe('sender:*@x.com !subject:"Sign in"')
  })

  it('renders the match-everything term', () => {
    expect(renderGroup(firstRule('* -> move:X').groups[0] as AndGroup)).toBe('*')
  })

  it('renders OR-groups', () => {
    expect(renderPredicates(firstRule('subject:a | subject:b -> move:X'))).toBe('subject:a | subject:b')
  })

  it('renders actions with and without values', () => {
    const rule = firstRule('* -> move:"Junk Email", suggest')
    expect(rule.actions.map(renderAction)).toEqual(['move:"Junk Email"', 'suggest'])
  })
})
