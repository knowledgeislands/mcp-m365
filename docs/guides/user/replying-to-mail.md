# Preview and send a reply

Use `m365_email_message_reply` to reply to the sender of an existing message, or `m365_email_message_reply_all` when every original recipient should be included under Microsoft Graph's rules. Both tools require `MCP_M365_ACCESS_LEVEL=write` or higher. Find the message with `m365_email_messages_search` or `m365_email_messages_list` and use its exact `id`.

Call the chosen tool with the message `id` and a plain-text `comment`. The default `dry_run: true` fetches the original message's metadata and describes the action without sending anything. Check the subject and chosen action. The preview does not determine or display the final recipient list; Graph owns that derivation and the reply threading.

When you intend to send, repeat the same call with `dry_run: false`. The server makes one Graph `reply` or `replyAll` request and does not retry it automatically. A successful response means Graph accepted the action for delivery; it is not a delivery receipt. Do not repeat an ambiguous failed or timed-out send without checking Outlook's Sent Items and the original conversation first.

These first-version tools accept only the original message ID and a bounded plain-text comment. They do not accept arbitrary recipient or message overrides. If you need to review and edit a composed message in Outlook before sending, `m365_email_draft_create` saves a standalone draft; it does not promise a threaded reply to the original. Keep the draft separate from the reply tools' explicit send path.
