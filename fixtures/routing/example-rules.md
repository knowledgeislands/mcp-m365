# Example Routing Rules

A **synthetic** rule file used by the test suite. Every address here uses a domain reserved by RFC 2606 / RFC 6761 (`example.com`, `example.net`, `example.org`, `.invalid`, `.test`), and every folder name is generic. Nothing in this file describes a real mailbox, correspondent, or filing taxonomy.

It is deliberately small — around forty rules rather than a real file's several hundred — but it exercises every construct in the grammar and every ordering hazard the engine is meant to catch. The suite asserts behaviour classes, not anybody's routing table.

Constructs covered, and where to find them below:

| Construct                                 | Rule                                                   |
| ----------------------------------------- | ------------------------------------------------------ |
| Absolute override, marked collision       | `status:flagged` (rule 1)                              |
| Broad rule hoisted above specific ones    | `type:calendar-invite`                                 |
| Carve-out above the rule it escapes       | `sender:noreply@example.com subject:"Payment Receipt"` |
| AND by juxtaposition                      | `party:*@partner.example.com subject:renewal`          |
| OR across AND-groups                      | `subject:widget \| subject:widgets \| body:widget`     |
| Negation                                  | `sender:*@notify.example.net !subject:security`        |
| Exact address                             | `billing@vendor.example.com`                           |
| Any local part at a domain                | `*@partner.example.com`                                |
| Local-part wildcard                       | `receipts+*@vendor.example.com`                        |
| Domain **and** subdomains                 | `*@*.cloud.example.net`                                |
| Bare wildcard does _not_ reach subdomains | `*@example.org` vs `*@lists.example.org`               |
| Recipient predicates                      | `to:`, `cc:`                                           |
| Importance                                | `importance:high`                                      |
| Quoted values with spaces                 | `subject:"Payment Receipt"`                            |
| Mandatory fallback                        | `*` (last rule)                                        |
| Retention by age                          | the `aged` block                                       |

---

## Inbound

```rules v1
# ===== Absolute overrides =====
# Rule 1: pre-empts everything below, disposal included. Marked, because the
# collision is the entire point of putting it here.
status:flagged                                          -> move:102 Urgent   # lint:allow-collision

# A broad type rule placed above the topic rules on purpose: every invitation
# collects in one folder to be resolved, rather than being filed by subject.
# This is the ordering hazard the `broad-rule-collision` check reports.
type:calendar-invite                                    -> move:101 Do       # lint:allow-collision

# ===== Carve-outs =====
# Narrow rules rescued from the broad disposal rules further down. First match
# wins, so an exception must sit ABOVE the rule it is an exception to; placed
# below, it would be unreachable and the `shadowed-rule` check would say so.
sender:noreply@example.com subject:"Payment Receipt"    -> move:282 Finance
sender:updates@lists.example.org                        -> move:451 Read Later

# ===== Noise =====
type:calendar-response                                  -> move:981 Delete
type:calendar-update                                    -> move:981 Delete

# ===== Topic routing =====
# Ordering matters here: the narrower topic must precede the broader one, or
# the broader one swallows it. `lighthouse` before the general partner rule.
body:lighthouse                                         -> move:112 Lighthouse
party:*@partner.example.com subject:renewal             -> move:263 BizDev
party:*@partner.example.com                             -> move:111 Partner
subject:widget | subject:widgets | body:widget          -> move:221 Widgets
to:events@example.com                                   -> move:251 Events
cc:legal@example.com                                    -> move:285 Legal
importance:high                                         -> move:102 Urgent

# ===== Vendors =====
sender:billing@vendor.example.com                       -> move:282 Finance
sender:receipts+*@vendor.example.com                    -> move:311 Expenses
sender:*@*.cloud.example.net                            -> move:981 Delete
sender:*@notify.example.net !subject:security           -> move:981 Delete

# ===== Disposal =====
sender:*@example.org                                    -> move:981 Delete
sender:*@lists.example.org                              -> move:981 Delete
sender:*@bulk.example.invalid                           -> move:991 Junk
sender:noreply@example.com                              -> move:981 Delete

# ===== Fallback =====
* -> move:000 Unknown, suggest
```

---

## Aged

```rules v1
folder:"111 Partner"  age:7d !status:flagged  -> move:_ARCHIVE/Partner, tag:partner, mark:read
folder:"282 Finance"  age:7d !status:flagged  -> move:_ARCHIVE/Finance, mark:read
folder:"981 Delete"   age:7d !status:flagged  -> delete
folder:"991 Junk"     age:7d !status:flagged  -> move:"Junk Email"
folder:"102 Urgent"   status:unflagged        -> move:000 Unknown
```
