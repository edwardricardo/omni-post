# Single-Use Claim Gate — Delta Spec (admin-password-reset-claim / SMELL-97)

> **NEW capability** for change `admin-password-reset-claim`. Capability: **fitness #41 — a
> Prisma write whose `data` carries a CONSUMPTION MARKER for a single-use credential MUST name
> that credential's prior state in its OWN `where`. Hard-zero, fail-closed, with its red
> demonstrated and its blind spots written into the check itself.**
>
> **Why a class gate and not two fixes.** This change fixes two sites. The gate is what stops
> the THIRD from being written: a consuming write whose predicate names only `id` is the exact
> shape of both defects, it type-checks, it passes review, and every existing test stays green
> under it — the two live instances were written that way and survived until now. Fixing
> instances without holding the class is how this class arrived twice.
>
> **Why it ships hard-zero and not as a ratchet.** Edward signed the hard-zero, and the refresh
> rotation converts in this same change specifically so the gate can reach it. A ratchet at 1
> would be a gate that documents a known violation instead of blocking one.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Requirements marked
> **[MERGE-BLOCKING]** gate the change.
>
> **Scenario tags.** `[static]` — decidable by running the check, inspecting its source, or
> comparing two files. This capability has no runtime surface, so every scenario is `[static]`
> by construction.
>
> **Decisions already taken (Edward, 2026-09-12 pre-propose gate), stated so they are not
> re-litigated:** the gate lands WITH the slice, hard-zero, red-proven, with its residual limits
> written into the check itself; the one `omnipost-allow sensitive-edit` token this change
> consumes belongs here, for `.github/workflows/fitness.yml`.
>
> **Non-goals.** Fitness #23's blindness to tagged-template raw queries — a defect of ANOTHER
> gate, measured during exploration at 6 production sites the regex cannot see, filed as
> SMELL-111 with its own re-measure-and-enrol change; it SHALL NOT be repaired here. Extending
> the gate to reach cache-backed consumption (`OAuthFlowStore`). Adding `@unique` to
> `AdminUser.passwordResetToken` (blocked by the `"CHANGE_REQUIRED"` sentinel, SMELL-110).
>
> **Premise timeline, stated so nobody re-litigates it.** The proposal correctly flagged
> `openspec/config.yaml` as stale at "#1-#26 / 27 fitness functions" — true at commit
> `19fb9e6a`. The orchestrator fixed it in the working tree between the propose and spec
> phases (now "#1-#40" / "40", with the #30/#38 ratchets stated honestly), which is why a
> spec-time read of the tree shows current text. The residual that DOES belong to this
> change: when #41 lands, the same three lines move 40 → 41 in the gate's own commit. No
> requirement below covers that bump (the proposal's scope table places config.yaml outside
> the capability surface); it is named here as an apply-time task item so it is not silent.

---

## ADDED Requirements

### Requirement: The class invariant is stated and enforced hard-zero **[MERGE-BLOCKING]**

A new fitness check **#41** SHALL enforce: a Prisma `update`, `updateMany` or `upsert` whose
`data` carries a consumption marker for a single-use credential MUST name that credential's
prior state in the SAME call's `where`. Its verdict SHALL be hard-zero — any occurrence fails
the workflow with a real non-zero exit, not an annotation.

The check SHALL exist in TWO places that agree byte-for-byte: the catalogue block in
`CLAUDE.md §Automated Compliance Checks` and its mirror step in `.github/workflows/fitness.yml`.
The mirror SHALL be pasted, never paraphrased — drift between the documented regex and the
executed one is the failure mode the suite's own extension rules name first.

The suite's count sentence in `CLAUDE.md` SHALL be updated from 40 checks to 41 in the same
change. A catalogue that says 40 while holding 41 is the smallest possible version of the dead-
scope defect this suite has already met three times.

The check SHALL state, in its own comment, the threat it prevents in one line: a consuming write
that does not name the credential it consumes lets two callers consume it once each.

#### Scenario: the gate reports zero on the post-change tree [static]

- **GIVEN** both fixes in this change are applied
- **WHEN** fitness #41 is run over the repository
- **THEN** its count is 0

#### Scenario: the two blocks are identical [static]

- **GIVEN** the change is applied
- **WHEN** the #41 block in `CLAUDE.md` and the #41 step in `.github/workflows/fitness.yml` are extracted and compared
- **THEN** they are identical — a `diff` of the extracted blocks is empty

#### Scenario: the count sentence names 41 [static]

- **GIVEN** the change is applied
- **WHEN** the "checks, numbered" sentence in `CLAUDE.md §Automated Compliance Checks` is read
- **THEN** it says 41 checks, numbered #1-#41

#### Scenario: the gate fails the job, it does not merely annotate [static]

- **GIVEN** the #41 step in `.github/workflows/fitness.yml`
- **WHEN** it is inspected
- **THEN** its `::error` emission is paired with a real failure mechanism in the same step, satisfying fitness #34

---

### Requirement: The gate's population is MEASURED and fail-closed **[MERGE-BLOCKING]**

The check SHALL count only WRITE SITES: occurrences of a consumption marker inside the `data` of
a write call. It SHALL NOT count a marker appearing in a `select`, in a type or interface
declaration, in a test, in an in-memory fake, in `dist`, or in `node_modules`. This distinction
is load-bearing and was measured: the marker names alone occur across the tree in scores of
places that are overwhelmingly selects, DTO fields, fixtures and test doubles, while the write-
site population is 7. A floor over textual occurrences would be satisfied by fixtures and would
therefore measure nothing.

The measured baseline SHALL be recorded: **8 marker sites = 7 claim sites + 1 named issuance
exception (`PrismaAdminSessionRepository.updateRefreshTokenHash`), of which 2 claim sites are
unsound before this change and 0 after** — `PasswordService.confirmPasswordReset` and
`authServiceSession.refreshTokens` are the two; the customer reset claim, the two admin MFA
claims and the two customer MFA claims are the five already sound. (Amended per design rev 2
F7: the structural scan counts the exempt issuance site in its fail-closed floor.)

The check SHALL FAIL CLOSED, in the #36/#38/#40 form:

- a marker-site floor SHALL be asserted, at the population measured when the check lands, so that
  a renamed marker, a moved scope directory, or a detection that stops matching produces a red
  rather than a clean-looking zero over code it never read;
- every scope directory the check scans SHALL be asserted to exist before it is scanned, because
  a `grep -r` over an absent directory exits 2, prints nothing, and renders as `0`;
- the floor may FALL only together with the deliberate removal of a site, and MUST never be
  raised to absorb a new violation.

The one-off backfill script `infra/prisma/scripts/backfill-admin-mfa-backup-codes.ts` SHALL be
excluded BY PATH, and the exclusion SHALL name the `migration` scenario from
`CLAUDE.md §Pragmatic Exceptions` as its justification. It carries a real marker in `data` and is
throwaway migration code, so excluding it silently would be indistinguishable from missing it.

#### Scenario: the measured population is recorded with the check [static]

- **GIVEN** the change is applied
- **WHEN** the #41 block is read
- **THEN** it records the write-site population it measured, names the two sites this change converted, and states that the floor may fall and must never rise

#### Scenario: a renamed marker or a moved scope fails closed [static]

- **GIVEN** the check as shipped
- **WHEN** a marker name is changed, or a scanned scope directory is made absent, in a harness mutation
- **THEN** the check exits non-zero with a scope error naming the cause, rather than reporting a count of 0

#### Scenario: selects, types, fixtures and fakes do not count [static]

- **GIVEN** the check as shipped
- **WHEN** it is run over the tree
- **THEN** its detected population equals the recorded write-site count, and no occurrence inside a `select`, a type declaration, a test, an in-memory fake, `dist` or `node_modules` is included

#### Scenario: the migration script is excluded with a named scenario [static]

- **GIVEN** the check as shipped
- **WHEN** its exclusions are read
- **THEN** the backfill script is excluded by path and the exclusion cites the `migration` scenario from the allowed list

---

### Requirement: The gate's red is DEMONSTRATED, not asserted **[MERGE-BLOCKING]**

Before the gate merges, its red path SHALL be demonstrated end to end and the demonstration
SHALL be recorded as evidence:

1. plant the violation — narrow one already-sound claim's `where` to `{ id }` alone;
2. run the check and observe a REAL non-zero exit (an `::error` annotation alone leaves the job
   green and proves nothing);
3. restore the tree BYTE-EXACT and verify the restoration with `cmp` or a checksum;
4. re-run the check and confirm the count is 0.

A gate whose red path was never demonstrated does not merge. This is the suite's own extension
rule, and it applies hardest to a gate written by the same author as the fixes it is meant to
police.

#### Scenario: a planted unsound claim turns the gate red [static]

- **GIVEN** the check as shipped and one sound claim site
- **WHEN** that site's `where` is narrowed to name only `id` and the check is run
- **THEN** the check exits non-zero and its output names the planted site

#### Scenario: an annotation alone is not accepted as red [static]

- **GIVEN** the planted violation
- **WHEN** the check's exit status is examined
- **THEN** it is non-zero — the demonstration is not satisfied by an `::error` line with a zero exit

#### Scenario: the restore is byte-exact and the count returns to zero [static]

- **GIVEN** the planted violation has been reverted
- **WHEN** the tree is compared with its pre-plant state and the check is re-run
- **THEN** `cmp` (or an equivalent checksum) reports no difference and the count is 0

---

### Requirement: The gate's residual limits are written INTO the check **[MERGE-BLOCKING]**

The check SHALL state its own blind spots, in its own comment, in the honest form this suite
already uses for #36, #38 and #40. At minimum it SHALL name:

- **cache-backed consumption** — `OAuthFlowStore.consume` performs a non-atomic read-then-delete
  outside Prisma entirely and is unreachable by a Prisma-shaped check;
- **dynamically built `where` or `data`** — a predicate or payload assembled in a variable, by
  spread, or at runtime is invisible to a textual check;
- **markers reached through a helper** — a consuming write wrapped in a helper hides both halves
  from the site the check inspects;
- **argument slicing** — the check slices each call's argument to its balanced close; a call the
  slicer cannot close (a regex literal with an unbalanced brace or quote) is dropped, and at a
  marker site the floor turns that into a red. (Amended per design rev 2: the structural scan
  ELIMINATES the earlier line-window-matching residual and this limit replaces it.)

It SHALL also state the out-of-class boundary, so the gate's silence is a decision rather than an
oversight: idempotent session revocations (which already name `isActive: true`), the outbox work-
item lease (a lease, not a credential), a stateless-JWT refresh with no server-side consumption
marker at all, and the sentinel-writing admin reset issuance (an issuance, not a consumption).

A gate whose stated invariant is broader than what it measures is the defect this change's
exploration found in another gate. Writing the limits down is what makes the difference between a
measured residual and a false claim.

#### Scenario: the four residual limits are named in the check [static]

- **GIVEN** the change is applied
- **WHEN** the #41 block's comment is read
- **THEN** it names cache-backed consumption, dynamically built `where`/`data`, helper indirection, and argument slicing as limits of the check itself

#### Scenario: the out-of-class boundary is stated [static]

- **GIVEN** the #41 block's comment
- **WHEN** it is read
- **THEN** it states which adjacent write shapes are deliberately out of class and why, so their absence from the count is legible

---

### Requirement: The gate lands with or after the fixes, never before **[MERGE-BLOCKING]**

The gate is RED until BOTH the reset claim and the rotation claim have landed. It SHALL therefore
be sequenced with or after them.

If the change is split, the gate SHALL occupy the LATER pull request in the chain, and the
rollback order SHALL be stated with it: the gate is reverted FIRST, because reverting the fixes
under a live gate turns CI red on the reverted tree. The gate's `fitness.yml` revert consumes a
second `omnipost-allow sensitive-edit` token, and that SHALL be stated in the rollback plan
rather than discovered during an incident.

The `.github/workflows/fitness.yml` edit SHALL be performed under exactly ONE
`omnipost-allow sensitive-edit` token, audited in `.claude/heuristic-overrides.log` as the
mechanism requires.

#### Scenario: the merged result is green on the gate [static]

- **GIVEN** the fixes and the gate merged in their intended order
- **WHEN** the full fitness suite runs on the merged tree
- **THEN** all 41 checks pass, with #41 at 0 and no other check's ratchet raised

#### Scenario: if split, the gate is the later PR [static]

- **GIVEN** the change is delivered as more than one pull request
- **WHEN** the chain is inspected
- **THEN** the gate's PR is stacked after the PR carrying both fixes, and never before it

#### Scenario: the rollback order is written down [static]

- **GIVEN** the change is applied
- **WHEN** the PR body's rollback section is read
- **THEN** it states that the gate reverts first, that reverting the fixes under a live gate turns CI red, and that the `fitness.yml` revert needs its own sensitive-edit token

---

## Verification note

This capability has no runtime surface: its evidence is the check's own measured output, its
demonstrated red, and a `diff` between the two places it lives. It is RED before the two fixes
land (count 2) and 0 after — which is itself the sequencing constraint above, not a separate
test.

The `.github/workflows/fitness.yml` edit is the only sensitive-edit token this change consumes.
No file under `infra/prisma/schema.prisma` or `infra/prisma/migrations/**` is touched. The #41
block carries no sprint, phase or timeline reference, and neither the block nor its mirror
introduces a `canon-exception` marker — the backfill exclusion is a path exclusion inside the
check, justified by naming the `migration` scenario, not a marker planted in the script.
