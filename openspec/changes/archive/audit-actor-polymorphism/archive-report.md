# Archive Report — audit-actor-polymorphism (ADR-0020)

**Status**: complete (spec merge + report done by this phase; folder move MUST still be performed by the orchestrator — see below)
**Date**: 2026-07-12
**Artifact store**: hybrid (openspec files + engram mirror)

## Task Completion Gate — PASSED

Read `openspec/changes/audit-actor-polymorphism/tasks.md` in full (not assumed).
All 40 tasks across both slices are checked:

| Section                         | Tasks     | Result    |
| ------------------------------- | --------- | --------- |
| A1.0 Preconditions              | 0.1       | `[x]`     |
| A1.1 Schema & Migration         | 1.1–1.4   | all `[x]` |
| A1.2 Port + Adapters            | 2.1–2.5   | all `[x]` |
| A1.3 AuditableService seam      | 3.1–3.2   | all `[x]` |
| A1.4 DSAR unit coverage         | 4.1       | `[x]`     |
| A1.5 28 mechanical wraps        | 5.1–5.7   | all `[x]` |
| A1.6 Direct writers + optionals | 6.1–6.6   | all `[x]` |
| A1.7 ADR + guards + verify prep | 7.1–7.6   | all `[x]` |
| A2.1 Stats + getLogs            | 8.1–8.3   | all `[x]` |
| A2.2 CSV + API shape            | 9.1–9.2   | all `[x]` |
| A2.3 Frontend type + compliance | 10.1–10.3 | all `[x]` |

32 A1 tasks + 8 A2 tasks = 40/40. No stale unchecked checkbox. No exceptional
reconciliation was needed.

## Verify Report Review — no unaddressed CRITICAL

Read `openspec/changes/audit-actor-polymorphism/verify-report.md` (both the A1
section and the appended A2 section) in full.

| Slice | Initial verdict    | Post-remediation verdict                                                                                              | CRITICAL | WARNING (disposition)                                                                                                                      | SUGGESTION                                                                                               |
| ----- | ------------------ | --------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| A1    | PASS WITH WARNINGS | PASS (3 suggestions resolved same session: derivation-wins hardening, enum-constant consistency, spec-line alignment) | 0        | 1 (commit-boundary hygiene, non-code — resolved by the orchestrator excluding unrelated files from the A1 commit)                          | 3 (all 3 resolved same session, see verify-report §Post-verify remediation)                              |
| A2    | PASS WITH WARNINGS | PASS (both warnings resolved same session)                                                                            | 0        | 2 (A2-W1 `"undefined"` CSV cell — RESOLVED via `formatOptionalCell`; A2-W2 stray slice/task references in comments — RESOLVED, prose kept) | 4 (1 fixed — "Stub" wording; 2 accepted-deferred to backlog; 1 rejected with spec rationale — see below) |

**Zero CRITICAL findings across both slices.** Every resolvable WARNING was
closed within the same session with RED→GREEN proof where applicable. Both
verify-report sections end with `Next: sdd-archive`.

## Specs Synced (openspec/specs/ — source of truth updated)

Three named capabilities existed as delta specs under
`openspec/changes/audit-actor-polymorphism/specs/`; none had a corresponding
living spec under `openspec/specs/` yet, so each was created as a full spec
(not a delta merge), following the `mfa-consolidation` precedent structure
(`## Requirements` with Given/When/Then scenarios, `[MERGE-BLOCKING]` markers,
`## How to extend`).

