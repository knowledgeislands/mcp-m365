# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- Device-code authentication against Microsoft 365, with status reporting.
- Mail: list, search, read, send, draft, move, delete, mark read, and folder management.
- Calendar: list, create, cancel, and delete events, and accept or decline invitations.
- Aged-message routing reports.
- Thread-follow routing: the `thread:filed` predicate and the `move:@thread` target file a message with the rest of its conversation. Rule files without `thread:` are unaffected.
- Forwarded-to routing: the `forwarded-to:<address>` predicate holds when exactly one forward of a message to that address exists, so a held item is archived once it has been handed on. Ambiguous forwards are reported and never applied. Rule files without `forwarded-to:` are unaffected.
