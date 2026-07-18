---
code: FND
---

# Foundation tooling roadmap

## Blocking

Actively broken, or blocking the `Next` horizon: takes priority over everything else and must clear before `Next` work proceeds. Empty means nothing is on fire.

## Next

Scoped and ready to start — the immediate queue, picked up before anything in **Soon** or **Future**.

## Soon

Understood and roughly scoped but not yet started — worth doing once the **Next** queue clears, ahead of anything still speculative.

### Replace hand-rolled OAuth refresh with MSAL

Replace the custom OAuth refresh implementation in [auth/index.ts](../../../src/main/auth/index.ts) with `@azure/msal-node`, preserving the existing token-file shape and `ensureAuthenticated` call sites through a deliberate migration.

## Waiting for

Worth doing, but presently blocked on an external dependency or decision. Revisit when its named condition changes rather than treating it as dormant local work.

## Future

Speculative or not yet scoped — items marked _(candidate)_ need a scoping pass (or a decision to drop them) before they're actionable.
