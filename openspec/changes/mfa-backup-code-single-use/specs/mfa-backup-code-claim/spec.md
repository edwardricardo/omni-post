# MFA Backup-Code Claim — Delta Spec (mfa-backup-code-single-use)

> **NEW capability** for change `mfa-backup-code-single-use`. Capability: **consuming a
> backup code is a CLAIM — for a given `(userId, codeIndex)` at most ONE caller ever
> receives `ok`, under EVERY interleaving, and the winner's consumption timestamp is
> immutable thereafter.**
>
> **Why the STAGGERED interleaving is the whole subject.** The existing whole-column
> compare-and-swap already covers the interleaving two racers produce under `Promise.all`
> (both snapshots taken before either commits). It does NOT cover the one an attacker
> actually gets for free inside the argon2 window: the loser's snapshot taken strictly
> AFTER the winner's commit, which matches `equals: snapshot`, returns `count === 1`, and
> mints a second session. This is the THIRD arrival at this code (naive read-modify-write →
> `7b245e3e`'s CAS → this change), so the discipline is explicit and normative here: every
> correctness argument states which interleavings it covers, and the evidence exercises the
> staggered one DETERMINISTICALLY — not by timing luck.
>
> **The forensic half is the worse half.** The current mark overwrites the used-map entry
> unconditionally, so a second consumption erases the record that the first one happened,
> and the HIGH alarm fires only on `count === 0` — only on the interleaving where the attack
> had already failed. A capability that closes the race but keeps those two properties has
> fixed the smaller half.
>
> **Scenario tags.** `[integration]` — requires a real Postgres row reached through the
> wired service and a real Unit of Work; only a real row decides ATOMICITY. `[unit]` —
> vitest against a stateful fake of the **Prisma client** (never of the repository), so the
> adapter's real predicate and write construction execute. `[static]` — checkable by
> inspecting source, config, or a gate's measured count.
>
> **Decisions already taken (Edward, 2026-09-12), stated so they are not re-litigated:**
> the discretionary CLASS fitness function (a consumption-marker write in `data` must name
> the claim in `where`) is **DEFERRED and paired with SMELL-97's slice** — it is NOT a
> requirement of this capability, and no requirement below may be read as demanding it. The
> EVIDENCE tier (~450–600 lines) is pre-approved as a single declared budget.
>
> **Non-goals.** The claim table + migration + backfill + ADR (obviated: measured against
> the generated client, the existing columns are claimable). P-2, the live admin
> password-reset race, is SMELL-97 and MUST NOT be absorbed here. The other four orphan MFA
> integration suites (SMELL-75), `codeIndex` positional remodelling, and G4–G8 / G13–G15
> stay out.

---

## ADDED Requirements

### Requirement: A backup code is claimed at most once, under every interleaving **[MERGE-BLOCKING]**

For a given `(userId, codeIndex)` at most ONE caller SHALL ever receive `ok` from the
claim. The guarantee SHALL hold for the interleaving in which a second caller's snapshot is
taken strictly AFTER the first caller's claim has committed — the interleaving the current
mechanism does not cover and the one `Promise.all` cannot reliably produce. It SHALL also
continue to hold for simultaneous callers and for sequential replay.

A refused claim SHALL write nothing: no column of the target row changes, and the code is
not marked consumed by the attempt that was refused.

This requirement constrains the OUTCOME, not the mechanism. Whether the refusal comes from
a snapshot-consistent pre-check, a per-key predicate, or another construction is a design
choice; what is normative is that the argument states its covered interleavings and that the
staggered one is exercised.

#### Scenario: staggered racers yield exactly one success [integration]

- **GIVEN** two verifications of the SAME backup code for the same user, ordered so the second's deciding read happens deterministically AFTER the first's claim has COMMITTED
- **WHEN** both run against the real database
- **THEN** exactly ONE receives `ok` and the other is refused with `ALREADY_USED`; exactly one session is minted

#### Scenario: simultaneous racers still yield exactly one success [integration]

- **GIVEN** two verifications of the same backup code started before either completes (neither snapshot taken after the other's commit)
- **WHEN** both run against the real database
- **THEN** exactly ONE receives `ok` and the other is refused with `ALREADY_USED`

#### Scenario: sequential replay is refused by both adapters [unit]

- **GIVEN** a stateful Prisma-client fake holding a row whose used-map already carries index `i`, and each production adapter constructed over it
- **WHEN** `markBackupCodeUsed(userId, i, …)` is called again
- **THEN** each adapter returns `ALREADY_USED` and the fake's stored map is unchanged

#### Scenario: a refused claim changes nothing in the row [integration]

- **GIVEN** an index already claimed by a successful verification
- **WHEN** a second claim for that index is refused
- **THEN** reading the row back yields a used-map byte-identical to the one the winner stored, and no other column of the row has changed

---

### Requirement: The winner's consumption timestamp is immutable **[MERGE-BLOCKING]**

Once an index carries a consumption timestamp, no later attempt SHALL overwrite it. An
existing key in the used-map is never rewritten, so the record of the FIRST consumption —
the only forensic evidence that a recovery credential was used, and by whom, and when —
survives every subsequent attempt, successful or refused.

The evidence for this requirement SHALL be decidable: attempts SHALL present DISTINCT
timestamps, because an assertion over two identical values cannot distinguish "preserved"
from "overwritten with the same value" and would pass under the defect.

#### Scenario: an existing used-map key is never overwritten [unit]

- **GIVEN** a row whose used-map carries index `i` at time `T1`, and a later claim for `i` at a DISTINCT time `T2`
- **WHEN** the claim runs through each production adapter
- **THEN** the claim is refused and the fake's stored value for `i` is still `T1`

#### Scenario: the stored timestamp survives the refused attempt [integration]

- **GIVEN** the staggered pair above, each presenting a distinct consumption timestamp
- **WHEN** both have completed
- **THEN** the STORED timestamp for that index is the WINNER's, and the loser's value appears nowhere in the row

#### Scenario: the racers present distinguishable timestamps [static]

- **GIVEN** the integration proof
- **WHEN** its two attempts are inspected
- **THEN** they submit distinct consumption timestamps, so an overwrite would be observable

---

### Requirement: `ALREADY_USED` names the claim's state, never a race outcome **[MERGE-BLOCKING]**

The port SHALL document the observable GUARANTEE — at most one caller ever claims a given
`(userId, codeIndex)`; an existing claim is never overwritten; `ALREADY_USED` means the code
is already consumed and the caller MUST reject the verification and MUST NOT retry — and
SHALL NOT document the MECHANISM. A port that describes a compare-and-swap invites a
conformant adapter that implements exactly that mechanism and is still exploitable, which is
how the current contract reads today.

The port method signature SHALL be byte-identical after this change: no new port, no new
token, no DI change, no consumer churn.

#### Scenario: the port states the guarantee, not the mechanism [static]

- **GIVEN** the change is applied
- **WHEN** the `markBackupCodeUsed` contract in `packages/ports/src/MfaUserRepositoryPort.ts` is inspected
- **THEN** it states the single-consumption guarantee and the immutability of an existing claim, and it describes no compare-and-swap, no snapshot, and no column encoding

#### Scenario: `ALREADY_USED` is defined as claimed, not as a lost write [static]

- **GIVEN** the rewritten contract
- **WHEN** the `ALREADY_USED` documentation is read
- **THEN** it says the code is already consumed and the caller MUST reject; it does not say "a concurrent writer won"

#### Scenario: the signature is unchanged [static]

- **GIVEN** the change is applied
- **WHEN** the port method's parameter list and return type are compared with the pre-change tree
- **THEN** they are byte-identical, and no call site required a change

---

### Requirement: Both subjects' adapters carry identical claim semantics **[MERGE-BLOCKING]**

The customer adapter and the admin adapter SHALL enforce the SAME claim guarantee, with the
same observable verdicts for the same inputs. Admin/customer parity is a signed project rule
and the two implementations are twins today; fixing one and not the other would widen the
gap this capability exists to close.

#### Scenario: both adapters refuse an already-claimed index [unit]

- **GIVEN** the identical fixture applied to each adapter over its own stateful Prisma-client fake
- **WHEN** an already-claimed index is claimed again
- **THEN** both return `ALREADY_USED`, both leave the stored map unchanged, and no assertion distinguishes the two adapters

#### Scenario: both adapters claim an unclaimed index [unit]

- **GIVEN** the identical fixture with an unclaimed index
- **WHEN** the claim runs
- **THEN** both return `ok` and both store the presented timestamp under that index, leaving prior entries intact

---

### Requirement: One conformance suite binds all three implementations **[MERGE-BLOCKING]**

A port-conformance suite SHALL run the SAME claim assertions against all THREE
implementations of `markBackupCodeUsed`: both Prisma adapters and the in-memory test double.
Its first assertion SHALL be sequential reuse.

The double's semantics ARE the contract. `InMemoryMfaUserRepository` already refuses an
already-present index — it was right while production was wrong — and its comment claiming to
"mirror the Prisma adapter's compare-and-swap" points the wrong way. That comment SHALL be
corrected, and its SEMANTICS SHALL NOT be weakened to match production. Binding all three to
one suite is what makes the NEXT divergence between a double and production a structural
failure rather than a discovery years later.

#### Scenario: the same assertions pass over all three implementations [unit]

- **GIVEN** the conformance suite and the three implementations
- **WHEN** it runs
- **THEN** each implementation satisfies every assertion, sequential reuse first, with no per-implementation exception or skip

#### Scenario: an implementation that stops refusing turns the suite red [unit]

- **GIVEN** the conformance suite
- **WHEN** any one implementation's refusal is removed in a harness mutation
- **THEN** that implementation fails the suite — the suite is not satisfiable by a permissive implementation

#### Scenario: the double no longer asserts a false mirror [static]

- **GIVEN** the change is applied
- **WHEN** `InMemoryMfaUserRepository`'s `markBackupCodeUsed` comment is read
- **THEN** it names the claim contract it implements and no longer claims to mirror a mechanism production does not have; the refusal itself is unchanged

---

### Requirement: The reuse alarm is reachable BY the attack, not only by its failure **[MERGE-BLOCKING]**

`MFA_BACKUP_CODE_REUSE_REJECTED` (HIGH) and its security metric SHALL be emitted on EVERY
refused claim, whatever interleaving produced the refusal — including the staggered attack,
where the refusal now comes from the claim's own consistency check rather than from a lost
write. Today the alarm fires only when the write lost the compare-and-swap, i.e. only on the
interleaving where the attack had already been blocked: the one case operators most need to
see is the one case that is silent.

The emission SHALL NOT be conditioned on the CAUSE of the refusal. **Stated volume-profile
change, not a surprise:** the alarm's population broadens from "lost a concurrent write" to
"every refused claim the service reaches", so already-used submissions that reach the claim
fire it too. The alarm becomes a reuse indicator rather than a race indicator; its threshold
is tuned at the alert, never suppressed in code.

The event SHALL carry no TOTP secret and no backup-code material.

#### Scenario: the staggered attack raises the alarm and the metric [integration]

- **GIVEN** the staggered pair from the first requirement
- **WHEN** the loser is refused
- **THEN** a HIGH `MFA_BACKUP_CODE_REUSE_REJECTED` event is recorded for that subject AND the security-threat metric is incremented

#### Scenario: a refusal that never reached a write still alarms [unit]

- **GIVEN** a verification whose claim is refused because the index is already consumed, with no write attempted
- **WHEN** it completes
- **THEN** the HIGH event and the metric are emitted exactly as for a refusal produced by a lost write

#### Scenario: emission is not gated on the refusal's cause [static]

- **GIVEN** the change is applied
- **WHEN** the alarm and metric emission site is inspected
- **THEN** it is reached for `ALREADY_USED` without branching on which interleaving or which mechanism produced it

#### Scenario: the event carries no secret material [unit]

- **GIVEN** an emitted reuse event
- **WHEN** its payload is inspected
- **THEN** it names the subject and account and contains no TOTP secret, no backup code, and no code hash

---

### Requirement: The refusal is operationally visible

The refusal SHALL increment the existing security-threat counter under a dedicated
`threat_type`, and the change SHALL ship ONE alert rule over that series and ONE runbook
entry for it (the ADR-0015 precedent: a signal nobody alerts on is a signal that goes
silent). The runbook SHALL state the broadened volume profile above and the accepted
sibling-claim false positive below, so an operator reading a firing alert is not re-deriving
them from source.

#### Scenario: the counter increments on refusal [unit]

- **GIVEN** a refused claim
- **WHEN** the metrics registry is inspected
- **THEN** `api_security_threats_total` has incremented for this refusal's `threat_type`

#### Scenario: one alert rule and one runbook exist and point at each other [static]

- **GIVEN** the change is applied
- **WHEN** `prometheus/alerts/` and `docs/runbooks/` are inspected
- **THEN** exactly one new rule watches the refusal series and names its runbook, and that runbook states the expected volume profile and the sibling-claim false positive

---

### Requirement: The integration proof executes in CI **[MERGE-BLOCKING]**

`apps/api/tests/integration/mfaBackupCodeSingleUse.integration.test.ts` SHALL be named by
EXACTLY ONE `run_batch` in `apps/api/scripts/run-tests.sh`. It is an orphan today: no batch
names it, so it has never executed while still reading as coverage in the tree, in review,
and in any report that counts only what ran. A proof of the staggered interleaving that never
runs is not a proof.

Exactly one file SHALL be wired. Wiring the sibling orphans is SMELL-75 and is not this
change.

Fitness #30's measured unreached count SHALL FALL from 21 to 20, and that measurement SHALL
be recorded as evidence. **Recorded residual, not silently absorbed:** the ratchet BASELINE
literal in `.github/workflows/fitness.yml` stays at 21 — tightening it is a workflow edit,
this change is deliberately token-free, and the gate's rule is that the count may fall and
must never rise. Tightening the literal belongs to the slice that next edits that file.

#### Scenario: the file is named by exactly one batch [static]

- **GIVEN** the change is applied
- **WHEN** `run-tests.sh` is inspected
- **THEN** `mfaBackupCodeSingleUse.integration.test.ts` appears in exactly one `run_batch`, and no other previously-orphaned MFA suite was wired alongside it

#### Scenario: the unreached count falls by exactly one [static]

- **GIVEN** the change is applied
- **WHEN** fitness #30 is run
- **THEN** its count is 20, down from the measured 21, and the recorded evidence names the file that left the list

#### Scenario: the wired suite executes and passes in CI [integration]

- **GIVEN** the integration tier running against the migrated Postgres service
- **WHEN** the batch that names the file runs
- **THEN** the suite executes (non-zero collected tests) and passes

---

### Requirement: The evidence cannot be satisfied by a double that masks the defect **[MERGE-BLOCKING]**

The evidence SHALL be constructed so the pre-change tree FAILS it:

- Unit doubles SHALL fake the **Prisma client**, never the repository, so the adapter's real
  predicate and write construction execute.
- The two adapter tests titled for concurrency SHALL stop hardcoding the update result. They
  return a fixed zero count today, so the predicate under test is never evaluated and the
  tests are green under the defect and under any fix.
- Service-level greenness SHALL NOT be accepted as evidence of the claim: the service runs
  against the double, which was already correct, so it proves nothing about production. The
  adapter test is the only unit-level oracle, and only a real database row decides atomicity.
- Un-stubbing SHALL fix whatever it surfaces; re-stubbing is prohibited.

#### Scenario: the doubles fake the client, not the repository [static]

- **GIVEN** the new and rewritten unit tests
- **WHEN** their doubles are inspected
- **THEN** each substitutes the Prisma client and lets the real adapter build its own predicate and write; none substitutes the repository for a claim assertion

#### Scenario: the un-stubbed concurrency tests evaluate the real predicate [static]

- **GIVEN** the two adapter tests titled for concurrency
- **WHEN** they are inspected
- **THEN** neither hardcodes the update result; each drives the adapter through a stateful fake whose stored row decides the outcome

#### Scenario: the staggered scenario is RED before the change [static]

- **GIVEN** the unmodified tree
- **WHEN** the staggered integration scenario is run
- **THEN** it fails with TWO successes — a green-looking red, which is why it is asserted against the stored row and the session count, not against call shape

---

### Requirement: The sibling-claim residual is documented, not engineered around

Two concurrent claims of DIFFERENT indices for the same user may still collide: one loses,
is refused, and raises a HIGH alarm it did not earn. The code is NOT consumed and a retry
succeeds, so this is an availability blip and a false positive — never a lost credential.
It exists identically today. It SHALL be written down (contract, runbook, PR body) and SHALL
NOT be engineered around in this change: widening scope to remove it would trade a HIGH
security fix's single-concern virtue for an availability nicety.

#### Scenario: a spuriously refused sibling claim consumes nothing [integration]

- **GIVEN** two concurrent verifications of DIFFERENT backup codes for the same user, where one is refused
- **WHEN** the refused caller retries
- **THEN** the retry succeeds, and the index it claims was absent from the stored map between the two attempts

#### Scenario: the residual is stated where an operator will meet it [static]

- **GIVEN** the change is applied
- **WHEN** the port contract, the runbook, and the PR body are inspected
- **THEN** each states that a refused claim may be a sibling-claim collision, that the code stays unconsumed, and that a retry is the correct response

---

## Verification note (strict TDD — RED→GREEN)

Every **[MERGE-BLOCKING]** requirement is RED on the unmodified tree, in two different
shapes. The adapter and conformance reds fail loudly (`ok` where `ALREADY_USED` is required;
an overwritten timestamp). The staggered integration red is the dangerous kind: it fails by
SUCCEEDING TWICE, which is why every claim scenario is asserted against the stored row and
the minted-session count rather than against which methods a double recorded.

Integration scenarios need DB + Redis via `pnpm db:up`, run inside a real Unit of Work, and
on LXC are run heap-capped under a `timeout` wrapper. New and changed code carries JSDoc
`@file/@description/@layer` (fitness #9/#10) and no sprint/phase reference (fitness #8).
Zero edits to `infra/prisma/schema.prisma` or `infra/prisma/migrations/**`; no
`omnipost-allow sensitive-edit` token is consumed by this capability.
