# ADR-0023: `UnitOfWork.executeResultInTransaction` — a Result-aware transaction seam

- **Status**: Accepted
- **Date**: 2026-09-15
- **Deciders**: Edward
- **Supersedes**: —
- **Superseded by**: —
- **Amends**: ADR-0005 (Unit of Work with `PrismaUnitOfWork` + `AsyncLocalStorage`), additively

## Context

ADR-0005 gave every mutating use case one transaction seam,
`UnitOfWork.executeInTransaction(fn)`, and CLAUDE.md §Unit of Work fixed the
shape callers use:

```typescript
let result: Result<Output, UseCaseError> = ok(undefined) as Result<Output, UseCaseError>;
await this.unitOfWork.executeInTransaction(async () => {
  result = await doWork();
});
return result;
```

That capture is the hole. `doWork()` returns a `Result`; an `err` is stored in
`result` and the callback **resolves normally**. An interactive Prisma
transaction commits unless its callback rejects, so the Unit of Work sees a
success and **COMMITS** — the `err` is then handed back to the caller as if
nothing had been written.

For a single-statement save that is harmless: the statement either executed or
it did not. It stops being harmless the moment a save is **multi-statement**.
`PrismaPostRepository.save()` catches everything into an `err`
(`packages/adapters/db-prisma/src/post/PrismaPostRepository.ts:84-98`), and
its `doUpdate` issues four groups of statements in sequence: the OCC row update
with `version: { increment: 1 }` (`:684`), the content rows (`:712`), the media
rows (`:731-773`), and finally the outbox rows (`:776`). A failure raised on the
JS side **after the first statement** — `writeEvents` throwing before it issues
its own statement is the concrete one — is caught by `save()`, returned as
`err`, resolved by the callback, and the transaction commits a row whose status
advanced with **no event in the outbox**.

