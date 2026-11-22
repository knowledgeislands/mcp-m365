# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- Protected list: `MCP_M365_PROTECTED_FILE` names a per-account TOML file of folders (by id, with their subfolders) and categories that every mail-changing tool refuses with `PROTECTED_REFUSED`, all or nothing and previews included; the routing engine's live passes leave a protected message untouched. An unusable file refuses every guarded write with `PROTECTED_LIST_INVALID`; no file changes nothing. `m365_email_protected_list` reports the list and what it covers.
- Rules: `m365_email_rule_update` renames, enables or disables, reorders or changes an inbox rule, and `m365_email_rule_delete` deletes one; both preview by default.
- Categories and changes: `m365_email_messages_categorise` sets, adds or removes categories on messages, `m365_email_categories_list` and `m365_email_category_create` read and extend the master category list, and `m365_email_messages_delta` reads a folder's mail changes since a checkpoint, headers only.
- Device-code authentication against Microsoft 365, with status reporting.
- Mail: list, search, read, send, draft, move, delete, mark read, and folder management.
- Calendar: list, create, cancel, and delete events, and accept or decline invitations.
- Aged-message routing reports.
- Thread-follow routing: the `thread:filed` predicate and the `move:@thread` target file a message with the rest of its conversation. Rule files without `thread:` are unaffected.
- Forwarded-to routing: the `forwarded-to:<address>` predicate holds when exactly one forward of a message to that address exists, so a held item is archived once it has been handed on. Ambiguous forwards are reported and never applied. Rule files without `forwarded-to:` are unaffected.
- Category-aware routing: the `category:<name>` predicate, the `untag:<name>` action and the `hold` action let a category shield mail from later rules and lapse on a timer. Held messages are reported in `held` and never acted on. An optional ` ```categories v1 ` block declares the names rules may use, and a run refuses an undeclared one. `tag:` no longer adds a case variant of a category the message already carries. Rule files without these terms route as before.
- Fixed: message searches now send Graph the query form it accepts, with each quoted value escaped inside the outer search string. The `forwarded-to:` lookup no longer fails with a syntax error, and `m365_email_messages_search` applies every term or returns an error instead of silently falling back to a looser search or to recent mail.