| Domain                      | Action  | Details                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit-actor-attribution`   | Created | Delta spec's 4 requirements carried forward. 1 requirement was RENAMED for clarity ("Explicit actorType discriminator with deterministic backfill" → "actorType is the ONLY way readers distinguish actors — never a null FK") and gained a new scenario making the SYSTEM-vs-CUSTOMER disambiguation explicit — this is the exact durable guarantee verify-report A2 calls "ADR-0020's core principle" and it deserves first-class visibility in the living spec, not just a closing sentence.                                                                                                                                                                                                                                                                             |
| `customer-audit-write-path` | Created | Delta spec's 4 requirements carried forward (already using the aligned `anonymizeCustomerUser` name — the spec-line alignment from verify-report S3 was already applied to the delta spec before this archive ran). 1 NEW requirement added: "Derivation wins over an explicit actorType at every direct-writer create path" `[MERGE-BLOCKING]`, synthesized from the A1 post-verify S1 remediation (derivation-wins hardening across `auditLogger.ts`, `AuditService.log`, `AdminAuthService`'s writer, and `services/audit.ts`'s `emitAudit`) — this closed a real latent mislabeling defect class and is now a structural guarantee, not merely a suggestion disposition.                                                                                                |
| `audit-actor-visibility`    | Created | Delta spec's 3 requirements carried forward, but the admin do-not-regress guarantee — originally implicit prose ("Admin rows SHALL render identically to today" / "byte-identical") — was promoted to 2 explicit `[MERGE-BLOCKING]` requirements ("Admin stats and getLogs output is byte-identical", "Admin row exports identically to before this capability shipped", "Admin rows render identically in the compliance view"). The original delta spec never formally tagged any A2 requirement `[MERGE-BLOCKING]`, yet verify-report's own language calls this "the MERGE-BLOCKING do-not-regress guarantee" — the living spec now matches what verify-report already treated as binding, so a future PR touching these read surfaces cannot silently relax the freeze. |

All three living specs cross-reference each other, the archived design doc,
and ADR-0020, and each carries a `## How to extend` section per the
established `openspec/specs/*/spec.md` convention (matching `mfa-consolidation`
and `cross-tenant-criticals`).

## The key durable guarantee (say it plainly, so it is never reintroduced)

**Readers of `AuditLog` switch on `actorType`. They NEVER infer an actor from
a null FK.** Before this change, `userId == null` meant "system action" by
convention — but a customer-actor row also has `userId == null` (customers
FK to `customerUserId`, not `userId`), so that convention is ambiguous the
moment a second actor type exists. `actorType` is the explicit discriminator
that makes SYSTEM and CUSTOMER distinguishable despite sharing a null
`userId`. This is recorded as its own `[MERGE-BLOCKING]` requirement +
scenario in `openspec/specs/audit-actor-attribution/spec.md` precisely so a
future contributor reading `AuditLog` does not "simplify" a query back to a
null-check and quietly reintroduce the ambiguity this change exists to kill.

## Carry-forward items (explicitly NOT closed by this archive)

Each is a future slice, not part of `audit-actor-polymorphism`:

1. **Fitness #8 is a blind guard.** Its regex matches `Sprint N` / `Phase N`
   / `T0A_` / `(P[0-9])`-style parenthetical forms, but NOT the bare slice
   form (`A1`, `A2`) nor the bare task-number form (`8.3`). Both sat in
   production and test comments during this change and CI stayed green
   (count = 0) — the guard could not see the violation it exists to
   prevent. All discovered instances were fixed at the source during
   post-verify remediation (nine call sites + four more found on a
   repo-wide re-scan), but the regex gap itself remains open. This belongs
   with cluster G / N-CI-1, which already reports fitness #2/#3/#4 grepping
   nonexistent paths — widening #8's regex is a repo-wide change that will
   surface pre-existing hits elsewhere and needs a documented baseline per
   CLAUDE.md's "Extending the suite" protocol, so it was correctly NOT done
   inside this change.
2. **5 legacy CSV columns emit `"null"`/`"undefined"`** (`Error`,
   `Resource`, `Resource ID`, `IP Address`, `User Agent`) — the exact same
   defect class A2 fixed for the actor columns (`formatOptionalCell`), but
   these five columns are inside the nine-column pre-change set that
   `audit-actor-visibility`'s spec now freezes `[MERGE-BLOCKING]` as
   byte-identical. Blanking them would change ADMIN row bytes, so the fix
   needs an explicit spec amendment (relaxing the freeze on those five
   columns specifically), not a patch. Documented in the living spec's
   `## How to extend` §2.
3. **Rejected suggestion, reason recorded**: badging all three actor types
   (not just CUSTOMER) in the compliance view was REJECTED because it would
   change the ADMIN row's rendered markup — a direct violation of
   `audit-actor-visibility`'s "Admin rows render identically" requirement.
   It also needs a spec amendment, documented in the living spec's
   `## How to extend` §3, not a silent patch.
