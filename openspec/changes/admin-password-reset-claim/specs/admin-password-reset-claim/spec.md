# Admin Password-Reset Claim — Delta Spec (admin-password-reset-claim / SMELL-97)

> **NEW capability** for change `admin-password-reset-claim`. Capability: **confirming an
> admin password reset is a CLAIM — for a given reset token at most ONE caller ever receives
> success, under EVERY interleaving; the winner's password is the one that persists; and every
> exit that does not consume the token leaves that token exactly as usable as it was.**
>
> **Why the interleaving is the whole subject.** Today the confirm resolves the token with
> `findFirst(token, expiry)` and consumes it with `update({ where: { id } })` — the write's
> predicate never names the contested column, so under Read Committed the second writer
> re-reads the row, finds `id` still matching, and proceeds. EvalPlanQual protects a qual that
> names the contested column, and `id` is not contested. The window between the two is 1–6
> argon2id verifies plus one argon2id hash plus a second round-trip — the widest claim window
> in the estate, and attacker-inflatable by choosing a password that maximises history
> comparisons. Two parties who both hold the token (forwarded link, shared inbox, mailbox
> compromise) do not race first-come-first-served: the LAST writer owns the account.
>
> **Why the outcome, not the call shape, is the whole evidence.** The staggered red fails by
> SUCCEEDING TWICE — a green-looking red. Every acceptance scenario below is therefore written
> against PERSISTED state (`argon2.verify(STORED hash, …)`, the stored token columns, the
> stored lockout columns), never against which methods a double recorded or how many times.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Requirements marked
> **[MERGE-BLOCKING]** gate the change.
>
> **Scenario tags.** `[integration]` — requires a real Postgres row, because only a real row
> decides ATOMICITY; the service is driven directly (`new PasswordService(prisma)`), no HTTP,
> no DI. `[unit]` — vitest against a stateful fake of the **Prisma client**, never of a
> repository, so the service's real predicate and write construction execute. `[static]` —
> decidable by inspecting source, config, or a gate's measured count.
>
> **Decisions already taken (Edward, 2026-09-12 pre-propose gate), stated so they are not
> re-litigated:** liveness (`isActive: true`) ENTERS the claim predicate and the accompanying
> behaviour change is accepted; the confirm KEEPS clearing the lockout columns on success and
> that is documented as deliberate, not inherited; `passwordHistory` is guarded by a FULL
> snapshot CAS with `count === 0` disambiguated by a re-read; no schema change and no `@unique`
> on `AdminUser.passwordResetToken`; approach **A** (in-place claim, no port/adapter/DI churn).
>
> **Non-goals.** The `"CHANGE_REQUIRED"` sentinel and the dead `mustChangePassword`
> force-change feature (SMELL-110) — the route's `token: z.string().uuid()` remains the only
> barrier and is named as such, NOT moved and NOT relied upon by any requirement below;
> fitness #23's blindness to tagged-template raw queries (SMELL-111); issued-but-never-consumed
> credentials (SMELL-112); the customer refresh flow (SMELL-113); making `PasswordService`
> constructible for tests — it keeps holding `PrismaClient` (SMELL-114); the enumeration timing
> fig leaf and the `"reset_token_placeholder"` control-flow sentinel (SMELL-115).
> `initiatePasswordReset`, `changePassword`, the customer flows, and the route/Turnstile
> handling are untouched.

---

## ADDED Requirements

### Requirement: The confirm is ONE atomic, count-gated claim **[MERGE-BLOCKING]**

The confirm SHALL persist the new password hash and consume the reset token in a SINGLE
conditional write. That write's predicate SHALL name, together: the row `id`, the presented
`passwordResetToken`, a `passwordResetExpires` strictly in the future, `isActive: true`, and
the `passwordHistory` snapshot the flow read. Success SHALL be gated on a matched-row count
greater than zero.

For a given reset token at most ONE caller SHALL ever receive success. The guarantee SHALL
hold for the interleaving in which a second caller's deciding read happens strictly AFTER the
first caller's claim has COMMITTED — the interleaving the current mechanism does not cover and
the one `Promise.all` cannot reliably produce. It SHALL also hold for simultaneous callers and
for sequential replay.

