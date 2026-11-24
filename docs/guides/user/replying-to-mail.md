# Draft a reply, reply-all, or forward

The server is draft-only: it never sends. To answer an existing message, it saves a draft in your Outlook Drafts folder, and you review and send it from Outlook yourself. No access level or setting changes that.

Find the message with `m365_email_messages_search` or `m365_email_messages_list` and use its exact `id`. Then use `m365_email_draft_reply` to reply to the sender, or `m365_email_draft_reply_all` when every original recipient should be included under Microsoft Graph's rules, with the original `id` and an optional comment. For a forward draft, use `m365_email_draft_forward` with the original `id`, 1 to 50 recipient addresses, and an optional comment. Each draft tool requires `MCP_M365_ACCESS_LEVEL=write` or higher and Graph's `Mail.ReadWrite` permission.

Each draft tool defaults to `dry_run: true`, which fetches the original message's metadata and describes the draft without creating it. Pass `dry_run: false` to create the draft. The result includes the new draft ID and subject so you can find it in Outlook. Graph prepares the quoted original content and reply recipients, and carries the original attachments into a forward; these tools never send or replace the prepared body. If a creation call fails ambiguously, inspect Drafts before retrying to avoid duplicates.

`m365_email_draft_create` saves a standalone draft for a new message. It does not promise a threaded reply to an existing conversation.
