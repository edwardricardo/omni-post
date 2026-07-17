# Verification Report — external-notification-tenant-guard (Slice 1, REFERENCE IMPL)

- **Change**: `external-notification-tenant-guard`
- **Branch**: `workstream/cluster-c-extnotif-guard`
- **Mode**: hybrid (openspec files + engram mirror)
- **Verdict**: **PASS** — 0 CRITICAL, 0 WARNING, 3 SUGGESTION (all non-blocking)
- **Independence**: re-verified at source + real DB + real test execution. Sensitive
  `infra/prisma/**` was NOT touched (read-only introspection only).

## Completeness

| Artifact                                                                                         | Status                                                                                                                      |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| spec (5 reqs, 3 MERGE-BLOCKING)                                                                  | present, all mapped                                                                                                         |
| design (D1 order, D2 threading, D3 list-200, D3a 404, index rule, per-route runtime enforcement) | present, all honored                                                                                                        |
| tasks                                                                                            | 20/20 checkboxes complete (launch prompt said "21"; the openspec artifact contains 20 — cosmetic count mismatch, all `[x]`) |

## Test execution (independent re-run, LXC single-file)

| Suite                                                                             | Result                             |
| --------------------------------------------------------------------------------- | ---------------------------------- |
| INT `externalNotificationTenantIsolation.test.ts` (node:test, real DB, 2 tenants) | **10 pass / 0 fail / 0 cancelled** |
| UNIT `security/tenantGuard.test.ts` (vitest)                                      | 24/24                              |
| UNIT `application/externalNotificationUseCase.test.ts`                            | 12/12                              |
| UNIT `infrastructure/PrismaExternalNotificationConfigRepository.test.ts`          | 4/4                                |
| UNIT `infrastructure/container/setupExternalNotificationUseCases.test.ts`         | 2/2                                |
| UNIT (core) `ConfigureExternalNotificationUseCase.test.ts`                        | 8/8                                |

## DB state (real dev DB, migration already applied — pg catalog introspection)

- `ExternalNotificationConfig.accountId`: exists, `is_nullable = NO` (NOT NULL), type text — **PASS**
- FK `ExternalNotificationConfig_accountId_fkey` → `Account`, `confdeltype = c` (ON DELETE CASCADE) — **PASS**
- Index `ExternalNotificationConfig_accountId_idx` btree leading on `("accountId")` — **PASS**
- RLS: `relrowsecurity = true`; policy `tenant_isolation` present; USING + WITH CHECK byte-identical to `20260527000000`
  (`current_setting('app.account_id', true) = '__system__' OR "accountId" = current_setting('app.account_id', true)`) — **PASS**
- `relforcerowsecurity = false` — parity with `Project` and `ApiKey` (repo-wide pattern; app connects as non-owner role subject to RLS) — **no drift**
- Rows with NULL accountId: **0**; rows where `accountId <> Project.accountId`: **0** (global JOIN check) — **PASS**
- Total `tenant_isolation` policies DB-wide: **51** (matches `rls-tenant-isolation.test.ts` assertion)

## Spec compliance matrix

| #   | Requirement                                             | MERGE-BLOCKING | Status | Evidence                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------- | -------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Structural isolation by construction (3 legs)           | Yes            | PASS   | schema+migration+guard at source; DB catalog; guard membership; auto-scoped reads proven by INT list/delete/test                                                                                                                                                                  |
| 2   | 3 live IDOR routes closed, no decrypted secret crosses  | Yes            | PASS   | INT: foreign list→200 `[]` no `/b`; foreign delete→404 B persists; foreign test-fire→404, B sink ZERO hits, no `/b` in payload                                                                                                                                                    |
| 3   | Create validates parent ownership → 404 (never 403/500) | Yes            | PASS   | use case returns `err(NOT_FOUND)` BEFORE doWork; route maps `NOT_FOUND→404`; INT asserts "404, never 500/403", no row                                                                                                                                                             |
| 4   | Backfill integrity — zero NULL accountId                | No             | PASS   | in-migration RAISE assert; DB NULL count = 0; INT re-asserts                                                                                                                                                                                                                      |
| 5   | No caller regression from guard flip                    | No             | PASS   | independent enumeration: only runtime readers are the 4 auth+tenant-context routes; `ExternalNotificationDispatcher.broadcast` (sole `findActiveByProjectAndEvent` reader) has NO production caller; no seed/script/worker constructs the model; own-tenant CRUD regression green |