A refused claim SHALL write nothing: no column of the target row changes, and the token is not
consumed by the attempt that was refused.

`count > 0` rather than `count === 1` is the gate, and the reason SHALL be written at the site:
there is NO `@unique` on `AdminUser.passwordResetToken` (the customer twin's uniqueness does
not exist here), so a match is not capped at one row by construction; tokens are
`crypto.randomUUID()`, so a multi-row match is negligible, and a single `UPDATE … WHERE (…)`
is atomic regardless of uniqueness. This requirement constrains the OUTCOME; it does not
require a unique index, and adding one is out of scope.

#### Scenario: staggered racers yield exactly one success [integration]

- **GIVEN** one live reset token and two confirms submitting DIFFERENT new passwords, ordered so the second's deciding read happens deterministically AFTER the first's claim has COMMITTED
- **WHEN** both run against the real database
- **THEN** exactly ONE returns success and the other is refused; the stored hash verifies against the winner's password and against no other password presented

#### Scenario: simultaneous racers yield exactly one success [integration]

- **GIVEN** one live reset token and two confirms submitting DIFFERENT new passwords, both started before either completes
- **WHEN** both run against the real database
- **THEN** exactly ONE returns success and the other is refused; the stored hash verifies against the winner's password only

#### Scenario: sequential replay fails and changes nothing [integration]

- **GIVEN** a token already consumed by a successful confirm
- **WHEN** the same token is presented again with a different new password
- **THEN** the confirm fails with `INVALID_TOKEN` and the stored hash is byte-identical to the one the first confirm stored

#### Scenario: a successful claim consumes the token columns [integration]

- **GIVEN** a live token and a successful confirm
- **WHEN** the row is read back
- **THEN** `passwordResetToken` and `passwordResetExpires` are both null, and the stored hash verifies against the new password and not against the old one

#### Scenario: a refused claim changes no column [integration]

- **GIVEN** the staggered pair above
- **WHEN** the loser is refused
- **THEN** every column of the row equals the value the WINNER's claim left, and no value submitted by the loser appears anywhere in the row

#### Scenario: expiry is enforced by the claim predicate itself [integration]

- **GIVEN** a token whose `passwordResetExpires` is in the past
- **WHEN** the confirm is submitted
- **THEN** the confirm fails, the stored hash is unchanged, and the expired token columns are NOT nulled by the failed attempt

#### Scenario: exactly one write reaches the admin row [static]

- **GIVEN** the confirm flow after the change
- **WHEN** its writes to `adminUser` are inspected
- **THEN** exactly one conditional write reaches the row, and no unconditional `update({ where: { id } })` of the password or token columns remains

#### Scenario: the `count > 0` reasoning is written at the site [static]

- **GIVEN** the change is applied
- **WHEN** the claim site is read
- **THEN** it states why `count > 0` is sound in the absence of a unique index, and it does not claim a uniqueness the schema does not have

---

### Requirement: Non-consuming exits leave the token usable **[MERGE-BLOCKING]**

`PASSWORD_TOO_WEAK` and `PASSWORD_REUSED` SHALL NOT consume the token: after either, the token
columns SHALL be unchanged and a subsequent well-formed confirm with the SAME token SHALL
succeed. An unknown token SHALL be refused with `INVALID_TOKEN` and SHALL write nothing.

These exits SHALL be reached BEFORE the claim, so they preserve the token by construction
rather than by a compensating write. No exit SHALL null the token columns other than a
successful claim.

#### Scenario: a weak password does not burn the token [integration]

- **GIVEN** a live reset token
- **WHEN** the confirm is submitted with a password that fails the strength policy
- **THEN** it fails with `PASSWORD_TOO_WEAK`, the token columns are unchanged, and a second confirm with the SAME token and a compliant password succeeds

#### Scenario: a reused password does not burn the token [integration]

- **GIVEN** a live reset token and an admin whose recent history contains hash `H`
- **WHEN** the confirm is submitted with the password behind `H`
- **THEN** it fails with `PASSWORD_REUSED`, the token columns and `passwordHistory` are unchanged, and a second confirm with the SAME token and a fresh compliant password succeeds