That is precisely the state the `post-publish-status-integrity` capability
forbids ("the commit SHALL be all-or-nothing: a failure at any point leaves the
post exactly as it was, with no event in the outbox"), and it is not reachable
through any database-level failure: PostgreSQL aborts the transaction itself
when a **statement** fails. The exposure is the JS-side path exclusively, which
is why it survived every existing test — nothing in the suite injected it.

The constraint that makes this awkward is canon, not preference. Fitness **#4**
holds `packages/core` at hard-zero raw `throw` statements, and the application
core must keep returning `Result`. So the abort cannot be expressed as a throw
written in the core — and an interactive transaction aborts **only** by
rejecting.

Fitness #4 already anticipated this. Its `GatewayBillingService.ts` /
`TrialManagementService.ts` exception carries a remove-when that names exactly
this seam. Quoted from the check's canonical home, `CLAUDE.md` §Automated
Compliance Checks #4, as that text stood at the time of this decision:
_"Remove-when: UnitOfWork exposes an explicit abort so a callback can signal
rollback without throwing."_ The `.github/workflows/fitness.yml` mirror carried
the same intent in shorter words at `:151` (_"Remove-when: UnitOfWork exposes an
explicit abort."_) — the two mirrors were never byte-identical prose, so this
ADR quotes the canonical one rather than asserting a shared verbatim string that
would go stale the moment either mirror is reworded. Those 15 throws exist
because the seam had no other way to say "roll back".

## Decision

**Extend the `UnitOfWork` domain port additively with a Result-aware sibling.**

```typescript
// packages/core/domain/src/repositories/Repository.ts
export interface UnitOfWork {
  executeInTransaction<T>(fn: () => Promise<T>): Promise<T>; // unchanged
  executeResultInTransaction<T, E>(fn: () => Promise<Result<T, E>>): Promise<Result<T, E>>;
}
```

Contract:

- `ok(value)` **commits** and is returned unchanged.
- `err(error)` **rolls back** and is returned unchanged, **as a value**. The
  caller narrows on `.ok`. Nothing is raised across the layer boundary.
- A genuine failure raised by the work itself — transaction timeout, lost
  connection, the tenant guard refusing an unscoped query — is not a `Result` at
  all: that throw propagates to the caller untouched and is never converted into
  an `err`.

`PrismaUnitOfWork` implements it **on top of `executeInTransaction`**
(`packages/adapters/db-prisma/src/unitofwork/PrismaUnitOfWork.ts`): a module-private
`TransactionRollbackSignal`, created per call and compared by identity, is
thrown inside the existing `$transaction` callback when the work resolves to
`err`, and unwrapped by the same method outside it. Consequences of implementing
it that way rather than as a second transaction:

- the GUC binding (`set_config('app.account_id', …, true)`) is still the first
  statement, so RLS layer 2 is in force identically;
- the `runWithBoundGuc` marker and the `AsyncLocalStorage` transaction client
  are the same ones every repository already detects;
- there is **no second `$transaction` call**, so `PrismaUnitOfWork` stays the
  single named seam fitness **#40 Part A** allowlists.

The one throw lives in `apps/api` infrastructure, which is outside fitness #4's
scope, so the core stays at hard-zero and **#4's exception list gains no name**.

`executeInTransaction` is byte-unchanged. Its ~50 existing callers keep their
exact semantics.

## Rationale

1. **The abort signal is the `Result`.** The core says "this failed" the only
   way canon allows — by returning `err` — and the infrastructure adapter
   translates that into the rejection an interactive transaction requires. The
   translation happens once, in one file, at the layer that owns the
   technology.
2. **It satisfies fitness #4's own remove-when.** The gate asked for "an
   explicit abort so a callback can signal rollback without throwing". This is
   that abort, and it is now available to the 15 billing throws — see
   Consequences for why they do not move here.
3. **Additive, so nothing existing changes meaning.** Changing
   `executeInTransaction` in place would silently alter every caller that passes
   its work straight through (`TrialManagementService.ts:57`,
   `RequestPasswordResetUseCase.ts:119`, …). A shared seam must not change
   meaning by accident; a new member cannot.
4. **One seam, one set of guarantees.** Implementing on top of the existing
   method rather than beside it means the GUC binding, the transaction marker
   and the client propagation cannot drift between the two forms.

## Alternatives Considered

- **Make `PrismaPostRepository.save()` rethrow when it runs inside a Unit of
  Work.** Rejected on two counts. It is an **instance fix**: every other
  repository's `save()` swallows failures the same way, so the class stays open
  and the next multi-statement aggregate re-opens the same hole. And it makes a
  throw a _designed_ element of the adapter→application boundary, which is what
  ADR-0006 (Result over throws) exists to prevent.
- **An `abort()` token passed into the callback.** Rejected: calling
  `ctx.abort()` and having it unwind the callback is a throw wearing a method
  name. It puts control flow that raises back into core code, just spelled
  differently, and the core would then have two ways to fail.
- **Change `executeInTransaction` to inspect the returned value and roll back on
  `err`.** Rejected: it changes the meaning of a seam ~50 callers already use,
  silently, for the callers that return a `Result` straight through. A caller
  that today relies on receiving an `err` back from a committed transaction
  would start seeing a rollback with no diff to point at.
- **Leave it and rely on the outbox relay to notice.** Rejected: the committed
  state IS the defect. There is no later actor that can distinguish "published
  with a lost event" from "published normally" once the row says `PUBLISHED`.

## Consequences

**Positive**

- A multi-statement save whose JS-side failure is caught into an `err` no longer
  commits partially — the transaction aborts and the caller receives the same
  `err` object.
- Fitness #4's remove-when is met; the gate's exception list is unchanged and
  the core stays at hard-zero throws.
- The 15 billing throws now have a canon-sanctioned destination, so their
  exception entry stops being open-ended debt and becomes a scheduled migration.

**Negative / costs**

- **Two seams to choose between.** A caller who picks `executeInTransaction` for
  Result-returning work gets the old behaviour with no warning. The port JSDoc
  and the canon paragraph state the rule; nothing enforces it mechanically yet.
- **Every `UnitOfWork` test double had to gain the member** — **53 definition
  sites across 52 files**. Measured and material: **no `*.test.ts` file is in any
  typecheck program** in this repo (`apps/api/tsconfig.json` includes `src`
  only; each `packages/core/*/tsconfig.json` includes `src/**/*`), so `tsc` can
  never report a stale double. The completion signal is the measured count of
  definition sites, not a green typecheck.
- **That count must be taken SHAPE-AGNOSTICALLY, and the first attempt was not.**
  A `executeInTransaction\s*:` regex sees only `key: value` doubles. It is blind
  to **method shorthand** (`async executeInTransaction<T>(fn) { … }`, e.g.
  `apps/api/tests/unit/unitOfWork.useCases.test.ts`) and to **property shorthand**
  (`const executeInTransaction = vi.fn(…); const uow = { executeInTransaction }`,
  e.g. `apps/api/tests/unit/application/listening/DispatchMentionSearchUseCase.test.ts`).
  Both shapes exist in-tree; both were missed, and a colon-only completion gate
  reported the sweep finished while two doubles still lacked the member. The
  sound measurement is a set difference over FILES: files mentioning
  `executeInTransaction` at all, minus files mentioning
  `executeResultInTransaction`, minus files that construct the real
  `PrismaUnitOfWork` (those are callers, not doubles). That remainder must be
  empty — verified empty here, with the five real-UoW caller suites
  (`customerPasswordReset.integration`, `post-trio-tenant-isolation`,
  `tenantGucTransactionBinding`, `softDeleteJoinsUnitOfWork`,
  `tenantTransactionNesting`) correctly excluded rather than swept.
- **A deterministic JS-side save failure now fails loudly instead of committing
  a wrong state.** Work that previously "succeeded" with a partial write now
  returns `err` every attempt. For a retryable saga step that means retrying to
  exhaustion and failing post-pivot. That is the correct trade — a visible
  failure beats a committed wrong state — but it is a behaviour change for any
  path that migrates onto the new seam.
- **The new method deliberately takes no `options?` parameter.** The port's
  `executeInTransaction` never had one either — `TransactionOptions` (timeout,
  isolation level) is an adapter-level concern that `PrismaUnitOfWork` owns, not
  part of the technology-free contract. Canon requires a test for every new
  public surface, no planned caller needs a custom timeout, and an untested
  parameter added for symmetry is a larger surface bought with nothing. It is one
  line to add the day a caller actually needs it, with its test.
- **The billing migration is explicitly DEFERRED** (signed): migrating the 15
  throws in `GatewayBillingService.ts` and `TrialManagementService.ts` is its
  own change, with its own bounded context and its own regression tests. This
  ADR only records that their remove-when is now met; the fitness #4 comment
  says the same in both of its mirrors.

## Revisit if

A second `UnitOfWork` implementation appears (a non-Prisma store, an in-memory
one for integration harnesses) and the sentinel-based translation cannot be
expressed there. The port contract is technology-free and would survive; only
the adapter's mechanism would need rewriting.

Also revisit if `executeInTransaction`'s remaining Result-returning callers are
all migrated. At that point the two seams collapse into one and
`executeInTransaction` can be reserved for genuinely throw-based work — or
retired.

## Risks and Mitigations

| Risk                                                                                                      | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A new mutating use case picks `executeInTransaction` for Result work and silently commits a partial write | The port JSDoc states the rule at the point of use, and `ARCHITECTURE_CANON.md §Unit of Work` carries the paragraph. A fitness check that detects the `let result` capture over a multi-statement save is a candidate follow-up, not shipped here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| The rollback signal escapes to a caller                                                                   | It is module-private, instantiated per call, compared by identity, and unwrapped by the method that created it. The unit suite asserts the `err` comes back as the same object and that a foreign throw propagates untouched.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| The sentinel is mistaken for a real failure by an outer `catch`                                           | It cannot reach one: the only `catch` that sees it is the method's own, and anything that is not the per-call instance is rethrown unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A stale test double hands a future caller `undefined`                                                     | No typecheck covers test files (see Consequences), so the sweep was completed against a measured count of definition sites and that count is recorded in the change's apply-progress. The count is taken shape-agnostically — a colon-only regex is blind to method and property shorthand and reported the sweep complete with two doubles still missing the member.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **The sentinel is REPLACED rather than propagated, so the `err` degrades into a throw**                   | One branch is known and accepted. `executeInTransaction` delegates to Prisma's interactive `$transaction`; if the transaction has already expired, Prisma rejects with its **own** `P2028` (transaction not found / already closed) instead of re-throwing the callback's `rollbackSignal`. The identity check at `PrismaUnitOfWork.ts:151` (`error === rollbackSignal`) then correctly declines to claim it — a foreign error must never be laundered into the captured `err` — and rethrows, so a caller whose work returned `err` receives a **throw**. This is the safe direction (a loud failure, not a silent commit) and the outer `classifyPersistenceFailure` in the consuming use case absorbs it into `TRANSIENT_FAILURE`. It is untestable against the mocked client used in the unit suite, which is why the real-Prisma proof is deferred to the integration harness (change task T3.10, PR 3). |

## References

- ADR-0005 — Unit of Work with `PrismaUnitOfWork` + `AsyncLocalStorage` (the seam this extends)
- ADR-0006 — Result type over throws (why the abort cannot be a throw in the core)
- ADR-0008 — Saga pattern; outbox events share the transaction with the state mutation
- `CLAUDE.md` §Automated Compliance Checks — fitness #4 (raw throws), #40 (one transaction seam)
- `.github/workflows/fitness.yml` — fitness #4's remove-when, now met
- Port: `packages/core/domain/src/repositories/Repository.ts`
- Adapter: `packages/adapters/db-prisma/src/unitofwork/PrismaUnitOfWork.ts`
- Unit proof: `apps/api/tests/unit/infrastructure/PrismaUnitOfWork.test.ts`
- The hole it closes: `packages/adapters/db-prisma/src/post/PrismaPostRepository.ts:84-98` (`save`), `:684`–`:776` (`doUpdate`)
