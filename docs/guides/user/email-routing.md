# Route mail with the routing engine

Use this guide to set up and run the deterministic email triage engine. It is the part of this server with the most moving parts and the most ways to go wrong quietly, so it is worth reading through before the first live run rather than during it.

The engine is a flat, ordered, first-match-wins rule list written in a small line DSL and executed mechanically. It is not an interpretation of your intent, and it holds no rule state of its own: your rule file is the single source of truth, read fresh on every call, so editing it takes effect without a restart.

This is distinct from the `m365_email_rule_*` tools, which manage Outlook's own server-side inbox rules. Those live in your mailbox; this engine lives here.

## Before you begin

- The server installed, connected, and signed in — see [Install and connect the server](installation.md) and [Sign in](authentication.md).
- `MCP_M365_ACCESS_LEVEL=destructive`. The three run tools are annotated destructive, so at any lower level they are not registered and the engine cannot act. `m365_email_routing_lint` is read-only and available at every level.
- `MCP_M365_TRIAGE_ROOTS` set to the directory holding your rule file. With no roots configured the engine does no file access at all, which means no rule file can be read and every call is refused.
- `pdftotext` on disk, only if you intend to save attachments.

## Set the filesystem roots

Everything the engine touches — the rule file, the tracking cache, an attachment destination — must resolve inside a configured root, or the call is refused. This is what makes a caller-supplied path safe: the blast radius is the directories you allowlisted and nothing else. The check is two-layer, lexical and then `realpath`, so neither a `..` traversal nor a symlink pointing out of a root gets through.

```bash
MCP_M365_TRIAGE_ROOTS=/path/to/your/knowledge-base
MCP_M365_TRIAGE_RULES_PATH=/path/to/your/knowledge-base/Mail Routing.md
```

`MCP_M365_ATTACHMENT_ROOTS` is separate and governs only where a `save-attachments:` action may write. The two do not widen each other: saving attachments has no business writing to the rule note, and the rule engine none writing into a destination folder. Set only what you need. Full descriptions are in [Configure the server](configuration.md).

Rules reach the engine three ways, in precedence order: the `rules` argument carrying the document inline, the `rulesPath` argument, or `MCP_M365_TRIAGE_RULES_PATH`. Either path form is read at call time.

## Write a rule file