#### Scenario: an unknown token writes nothing [integration]

- **GIVEN** a token value that matches no row
- **WHEN** the confirm is submitted
- **THEN** it fails with `INVALID_TOKEN` and no admin row is modified

#### Scenario: the non-consuming exits precede the claim [static]

- **GIVEN** the confirm flow after the change
- **WHEN** the order of its steps is inspected
- **THEN** the strength check and the reuse check both return before the conditional write is reached, and no compensating write restores a token

---

### Requirement: Liveness gates the claim, and clearing the lockout is deliberate **[MERGE-BLOCKING]**

The claim predicate SHALL require `isActive: true`, the admin parity of the customer claim's
`deletedAt: null`. A deactivated admin holding an otherwise-live token SHALL be refused and
SHALL NOT have the token consumed, the password changed, or the lockout cleared. **Stated
behaviour change, accepted and signed:** a token issued before deactivation stops working; the
caller cannot distinguish this refusal from any other unusable-token refusal, which is
intended.

On a SUCCESSFUL claim the confirm SHALL keep clearing `failedLoginAttempts`, `lockedUntil` and
`lockReason`. This is RETAINED deliberately — completing a reset proves control of the mailbox,
which is the stronger signal — and the reason SHALL be written at the site so a later reader
meets a decision rather than an accident.

#### Scenario: an inactive owner is refused and nothing is cleared [integration]

- **GIVEN** an admin whose `isActive` is false, holding a live reset token, with `failedLoginAttempts > 0` and `lockedUntil` in the future
- **WHEN** the confirm is submitted with that token
- **THEN** it fails, the stored hash is unchanged, the token columns are unchanged, and `failedLoginAttempts`, `lockedUntil` and `lockReason` are all unchanged

#### Scenario: a successful confirm clears the lockout [integration]

- **GIVEN** an active admin who is locked out (`failedLoginAttempts > 0`, `lockedUntil` in the future, `lockReason` set) and holds a live reset token
- **WHEN** the confirm succeeds
- **THEN** `failedLoginAttempts` is 0 and `lockedUntil` and `lockReason` are null

#### Scenario: the lockout decision is documented, not inherited [static]

- **GIVEN** the change is applied
- **WHEN** the claim's `data` is read
- **THEN** the lockout clearing carries a stated reason (proof of mailbox control) rather than appearing as an unexplained side effect

---

### Requirement: A zero count is disambiguated — a moved history is never a false `INVALID_TOKEN` **[MERGE-BLOCKING]**

When the claim matches zero rows, the flow SHALL re-read the row by `id` and decide:

- the token is gone, expired, or the owner is inactive → `INVALID_TOKEN`;
- the token is still live but the `passwordHistory` snapshot has moved → a DISTINCT, retryable
  conflict outcome that SHALL NOT be `INVALID_TOKEN`.

A concurrent history move (a `changePassword` racing the reset) SHALL NOT be reported as an
invalid token. The two are opposite instructions to the caller — "this token is dead, stop" and
"nothing is wrong with your token, try again" — and collapsing them would tell a legitimate
holder their live token is invalid.

Whether the retryable outcome is surfaced as a new error code with its own HTTP mapping or
absorbed by one bounded in-service re-attempt is a DESIGN choice. What is normative: the caller
never receives `INVALID_TOKEN` for a live token, and a retry with the same token succeeds when
nothing else consumed it.

#### Scenario: a moved history surfaces as the conflict outcome, not `INVALID_TOKEN` [integration]

- **GIVEN** a live reset token, and a concurrent operation that advances the admin's `passwordHistory` after the confirm's read and before its claim
- **WHEN** the confirm reaches its claim and matches zero rows
- **THEN** the result is the retryable conflict outcome, it is NOT `INVALID_TOKEN`, the token columns are unchanged, and presenting the same token again succeeds

#### Scenario: a dead token still yields `INVALID_TOKEN` [integration]

- **GIVEN** a token already consumed by another confirm
- **WHEN** a second confirm matches zero rows and re-reads the row
- **THEN** the result is `INVALID_TOKEN`

#### Scenario: the disambiguation is a re-read, not a guess [static]

