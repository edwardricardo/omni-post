# Proposal: Implementation-Plan Re-validation (Track 2)

> Store: hybrid · Branch: `workstream/impl-revalidation` (off main `552c63a9`) · Mode: interactive.
> Reads: explore (obs 174), `~/.claude/plans/track2-revalidation.md`, `IMPLEMENTATION_PLAN_ES.md`, `PENDING_WORK_INVENTORY.md §2`, ADR-0018.

## Intent

`IMPLEMENTATION_PLAN_ES.md` is reset to **0/67** post dep-baseline. We must re-confirm every item against the CURRENT bar (0-defect canon + the now-confirmed §2 security + the ADR-0018 dep-freshness gate) before re-marking `[x]`. **Why now:** the §2 IDOR/auth/cache/write-path cluster is `UNVERIFIED-prelim` (WF2 single-pass, no adversarial Verify ran) yet it GATES the Fase 1-2 client-portal items (white-label, reviews, inbox). Re-validating those items "against §2 findings" is meaningless until the findings are confirmed — so security is a precondition, not a checkbox.

## Scope

### In Scope

- **Phase A — §2 security confirm + fix (precondition).** Adversarial Verify on the §2 `UNVERIFIED-prelim` leads → CONFIRM/refute → FIX the confirmed cluster.
- **Phase B — per-item re-validation WALK, INDIVIDUAL** — all **67** items one-by-one (incl. the ~23 done+frozen), section-ordered B → Fase 0 → 1 → 2 → 3.
- Per item: SCOPE → dep-freshness gate → frozen-lockfile install + `syncpack` → RE-VERIFY → fix → `[x]`.
- Catalog-bump candidates drained AFTER the walk as ONE root PR.

### Out of Scope

- NO batch-assert of the frozen items (Edward: walk individual).
- NO mid-walk catalog edits (shared deps asserted, staleness logged only).
- NO vite-8 migration (RE-VERIFY under the **vite 7.3.5 hold**, rolldown JSX-in-SSR gap).
- The full paused assessment tail (WF2 remaining finders, WF3, synthesis) beyond what §2-confirm needs.
- Git operations (orchestrator integrates). Archiving the `dependency-baseline` SDD change.

## Capabilities

> Pure process/verification + security-remediation change. No NEW product capability is introduced; spec-level behavior changes only where a §2 fix tightens an existing contract.

### New Capabilities

- None.

### Modified Capabilities

- None at the spec-authoring level for the walk itself. Phase A security fixes MAY tighten existing tenant-isolation behavior on `posts`, `accounts`, `analytics`, `trackedLink`, `notifications`, `recurring`, `comments`, cache keys, `auth/register`, and the publish/OAuth-refresh path — sdd-spec decides whether each confirmed fix warrants a delta spec once Phase A confirmation lands.

## Approach

**Phase A — block-first security.** Run the adversarial Verify on the §2 leads (PENDING_WORK_INVENTORY §2). In-scope sub-areas: **§2A IDOR cluster** (posts/accounts/analytics/trackedLink/scheduledReport/notifications/recurring/comments + the project-scoped-guard-gap root cause), **§2B cache cross-tenant** (HTTP `autoCache` + AI cache), **§2C auth** (AUTH-REGISTER-PRIVESC + RATELIMIT-DEAD), **§2F write-path** (WRK-DOUBLE-POST, OAUTH-REFRESH-UNWIRED, WRK-NO-REAUTH, SAGA-ACCOUNTID-AS-USERID). Confidence is ELEVATED for the IDOR/auth cluster (`known_smell` + SMELL-31/32 corroboration). Confirmation = re-read the cited code path + exercise the exploit hypothesis; refuted leads are recorded as not-a-defect with evidence. **Fix DoD:** confirmed defect closed via the canon path (tenant gate / owner check via `callerAccountId`, accountId in cache key, role-strip on register, rate-limit middleware registered, OAuth refresh wired) + a regression test + the §2G CI gate wired so it cannot silently regress + 0-defect green. OAUTH-REFRESH-UNWIRED is the explicit precondition for F1-API-4 (Canva).

**Phase B — per-item walk.** Section-ordered, respecting `🔗 dep:` and §8.5 (no Fase 3 while any Fase 1 open). Per item, the **dep-freshness gate** sits between SCOPE and RE-VERIFY: a SHARED dep (≥2 manifests / family / in catalog) is ASSERTed == catalog pin — if stale, logged as a catalog-bump candidate and validated against the CURRENT pin (NEVER edited mid-walk); a PRIVATE dep (one manifest, that item) may be freshened (`taze` private-only, contained). Then `pnpm install --frozen-lockfile` + `syncpack list-mismatches`. RE-VERIFY = tests + DoD + current 0-defect canon + the now-CONFIRMED §2 caveats for that item's area. The ~23 frozen items are re-confirm (code already merged); the ~44 open are build-then-confirm — heterogeneous, but each still walks the same gate. RE-VERIFY runs against the MERGED-main tree.

