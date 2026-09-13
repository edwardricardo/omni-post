# Tasks: admin-password-reset-claim (SMELL-97)

**Phase**: sdd-tasks · **Date**: 2026-09-13 · **Branch**: `workstream/admin-reset-claim` (tip = main `19fb9e6a`) · **Store**: openspec (+ Engram mirror `sdd/admin-password-reset-claim/tasks`)
**Inputs**: the three delta specs (`specs/admin-password-reset-claim`, `specs/admin-refresh-rotation-claim`, `specs/single-use-claim-gate`), `design.md` rev 2 (design gate PASS-WITH-WARNINGS, pass 2), `proposal.md`, `pre-propose-decisions.md` (four signatures — honoured, none re-litigated).
**Delivery parameters (cached session preflight)**: `delivery_strategy: ask-on-risk` · `chain_strategy: stacked-to-main` · two-tier budget (CODE 400 hard per PR; EVIDENCE band declared here with ONE Edward decision).
**Strict TDD is ACTIVE.** Every unit below runs RED first and the RED output is recorded in `apply-progress` before the fix is written. The two racers are red on `19fb9e6a` by SUCCEEDING TWICE — a green-looking red — so every claim assertion is made against persisted state, never call shape.

**Git**: the orchestrator owns every commit, push and PR. Work units below describe commit BOUNDARIES and their intents; the writer never runs git.

---

## 0. Measurement (mandated by the brief — measured, not estimated)

The design asked the tasks phase to measure the #41 block rather than carry its estimate. Done, against `design.md` at the byte level.

| Quantity                      | Design rev 2 claim | **Measured**               | Where                                                                                           |
| ----------------------------- | ------------------ | -------------------------- | ----------------------------------------------------------------------------------------------- |
| #41 comment block             | 68 lines           | **72 lines**               | `design.md:344-415` (`# 41. Single-use claim shape…` → `# Hard-zero.`)                          |
| #41 shell + node script       | 111 lines          | **111 lines** (confirmed)  | `design.md:416-526` (`set -uo pipefail` → `echo "$COUNT"   # expect 0`)                         |
| **#41 block, total**          | 179                | **183 lines**              | `design.md:344-526`                                                                             |
| `fitness.yml` mirror overhead | ~+19               | **+10 lines**              | derived from the shipped #40 step, `.github/workflows/fitness.yml:1366-1452`                    |
| `fitness.yml` mirror, total   | ~198               | **193 lines** at block 183 | blank 1 + `name`/`if`/`run` 3 + `# Mirrors CLAUDE.md #41.` 1 + body-minus-tail 179 + yml tail 9 |

**Mirror decomposition** (why +10 and not +19): the yml replaces the CLAUDE.md tail of 4 lines (`) || {…}`, `COUNT=`, `COUNT=${COUNT:-0}`, `echo "$COUNT"`) with 9 (`) || { ::error }`, `COUNT=` ×2, `echo "Fitness #41: …"`, `if … then`, `::error` violation line, `printf`, `exit 1`, `fi`) = +5, and adds 5 lines of step scaffold. Each `::error` is ONE long line in the #40 precedent, so nothing wraps.

**Insertion points confirmed against the tree:**

- `CLAUDE.md` — the whole fitness catalogue is ONE fence closing at `:1487`; #41 inserts after `:1486` with one blank separator. Count sentence at `:305` ("There are **40 checks, numbered #1-#40**") — one occurrence, one line.
- `.github/workflows/fitness.yml` — #41 step goes after #40 (`:1367-1452`), before `Fitness summary` (`:1454`). Summary sentence at `:1459`.
- `openspec/config.yaml` — 40 → 41 at `:21` ("40 CI fitness functions"), `:62` ("(#1-#40)"), `:86` ("all 40 fitness functions"). **Three lines.** (`:22` holds the ratchet clause and does not carry a count.)
- `docs/reports/roadmap-detected-smells-backlog.md` — each row is exactly ONE (very long) markdown table line; latest row is SMELL-109 at `:162`, so this change's rows start at **SMELL-110**.

**Correction to a gate NOTE, verified against the tree (N7).** The pass-2 note places the confirm's `statusMap` literal at `adminAuthRoutes.ts:339-343`. Measured: `:339` is `if (!result.ok) {`; the literal is **`:340-344`** and `:345` is `const status = statusMap[result.error] || 500;`. The design's own citation was right. The rest of N7 holds exactly: DF-4 is **2 changed lines** — `AuthErrorCode` is not imported in that file today, so `:31` (`import type { DeviceFingerprint } from "./adminAuthTypes.js";`) gains the member, and `:340` is retyped.

**Finding worth naming before apply:** `adminAuthRoutes.ts` holds **six** `statusMap` literals (`:109`, `:137`, `:220`, `:340`, `:442`, `:530`), all `Record<string, number>`. DF-4 retypes **exactly one** — the confirm's at `:340`. The other five are out of scope; a well-meaning sweep of all six would inflate PR 1 for a change no requirement asks for. Stated so it is a decision, not an omission.

---

## 1. Delivery seam

The seam is design-mandatory and confirmed by the measurement: CODE totals ~530-580 across the change, over the 400 hard budget, so the change splits. `chain_strategy: stacked-to-main`.

```
main
 └─ PR 1  fixes + ALL evidence            (~144-174 CODE, 1,165-1,510 EVIDENCE)   >> lands first
     └─ PR 2  fitness #41 gate            (MEASURED — see the forecast; the gate is RED until PR 1 lands)
         └─ PR 3  close ritual, docs-only (backlog rows + master-plan ficha)      [recommended — see 1.2]
```

When the applier writes each PR body, mark the current PR in that diagram with the `chained-pr` skill's own current-PR marker, and state start, end, prior dependency, follow-up and out-of-scope items.

