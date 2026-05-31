/**
 * Inbox-rules concern — library-usable implementation behind the
 * `m365_email_rule*` / `m365_email_rules_*` tools.
 */
export { handleCreateRule } from './create.js'
export { handleEditRuleSequence } from './edit-sequence.js'
export { getInboxRules, handleListRules } from './list.js'