Rules live in a fenced ` ```rules v1 ` block, one rule per logical line:

```text
predicates -> actions [# comment]
```

Juxtaposition is AND, `|` is OR across whole AND-groups, `!` negates a single predicate, and `*` matches everything — valid only as the mandatory final fallback.

- **Predicates:** `type:`, `party:`, `sender:`, `to:`, `cc:`, `subject:`, `body:`, `importance:`, `status:`, `age:`, `folder:`, `has:`, `thread:`, `forwarded-to:`, `category:`.
- **Actions:** `move:`, `tag:`, `untag:`, `mark:`, `save-attachments:`, `delete`, `suggest`, `hold`.

```text
sender:*@vendor.example.com !subject:sign  -> move:981 Delete   # keep signature requests visible
party:*@partner.example.com                -> move:111 Partner
subject:"NTN Forum" | subject:NTN-Forum    -> move:111 Partner
*                                          -> move:000 Unknown, suggest
```

A rule's actions run in written order and stop at the first failure. That ordering is load-bearing: put a `save-attachments:` before the `move:` that disposes of the message, and a failed save takes the move with it, leaving the mail in place for the next pass rather than filing something whose attachment was never captured.

`move:` targets are `_TRIAGE`-relative unless they contain a `/` or are quoted, as in `move:"Junk Email"`.

Address patterns match an exact address (`noreply@code.example.net`), any local part at a domain (`*@partner.example.com`), a local-part wildcard (`receipts+*@payments.example.net`), or a domain and its subdomains (`*@*.cloud.example.net`). A bare `*@domain` deliberately does **not** reach subdomains: if it did, a broad disposal rule would silently swallow a later, more specific subdomain rule, and first-match-wins means you would never see it happen.

Two blocks are recognised beyond `rules`: an `inbound` block, which `m365_email_routing_triage` applies to Inbox mail, and an `aged` block, which `m365_email_routing_aged` applies across the `_TRIAGE` subfolders as a retention pass.

## Follow a conversation to its folder

A reply often comes from someone no rule knows, with a subject no rule matches, so it falls to the fallback even though the rest of its conversation is already filed. Thread-follow files it with the rest:

```text
thread:filed -> move:@thread   # lint:allow-collision — a filed thread beats topic routing
```

`thread:filed` holds when another message in the same conversation sits in a filed folder, and `move:@thread` moves the message there. "Filed" is read from your rule file, so it changes when the rules do:

- Every `move:` target in the `inbound` block counts, except the fallback's. A sibling in `000 Unknown` says nothing about where the thread belongs.
- An archive that an `aged` rule fills from `folder:X` stands for `_TRIAGE/X`, so a reply to long-archived mail returns to the live folder, not the archive. An archive filled from two or more filed folders cannot say which, so a sibling there is skipped.

Place the line where it should take precedence. Rules above it decide first and cost no lookup; the conversation is read only for a message that reaches the line, once per conversation per call. A rule file with no `thread:` rule never reads a conversation, and behaves exactly as it did before thread-follow existed.

When the conversation is filed in more than one folder, the most recent filed sibling decides. The report item carries `thread.folder`, `thread.alternatives` for the other folders, and `thread.skipped` for any archive it could not resolve, and the text summary names them. If the lookup fails, the run reports it as a warning and the message falls through to the rules below.

`move:@thread` is defined only when `thread:filed` holds, so lint refuses a rule that uses it in any OR-arm without an un-negated `thread:filed`. A quoted `move:"@thread"` is an ordinary folder name. `thread:filed` also works in the `aged` block, for example `folder:"000 Unknown" thread:filed -> move:@thread` to re-file unknown mail once its thread has been filed.

## Archive an item once you have forwarded it

Some mail waits in a folder until you hand it on yourself, such as an invoice you forward to a finance mailbox. `forwarded-to:` lets an `aged` rule archive each one once the forward exists, instead of ageing the folder out on a timer:

```text
folder:"210 Held" forwarded-to:finance@example.com !status:flagged -> move:_ARCHIVE/Paid, mark:read
```

`forwarded-to:<address>` takes a full address, never a pattern, and can be negated. It holds when exactly one forward of the message exists that meets all four conditions:

- you sent it, from any address the signed-in account carries, and `<address>` is on its To or Cc line;
- its subject is `FW:` or `Fwd:` followed by the original's subject, compared after removing any further `RE:`, `FW:` and `Fwd:` prefixes and ignoring case and spacing;
- it was received after the original and no more than 90 days later;
- when both messages carry attachments, they share at least one file name.

A forward to an address you also receive exists twice in the mailbox, in Sent Items and as the copy that comes back. Both carry the same message id, so they count as one forward.

There are three outcomes:

- **One forward.** The predicate holds and the rule's actions run on the original. The forward copy is never touched; it follows whatever rule its own folder carries. The report item carries `forward` with the address, subject and received time of the forward, and the result counts these in `forwardMatched`.
- **Two or more forwards.** The predicate does not hold, so nothing moves. The result lists the message in `forwardAmbiguous` with the address and the number of candidates, and the text summary names it for you to decide by hand.
- **No forward.** The predicate does not hold and the run says nothing about it.

As with thread-follow, the lookup is lazy. The mailbox is searched only for a message whose other conditions in the same rule already hold, once per address and subject per call, and attachment names are read only when both messages have attachments. A failed lookup is reported as a warning and leaves the message where it is. A rule file with no `forwarded-to:` rule makes no extra call, and its result has neither `forwardMatched` nor `forwardAmbiguous`.

The original and its forward usually carry the same attachment, so put `save-attachments:` on one side of the pair only. Harvesting on both saves the document twice.

## Route on categories

`tag:` adds a category to a message, and three more terms let a rule read and act on what it finds there:

- `category:<name>` holds when the message carries that category, compared without regard to case, as Outlook compares them. It can be negated.
- `untag:<name>` removes the category and leaves the others in place. A message without it is left alone, with no write.
- `hold` claims the message and does nothing to it. It must be the rule's only action.

Quote a name that has a space in it, as in `category:"Routed: judged"`. A name may not contain `,` or `"`. `tag:` adds no second copy of a category the message already carries in another case.

A category can shield mail from the disposal rules below it for a while. In the `aged` block:

```text
category:"Routed: judged" age:30d folder:"981 Delete" -> untag:"Routed: judged"
category:"Routed: judged" -> hold
folder:"981 Delete" age:7d -> delete
```

The first line lets the shield lapse after thirty days. The second keeps every other judged message where it is, ahead of the disposal rule. A held message makes no Graph call and is not tracked. It does not count towards `maxActions` or keep `remaining` set. The result lists each one in `held`, with its rule line and ruleset, and the text summary gives the count. `held` is present only when the block has a `hold` rule.

Held messages are still read, though. Each folder is listed oldest first in a window one larger than `maxActions`, so a run of held mail at the old end of a folder can fill it. The pass then reports `remaining` with nothing acted on, which ends the batch loop below. Raise `maxActions` if that happens.

### Declare your categories

A ` ```categories v1 ` block lists the categories your rules use, one name per line. `#` comments and blank lines are ignored.

```text
Routed: judged
Routed: unsure   # set by the review step
```

Once the block exists, every `tag:`, `untag:` and `category:` name must be declared in it, and a run refuses a rule file that uses an undeclared name. That way a typo cannot leave a category on your mail for good, or make a shield rule silently do nothing. A name that differs from its declaration only in case still matches, but lint warns so that you spell each one a single way. A duplicate declaration is a parse error, as is a `key = value` line, which is reserved for a future provider setting.

The block is optional. Without it, names go unchecked. Lint gives one warning when a rule tests or removes a category, but says nothing about `tag:` used alone.

## Lint before you run

```text
m365_email_routing_lint
```

Static checks over the rule file, with no mailbox access at all: parse errors, unreachable rules, duplicates, broad-rule collisions, unknown move targets, `move:@thread` without `thread:filed`, a `forwarded-to:` value that is not a full address, undeclared attachment destinations, and undeclared or inconsistently cased category names. `thread:` counts as a broad predicate, so a thread-follow line above specific rules is reported until you mark it `# lint:allow-collision`. It is available at every access level, so you can iterate on a rule file on a server configured `read`.

Lint first, every time you edit the file. An unreachable rule is invisible at runtime — the mail simply goes somewhere else — and a broad-rule collision is the failure that first-match-wins makes hardest to spot by reading.

## Run in report mode, then live

Both run tools default to `mode: "report"`. That is the engine's equivalent of the `dry_run: true` default the destructive tools carry: it classifies, reports what it would do, and touches nothing. **Nothing is mutated until you pass `mode: "live"`.**

Run a full report pass and read it before the first live run. A rule file that lints cleanly can still be wrong about your intent, and report mode is the only cheap way to find that out.

```text
m365_email_routing_triage            # report — what would happen
m365_email_routing_triage mode:live  # execute
```

## Drive the batch loop

Both run tools are batch-bounded and resumable. A call acts on at most `maxActions` messages — 50 by default, 200 at most — and reports `remaining`. The caller loops:

> Loop while `remaining` is true and `acted` is above zero.

This keeps every call comfortably inside a client's request timeout without long-running calls or server-side cursors. Re-invoking after a partial run or a timeout is always safe, because classification moves a message out of the folder being scanned.

Both run tools are annotated `DESTRUCTIVE_ONESHOT_REMOTE` — destructive and explicitly _not_ idempotent, because repeating a call advances to the next batch rather than converging on the same end state. A client that retries them automatically on the assumption that a repeat is harmless will work through your mailbox faster than you expected, not redo the same work.

## Reconcile what you re-filed by hand

`m365_email_routing_drift` reports the messages you moved yourself after the engine filed them, and prunes the tracking cache accordingly. It returns the diff and writes no suggestions: deciding whether your hand-filing means the rule is wrong is your job, not the engine's.

It is batched the same way, but over the tracking cache rather than a mail folder: call again while `remaining` is above zero. Progress is held in a persisted sweep cursor — each entry records when it was last examined, and the file records when the current sweep began — so `remaining` counts what is left in _this_ pass and reaches zero once the pass has covered every tracked message. A caller polling on `remaining` therefore terminates after exactly one full scan, and the next invocation starts a fresh sweep.

The engine keeps one piece of state, the tracking cache, recording what it routed where. Message identity there is subject plus sender plus received timestamp, never the Graph id, because Graph reissues ids when a message moves between folders. Every run reports which tracking file it used, so a mistaken override shows up on the first run rather than the fifth.

## Save attachments out of a message

A rule may lift attachments out of a message before disposing of it:

```text
folder:"282 HNR Finance" has:attachment subject:receipt -> save-attachments:receipts, move:_ARCHIVE/Internal/Finance, mark:read
```

`save-attachments:<name>` writes the message's PDF attachments into a destination the rule file declares, naming each one `YYYY-MM-DD_vendor_amount.pdf` from the received date, the subject, and the transaction total read out of the document.

The destination is declared beside the rules, in a ` ```destinations v1 ` block of `name = path` lines:

```text
receipts = ~/Library/CloudStorage/OneDrive-Example/Exec/Receipts
```

A rule line names `receipts`; the declaration says where `receipts` is. Repointing it is one edit in one place rather than one per rule.

This is a rule action rather than a tool of its own because of where the policy lives. Which mail gets saved, and what becomes of it afterwards, is policy, so it belongs in the rule file with the rest of the routing and is reviewed the same way. Where a destination points is policy too, so the file declares that as well. What the file may _not_ choose is whether it writes outside the permitted area: attachments are attacker-supplied bytes and rules are data read off disk, so `MCP_M365_ATTACHMENT_ROOTS` is the boundary. A destination that oversteps it, or a rule naming a destination the file never declared, is a blocking lint error that refuses the whole run rather than failing one message at a time.

Behaviour worth knowing before the first live run:

- **The amount comes from the PDF, never from the email body.** Receipt mail routinely quotes several money values, and the transaction total is not reliably the first or the largest. Text extraction shells out to `pdftotext` (`MCP_M365_PDFTOTEXT_PATH`); a document it cannot read is filed as `no-amount` rather than given a plausible wrong figure.
- **Only non-inline `.pdf` attachments are saved,** each capped at 25 MB.
- **An existing filename is never overwritten.** A clash gains `-2`, then `-3`.
- **A message carrying no PDF is a success, not a failure.** `has:attachment` is true of an inline signature image too, and failing would wedge that mail in the triage folder on every subsequent run.
- **A part-written message is rolled back,** so a retry cannot duplicate files that had already been written.

## Recover from a failure

- **`Refusing to access the … : no roots are configured. Set MCP_M365_TRIAGE_ROOTS to the directories the engine may use.`** — no roots. The engine does no file access at all in this state. Set `MCP_M365_TRIAGE_ROOTS` and restart the server.
- **`… it resolves outside the configured roots (…)`** — the path is real but outside the allowlist. Either widen the roots deliberately or move the file inside them. Note that a symlink pointing outside a root is rejected too, by design.
- **The routing tools are not offered by the client.** They are destructive and are not registered below `MCP_M365_ACCESS_LEVEL=destructive`. `m365_email_routing_lint` is the exception and stays available.
- **Mail lands in the wrong folder.** First-match-wins: an earlier, broader rule matched first. Run the lint tool, which reports broad-rule collisions and unreachable rules, and reorder rather than adding a narrower rule below the one that is catching everything.
- **A live run stops before the folder is empty.** That is the batch bound, not a failure. Check `remaining` and call again.
- **A destination is rejected at lint time.** Either it points outside `MCP_M365_ATTACHMENT_ROOTS`, or a rule names a destination the ` ```destinations ` block never declared. Both refuse the whole run deliberately.
- **Saved PDFs are named `no-amount`.** `pdftotext` could not read the document. Check `MCP_M365_PDFTOTEXT_PATH` points at a real poppler binary; a scanned image PDF with no text layer will produce this regardless.