## Gate 0/0

- tsc --noEmit: `@core/domain` = 0, `@core/external-notifications` = 0, `@apps/api` = 0
- eslint --max-warnings 0 on all 11 touched files = 0
- Fitness #21 (prisma singleton outside composition roots) = 0
- Fitness #23 (raw queries outside guard exceptions) = 0

## Adversarial findings (reference impl — a flaw propagates ×7)

1. **Guard-list is load-bearing — CONFIRMED enforced.** Removing `externalNotificationConfig`
   from `TENANT_SCOPED_MODELS` WOULD fail the MERGE-BLOCKING test:
   - **List** (layer-1-only, outside UoW): unguarded `findMany({where:{projectId:B}})` returns B's
     row → asserts `length === 0` AND `!payload.includes("/b")` both break.
   - **Test-fire** (layer-1-only, outside UoW): unguarded `findById(Bconfig)` returns B's row →
     decrypts → sends to B's sink and returns 200 → asserts 404 + sink `/b` unchanged + no `/b` in
     payload all break.
   - In the INT environment the client is the DB owner (RLS `forced=false` → RLS INERT), so **Delete
     and Create also depend on layer 1 in the test** and would break too. The credential-bearing
     reads therefore have real, test-enforced protection. Reasoned (not mutated — infra/prisma is
     read-only), airtight from the code + observed passing behavior.
2. **No weakened assertions.** All updated tests inspect real call args (`repo.save` payload,
   `upsert.create`/`upsert.update`), assert concrete `error.code`, zero persistence, and
   `update.accountId === undefined` (D2 never-repoint). `as never` / `as unknown as
ProjectRepositoryPort` / `prisma as never` are canon-allowed partial/narrow-mock fixture
   coercion, not assertion weakening.
3. **Create-404 genuine.** `err(USE_CASE_ERRORS.NOT_FOUND)` returned BEFORE `doWork`, so the
   use-case catch-all cannot flatten it to INTERNAL_ERROR; route maps `code === "NOT_FOUND" ? 404`.
   Both legs asserted by INT; apply's RED (route branch absent → `500 !== 404`) proves the test
   catches a regression.
4. **Secret non-leak re-confirmed.** For a foreign caller no decrypted `webhookUrl` crosses any
   boundary: body (list `[]`, no `/b`), outbound send (test-fire ZERO sink hits), error/log (observed
   error logs carry only the id + "not found", never the URL — matches design secret-boundary audit).
5. **accountId == Project.accountId invariant.** Proven on create (threaded from guard-resolved
   parent `project.accountId.toString()`), on backfill (DB divergent = 0), and the update branch never
   touches accountId. Guard throws `TenantContextMismatchError` on any create with a divergent id.
6. **Migration correctness / no drift.** Migration A (020035) sorts before Migration B (020135);
   applied DB column/FK/index match `schema.prisma` exactly; RLS policy shape identical to
   `20260527000000`; generated client compiles the explicit threading (tsc=0) → client in sync.

## SUGGESTIONS (non-blocking)

- **S1 (design-acknowledged, D4 residual):** the per-slice integration test is the ONLY enforcement of
  `accountId == Project.accountId`; no static/fitness guard would catch a FUTURE write path (bulk
  `createMany` or a `projectId`-repoint route) that persists a divergent row. Backlog candidate:
  a grep fitness ("create/upsert on a projectId-bearing model without a preceding guarded parent
  resolution"). Already on the record in `design.md`.
- **S2:** tasks count cosmetic mismatch (launch prompt "21" vs artifact 20). No functional impact.
- **S3:** minor test-style inconsistency — the api-side Configure test uses `repo as never` while the
  core test uses a structural mock; both valid, the structural form is marginally cleaner.

## Final verdict: **PASS** — ready for `sdd-archive`. 0 CRITICAL, 0 WARNING.
