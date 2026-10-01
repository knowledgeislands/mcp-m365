# Preview, draft, and send a reply

Use `m365_email_message_reply` to reply to the sender of an existing message, or `m365_email_message_reply_all` when every original recipient should be included under Microsoft Graph's rules. Both tools require `MCP_M365_ACCESS_LEVEL=write` or higher. Find the message with `m365_email_messages_search` or `m365_email_messages_list` and use its exact `id`.

Call the chosen tool with the message `id` and a plain-text `comment`. The default `dry_run: true` fetches the original message's metadata and describes the action without sending anything. Check the subject and chosen action. The preview does not determine or display the final recipient list; Graph owns that derivation and the reply threading.

When you intend to send, repeat the same call with `dry_run: false`. The server makes one Graph `reply` or `replyAll` request and does not retry it automatically. A successful response means Graph accepted the action for delivery; it is not a delivery receipt. Do not repeat an ambiguous failed or timed-out send without checking Outlook's Sent Items and the original conversation first.

These first-version send tools accept only the original message ID and a bounded plain-text comment. They do not accept arbitrary recipient or message overrides.

If you want to review a threaded message in Outlook first, use `m365_email_draft_reply` or `m365_email_draft_reply_all` with the original `id` and an optional comment. For a forward draft, use `m365_email_draft_forward` with the original `id`, 1 to 50 recipient addresses, and an optional comment. Each draft action also defaults to `dry_run: true`; pass `dry_run: false` to create the draft. The result includes the new draft ID and subject so you can find it in Outlook. Graph prepares the quoted original content and reply recipients; these tools never send or replace the prepared body. If a creation call fails ambiguously, inspect Drafts before retrying to avoid duplicates.

`m365_email_draft_create` remains a standalone draft for a new message. It does not promise a threaded reply to an existing conversation. Draft actions require `write` access and Graph's `Mail.ReadWrite` permission.
