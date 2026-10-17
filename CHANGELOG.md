# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- Device-code authentication against Microsoft 365, with status reporting.
- Mail: list, search, read, send, draft, move, delete, mark read, and folder management.
- Calendar: list, create, cancel, and delete events, and accept or decline invitations.
- Aged-message routing reports.
- Thread-follow routing: the `thread:filed` predicate and the `move:@thread` target file a message with the rest of its conversation. Rule files without `thread:` are unaffected.
- Forwarded-to routing: the `forwarded-to:<address>` predicate holds when exactly one forward of a message to that address exists, so a held item is archived once it has been handed on. Ambiguous forwards are reported and never applied. Rule files without `forwarded-to:` are unaffected.
- Category-aware routing: the `category:<name>` predicate, the `untag:<name>` action and the `hold` action let a category shield mail from later rules and lapse on a timer. Held messages are reported in `held` and never acted on. An optional ` ```categories v1 ` block declares the names rules may use, and a run refuses an undeclared one. `tag:` no longer adds a case variant of a category the message already carries. Rule files without these terms route as before.
- Fixed: message searches now send Graph the query form it accepts, with each quoted value escaped inside the outer search string. The `forwarded-to:` lookup no longer fails with a syntax error, and `m365_email_messages_search` applies every term or returns an error instead of silently falling back to a looser search or to recent mail.
