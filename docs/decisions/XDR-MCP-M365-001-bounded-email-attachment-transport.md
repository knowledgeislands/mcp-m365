---
id: XDR-MCP-M365-001
title: Bounded Email Attachment Transport
date: 2026-10-01
status: current
decision_type: security
decision_type_url: https://knowledgeislands.info/specifications/decision-records/xdr
---

# XDR-MCP-M365-001: Bounded Email Attachment Transport

## Context

Microsoft Graph represents file attachments with base64 `contentBytes` and supports listing message attachments separately from fetching a specific one. The existing routing PDF saver has filesystem authority for configured destinations, while general mail tools need a narrower caller-facing attachment boundary. Inline JSON composition also grows with base64 overhead and message body size.

## Decision

Keep general attachment tools independent of local files and OneDrive. List only bounded metadata pages; require an explicit attachment ID to return file bytes, cap decoded downloads at 256 KiB, and mark returned bytes untrusted. Reject item and reference attachment downloads. Bound Graph attachment responses during transport and validate metadata before and after download.

Accept only canonical base64 file attachments on standalone send and draft, with at most ten entries, 2 MiB decoded per file and in aggregate, and a serialized request smaller than 4,000,000 bytes. Validate before authentication or network use. Omit attachment input from audit logs and response bodies from attachment-call errors. Treat larger uploads as a separate future decision and authority scope.

## Consequences

Callers can inspect and move small file content through explicit MCP arguments without granting path access. Some legitimate large or non-file attachments cannot use this first surface. Base64 preserves bytes but does not make mail content safe to follow as instructions. The routing PDF saver remains a distinct, root-bound workflow.

## References

- [Microsoft Graph: list message attachments](https://learn.microsoft.com/en-us/graph/api/message-list-attachments?view=graph-rest-1.0)
- [Microsoft Graph: get an attachment](https://learn.microsoft.com/en-us/graph/api/attachment-get?view=graph-rest-1.0)
- [Microsoft Graph: fileAttachment resource](https://learn.microsoft.com/en-us/graph/api/resources/fileattachment?view=graph-rest-1.0)
