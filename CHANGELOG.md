# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file is maintained automatically by
[release-please](https://github.com/googleapis/release-please) — entries below
are generated from [Conventional Commits](https://www.conventionalcommits.org/)
on `main`. Edit only when manually overriding release-please output.

## [1.0.0] - 2026-05-09

### Added

- Initial release.
- Outlook tools: list/search/read/send/draft/mark-as-read/delete email; list/create/cancel/decline/delete events; list/create/rename/delete folders; move emails; list/create/edit-sequence rules.
- OneDrive tools: list, search, download, upload (small + chunked), share, create folder, delete.
- OAuth 2.0 authentication flow with token storage.

### Removed

- Power Automate / Flow API tools and configuration removed in favour of focusing on Outlook + OneDrive via Microsoft Graph.