4. **Readability/perf suggestions accepted to backlog** (from verify-report
   A2-S1/A2-S3, both dispositioned "accepted, deferred to backlog", neither
   a defect):
   - `apps/admin/hooks/api/useCompliance/api.ts:120`'s display-name
     coalescing chain (`log.user?.name ?? customerDisplayName(...) ??
log.userId ?? "Unknown"`) could be an explicit `switch (log.actorType)`
     — correct today only because the exclusive-arc CHECK guarantees at
     most one actor FK is non-null; a switch would make that contract
     self-evident to the reader instead of implicit.
   - `getStats` (`auditService.ts`) and `getStatistics` (`auditLogger.ts`)
     each run a `customerUser.findMany` serially AFTER the `groupBy`
     resolves, instead of joining the existing `Promise.all`. Pure latency
     micro-optimization, mirrors the existing `adminUser.findMany` shape
     (internally consistent today), no correctness impact.

## Commit chain

**Note on verification method**: this archive executor has no Bash/shell
tool in its available tool set for this session, so `git log --oneline`
could not be run directly by this phase. The commit hashes below were
supplied by the orchestrator's task instructions and cross-checked against
internal evidence already present in `verify-report.md`, which independently
states (A2 section, written before this archive phase): _"Branch:
`workstream/cluster-b-mfa` · A1 committed at `3242147a` (confirmed ancestor
of `HEAD` `b97a4157`); uncommitted working tree = A2"_ — i.e. verify itself
already confirmed A1 (`3242147a`) as an ancestor of a later HEAD via its own
`git log` check. Per the task instructions, A2 has since been committed as
`35d44f4f`.

- **A1** — `3242147a` (exclusive-arc schema + write seam + DSAR).
- **A2** — `35d44f4f` (read-path visibility: stats, CSV export, admin
  frontend).

**Recommendation**: the orchestrator should re-run `git log --oneline -- .`
(or equivalent) before finalizing the folder move/commit below, to confirm
both hashes are on `workstream/cluster-b-mfa` and that no other uncommitted
changes remain in the working tree for this change's files.

## Traceability — Engram observation IDs

| Artifact                       | Engram topic_key                              | Observation ID             |
| ------------------------------ | --------------------------------------------- | -------------------------- |
| Proposal                       | `sdd/audit-actor-polymorphism/proposal`       | #224                       |
| Spec (3 delta specs)           | `sdd/audit-actor-polymorphism/spec`           | #225                       |
| Design                         | `sdd/audit-actor-polymorphism/design`         | #226                       |
| Tasks                          | `sdd/audit-actor-polymorphism/tasks`          | #227                       |
| Apply progress                 | `sdd/audit-actor-polymorphism/apply-progress` | #228                       |
| Verify report (A1 + A2)        | `sdd/audit-actor-polymorphism/verify-report`  | #229                       |
| Archive report (this document) | `sdd/audit-actor-polymorphism/archive-report` | (new, saved by this phase) |

## Filesystem changes made by this archive phase

- Created `openspec/specs/audit-actor-attribution/spec.md` (new living spec)
- Created `openspec/specs/customer-audit-write-path/spec.md` (new living spec)
- Created `openspec/specs/audit-actor-visibility/spec.md` (new living spec)
- Created `openspec/changes/audit-actor-polymorphism/archive-report.md` (this file)

## Filesystem changes the orchestrator MUST still perform

This archive executor has NO filesystem-move tool. Per the archive
convention (bare-name form, confirmed against the sibling archives
`cross-tenant-criticals`, `mfa-consolidation`, `dev-prod-resolution-model`,
`knip-at-alias-resolution` — none are date-prefixed):

- Move `openspec/changes/audit-actor-polymorphism/` → `openspec/changes/archive/audit-actor-polymorphism/` (pure rename, no content altered).

Every cross-reference written in the three new living specs already points
at the bare-name path `openspec/changes/archive/audit-actor-polymorphism/`,
so no fix-up is needed in the specs after the move.

## Next Recommended

`none` for planning — the change is functionally complete and its
guarantees are now recorded in living specs. Remaining follow-ups are
outside SDD's scope: (1) the orchestrator performs the folder move above and
commits it together with the living specs and this report, (2) the
orchestrator re-confirms the A1/A2 commit hashes via `git log --oneline`
before that commit, and (3) the four carry-forward items above are routed to
backlog, not silently dropped.