### 1.1 Ordering constraint (spec `single-use-claim-gate`, "The gate lands with or after the fixes, never before")

The gate is RED until BOTH fixes land. PR 2 therefore merges strictly after PR 1. Rollback order is the inverse and MUST appear in PR 2's body: **revert the gate FIRST** — reverting the fixes under a live gate turns CI red on the reverted tree — and the `fitness.yml` revert consumes a **second** `omnipost-allow sensitive-edit` token.

### 1.2 The close ritual is a lever, not an invention

The brief places the backlog rows in PR 2. Measured, that costs PR 2 11 changed lines and pushes it over budget (section 9). This repo already closes every change with a docs-only micro-PR (#245, #251, #253 — "ritual de cierre": archive + spec promotion + master-plan ficha), and `docs/product/MASTER_PLAN_ES.md` must be updated at close regardless. Moving the backlog rows onto that existing close PR is the established pattern and buys PR 2 real headroom without dropping a single required element from the gate. **This is part of the ONE Edward decision in section 9 — not a unilateral re-plan.**

---

## 2. Work unit U0 — SDD registro (PR 1)

**Commit intent:** `docs(sdd): record the admin-password-reset-claim planning artifacts`
Body names the second outcome: the stale fitness count in `openspec/config.yaml` is corrected 27 → 40 in this commit so PR 2's 40 → 41 diff reads clean.

- [ ] **0.1** Stage the change directory `openspec/changes/admin-password-reset-claim/` — `explore.md`, `pre-propose-decisions.md`, `proposal.md`, `specs/*/spec.md` (×3), `design.md`, `tasks.md`, `evidence/probe-reset-claim-sql-v3.mts`, `evidence/capture-output-v3.txt`. Measured: 2,724 lines already on disk + this file.
- [ ] **0.2** (N9) Include the **uncommitted** `openspec/config.yaml` staleness fix already in the working tree — `:21`, `:62`, `:86` carrying 27 → 40. This is the ORCHESTRATOR's earlier correction, not this change's 40 → 41 bump; sequencing it here is what lets PR 2 present a clean three-line 40 → 41 diff instead of a 27 → 41 diff that reads as this change's doing.
- [ ] **0.3** Apply the three spec amendments the design states verbatim under "Spec amendments the orchestrator applies" — gate baseline "8 marker sites = 7 claim sites + 1 named issuance exception"; residual-limits bullet 4 "line-window matching" → "argument slicing"; refresh spec non-goal gains "…and the per-mint `jti` the rotation claim requires to be a claim (design D9)". **Verify before editing**: all three amendments are ALREADY present in the spec files on disk (`single-use-claim-gate/spec.md:104-109` and `:198-201`, `admin-refresh-rotation-claim/spec.md:45-46`). If so, this item is a confirmation, not an edit — record it as confirmed and change nothing.
- [ ] **0.4** No code, no test, no gate run in this unit. It exists so the planning trail is in the PR a reviewer reads.

---

## 3. Work unit U1 — the reset claim (PR 1)

**Commit intent:** `fix(admin-auth): make the password-reset confirm a single count-gated claim`
Covers reset spec R1, R2, R3, R4, R5, R6, and R7's reset half.

### RED first (record the output in `apply-progress` before any src edit)

- [ ] **1.1** Write `apps/api/tests/unit/helpers/statefulAdminUserPrismaFake.ts` (D5). **Fail-closed**: an unknown column or an unknown filter operator THROWS — it never falls through to `===`. Modelled on the shipped `statefulCustomerUserPrismaFake.ts`. Surface: `adminUser.findFirst` / `findUnique` / `updateMany` / `update`, `adminSession.updateMany`, plus a post-read hook so a test can move the row between the read and the claim, and a failing-write hook. **Do NOT route the tenant guard through it** — `adminUser`/`adminSession` are absent from `TENANT_SCOPED_MODELS`, so a guard check there would decide nothing (the customer fake routes it only because `customerUser` IS enrolled). Supports list `equals` on `passwordHistory` natively. Header JSDoc `@file`/`@description`/`@layer infrastructure` (fitness #9/#10).
- [ ] **1.2** Write `apps/api/tests/unit/admin/auth/PasswordService.test.ts` (**vitest** — `apps/api/tests/unit/**` is the vitest tier). Cases, all from the design's Testing Strategy row 4: success (count 1 → token nulled, history = prior + previous hash, lock cleared, event fired once, sessions revoked); **history guard (F6)** — fake seeded `passwordHash: ""` and `passwordHistory: ["", "$h1"]` → stored history holds `$h1` only, NO `""` entry, and the CAS predicate carried the **UNFILTERED** read snapshot; unknown / expired / inactive token → `INVALID_TOKEN` with `updateMany` never called and the row byte-equal; inactive + locked → lockout intact; weak / reused → no write at all; count-0 with the token nulled by a post-read hook → `INVALID_TOKEN`; count-0 with history moved by a hook → `CONCURRENT_MODIFICATION` and the second call succeeds; count-0 with `passwordHash` moved alone (E2, the login rehash) → `CONCURRENT_MODIFICATION`; owner deactivated after the read → `INVALID_TOKEN`; failing-write hook → `INTERNAL_ERROR` logged, token intact; no event and no revocation on ANY refusal.
- [ ] **1.3** Write `apps/api/tests/integration/adminPasswordResetClaim.integration.test.ts` (**node:test** + `assert` — the integration tier's framework). **Harness from zero**: no test calls `confirmPasswordReset` today. Four MFA layers: adapter-level claim, service simultaneous, service **staggered**, refusal-changes-nothing. Fixtures: `createSeedPrismaClient()` and `assertSeedChannelConfigured()` at module scope, `role.upsert({ where: { name: "ADMIN" } })` (the backfill-suite recipe), a per-case admin with a REAL argon2id `passwordHash`, a `randomUUID()` token and a +1h expiry; per-case cleanup. Seam: the `gateConsumingWrites` wrapper from the design's sketch, gating **both** `update` AND `updateMany` on the racing delegate (gating both is what makes the RED deterministic — the write on `19fb9e6a` is `update`) and signalling on the pre-claim `findFirst`. Sequence: start loser → await `preClaimReadDone` → run winner to completion → capture row → release → await loser.
- [ ] **1.4** Assertions: staggered pair with DIFFERENT passwords → exactly one ok; simultaneous `Promise.all` pair with DISTINCT passwords → exactly one ok; sequential replay → `INVALID_TOKEN`; the stored hash verifies against the winner's password **and against no other password presented** (both directions, the customer precedent); token columns null; **the row after the loser deep-equals the row after the winner, `updatedAt` included** (v3 capture dividend: a refused `updateMany` performs no write at all, so byte-equality is assertable); `onSecurityEvent` spy fired once; sessions revoked once. Non-consuming: weak → `PASSWORD_TOO_WEAK`; reused (history seeded with the new password's hash) → `PASSWORD_REUSED`; expired (`passwordResetExpires` in the past) → `INVALID_TOKEN` with the token columns intact; inactive owner with `lockedUntil` set → `INVALID_TOKEN` with lockout AND token intact; history moved while gated (a direct `adminUser.update` appending to history, token still live) → `CONCURRENT_MODIFICATION`, token intact, retry succeeds.
- [ ] **1.5** Wire `apps/api/scripts/run-tests.sh` with the design's batch block, naming **only the reset racer for now**. Rationale, stated because it deviates from the design's single wiring step: fitness #30 counts any committed test file no `run_batch` names as UNREACHED, so wiring both files here would name `adminRefreshRotationClaim.integration.test.ts` before it exists, and wiring neither would raise #30's ratchet at this commit. U3 extends the same batch line. Keep the block's comment verbatim (`CONCURRENCY=1`, both suites race the SAME credential on purpose, Redis absent on purpose).
- [ ] **1.6** **Run RED.** Unit tier: `pnpm --filter @apps/api test` scoped to the new file. Integration: single file, heap-capped, under `timeout` (LXC rule — never the full suite at once); `pnpm db:up` first. Expected RED shapes, recorded verbatim: the staggered and simultaneous cases fail **by producing TWO successes** with the stored hash verifying against the LAST writer; the liveness, disambiguation, `INTERNAL_ERROR` and history-poison cases fail loudly. A red that fails for any OTHER reason is a harness defect — fix the harness, re-run, and do not proceed on a false red.

### GREEN

- [ ] **1.7** `apps/api/src/admin/auth/PasswordService.ts` — implement blueprint (a) verbatim from the design: ONE `findFirst` selecting `id`, `passwordHash`, `passwordHistory` with `isActive: true` mirrored; strength check and reuse check BEFORE the claim (non-consuming by construction, no compensating write); the history composed as `[...user.passwordHistory, user.passwordHash].filter((entry) => entry.length > 0).slice(-keep)`; ONE `updateMany` whose `where` names `id`, `passwordResetToken`, `passwordResetExpires: { gt: new Date() }`, `isActive: true`, `passwordHash: user.passwordHash`, `passwordHistory: { equals: user.passwordHistory }` — **the UNFILTERED read snapshot**; `data` per the blueprint including the deliberate lockout clearing. **No `isEmpty` branch** — capture v3 P1 proved `equals: []` matches a real `'{}'` row (F3's trap closed).
- [ ] **1.8** The four site comments are canon notes, not decoration, and each is required by a `[static]` scenario: (i) the history guard and why it is unreachable from the tree today; (ii) the claim — why `count > 0` and `count === 1` coincide because **`id` caps the match at one row**, that the token column carries no unique index (blocked by the `"CHANGE_REQUIRED"` sentinel, SMELL-110) and is therefore a claim predicate and not the row key, and that `randomUUID()` collision is NOT what caps the count; (iii) the disambiguation, including the F5 residual — the verdict names the row as of the RE-READ's instant, not the claim's; (iv) the lockout clearing as proof of mailbox control. Method JSDoc states the GUARANTEE (at most one success per token under every interleaving; non-consuming exits keep the token usable; the four exits), never the mechanism.
- [ ] **1.9** `try` covers read → strength → reuse → hash → claim → re-read (D8). A throw becomes `err("INTERNAL_ERROR")` logged through `authLogger` (the `createLogger` factory — LOGGING_CANON; no direct `pino`, fitness #13; empty catch forbidden). Post-claim side effects (`onSecurityEvent`, session revocation) stay OUTSIDE the try, unchanged — the pre-existing non-atomicity the spec requires be NAMED, in the site comment and in the PR body.
- [ ] **1.10** `apps/api/src/admin/auth/adminAuthTypes.ts` — append `| "CONCURRENT_MODIFICATION"` to `AuthErrorCode` (1 line).
- [ ] **1.11** `apps/api/src/admin/auth/adminAuthMiddleware.ts:90` — one entry in the EXHAUSTIVE `Record<AuthErrorCode, string>` (E1): `CONCURRENT_MODIFICATION: "Concurrent modification, retry the request",`. Without it the file does not compile — which is the record doing its job.
- [ ] **1.12** `apps/api/src/admin/auth/adminAuthRoutes.ts` — **exactly 3 changed lines**: `:31` adds `AuthErrorCode` to the existing type import; `:340` retypes the confirm's literal to `Partial<Record<AuthErrorCode, number>>` (DF-4 — an unmapped code becomes a type error instead of a silent 500); one new mapping `CONCURRENT_MODIFICATION: 409` inside `:341-343`. The other five `statusMap` literals in this file are NOT touched.
- [ ] **1.13** Re-run 1.6's suites → GREEN. Portal is unchanged and must stay unchanged: `reset-password/page.tsx:97-99` renders whatever message the API returns.

---

## 4. Work unit U2 — the per-mint `jti` (PR 1)

**Commit intent:** `fix(auth): give every refresh token a per-mint jti`
D9. Its own unit because it is a mechanism change with its own blast radius, it is independently revertible, and the rotation CAS in U3 is **unsound without it**: without a `jti`, two mints of one payload inside one second are byte-identical, so a rotation re-mints the presented token, the CAS swaps a hash for itself, `count === 1` for both racers, and the replay goes undetected.

- [ ] **2.1** RED: add the D9 uniqueness case to `apps/api/tests/unit/authService.test.ts` — two `generateTokens` calls for one payload **in the same tick** (no await between them) → assert distinct `refreshToken` strings, distinct `hashRefreshToken` values, and `jwt.decode(...).jti` a UUID on each. On `19fb9e6a` this is RED **deterministically** (identical strings). That suite does not mock `jsonwebtoken`, so the real signer runs. Record the RED.
- [ ] **2.2** `apps/api/src/auth/authServiceCore.ts` — extend the `crypto` import to `import { randomBytes, randomUUID } from "crypto";` (`:9`) and add `jwtid: randomUUID(),` to the **refresh** `jwt.sign` options (`:427-433`) with the design's site comment. The ACCESS token is deliberately left alone: nothing consumes it by a write, so uniqueness there would be symmetry without a requirement. ~8 lines.
- [ ] **2.3** `apps/api/src/auth/authTypes.ts` — `jti?: string;` on `TokenPayload` (1 line, registered claim, present on refresh tokens).
- [ ] **2.4** (N8) The site comment and the PR body state D9's rationale on its own mechanism. **Do not cite `customerJwt.ts:53` as precedent** — that `jti` is a different token (an MFA challenge id), so the cite would be false. D9's soundness does not rest on a precedent.
- [ ] **2.5** (DF-7) Delete `apps/api/tests/auth.test.ts:286-287` — the comment `// Wait 1 second to ensure new JWT has different iat timestamp` and `await new Promise((resolve) => setTimeout(resolve, 1000));`. The `notEqual` assertion that follows becomes the **no-sleep integration pin** of D9. That sleep is the tree's own record of the defect; deleting it converts a timing dependence into a proof.
- [ ] **2.6** Blast-radius re-verification before GREEN is claimed (the design verified it; confirm it still holds): the refresh JWT is parsed in `apps/api/src` only at `authServiceSession.ts:82` (`jwt.verify` → cast to `TokenPayload`) and `:238` (`jwt.decode` for `exp`); `apps/admin` decodes no JWT. An extra registered claim is ignored by both; the token grows by ~45 bytes inside an opaque cookie/header.
- [ ] **2.7** GREEN: the D9 case and the de-slept `auth.test.ts` both pass; run `auth.test.ts` as a single heap-capped file.

---

## 5. Work unit U3 — the rotation claim (PR 1)

**Commit intent:** `fix(auth): rotate admin refresh tokens by compare-and-swap on the presented hash`
Covers refresh spec F1, F2, F3, F4, and F5.

### RED first

- [ ] **3.1** Write `apps/api/tests/integration/adminRefreshRotationClaim.integration.test.ts` (**node:test**). NOT from zero: reuse the real-adapter `AuthService` construction recipe at `apps/api/tests/auth.test.ts:22-39`, then `registerAdmin` + `login` to obtain the token. Seam: the design's refresh variant of the wrapper — `adminSession.findUnique` signals, `update`/`updateMany` gate; `adminUser` passes through. **Redis-less BY CONSTRUCTION**: never call `setRedisInstance`, so `hasRedis` is false and the DB CAS is the only line that can refuse — a recorded loser `count === 0` then proves the CAS executed rather than short-circuited. Login and race run **inside one second** with no sleep, which is exactly the case D9 makes sound.
- [ ] **3.2** Assertions: staggered and simultaneous → exactly one ok; loser `TOKEN_BLACKLISTED`; recorded loser `count === 0`; stored hash = `hashRefreshToken(winner.refreshToken)` and ≠ the presented hash; the session row after the loser **deep-equals** the row after the winner with `isActive` still true; **the loser's pair appears in no row** — wrap `core.generateTokens` to RECORD every minted refresh token (values, not call counts) and assert the hash of each non-winner mint matches no `adminSession` row (satisfiable only because D9 makes mints distinct); sequential replay refused (`!ok`; the observed code without Redis is `SESSION_EXPIRED` — name that in the assertion message, it is the pre-existing asymmetry D2 documents, not a defect introduced here); the winner's new pair rotates normally afterwards.
- [ ] **3.3** The interleaving MUST be pinned BEFORE either attempt's blacklist write (refresh spec, `[static]` scenario). With Redis structurally absent this holds by construction, and the racer states that in a comment so the pinning is explicit rather than dependent on timing luck.
- [ ] **3.4** Add the rotation cases to `apps/api/tests/unit/authService.test.ts` (already on `mockPrisma`, whose `matchesWhere` handles the CAS's plain equalities and `updateMany` — **no helper change**): rotation stores the new hash; replay refused; count-0 via a `findUnique.mockImplementationOnce` hook that rewrites the stored hash (the concurrent writer) → `TOKEN_BLACKLISTED`, HIGH audit written, stored hash untouched; session deactivated by the hook → `TOKEN_BLACKLISTED`. Redis-ordering (D3) with a recording double set through `setRedisInstance` (methods the helpers call: `get`, `setex`, `del`, `sadd`, `expire`, `scard`, `lpush`, `ltrim`): **no** `setex` under `TOKEN_BLACKLIST_PREFIX` on the count-0 path, exactly one on success.
- [ ] **3.5** Extend the U1 batch line in `apps/api/scripts/run-tests.sh` with `tests/integration/adminRefreshRotationClaim.integration.test.ts`. One batch, both files, `CONCURRENCY=1`.
- [ ] **3.6** **Run RED.** Expected shape: the staggered and simultaneous cases fail by **MINTING TWO PAIRS**, observed on the stored hash and the returned pairs — never on an error code (an error-code assertion is satisfied by the defect whenever the blacklist answers first). Record it.

### GREEN

- [ ] **3.7** `apps/api/src/auth/authServiceSession.ts` — implement blueprint (b): the rotation becomes `updateMany({ where: { id: session.id, refreshTokenHash: hashRefreshToken(refreshToken), isActive: true }, data: { refreshTokenHash: hashRefreshToken(newTokens.refreshToken), expiresAt: newTokens.expiresAt } })`; `count !== 1` → the `:59-72` audit block with `reason: "ROTATED_TOKEN_REPLAYED"` (token-hash prefix, fingerprint/ip when present) then `err("TOKEN_BLACKLISTED")`.
- [ ] **3.8** (D3) Move `blacklistToken` to AFTER a successful CAS — order becomes read → liveness/fingerprint → mint → CAS → (count 1) blacklist → audit → return; the call at today's `:116-118` goes. Site comment states why: the row is the source of truth and Redis is defence-in-depth, so a losing or throwing attempt never kills a live token; and the N9 caller-visible half — a throw inside `blacklistToken` after a committed CAS returns `DATABASE_ERROR` while the rotation persisted, the identical pre-existing shape of today's post-update audit write at `:142-158`.
- [ ] **3.9** Site comment states the `count === 1` reasoning **and why it differs from the reset's `count > 0`**: `AdminSession.refreshTokenHash` is `@unique` (`schema.prisma:231`), so the count is 0 or 1 by construction. The refresh spec has a `[static]` scenario that reads the two sites together — copying one gate onto the other would be wrong in one of the two places.
- [ ] **3.10** Site comment also carries the two named costs (refresh spec, non-merge-blocking requirement): a benign double-refresh from two tabs costs the loser a re-login, and a detected replay is refused but the session family is **not** revoked — a named follow-up that pairs with SMELL-113. Both repeat in the PR body.
- [ ] **3.11** `apps/api/src/infrastructure/repositories/PrismaAdminSessionRepository.ts` — JSDoc on `updateRefreshTokenHash` classifying it as the **issuance** step of `createSession` (E3: insert a throwaway hash → mint the JWT embedding the new session id → swap the real hash in, so nothing presented is consumed), naming it as fitness #41's one exception, with the remove-when: mint the session id before the insert and write the final hash on create. ~5 lines.
- [ ] **3.12** Re-run 3.1-3.4 → GREEN; re-run U1's reset racer → still GREEN.

### PR 1 gate (before the orchestrator opens it)

- [ ] **3.13** `pnpm lint --max-warnings 0` → 0/0 · `tsc -b apps/api` → 0 errors.
- [ ] **3.14** All **40** fitness checks (the pre-#41 suite) → hard-zero, no ratchet raised. Specifically: **#30 measured before and after — the baseline is 21 and it MUST NOT rise** (both new files are named by the batch); #32 → 0 (no `.skip`/`.only`); #9/#10 on every new file (`@file`/`@description`/`@layer infrastructure`); #8 → 0 (no sprint, phase or timeline reference in any new comment); #13 (no direct `pino` — `authLogger` comes from the factory); #23 untouched (the history CAS is a typed `StringNullableListFilter`, no raw SQL); #38/#39/#40 untouched (`AdminUser` bears no `deletedAt`/`accountId`; one statement, no transaction).
- [ ] **3.15** Run the new batch exactly as CI will, and confirm it reports a NON-ZERO collected-test count (fitness #31's rule: a zero-collection run that exits 0 is a false green). LXC-safe: single files, `--max-old-space-size`, `timeout`; `pnpm db:up` first. Do not introduce a bare `node --import tsx` invocation without `--conditions development` (fitness #27 Part A) — `run_batch` already carries it.
- [ ] **3.16** PR 1 body states, as the specs require: the post-claim non-atomicity (a throw in the security event or the session revocation leaves the password changed while returning 500, and closing it is not this change); the benign-double-refresh cost and the deferred family revocation; the accepted behaviour change that a deactivated admin's live token stops working; and that the gate follows in PR 2.

---

## 6. Work unit U4 — fitness #41 (PR 2)

**Commit intent:** `chore(fitness): add check #41 — consumption markers must name their credential in where`
Covers gate spec G1, G2, G3, G4, G5. **ONE commit, not two**: splitting `CLAUDE.md` from `fitness.yml` would leave a commit where the catalogue says 41 and CI runs 40 — the exact drift the suite's own extension rule names first.

- [ ] **4.1** Insert the #41 block into `CLAUDE.md` after `:1486`, inside the existing fence, with one blank separator. Paste the design's `design.md:344-526` verbatim. Update `:305`: "There are **40 checks, numbered #1-#40**" → "**41 checks, numbered #1-#41**".
- [ ] **4.2** (N5) Add ONE clause to the NAMED EXCEPTION paragraph, alongside the existing remove-when: the exemption keys on **file + column**, not on the caller, while its justification is a property of the CALLERS. It is sound today because `updateRefreshTokenHash` has exactly ONE caller tree-wide (`createSession`) — verify that caller set at apply and state the verification. A second caller that consumed a presented hash would inherit the exemption unseen. ~2-3 comment lines; they are inside the mirrored body, so they cost double (section 9).
- [ ] **4.3** Run the block from the repo root on the post-U3 tree → **`0`**. If it is not 0, STOP: either a fix is incomplete or the marker list is wrong, and the gate must not be tuned to fit a broken tree.
- [ ] **4.4** **Red-proof protocol** (the repo rule: a new gate ships with its red demonstrated — plant, real non-zero exit, byte-exact restore, re-confirm 0). Use the scratchpad for the originals; `cp`/`cmp` only, **never git**. Six plants:
  1. `PasswordService.ts` claim `where` reduced to `{ id: user.id }` → **expected: stdout `1`**.
  2. `authServiceSession.ts` CAS `where` reduced to `{ id: session.id }` → stdout `1`, naming `refreshTokenHash`.
  3. `PrismaCustomerUserRepository.ts:226` `resetToken: null` renamed `resetTokenX: null` → **floor breach**: `fitness #41 scope error: 7 marker sites … floor of 8`, exit 1.
  4. Duplicate the `updateRefreshTokenHash` write once in the same file → **exception-count** scope error, exit 1.
  5. Remove one scope directory (or point it at an absent path) → scope-existence error, exit 1.
  6. After each: `cp` back, `cmp` → exit 0, re-run → `0`.
- [ ] **4.5** (N6) **Correct expectation for step 2 of each plant.** The `CLAUDE.md` copy ends with `echo "$COUNT"`, so it prints **only the count** — the violation LINES live in `$VIOLATIONS` and are never echoed there. Expect stdout `1` and nothing more. To see `apps/api/src/admin/auth/PasswordService.ts:<n>: passwordResetToken consumed in data but not named in where`, run the **yml step body** (which does `printf "%s\n" "$VIOLATIONS"`) or inspect `$VIOLATIONS` directly. The design's red-proof step 2 expects the violation line from the CLAUDE.md copy; it will not appear there, and a proof written against the wrong expectation reads as a failed plant.
- [ ] **4.6** Mirror into `.github/workflows/fitness.yml` as a new step after #40 (`:1452`), before `Fitness summary` (`:1454`), under **ONE** `omnipost-allow sensitive-edit` token (15-minute window, audited in `.claude/heuristic-overrides.log`). If the `CLAUDE.md` edit also trips the pre-edit blocker, the SAME token covers it — do not request a second. The step body is the block re-indented 10 spaces, with the yml tail: `Fitness #41: $COUNT violations (expect 0)`, then `if [ "$COUNT" -gt 0 ]` → one `::error title=Fitness #41 violation::…` + `printf` + `exit 1` + `fi`. Every `::error` pairs with an `exit 1` in the SAME step (fitness #34). Update the summary at `:1459`: "40 architectural invariants (#1-#40)" → 41 / `#1-#41`.
- [ ] **4.7** **Drift check** (gate spec: a `diff` of the extracted blocks is empty): extract `sed -n "/^# 41\./,/^EOF$/p"` from `CLAUDE.md` and the same range from the yml step, strip leading whitespace per line, `diff` → empty. Paste, never paraphrase.
- [ ] **4.8** `openspec/config.yaml` 40 → 41 at `:21`, `:62`, `:86` — three lines, in this commit (N8). The 27 → 40 correction already landed in U0, so this diff reads as exactly what this change did.
- [ ] **4.9** `docs/security/SECURITY_CANON.md` — extend the "How to extend" companion-checks line with `#41` single-use claim shape (one line).
- [ ] **4.10** Re-run the full fitness suite on the merged shape: **41 checks, #41 at 0, no other ratchet raised** (#30 still at or below 21; #38's db-prisma sub-count still at or below 11).
- [ ] **4.11** PR 2 body carries the rollback order (gate reverts FIRST; the `fitness.yml` revert consumes a second sensitive-edit token), the measured population ("8 marker sites = 7 claims + 1 named issuance exception"), the red-proof evidence, and the dependency diagram with the current PR marked.

---

## 7. Work unit U5 — close ritual (PR 3, docs-only; see 1.2)

**Commit intent:** `docs(backlog): close SMELL-97 and open the rows this change reported`

- [ ] **5.1** `docs/reports/roadmap-detected-smells-backlog.md` — SMELL-97 row (`:150`) → **DONE** with PR numbers and the merge sha.
- [ ] **5.2** Open the rows. Numbers are assigned **at close against the live backlog** (next free number at `19fb9e6a` is 110, but concurrent closes move it — re-read the file, do not assume).

| Planned               | Row                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SMELL-110             | `"CHANGE_REQUIRED"` sentinel + the dead `mustChangePassword` force-change feature (HIGH) — also what blocks a `@unique` on `AdminUser.passwordResetToken`                                                                                                                                                                                                                                                                                                                                                       |
| SMELL-111             | fitness #23 blind to tagged-template raw queries, 6 production sites (HIGH)                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| SMELL-112             | issued-but-never-consumed credentials: DSAR `verificationToken`, `findByInviteToken` (MEDIUM)                                                                                                                                                                                                                                                                                                                                                                                                                   |
| SMELL-113             | the customer refresh flow has no server-side rotation (MEDIUM) — pairs with the deferred family revocation                                                                                                                                                                                                                                                                                                                                                                                                      |
| SMELL-114             | `PasswordService` unconstructible for tests inside `AdminAuthService` (MEDIUM)                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| SMELL-115             | enumeration timing fig leaf + the `"reset_token_placeholder"` control-flow sentinel (LOW)                                                                                                                                                                                                                                                                                                                                                                                                                       |
| design-found (DF-6)   | `mockPrisma.matchesWhere` falls an **unknown operator** through to `===`, so `{ equals: [...] }` answers "0 rows" — indistinguishable from a correct count gate. 33 suites import it; `auditLogger.ts:319` already sends `equals` through it                                                                                                                                                                                                                                                                    |
| design-found (DF-2)   | the reuse check compares only `passwordHistory`, which receives the CURRENT hash only at write time, so a reset (and `changePassword`) can set the password to its current value                                                                                                                                                                                                                                                                                                                                |
| **gate pass-2 (new)** | the **SECOND** admin refresh flow — `AdminAuthService.refreshToken`, the `ADMIN_JWT_*`/`TokenService` family — compares the stored hash and issues only a new ACCESS token, so it **never rotates its stored hash for the token's life**. The admin twin of SMELL-113. It is out of #41's class by construction (no consuming write exists for the gate to see), which is exactly why it needs a row: the gate's silence there is a decision, and a decision with no row is indistinguishable from an oversight |

- [ ] **5.3** `docs/product/MASTER_PLAN_ES.md` — dashboard §6 + the SMELL-97 ficha, with verified PR numbers and shas (the master-plan update is mandatory at every cluster close).
- [ ] **5.4** Archive the change and promote the three specs per the established close ritual.

---

## 8. Requirement traceability

Every `[MERGE-BLOCKING]` requirement maps to at least one task, and no task exists without a requirement behind it.

| Spec    | Requirement                                                                  | Tasks                                                                                                                                                   |
| ------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| reset   | R1 one atomic count-gated claim                                              | 1.3, 1.4, 1.7, 1.8                                                                                                                                      |
| reset   | R2 non-consuming exits leave the token usable                                | 1.2, 1.4, 1.7                                                                                                                                           |
| reset   | R3 liveness gates the claim; lockout clearing deliberate                     | 1.2, 1.4, 1.7, 1.8(iv)                                                                                                                                  |
| reset   | R4 zero count disambiguated, never a false `INVALID_TOKEN`                   | 1.2, 1.4, 1.7, 1.8(iii), 1.10-1.12                                                                                                                      |
| reset   | R5 a throw is `INTERNAL_ERROR`, never `INVALID_TOKEN`                        | 1.2, 1.9                                                                                                                                                |
| reset   | R6 history from ONE read, never an empty entry                               | 1.2 (F6 case), 1.7                                                                                                                                      |
| reset   | R7 evidence in CI, RED on the unmodified tree                                | 1.3-1.6, 3.14, 3.15                                                                                                                                     |
| reset   | post-claim non-atomicity named (non-blocking)                                | 1.9, 3.16                                                                                                                                               |
| refresh | F1 rotation is a claim on the token replaced                                 | 3.1, 3.2, 3.7, 3.9                                                                                                                                      |
| refresh | F2 a rotated token is never accepted again                                   | 3.2, 3.4, 3.7                                                                                                                                           |
| refresh | F3 the claim, not the cache, is the authority                                | 3.1 (Redis-less), 3.4 (ordering), 3.7, 3.8; **U2 in full** — without D9 the CAS is a no-op in the same-second case and the cache would be the only line |
| refresh | F4 a refused rotation changes nothing                                        | 3.2, 3.7                                                                                                                                                |
| refresh | F5 evidence in CI, RED by minting two pairs                                  | 3.1-3.6, 3.14, 3.15                                                                                                                                     |
| refresh | benign double-refresh + deferred family revocation documented (non-blocking) | 3.10, 3.16                                                                                                                                              |
| gate    | G1 class invariant, hard-zero, two places agreeing                           | 4.1, 4.6, 4.7                                                                                                                                           |
| gate    | G2 population MEASURED, fail-closed                                          | 4.2, 4.3, 4.4(3-5)                                                                                                                                      |
| gate    | G3 red DEMONSTRATED                                                          | 4.4, 4.5                                                                                                                                                |
| gate    | G4 residual limits written INTO the check                                    | 4.1 (residuals 1-7 verbatim), 4.2                                                                                                                       |
| gate    | G5 gate lands with or after the fixes                                        | 1.1 seam, 4.x in PR 2, 4.11 rollback order                                                                                                              |

---

## 9. Review Workload Forecast

**CODE — PR 1 (fixes + all evidence). Estimate; these lines do not exist yet and cannot be measured.**

| File                                                                                                              | CODE                                |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `apps/api/src/admin/auth/PasswordService.ts` (blueprint a + 4 site comments + method JSDoc + `authLogger` import) | 90-110                              |
| `apps/api/src/auth/authServiceSession.ts` (blueprint b + blacklist-after + count-0 audit + comments)              | 35-45                               |
| `apps/api/src/auth/authServiceCore.ts` (D9: import member, `jwtid`, site comment)                                 | 8                                   |
| `apps/api/src/auth/authTypes.ts` (`jti?: string`)                                                                 | 1                                   |
| `apps/api/src/admin/auth/adminAuthTypes.ts` (`CONCURRENT_MODIFICATION`)                                           | 1                                   |
| `apps/api/src/admin/auth/adminAuthMiddleware.ts` (one message entry)                                              | 1                                   |
| `apps/api/src/admin/auth/adminAuthRoutes.ts` (DF-4 retype + type import + 409 mapping)                            | 3                                   |
| `apps/api/src/infrastructure/repositories/PrismaAdminSessionRepository.ts` (JSDoc classification)                 | 5                                   |
| **PR 1 CODE**                                                                                                     | **144-174** — comfortably under 400 |

**CODE — PR 2 (gate #41). MEASURED, per section 0.**

| Element                                                                                     | Insertions | Deletions | Changed (ins+del) |
| ------------------------------------------------------------------------------------------- | ---------- | --------- | ----------------- |
| `CLAUDE.md` — #41 block (183 measured **+ ~3 for the N5 clause** = 186) + 1 blank separator | 187        | 0         | 187               |
| `CLAUDE.md:305` — count sentence 40 → 41                                                    | 1          | 1         | 2                 |
| `.github/workflows/fitness.yml` — #41 step (body-minus-tail 182 + yml tail 9 + scaffold 5)  | 196        | 0         | 196               |
| `.github/workflows/fitness.yml:1459` — summary 40 → 41                                      | 1          | 1         | 2                 |
| `openspec/config.yaml` — `:21`, `:62`, `:86`                                                | 3          | 3         | 6                 |
| `docs/security/SECURITY_CANON.md` — companion bullet                                        | 1          | 1         | 2                 |
| `docs/reports/roadmap-detected-smells-backlog.md` — 9 new rows + SMELL-97 → DONE            | 10         | 1         | 11                |
| **PR 2 as briefed**                                                                         | **399**    | **7**     | **406**           |

**PR 2 CROSSES THE 400 HARD BUDGET.** Stated loudly, as the brief requires. Under the additions-only reading it is 399 — one line under, which is not headroom, it is a coin flip. Under the `chained-pr` skill's own metric (`additions + deletions`) it is **406, over by 6**. The design forecast ~383 with ~17 headroom; that estimate undercounted the comment block by 4 lines (68 claimed, 72 measured) and did not carry the N5 clause the design gate then mandated.

**The levers, in the order I recommend them. Neither drops a required element — no population sentence, floor sentence, converted-sites sentence, out-of-class boundary, threat line, marker list, named exception, remove-when, N5 caller clause or residual (1)-(7) may be removed.**

| Lever                                                                                                                                                                                                                             | Saving | Effect on PR 2 (ins / ins+del) |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------ |
| **L1** — move the backlog rows to the close-ritual PR 3, this repo's established pattern (§1.2)                                                                                                                                   | 11     | 389 / 395                      |
| **L2** — re-wrap ~6 comment lines in the #41 block (same sentences, fewer lines; the comment is prose-wrapped at ~95 columns and several paragraphs re-flow losslessly). Each line saved costs **double** — the block is mirrored | 12     | 377 / 383                      |
| **L1 + L2 (recommended)**                                                                                                                                                                                                         | 23     | **377 / 383 — headroom 17**    |

If Edward prefers the backlog in PR 2, L2 alone lands it at 387 / 394: inside budget, but with 6 lines of margin.

**EVIDENCE — declared band, itemized so ONE adjudication covers it.**

| Line                                                                                                                                                                                                                                                | Lines           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Reset racer, **harness FROM ZERO** (fixtures, admin seeding, staggered ordering primitive, 4 MFA layers) — its own line because nothing in the tree calls `confirmPasswordReset` today                                                              | 300-380         |
| Refresh racer (the `AuthService` recipe is reused from `auth.test.ts:22-39`, so NOT from zero)                                                                                                                                                      | 220-300         |
| **Dedicated fail-closed stateful admin Prisma fake** (D5) — a new helper rather than extending `mockPrisma`, which 33 suites import and whose unknown-operator fall-through (E5) would answer a silent false zero for the very predicate under test | 250-320         |
| `PasswordService.test.ts` unit tier (13 cases incl. the F6 history guard and three count-0 shapes)                                                                                                                                                  | 250-320         |
| `authService.test.ts` — rotation + Redis-ordering + D9 same-tick uniqueness                                                                                                                                                                         | 130-175         |
| `auth.test.ts` — DF-7 sleep deletion                                                                                                                                                                                                                | 3               |
| `run-tests.sh` batch wiring (counted ONCE; split across U1 and U3 for per-commit fitness #30 integrity)                                                                                                                                             | 12              |
| **EVIDENCE band**                                                                                                                                                                                                                                   | **1,165-1,510** |

**Writer hard stop: 1,737 EVIDENCE lines** (band max + 15%). On crossing it the writer STOPS and reports rather than continuing — an EVIDENCE overrun is a signal that a harness is being over-built, not a licence to keep going.

**Third declared line, outside both bands, so the review load is fully visible:** SDD planning artifacts ≈ **3,077 lines** of markdown riding U0 (2,724 measured on disk + this file). Not CODE, not test EVIDENCE; declared because a reviewer opening PR 1 meets them.

---

- **Chained PRs recommended: Yes** — mandatory, not advisory: CODE totals ~521-580, and the gate is red until both fixes land.
- **400-line budget risk: High** — PR 2 measures 406 changed lines as briefed and needs a lever before apply. PR 1 is low risk at 144-174 CODE.
- **Estimated changed lines:** PR 1 CODE 144-174 (+ EVIDENCE 1,165-1,510 + artifacts ~3,077) · PR 2 CODE 377-406 depending on the lever chosen.
- **Decision needed before apply: Yes.** ONE stop, three things to adjudicate together: (1) confirm the two-PR seam (fixes+evidence, then gate) and whether PR 3 is the close ritual; (2) choose the PR 2 lever — **L1 + L2 recommended** (383 changed, headroom 17); (3) approve the EVIDENCE band 1,165-1,510 with the 1,737 hard stop.

---

## Forecast adjudication — SIGNED (Edward Velasquez, 2026-09-13, the change's ONE decision stop)

1. **Chain confirmed: THREE PRs stacked-to-main** — PR 1 fixes + all evidence · PR 2 gate #41 · PR 3 close ritual (archive + Master Plan ficha + backlog rows).
2. **PR 2 lever: L1 + L2** — backlog rows move to PR 3; ~6 comment lines re-wrapped losslessly in the #41 block (mirrored, so each saved line counts double) → PR 2 lands at ~377 insertions / ~383 changed, headroom ~17. No required element drops.
3. **EVIDENCE band RATIFIED: 1,165-1,510, writer hard stop 1,737** (band max +15%) — on crossing, the writer STOPS and reports, never trims.

W1 scope note presented with the forecast and accepted as part of this signature: D9 (per-mint `jti`) touches `authServiceCore.ts` (~8 lines) + `authTypes.ts` (1 line) beyond the two claim files — the mechanism that makes the rotation claim a claim, per the design-gate adjudication.