## Affected Areas

| Area                                               | Impact   | Description                                                                                      |
| -------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `apps/api/src/**` routes/use-cases                 | Modified | §2A/2C/2F security fixes (tenant gates, owner checks, register role-strip, OAuth refresh wiring) |
| `apps/api/src` cache + `autoCache`                 | Modified | §2B accountId in HTTP + AI cache keys                                                            |
| `apps/workers/src/**` publish path                 | Modified | §2F WRK-DOUBLE-POST idempotency, WRK-NO-REAUTH, saga tenant-id                                   |
| `.github/workflows/**` + integration tests         | Modified | §2G CI gates wired (16 dead integration files, RLS isolation)                                    |
| `docs/product/IMPLEMENTATION_PLAN_ES.md`           | Modified | per-item `[x]` re-marking + dashboard 0→N as the walk progresses                                 |
| `~94 package.json` + `pnpm-workspace.yaml` catalog | Modified | catalog-bump candidates drained as ONE root PR after the walk                                    |

## Risks

| Risk                                                                                    | Likelihood | Mitigation                                                                                   |
| --------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------- |
| §2 lead refuted after fix-scoping work                                                  | Med        | Confirm-before-fix; refuted leads recorded with evidence, not patched blind                  |
| F1-CLI-4 blocked by bulk-schedule targeting concept error (per-provider vs per-channel) | High       | Resolve `bulk_schedule_targeting_gap` redesign BEFORE that item; item stays `[!]` until then |
| F1-API-4 (Canva) lands on unwired OAuth refresh                                         | High       | Gated on §2F OAUTH-REFRESH-UNWIRED fixed in Phase A first                                    |
| Frontend RE-VERIFY breaks under vite 8 expectation                                      | Med        | RE-VERIFY explicitly under vite 7.3.5 hold; minimatch/brace consumer-governed                |
| Heavy install/build/test OOM on 9GB LXC                                                 | High       | Heavy runs need Edward's dev PAUSED; LXC-safe heap caps + timeouts; sequential batches       |
| §2A fix silently regresses (no net)                                                     | Med        | §2G CI gate wired WITH the fix, not after                                                    |
| Walk drifts the catalog mid-flight                                                      | Low        | Shared deps asserted-only; bumps deferred to one post-walk root PR                           |

## Rollback Plan

Per-PR revert. Phase A ships as its own PR(s) (one security cluster per slice) on the tracker; reverting a security PR restores the prior (vulnerable-but-known) state without touching the walk. Phase B ships as per-section or per-item PRs — each `[x]` re-mark + its fix is an isolated, revertible unit. The catalog-bump root PR is the last and most isolated revert. No item re-marks `[x]` until its PR is green, so the plan dashboard never advances past verified state.

## Dependencies

- Track 1 (dependency baseline) merged to main — DONE.
- `bulk_schedule_targeting_gap` redesign — precondition for F1-CLI-4.
- §2F OAUTH-REFRESH-UNWIRED fixed in Phase A — precondition for F1-API-4.
- Edward's dev PAUSED for heavy verification runs (LXC ~9GB).

## Delivery Strategy

**Recommended: feature-branch-chain on the tracker `workstream/impl-revalidation`.** Phase A as its own PR(s) — one per confirmed security cluster (IDOR, cache, auth, write-path) so each stays within the 400-line review budget and reverts independently. Phase B as **per-section** PRs by default (B / Fase 0 / Fase 1 / Fase 2 / Fase 3), splitting to **per-item** when a single item is a real build (most of the ~44 open) or exceeds budget. PR #1 targets the tracker; later child PRs target the immediate previous PR branch. Only the tracker merges to main. The catalog-bump root PR lands last.

## Success Criteria

- [ ] Phase A: every in-scope §2 lead CONFIRMED or refuted with evidence; every confirmed defect fixed via the canon path + regression test + §2G CI gate wired; 0-defect green.
- [ ] Phase B: all 67 items re-walked INDIVIDUAL; each `[x]` only after dep-gate asserted + `frozen-lockfile`/`syncpack` green + RE-VERIFY (tests + DoD + 0-defect + confirmed §2 caveats) passes.
- [ ] §8.5 honored: no Fase 3 item re-marked while any Fase 1 item is open.
- [ ] F1-CLI-4 not started until the bulk-schedule targeting redesign lands; F1-API-4 not started until §2F OAuth-refresh is fixed.
- [ ] Catalog-bump candidates logged during the walk, drained as ONE root PR after — zero mid-walk catalog edits.
- [ ] Dashboard reaches 67/67 only when every item is verified; `dependency-baseline` SDD change archived.