- **GIVEN** the change is applied
- **WHEN** the zero-count branch is inspected
- **THEN** it decides from a re-read of the row's current state, and no branch returns `INVALID_TOKEN` without having established that the token is unusable

---

### Requirement: A thrown error surfaces as `INTERNAL_ERROR`, never as `INVALID_TOKEN` **[MERGE-BLOCKING]**

A throw from password hashing or from any database call in the confirm SHALL be converted to an
explicit `INTERNAL_ERROR` result. It SHALL NOT be collapsed into `INVALID_TOKEN` and SHALL NOT
escape uncaught. `INTERNAL_ERROR` already exists in `AuthErrorCode` and the route already maps
unmapped codes to 500, so this exit requires no new code and no route change.

Today this class is unnamed: a throw escapes through `AdminAuthService` to Fastify as a 500 and
the token survives — the right outcome reached by accident. A failure that reports "your token
is invalid" when the token is fine sends the holder to request a new one for a fault that is
not theirs.

A run that ends in `INTERNAL_ERROR` SHALL NOT have consumed the token.

#### Scenario: a hashing failure is `INTERNAL_ERROR` and preserves the token [unit]

- **GIVEN** a stateful Prisma-client fake holding a live token, and password hashing arranged to throw
- **WHEN** the confirm runs
- **THEN** it returns `INTERNAL_ERROR`, and the fake's stored token columns and password hash are unchanged

#### Scenario: a database failure at the claim is `INTERNAL_ERROR` [unit]

- **GIVEN** a stateful Prisma-client fake whose conditional write throws
- **WHEN** the confirm runs
- **THEN** it returns `INTERNAL_ERROR` and not `INVALID_TOKEN`

#### Scenario: no error path collapses into `INVALID_TOKEN` [static]

- **GIVEN** the change is applied
- **WHEN** the confirm's error handling is inspected
- **THEN** `INVALID_TOKEN` is returned only where the token has been established unusable, and every catch returns `INTERNAL_ERROR`

---

### Requirement: The password history is computed from ONE read and can never hold an empty entry **[MERGE-BLOCKING]**

The confirm SHALL read the admin row ONCE before the claim, selecting everything it needs —
including the current `passwordHash`. The second `findUnique` SHALL be removed.

No empty string SHALL ever enter `passwordHistory`. The current `… || ""` fallback writes one
whenever the second read returns nothing, and a later `verifyPassword(candidate, "")` swallows
the malformed-hash throw and returns false — a permanent no-op entry that silently degrades
reuse prevention. The history SHALL be built only from values that are real stored hashes.

The snapshot named in the claim predicate SHALL be the snapshot that single read returned, so
the CAS guards exactly the value the flow computed from.

#### Scenario: a missing current hash never poisons the history [unit]

- **GIVEN** a stateful Prisma-client fake and a flow in which the current password hash is absent or empty
- **WHEN** the confirm runs to completion
- **THEN** the stored `passwordHistory` contains no empty-string entry

#### Scenario: exactly one read precedes the claim [static]

- **GIVEN** the change is applied
- **WHEN** the confirm's reads are inspected
- **THEN** exactly one read of the admin row precedes the claim, it selects the current `passwordHash`, and the redundant `findUnique` is gone

#### Scenario: the predicate guards the snapshot that was read [static]

- **GIVEN** the change is applied
- **WHEN** the claim predicate is compared with the read
- **THEN** the `passwordHistory` value in the predicate is the value returned by that read, not a re-derived or re-fetched one

---

### Requirement: The evidence executes in CI and is RED on the unmodified tree **[MERGE-BLOCKING]**

`apps/api/tests/integration/adminPasswordResetClaim.integration.test.ts` SHALL be named by
EXACTLY ONE `run_batch` in `apps/api/scripts/run-tests.sh`, and fitness #30's measured unreached
count SHALL NOT rise. A proof no batch names never executes while still reading as coverage in
the tree, in review, and in any report that counts only what ran.

The evidence SHALL be constructed so the tree at `19fb9e6a` FAILS it, and the shape of that
failure SHALL be recorded: the staggered and simultaneous scenarios fail by producing TWO
successes, so every claim assertion SHALL be made against PERSISTED state — the stored hash
verified with argon2, the stored token columns, the stored lockout columns — and never against
call shape.

