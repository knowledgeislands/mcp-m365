# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Migrated to the MCP 2026-07-28 protocol profile: `@modelcontextprotocol/sdk` 1.x is replaced by `@modelcontextprotocol/server` 2.0.0, and the stdio entry point now hands a per-connection server factory to the SDK-owned `serveStdio` boundary, which owns discovery, era selection, and protocol stamping.
- Result helpers carry the `resultType: "complete"` wire discriminator explicitly.
- Unpinned `zod` from 4.4.3 to 4.6.5; the hold existed only for the legacy SDK's schema types.

### Compatibility

- The tool surface is unchanged: identical names, descriptions, input schemas, annotations, and response text.
- Legacy 2025-era clients are still served (`legacy: 'serve'`). The smoke test asserts that a deliberately legacy connection sees the same tool surface as a modern one.

## [0.9.0]

Initial release.
