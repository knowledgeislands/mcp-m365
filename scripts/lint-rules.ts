#!/usr/bin/env node
/**
 * Lint a routing-rule file from the command line.
 *
 * The same checks the `m365_email_routing_lint` tool runs — it calls straight
 * into `main/triage`, so there is no second implementation to drift. Useful
 * while reordering rules by hand, where the round trip through an MCP client is
 * the slow part.
 *
 *   bun run ki:lint:rules                    # uses MCP_M365_TRIAGE_RULES_PATH
 *   bun run ki:lint:rules path/to/rules.md   # or an explicit path
 *   bun run ki:lint:rules --list             # print the rules in evaluation order
 *
 * Exits non-zero when any `error`-severity finding is present, so it can gate a
 * commit hook on the knowledge-base repo.
 */
import { readFileSync } from 'node:fs'
import { loadConfig } from '../src/config/index.js'
import { lintRules, type LintSeverity, parseRules, renderPredicates } from '../src/main/triage/index.js'

const COLOUR: Record<LintSeverity, string> = { error: '\x1b[31m', warning: '\x1b[33m', info: '\x1b[36m' }
const RESET = '\x1b[0m'
const useColour = process.stdout.isTTY

const paint = (severity: LintSeverity, text: string): string => (useColour ? `${COLOUR[severity]}${text}${RESET}` : text)

const args = process.argv.slice(2)
const wantsList = args.includes('--list')
const explicitPath = args.find((arg) => !arg.startsWith('--'))
const rulesPath = explicitPath ?? loadConfig().triageRulesPath

if (!rulesPath) {
  console.error('No rule file given. Pass a path, or set MCP_M365_TRIAGE_RULES_PATH.')
  process.exit(2)
}

let source: string
try {
  source = readFileSync(rulesPath, 'utf8')
} catch (error) {
  console.error(`Could not read ${rulesPath}: ${(error as Error).message}`)
  process.exit(2)
}

const parsed = parseRules(source)

if (wantsList) {
  // The flat, comment-free view the engine actually evaluates — position is the
  // only thing that decides anything, so this is the artefact worth reading
  // when reordering.
  for (const block of parsed.blocks) {
    console.log(`\n# ${block.label} — ${block.rules.length} rules, evaluated top to bottom\n`)
    block.rules.forEach((rule, index) => {
      const actions = rule.actions.map((a) => (a.value === undefined ? a.kind : `${a.kind}:${a.value}`)).join(', ')
      console.log(`${String(index + 1).padStart(3)}  L${String(rule.line).padStart(3)}  ${renderPredicates(rule)} -> ${actions}`)
    })
  }
  process.exit(0)
}

const findings = lintRules(parsed)
const counts = findings.reduce<Record<string, number>>((acc, f) => ({ ...acc, [f.severity]: (acc[f.severity] ?? 0) + 1 }), {})

console.log(`${rulesPath}`)
console.log(`Parsed: ${parsed.blocks.map((b) => `${b.label} (${b.rules.length} rules)`).join(', ') || 'nothing'}`)
console.log(`${findings.length} finding(s): ${counts.error ?? 0} error, ${counts.warning ?? 0} warning, ${counts.info ?? 0} info\n`)

for (const finding of findings) {
  console.log(`${paint(finding.severity, `L${finding.line} [${finding.severity}] ${finding.code}`)}: ${finding.message}`)
  if (finding.source) console.log(`     ${finding.source.trim()}`)
}

// Only errors gate. Warnings and info are advisory — a broad-rule collision is
// often a considered decision, not a defect.
process.exit(findings.some((f) => f.severity === 'error') ? 1 : 0)