**Harness from zero, stated as its own cost:** no test anywhere calls `confirmPasswordReset`
today, so the fixtures, the admin seeding, the staggered ordering primitive and the batch wiring
are built from nothing. Unit doubles SHALL fake the **Prisma client**, never a repository, so
the service's real predicate and write construction execute; a fake that understands the claim
predicate's list `equals` filter is required, and extending or replacing the existing helper is
a design choice.

No committed test SHALL carry `.skip` or `.only` (fitness #32).

#### Scenario: the integration file is named by exactly one batch [static]

- **GIVEN** the change is applied
- **WHEN** `apps/api/scripts/run-tests.sh` is inspected
- **THEN** `adminPasswordResetClaim.integration.test.ts` appears in exactly one `run_batch`

#### Scenario: fitness #30's count does not rise [static]

- **GIVEN** the change is applied
- **WHEN** fitness #30 is run
- **THEN** its unreached count is at or below the recorded baseline, and the measurement is recorded as evidence

#### Scenario: the staggered scenario is RED on the unmodified tree [static]

- **GIVEN** the tree at `19fb9e6a`
- **WHEN** the staggered scenario is run
- **THEN** it fails with TWO successes and a stored hash verifying against the LAST writer's password — a green-looking red, which is why it is asserted against the stored row

#### Scenario: the claim assertions are against stored state [static]

- **GIVEN** the new integration and unit tests
- **WHEN** their assertions are inspected
- **THEN** each claim assertion reads the stored row and verifies the stored hash; none asserts which methods a double recorded or how many times

#### Scenario: the wired suite executes and passes in CI [integration]

- **GIVEN** the integration tier running against the migrated Postgres service
- **WHEN** the batch that names the file runs
- **THEN** the suite executes with a non-zero collected-test count and passes

---

### Requirement: The post-claim side effects' non-atomicity is named, not silently inherited

The security event (`PASSWORD_RESET_COMPLETED`) and the session revocation SHALL continue to run
AFTER the claim, and the resulting residual SHALL be written down: a throw in either leaves the
password already changed and returns a 500, so the caller may see a failure for an operation
that succeeded. This is pre-existing and is NOT fixed here — folding it in would require a
transaction around a flow this change deliberately keeps to one statement, and would blur the
claim's proof.

Naming it is the requirement. An unnamed residual is indistinguishable from an unnoticed one.

#### Scenario: the residual is stated where a maintainer will meet it [static]

- **GIVEN** the change is applied
- **WHEN** the confirm's post-claim section and the PR body are inspected
- **THEN** each states that the security event and the session revocation are outside the claim, that a throw there leaves the password changed while reporting 500, and that closing it is not this change

#### Scenario: the side effects still run on success [integration]

- **GIVEN** a successful confirm
- **WHEN** the flow completes
- **THEN** the security event is emitted for that admin and that admin's active sessions are revoked

---

## Verification note (strict TDD — RED→GREEN)

Every **[MERGE-BLOCKING]** requirement above is RED on the tree at `19fb9e6a`, in two different
shapes. The liveness, disambiguation, `INTERNAL_ERROR` and history-poison reds fail loudly
(a reset that should be refused succeeds; an `INVALID_TOKEN` where a conflict is required; an
uncaught throw; an empty string in the stored history). The staggered and simultaneous reds are
the dangerous kind: they fail by SUCCEEDING TWICE, which is why every claim scenario is asserted
against the stored row rather than against call shape.

Integration scenarios need Postgres + Redis via `pnpm db:up`; on the LXC box they run as single
files, heap-capped, under a `timeout` wrapper — never the full suite at once. New and changed
code carries JSDoc `@file`/`@description`/`@layer` (fitness #9/#10) and no sprint, phase or
timeline reference (fitness #8). This capability edits no file under `infra/prisma/schema.prisma`
or `infra/prisma/migrations/**` and consumes NO `omnipost-allow sensitive-edit` token; the one
token this change needs belongs to the `single-use-claim-gate` capability.
