# EXPLORE RE-VERIFICATION — MFA backup-code single-use (2026-09-11)

> Re-verification of `openspec/changes/mfa-backup-code-single-use/explore.md` (2026-08-15)
> against `workstream/password-reset-integrity` @ 5744f606. The original explore is prior art
> and stands unmodified. This document supersedes it on ONE decisive point (§2) and revises
> three quality verdicts (§4). Everything not named here is re-confirmed unchanged.
> Materialized by the orchestrator from Engram `sdd/mfa-backup-code-single-use/explore`
> (obs 475, revision 2) — the explore executor had no Write tool; the orchestrator
> spot-checked the two decisive claims (the double's `:107-109` pre-check under its
> mirror comment, and the generated client's whole-value-only `mfaBackupUsedAt` write
> surface) against the tree before materializing.

## 1. Re-verified defect — unchanged, byte-for-byte

The tree moved massively (tenant-isolation fase 0, Slice 1 composite FK, SMELL-93 RLS W-form
on 61 policies, tonight's password-reset-integrity chain). **None of it touched this code
path.**

### 1.1 Current file:line evidence, both adapters

`apps/api/src/infrastructure/adapters/PrismaCustomerMfaUserRepository.ts:85-124`

    :91   const row = await client.customerUser.findUnique({          // snapshot read
    :93     select: { mfaBackupUsedAt: true } });
    :96   const snapshot = row.mfaBackupUsedAt;
    :97   const usedMap = normalizeUsedAt(snapshot);
    :98   usedMap[String(codeIndex)] = usedAt.toISOString();          // UNCONDITIONAL overwrite
    :104  const { count } = await client.customerUser.updateMany({
    :105    where: { id: userId,
    :107             mfaBackupUsedAt: { equals: snapshot } },         // codeIndex ABSENT
    :114    data: { mfaBackupUsedAt: usedMap } });
    :116  if (count === 1) return ok(undefined);

`apps/api/src/infrastructure/adapters/PrismaAdminMfaUserRepository.ts:80-119` — the twin,
still byte-identical including the justification comment (`Cust:99-103` / `Admin:94-98`).
Overwrite at `Admin:93`; predicate at `Admin:99-110`. `codeIndex` still appears exactly once
per method, as a JS object key, never in the `where`.

### 1.2 Service trace — unchanged, same line numbers

`apps/api/src/admin/auth/MfaService.ts`:

    :199  const found = await repo.findById(subject.id);        DECIDING READ
    :226  const usedIndexes = new Set(Object.keys(record.mfaBackupUsedAt));
    :228  if (usedIndexes.has(String(index))) continue;         skip = CHECK on the :199 snapshot
    :231  if (await verifyPassword(hash, token))                argon2id, up to 8x SERIAL
    :232  const remaining = ... - usedIndexes.size - 1;         computed from the STALE snapshot
    :240  markResult = await repo.markBackupCodeUsed(...)       ACT (adapter re-reads at :91)
    :261-264  MFA_BACKUP_CODE_REUSE_REJECTED fires only on count === 0

The two-session mint remains reproducible **in principle**: when racer B's adapter snapshot
(`:91`) is taken AFTER racer A commits, B's `equals snapshot` matches the live row,
`count === 1`, and `:116` returns `ok`. Both mint a session. The argon2 loop (m=64MiB, t=3,
p=4, up to 8 serial verifies) keeps the window in the hundreds of milliseconds.

### 1.3 What DID move, and why it does not help

- `withSystemContext("customer-mfa-login")` moved `customerAuthRoutes.ts:237 -> :255`
  (tonight's four new wraps shifted it). Still present, so **layer-1 tenant scoping remains
  inert during backup-code consumption** — the guard bypasses under system context.
- **Fase-0 GUC binding does not alter the write shape here.** `tenantGucBinding.ts:104-106`:
  pass-through when bound. The claim runs inside `MfaService.runInTransaction`, so both the
  snapshot read and the CAS write stay on the UoW's connection, in one transaction. Verified,
  not assumed.
- `mfaBackupCodeSingleUse.integration.test.ts` is **still an orphan** — no `run_batch` names
  it. G12 stands. All four MFA integration suites remain uncollected.

### 1.4 Severity today: HIGH, unchanged

Still a single-use-control failure plus evidence destruction, not an authentication bypass.
NIST SP 800-63B-4 3.1.2.2 SHALL violation. The forensic half (`:98` overwrites the winner's
timestamp; the HIGH alarm fires only on the interleaving that already blocked the attack) is
unchanged and remains the worse half.

## 2. SCHEMA VERDICT — the single most important output

> **No schema change is required. The August schema-touch hypothesis is DEAD. This change
> needs NO `omnipost-allow sensitive-edit` token.**

### 2.1 Measured from the generated client, not inferred

**Write surface** (`infra/prisma/generated/prisma/client/models/AdminUser.ts:672, :711,
:781, :814`; CustomerUser twin):

    mfaBackupUsedAt?: Prisma.NullableJsonNullValueInput | runtime.InputJsonValue

The **only** expressible write is the WHOLE JSON value. Prisma's typed API offers no
`jsonb_set`, no partial merge, no per-key update.
`CustomerUserUpdatemfaBackupCodesInput = { set?: string[]; push?: string | string[] }` —
`push` is atomic but there is no remove/pull. **Filter surface** (`commonInputTypes.ts:267-282`):
`JsonNullableFilter` carries `equals`, `path`, `not`, etc. — a per-key predicate IS
syntactically expressible, and `path` is already used in-tree.

### 2.2 The derivation

A correct single-use claim needs BOTH: **(P)** a predicate naming the claim, and **(W)** a
write applying only that claim atomically. Because the write is whole-value, **(P) alone is
unsafe** (two racers naming different indices would both match and the second would erase the
first's claim). But the existing whole-column `equals: snapshot` CAS **already supplies (W)**.
What is missing is (P), and (P) needs only the adapter to **refuse when its own snapshot
already carries the index**:

    const usedMap = normalizeUsedAt(snapshot);
    if (Object.prototype.hasOwnProperty.call(usedMap, String(codeIndex))) return err("ALREADY_USED");
    usedMap[String(codeIndex)] = usedAt.toISOString();
    // ... existing CAS unchanged

**Why this is a sound claim, not another check-then-act:** the check's evidence IS the
write's predicate — the write commits only if the live column still equals the same snapshot
`S` the check read, and `S` lacks the index. Case analysis:

| Interleaving                                     | Outcome                                                         |
| ------------------------------------------------ | --------------------------------------------------------------- |
| B's snapshot taken AFTER A commits (the exploit) | `S_B` contains the index -> pre-check refuses, no write         |
| B's snapshot taken BEFORE A commits              | `equals S_B` fails the EPQ recheck -> `count 0` -> ALREADY_USED |
| Simultaneous, same index                         | Row lock serializes; loser's qual re-evaluates -> `count 0`     |
| Different indices, concurrent                    | One loses the CAS -> spurious ALREADY_USED (see 2.4)            |

At most one caller ever receives `ok` for a given `(userId, codeIndex)`. **G1 closes by
construction** — an existing key is never overwritten, so the winner's timestamp survives.

### 2.3 The correct semantics are already written down — in the test double

`apps/api/tests/unit/helpers/InMemoryMfaUserRepository.ts:107-109` does exactly this, under a
comment (`:104-106`) claiming to _"Mirror the Prisma adapter's compare-and-swap"_. **The
mirror points the wrong way.** The double is right and production is wrong. The fix is to
make production match its own double, and to correct the comment.

### 2.4 Honest residuals of the no-schema fix

1. **Spurious ALREADY_USED on sibling claims** (two concurrent claims of DIFFERENT indices:
   one loses the CAS, is refused, the code is NOT consumed, a retry succeeds — an
   availability blip that exists identically today; it does emit a false HIGH alarm; name it,
   do not engineer for it).
2. **Atomicity rests on Postgres Read-Committed EvalPlanQual** re-evaluating the `updateMany`
   qual — the same property `claimTotpStep` and `claimPasswordReset` already rest on. See
   §6.1 for the one capture still worth taking.
3. **Positional identity** remains a modelling wart — and §2.5 shows the claim table does not
   fix it either.

### 2.5 Why shape (A) (claim table) is materially weaker than August judged it

Three of its four pillars have moved: `@@unique([userId, codeIndex])` PRESERVES the
positional identity it was billed as fixing; the repo now carries a wired, merge-blocking
two-racer proof of the count-gated claim; the pre-check preserves the winner's timestamp for
free. Against that, (A) costs a migration + backfill, the sensitive-edit token and its ADR
follow-up, and the regeneration-lockout hazard (G10) the no-schema fix simply does not have.
**Recommendation: the no-schema claim.** Take (A) only if per-use forensic metadata becomes a
stated product requirement.

## 3. Template mapping — what transfers from tonight's chain

| Piece                                               | Transfers?                     | How                                                                                                                                                                                |
| --------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Count-gated conditional write, count as the verdict | **Already present**            | The CAS _is_ this shape; the gap is the pre-check, not the mechanism                                                                                                               |
| `updateOneLiveRow` shared body                      | **No — the precedent says so** | `claimPasswordReset` is deliberately NOT routed through it (`PrismaCustomerUserRepository.ts:326-328`); `markBackupCodeUsed` has its own predicate and verdict for the same reason |
| Two-racer integration proof                         | **Directly**                   | Reuse the structure; ADD the piece it lacks — a **STAGGERED** racer (the exploitable interleaving is the one `Promise.all` cannot produce)                                         |
| Stateful Prisma-client fake                         | **Partially**                  | The MFA adapter suite already has a better-suited honest fake evaluating the real predicate — un-stub it, do not replace it                                                        |
| Type-test pin                                       | **Weak fit — do not force**    | No signature change, nothing becomes inexpressible; the right analogue is a port-conformance suite                                                                                 |
| Column-ownership invariants                         | **As a ready-made seam**       | `customerUserWriteInvariants.test.ts:67-73` already declares `MFA_COLUMNS`; the mirror obligation belongs on the MFA side                                                          |

Genuinely new: the staggered racer (barrier-injected decorator between `MfaService.ts:199`
and `:240`); repairing a double STRONGER than production (G11); making the HIGH alarm
reachable by the attack rather than by its failure (G2); wiring the orphan suite (G12).
The discipline that transfers above all (design.md:134-135): unit tests decide claim LOGIC;
only a real DB row decides ATOMICITY.

## 4. Quality judgment per touched unit (revisions from August marked)

| Unit                               | Verdict                                                | Note                                                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Port `markBackupCodeUsed` contract | **MAL HECHO**                                          | Documents the MECHANISM in a domain file; a conformant adapter is exploitable. Revised remedy: the doc rewrite is the whole port change — signature byte-identical |
| Both adapters `markBackupCodeUsed` | **MAL HECHO -> ARREGLABLE (REVISED)**                  | The mechanism is sound and INCOMPLETE; ~3 lines per adapter complete it                                                                                            |
| Both adapters `claimTotpStep`      | **BIEN**                                               | Unchanged reference implementation                                                                                                                                 |
| `replaceBackupCodes` / `clearMfa`  | **ARREGLABLE**                                         | Blind `{id}` writes racing a mark — persists, stays untested                                                                                                       |
| `MfaService.verifyMfaToken`        | **ARREGLABLE**                                         | `:226-228` filters on a stale snapshot; demote to cost optimisation; `remaining` read back from the claim                                                          |
| Schema model                       | **MAL HECHO -> ARREGLABLE (REVISED)**                  | The existing columns ARE claimable; the wart is real but not blocking                                                                                              |
| `InMemoryMfaUserRepository`        | **MAL HECHO as mirror -> BIEN as semantics (REVISED)** | `:107-109` is correct AND is the fix; the defect is the comment asserting parity that does not exist                                                               |
| Adapter unit tests                 | **ARREGLABLE**                                         | Honest fake present; the two concurrency-titled tests hardcode `updateMany: () => ({count: 0})` — the predicate is never evaluated                                 |
| Integration test                   | **MAL HECHO, and it still never runs**                 | Re-confirmed orphan                                                                                                                                                |
| Observability                      | **MAL HECHO**                                          | Unchanged                                                                                                                                                          |
| DI / port wiring                   | **BIEN**                                               | Unchanged                                                                                                                                                          |

## 5. Scope recommendation for propose

### 5.1 Minimal chain — ONE PR

**IN**: (1) the pre-check in both adapters; (2) port doc rewritten to the observable
guarantee, signature untouched; (3) `MfaService` `:226-228` demoted + `remaining` read back
from the claim; (4) the double's comment corrected; (5) Tier 1 sequential-reuse red in both
adapter suites; (6) Tier 2 port-conformance suite binding all three implementations; (7)
Tier 3 repair + STAGGER + WIRE `mfaBackupCodeSingleUse.integration.test.ts` into a
`run_batch`; (8) G1 (by construction) + G2 (alarm reachable by the attack). Discretionary,
recommend IN: (9) G3 minimal (metric + alert + runbook, ADR-0015 precedent); (10) the class
fitness function (consumption marker in `data` must name the claim in `where`) — with its red
demonstrated; its CI mirror touches fitness.yml and is the ONE item needing a token if
included.

**OUT**: the claim table + migration + backfill + ADR (obviated); G4-G8/G13-G15; P-5, P-10;
the other four orphan MFA suites (SMELL-75); `codeIndex` remodelling (target state).

### 5.2 P-2 IS STILL OPEN — the admin/customer parity gap (verified this session)

`apps/api/src/admin/auth/PasswordService.ts:218-285`: `findFirst({passwordResetToken,
passwordResetExpires:{gt}})` then `update({where:{id}})` — the token absent from the write
predicate, with the argon2 window between. **The exact defect tonight's chain fixed on the
customer side, still live for admins.** Under the signed admin<->customer parity rule,
tonight's work widened the gap. NOT in scope for this MFA change — filed as **SMELL-97**
(the fix is `claimPasswordReset`'s shape ported to `AdminUser`; also fix the
`passwordHistory` read-modify-write in the same slice). P-3 (customer reset revert) is
CLOSED by tonight's chain.

### 5.3 PR forecast — two-tier rule

**CODE ≈ 150-190** (adapters ~30, port doc ~25, MfaService ~35, double comment ~5, G3 ~30,
fitness ~45), single PR, risk **Low**. **EVIDENCE ≈ 450-600** (Tier 1 ~60, Tier 2 ~200,
Tier 3 ~250, wiring ~5, fitness red ~30) — pre-approved per change, split in the PR body.

    Decision needed before apply: No
    Chained PRs recommended: No
    400-line budget risk: Low

## 6. Risks and unknowns for propose

### 6.1 The one capture still worth taking (settle in DESIGN)

A `$on('query')` trace of the emitted `updateMany` SQL. Plain `UPDATE ... WHERE qual` form =>
EPQ guaranteed and the no-schema claim, `claimTotpStep`, AND `claimPasswordReset` are all
settled at once. `UPDATE ... WHERE id IN (SELECT ...)` form => the sub-select evaluates
against the original snapshot and **three** claim sites are racy — a second and third HIGH.
Tonight's wired racer makes the bad outcome unlikely but does not exclude it.

### 6.2 Risks

A third wrong fix (this is attempt #2 — any new argument must state which interleavings it
covers, and Tier 3 must exercise the staggered one); the double masks the fix in a NEW
direction (service-level greenness proves nothing — the Tier 1 adapter test is the only
unit-level oracle); un-stubbing the two adapter tests may surface unrelated failures;
spurious ALREADY_USED + false HIGH on sibling claims (accept and document); G2's volume
profile changes deliberately; wire exactly ONE orphan file; P-2 must not be absorbed.

### 6.3 The token question, stated plainly

**No sensitive-edit token is required** — unless the discretionary fitness function is
included, whose CI mirror touches `.github/workflows/fitness.yml` (that one file only).
Tripwire #7 (plan-mode guard) applies at apply time.

### 6.4 Unknowns carried forward

(1) emitted-SQL form (§6.1 — design); (2) whether per-use forensic metadata is required —
the only input that revives the claim table; (3) backfill size — moot; (4) G2's volume
profile acceptability.

## 7. Ready for proposal

**Yes.** The one genuine fork August identified (claim table vs in-place) is resolved by
measurement against the generated client: the in-place claim is expressible, smaller,
migration-free, token-free, immune to the regeneration-lockout hazard, and reuses the exact
mechanism tonight's chain proved against real Postgres. The residual technical question
(§6.1) is a design-phase experiment, not a scope fork.
