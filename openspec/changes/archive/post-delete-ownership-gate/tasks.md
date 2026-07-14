# Tasks: Post Delete Ownership Gate

## Review Workload Forecast

| Field                   | Value                                                                |
| ----------------------- | -------------------------------------------------------------------- |
| Estimated changed lines | ~230 (3 src ~30, unit ~60, integration ~120, regression updates ~20) |
| 400-line budget risk    | Low                                                                  |
| Chained PRs recommended | No                                                                   |
| Suggested split         | Single PR                                                            |
| Delivery strategy       | single-pr                                                            |
| Chain strategy          | single PR, under budget                                              |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal                                                                         | Likely PR | Focused test command                                                                                                                                                                                       | Runtime harness                                                    | Rollback boundary                                     |
| ---- | ---------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------- |
| 1    | Ownership gate on DELETE /posts/:id (union caller + both call sites + tests) | PR 1      | `node --import tsx --conditions development --test --test-force-exit --env-file=../../.env --env-file=../../.env.test tests/integration/postDeleteOwnership.test.ts` (from `apps/api`, `pnpm db:up` first) | Same command — real two-tenant DB via `createApp()` + `app.inject` | Single commit revert; both call sites revert together |

### Sensitive-edit token

No sensitive-edit token required. Edited files — `packages/core/posts/src/DeletePostUseCase.ts`, `apps/api/src/posts/postRoutes.ts`, `apps/api/src/cqrs/handlers/PostCommandHandlers.ts` — are NOT under `apps/api/src/auth/**`, `admin/auth/**`, `apps/api/src/security/**`, or `infra/prisma/**`.

### Commands (LXC-safe, from `apps/api`)

- Integration: `pnpm db:up` then `node --import tsx --conditions development --test --test-force-exit --env-file=../../.env --env-file=../../.env.test tests/integration/postDeleteOwnership.test.ts`
- Unit (single file): `pnpm --filter @apps/api exec vitest run <path>`
- Prefix `NODE_OPTIONS=--max-old-space-size=6144` if OOM.

## Phase 1: RED — failing cross-tenant integration test (MERGE-BLOCKING)

- [x] 1.1 Create `apps/api/tests/integration/postDeleteOwnership.test.ts` (node:test, real DB). Seed accounts A & B, projects, and a DRAFT post P owned by B. Via `createApp()` + `app.inject` with a `requireClientAuth` bearer: (a) owner (B) deletes own post → success; (b) tenant A deletes B's post id → 404 **deep-equal** to the 404 for a random nonexistent id; (c) assert P still present/unmodified after (a-A) attempt; (d) system path deletes a saga-created post it owns.
- [x] 1.2 Run 1.1 → expect RED (A currently deletes B's post).

## Phase 2: GREEN — the gate

- [x] 2.1 `packages/core/posts/src/DeletePostUseCase.ts`: add `DeletePostCaller = {type:"customer";accountId:string} | {type:"system";source:string}` and make `DeletePostInput.caller` **required**. Discriminate with exhaustive `switch (caller.type)` + `default: never` that throws (fail-closed). For `customer`: resolve `findOwnerAccountId(postId)` BEFORE `findById`/status/`delete`; on null OR mismatch return the existing `NOT_FOUND` (`Post not found: ${postId}`) — never FORBIDDEN. Compare via `AccountId` value-object equality (`ownerAccountId.equals(AccountId.fromString(caller.accountId).value)`), NOT raw case-sensitive `!==`. For `system`: skip the gate.
- [x] 2.2 `apps/api/src/posts/postRoutes.ts` (deletePost handler): pass `caller: { type: "customer", accountId: request.customerUser.accountId }`; if `request.customerUser` absent → 401 (defensive).
- [x] 2.3 `apps/api/src/cqrs/handlers/PostCommandHandlers.ts:505`: pass `caller: { type: "system", source: "PostPublishingSaga:Compensation" }`.
- [x] 2.4 Run 1.1 → expect GREEN (all four cases pass).

## Phase 3: Regression sweep + unit tests (SMELL-53)

- [x] 3.1 Enumerate every affected existing test: `rg -l "DeletePostUseCase|deletePostUseCase|DeletePostCommand|DeletePostInput" apps/api/tests packages`. Update each that constructs the input/command to pass a valid `caller`. Known set: `postUseCases.test.ts`, `UseCases.test.ts`, `PostCommandHandlers.delete.test.ts`, `PostCommandHandlers.test-helpers.ts`, `cqrsIntegration.test-helpers.ts`, `cqrsIntegration.init-commands-queries.test.ts`, `cqrsIntegration.system-errors-cache-shutdown.test.ts`, `CQRSIntegration.test.ts`.
- [x] 3.2 `apps/api/tests/unit/application/postUseCases.test.ts`: gate unit tests — customer mismatch → NOT_FOUND & `delete` never called; owner-null → NOT_FOUND; customer match → deletes; system → gate skipped, prior behavior intact; a test asserting an unknown/omitted variant is denied (type error / exhaustive-switch throws).
- [x] 3.3 `apps/api/tests/unit/PostCommandHandlers.delete.test.ts`: assert the explicit `{type:"system",source:...}` caller is forwarded.
- [x] 3.4 Run the full affected unit set (3.1–3.3 files) → green.

## Phase 4: 0-defect gate

- [x] 4.1 Re-confirm sensitive-edit note above (no token required).
- [x] 4.2 `pnpm --filter @apps/api exec tsc --noEmit` AND `pnpm --filter @core/posts exec tsc --noEmit`; `pnpm --filter @apps/api exec eslint . --max-warnings 0`.
- [x] 4.3 Full affected test set green: DeletePostUseCase unit tests + PostCommandHandlers tests + the new integration test (NOT just one file).
