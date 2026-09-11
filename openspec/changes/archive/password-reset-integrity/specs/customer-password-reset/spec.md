# Customer Password Reset — Delta Spec (password-reset-integrity / PR-1)

> **NEW capability** for change `password-reset-integrity`. Capability: **the customer
> password-reset pair (`POST /auth/customer/request-password-reset` and
> `POST /auth/customer/reset-password`) actually changes the password, exactly once per
> token, for exactly the account that token belongs to — proven against the PERSISTED row
> through the guarded Prisma client.**
>
> **Why the outcome, not the call shape, is the whole subject.** Today the confirm writes
> the new hash and then reverts it from a stale 19-column entity snapshot while reporting
> success, and the existing unit test asserts precisely that two-write call shape — so it
> CERTIFIES the defect and stays green under any fix. Every acceptance scenario below is
> therefore written against stored state (`argon2.verify(STORED hash, …)`, the stored token
> columns, the stored `deletedAt`), never against a double's recorded arguments.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Requirements marked
> **[MERGE-BLOCKING]** gate PR-1.
>
> **Scenario tags.** `[integration]` — requires a real-DB run through the GUARDED client
> (`app.inject` HTTP or the wired use case); a mocked run CANNOT prove a guarantee that
> lives in the database or in the Prisma extension. `[unit]` — vitest against a STATEFUL
> fake of the **Prisma client** (never of the repository), so the adapter's real write
> construction executes. `[static]` — checkable by inspecting source or config.
>
> **Decisions already taken (Edward, 2026-09-11), stated so they are not re-litigated:**
> `TOKEN_EXPIRED` COLLAPSES into `INVALID_TOKEN` for this flow (verified zero client
> consumers); the D3 e-mail shape is ONE e-mail carrying one link per matching account.
>
> **Non-goals.** The admin `PasswordService` reset (different table, not tenant-enrolled)
> is a named successor slice and is NOT touched here; token-at-rest hashing and moving the
> token out of the e-mailed URL are out of scope; the client-portal path mismatch
> (`/reset-password/confirm` vs the backend's `/reset-password`) is filed with the
> successor slice — backend acceptance is proven via `app.inject`, not through the portal.

---

## ADDED Requirements

### Requirement: The reset pair executes under the guarded client and is never affected by a previous request's context **[MERGE-BLOCKING]**

Both reset endpoints SHALL execute their use case against the guarded Prisma client and
return their contract responses: no `TenantContextMissingError` (and nothing derived from
it) on a legitimate request. The seam obligation itself lives in the
`tenant-context-boundaries` capability; this requirement is the reset-flow acceptance of it.

A reset SHALL operate on the row named by its own token regardless of any tenant context
bound earlier on the same connection. `enterTenantContext` is irreversible within its async
frame and nothing clears it at response end, so a leak across a keep-alive connection would
silently run a reset under a FOREIGN account — a worse outcome than today's failure, and one
only a real-connection run can settle.

#### Scenario: both endpoints answer their contract response [integration]

- **GIVEN** a seeded customer user and a live reset token
- **WHEN** `request-password-reset` and `reset-password` are called through `app.inject` against the guarded client
- **THEN** both answer 200 with their contract bodies, and no `TenantContextMissingError` (nor any error derived from it) is raised anywhere in either flow

#### Scenario: a reset is unaffected by a prior request's bound tenant [integration]

- **GIVEN** an authenticated request for account A has just completed on a keep-alive connection, and account B owns a live reset token
- **WHEN** the confirm for B's token is issued on that SAME connection
- **THEN** B's row is claimed and B's password changes, A's row is untouched, and the result does not depend on A's context having been bound first

---

### Requirement: The confirm is ONE atomic, count-gated claim **[MERGE-BLOCKING]**

The confirm SHALL persist the new password hash and consume the token in a SINGLE
conditional write whose predicate names, together: the presented token, an expiry strictly
in the future, and `deletedAt: null`. Success SHALL be gated on exactly ONE row having
matched; any other count SHALL fail the request and change nothing.

No second write SHALL follow the claim in the same flow. A whole-entity snapshot write
after the claim reverts the hash the claim just stored, which is the defect this capability
exists to retire — so the prohibition is on the flow's SHAPE, not only on its outcome.

#### Scenario: the reset actually changes the stored password [integration]

- **GIVEN** a customer user with stored hash `H_old` and a live reset token
- **WHEN** the confirm succeeds with `newPassword`
- **THEN** reading the row back through the guarded client yields a stored hash `H_new` where `argon2.verify(H_new, newPassword)` is true AND `argon2.verify(H_new, oldPassword)` is false, and the stored `resetToken` and `resetTokenExpiry` are both null

#### Scenario: the persisted outcome survives the whole use case, not just the first write [unit]

- **GIVEN** a stateful Prisma-client fake holding the row, and a use case constructed with the real adapter over that fake
- **WHEN** the confirm runs to completion
- **THEN** the fake's FINAL stored hash verifies against `newPassword` — no later write in the flow restores the entity's in-memory hash

#### Scenario: concurrent replay yields exactly one success [integration]

- **GIVEN** one live token and two confirms submitting DIFFERENT new passwords, both started before either completes
- **WHEN** both run against the real database
- **THEN** exactly ONE returns success and the other returns `INVALID_TOKEN`; the stored hash verifies against the winner's password and against no other; the token columns are null

#### Scenario: sequential replay fails and changes nothing [integration]

- **GIVEN** a token already consumed by a successful confirm
- **WHEN** the same token is presented again with a different new password
- **THEN** the request fails with `INVALID_TOKEN` and the stored hash is byte-identical to the one the first confirm stored

#### Scenario: expiry is enforced by the claim predicate itself [integration]

- **GIVEN** a token whose `resetTokenExpiry` is in the past
- **WHEN** the confirm is submitted
- **THEN** zero rows match, the request fails, the stored hash is unchanged, and the expired token columns are NOT nulled by the failed attempt

#### Scenario: a soft-deleted owner is never reset nor resurrected [integration]

- **GIVEN** a customer user whose `deletedAt` is set and whose reset token is otherwise live
- **WHEN** the confirm is submitted with that token
- **THEN** zero rows match, the stored hash is unchanged, and `deletedAt` is unchanged — the write neither resets nor revives a deleted user

#### Scenario: no snapshot write follows the claim [static]

- **GIVEN** the confirm flow after the change
- **WHEN** its writes are inspected
- **THEN** exactly one write reaches the customer-user row, and no whole-entity save runs after it

---

### Requirement: One failure code for every unusable token **[MERGE-BLOCKING]**

Unknown, malformed, expired, already-claimed, and soft-deleted-owner tokens SHALL be
answered with ONE code and ONE message — `INVALID_TOKEN`, HTTP 400. `TOKEN_EXPIRED` SHALL
be REMOVED from this flow's error union and from its route error map. Distinguishing the
classes is a token-validity oracle, and the single-statement claim cannot distinguish them
without a second query issued for no purpose but to build that oracle. (Admin reset codes
are a different flow and are unchanged.)

#### Scenario: every bad-token class is indistinguishable to the caller [integration]

- **GIVEN** four confirms carrying, respectively, an unknown token, an expired token, an already-claimed token, and a live token whose owner is soft-deleted
- **WHEN** each is submitted
- **THEN** all four responses are identical in status, code, and message

#### Scenario: the expired-token code is gone from the flow [static]

- **GIVEN** the change is applied
- **WHEN** the customer reset use case's error union and the customer reset route's error map are inspected
- **THEN** neither mentions `TOKEN_EXPIRED`

---

### Requirement: One reset token per user row **[MERGE-BLOCKING]**

A request for an e-mail address present in N accounts SHALL issue N DISTINCT tokens, one
persisted per row. Reusing one token across rows collides on a globally-unique column: one
arbitrary row wins and the rest fail — today silently, because the per-row write results are
discarded. A per-row write failure SHALL NOT be discarded: it SHALL be observable, and no
link whose token was not persisted SHALL be e-mailed.

#### Scenario: N accounts receive N distinct persisted tokens [integration]

- **GIVEN** one e-mail address registered in 3 accounts
- **WHEN** a reset is requested for it
- **THEN** all 3 rows carry a non-null `resetToken`, the 3 values are pairwise distinct, and no unique-constraint failure occurs

#### Scenario: each token claims only its own row [integration]

- **GIVEN** the 3 tokens from the scenario above
- **WHEN** the second account's token is confirmed with a new password
- **THEN** only that account's stored hash changes and only its token columns are cleared; the other two rows keep their original hash and their still-live tokens

#### Scenario: an unpersisted token is never e-mailed and never silent [unit]

- **GIVEN** a Prisma-client fake in which the write for one of the matched rows fails
- **WHEN** the request runs
- **THEN** the failure is surfaced (returned or logged — not discarded) and the sent e-mail contains no link for that row

---

### Requirement: The request response is uniform and the e-mail carries one link per account **[MERGE-BLOCKING]**

The request endpoint SHALL answer identically whether the address matches zero, one, or N
rows — the anti-enumeration silhouette is preserved by the per-user-token change, not
weakened by it. When at least one row matches, EXACTLY ONE e-mail SHALL be sent, carrying
one distinct reset link per matching account, each identifiably labelled so the recipient
can choose. Zero matches SHALL send nothing.

#### Scenario: unknown and known addresses are indistinguishable [integration]

- **GIVEN** an address registered in 3 accounts and an address registered in none
- **WHEN** a reset is requested for each
- **THEN** both responses are identical in status and body

#### Scenario: one send, N labelled links [unit]

- **GIVEN** an address matching 3 accounts
- **WHEN** the request runs
- **THEN** the e-mail port receives exactly ONE send whose body carries 3 links with 3 distinct tokens, each labelled with the account it resets

#### Scenario: no match sends nothing [unit]

- **GIVEN** an address matching no row
- **WHEN** the request runs
- **THEN** the e-mail port receives no send and the response is the uniform body

---

### Requirement: Customer-user persistence joins the ambient transaction

Every query the customer-user adapter issues SHALL run on the active transaction client
when a Unit of Work transaction is open, and on the base client only when none is. A write
that ignores the ambient transaction runs on a SECOND pooled connection and commits
independently of the enclosing rollback — and since the transaction now also carries the
GUC ownership marker, such a write passes the tenant binding UNWRAPPED rather than merely
escaping the transaction.

#### Scenario: a rolled-back transaction leaves no customer-user write behind [integration]

- **GIVEN** a Unit of Work transaction that performs a customer-user write and then rolls back
- **WHEN** the row is read back through the guarded client
- **THEN** the write is absent — it did not commit on a separate connection

#### Scenario: every adapter query resolves the transaction-aware client [static]

- **GIVEN** the change is applied
- **WHEN** the customer-user adapter's query sites are inspected
- **THEN** each resolves its client through the transaction-aware accessor; none reaches the base client directly

---

### Requirement: The proof cannot be satisfied by a double that masks the defect **[MERGE-BLOCKING]**

The evidence for this capability SHALL be constructed so that the pre-change tree FAILS it:

- Unit doubles SHALL fake the **Prisma client**, never the repository, so the adapter's real
  write construction runs. A stateless repository mock and a capture-only fake both stay
  green under the defect and under any fix, which is what the current estate does.
- No scenario SHALL be satisfied by asserting call shape (which methods were called, how
  many times) where stored state is the subject.
- The new integration file SHALL be named in a `run_batch` in `apps/api/scripts/run-tests.sh`.
  An integration file that no batch names never executes while still reading as coverage
  (fitness #30's ratchet may fall, never rise).
- The assertions that certify the defect today (`customerAuthUseCases.test.ts` asserting the
  hash write AND the snapshot save both happened) SHALL be replaced by outcome assertions.

#### Scenario: the doubles fake the client, not the repository [static]

- **GIVEN** the new and rewritten unit tests
- **WHEN** their doubles are inspected
- **THEN** each substitutes the Prisma client and lets the real adapter construct the write; none substitutes the repository for an outcome assertion

#### Scenario: the integration file is collected [static]

- **GIVEN** the new integration file
- **WHEN** `apps/api/scripts/run-tests.sh` is inspected
- **THEN** the file is named in a `run_batch`, and fitness #30's unreached count does not rise

#### Scenario: the bug-certifying test no longer certifies the bug [static]

- **GIVEN** the rewritten `customerAuthUseCases.test.ts` reset assertions
- **WHEN** they are inspected
- **THEN** they assert the persisted hash outcome, not that a hash write and a snapshot save both occurred

---

## Verification note (strict TDD — RED→GREEN)

Every **[MERGE-BLOCKING]** requirement above is RED on the unmodified tree, and the reds are
of two different kinds: the reachability and claim scenarios fail because the endpoints throw
(or answer a token-shaped 400) before reaching any write, while the D1 outcome scenario fails
with a SUCCESSFUL response whose stored hash is the OLD one — a green-looking red, which is
why it must be asserted against stored state. Integration scenarios need DB + Redis via
`pnpm db:up`; run single files heap-capped under a `timeout` wrapper on LXC. New and changed
code carries JSDoc `@file/@description/@layer` (fitness #9/#10).
