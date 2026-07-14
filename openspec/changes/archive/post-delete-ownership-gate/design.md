# Design: Post Delete Ownership Gate

## Technical Approach

Close the `DELETE /posts/:id` cross-tenant IDOR (CWE-639) with an ownership gate in `DeletePostUseCase`, reusing the existing `PostRepository.findOwnerAccountId` (port `packages/core/domain/src/repositories/PostRepository.ts:147`, adapter `PrismaPostRepository.ts:430-437`). Unlike the sibling gates, the caller context is REQUIRED via a discriminated union — the compiler forces every caller to declare whether it is a customer (gated) or a system surface (explicit, auditable skip). A future caller cannot accidentally obtain an ungated delete; bypassing requires deliberately writing `{ type: "system" }`, which is greppable and stands out in review.

## Verified Dispatch Graph for `post.delete`

Repo-wide enumeration (`DELETE_POST`, `DeletePostCommand`, `post.delete`, `deletePostUseCase` across `apps/api/src`, `apps/workers/src`, `packages/`) yields exactly two production entry points:

| #   | Entry point                                                                                                                                                                              | Auth context                                                                                                                                                                            | Verdict                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | `postRoutes.ts:578` → `deletePost` handler → direct `deletePostUseCase.execute`                                                                                                          | Customer (`requireClientAuth`)                                                                                                                                                          | THE live hole — gated by this change                           |
| 2   | `PostCommandHandlers.ts:505` (bus). Sole production dispatcher: `CreatePostStep.compensate()` in PostPublishingSaga (`packages/shared/src/saga.ts:535-549`) via `SagaIntegration.ts:264` | System-internal. `postId` comes from the saga's OWN `post.create` result (`saga.ts:493-507`); caller-owned reused drafts are never deleted (`skippedCreation` no-op, `saga.ts:530-533`) | Not attacker-steerable; safe to mark as explicit system caller |

`CQRSIntegration.registerRoutes()` exposes HTTP routes only for create/update/publish, queries, health/metrics, and `/api/cqrs/cache` (the `fastify.delete` at line 571) — no post-delete route and no generic execute-arbitrary-command endpoint. All remaining references are tests.

## Architecture Decisions

### Decision: Required discriminated `caller` context (not optional `callerAccountId?`)

**Choice**: `DeletePostInput.caller: { type: "customer"; accountId: string } | { type: "system"; source: string }` — required.
**Alternatives considered**: (a) Optional `callerAccountId?` mirroring `UpdatePostUseCase.ts:78-83` — rejected: silent skip on omission is the exact smell that produced this hole; a future caller forgetting the field gets an ungated delete with zero compiler pushback. (b) Required plain `callerAccountId: string` with the bus passing a self-resolved owner id — rejected: tautological check, extra query, dishonest about intent.
**Rationale**: Enforcement becomes unambiguous and hard to bypass (product-owner directive: best practice over parity with a weak pattern). Only two production call sites exist, so the required field costs one line each. Sibling migration to this shape is a follow-up for the workstream Slice 6 audit, not this hotfix.

### Decision: Gate placement — after `PostId` validation, before `findById`

**Choice**: For `caller.type === "customer"`, resolve `findOwnerAccountId(postId)` first; `null` or `ownerAccountId.value !== caller.accountId` → return NOT_FOUND. Runs before load, status check, and delete.
**Rationale**: Spec req 3 — a foreign id never reaches the mutation regardless of post status; non-owners cannot even observe the status-based FORBIDDEN branch. TOCTOU negligible (ownership never migrates).

### Decision: NOT_FOUND for both mismatch and nonexistent (anti-enumeration)

**Choice**: `new UseCaseError(\`Post not found: ${input.postId}\`, USE_CASE_ERRORS.NOT_FOUND)`— the exact message + code of the existing`findById`miss branch, so`mapUseCaseError` emits byte-identical 404 bodies. Never FORBIDDEN.

### Decision: Call-site wiring

**Choice**: Route (`postRoutes.ts:358`): if `request.customerUser` is absent → 401 (defensive; `requireClientAuth` makes it unreachable), else pass `caller: { type: "customer", accountId: request.customerUser.accountId }`. Bus handler (`PostCommandHandlers.ts:505`): `caller: { type: "system", source: "PostPublishingSaga:Compensation" }` — honest, auditable, proven system-only above.

### Decision: Blast radius

Slice 0 of `project-scoped-tenant-guard`; app-level gate superseded by the structural Post guard (Slice 8), which closes ownership at the data layer. Not a sensitive path (`packages/core/posts`, `apps/api/src/posts`, `apps/api/src/cqrs`).

## Data Flow

    DELETE /posts/:id ──requireClientAuth──▶ deletePost handler
        │  execute({ postId, caller: { type: "customer", accountId } })
        ▼
    DeletePostUseCase
        1. PostId.fromString ──invalid──▶ VALIDATION_FAILED (400)
        2. caller.type === "customer"?
           findOwnerAccountId ──null or ≠ accountId──▶ NOT_FOUND (404, identical to nonexistent)
        3. findById ──miss──▶ NOT_FOUND (404)
        4. status gate ──▶ FORBIDDEN (owner-only branch)
        5. delete via UoW ──▶ 200 { deleted: true }

    Saga compensation ──bus──▶ execute({ postId, caller: { type: "system", source } }) ──▶ step 2 skipped (explicit)

## File Changes

| File                                                     | Action | Description                                                                 |
| -------------------------------------------------------- | ------ | --------------------------------------------------------------------------- |
| `packages/core/posts/src/DeletePostUseCase.ts`           | Modify | Required `caller` union on `DeletePostInput` + customer ownership pre-check |
| `apps/api/src/posts/postRoutes.ts`                       | Modify | `deletePost` passes customer caller; defensive 401                          |
| `apps/api/src/cqrs/handlers/PostCommandHandlers.ts`      | Modify | One line: explicit system caller                                            |
| `apps/api/tests/unit/application/postUseCases.test.ts`   | Modify | Gate unit tests (mismatch/null/match/system)                                |
| `apps/api/tests/unit/PostCommandHandlers.delete.test.ts` | Modify | Assert explicit system caller forwarded                                     |
| `apps/api/tests/integration/postDeleteOwnership.test.ts` | Create | Two-tenant real-DB HTTP test (node:test)                                    |

## Interfaces / Contracts

```typescript
export type DeletePostCaller =
  | { type: "customer"; accountId: string }
  | { type: "system"; source: string };

export interface DeletePostInput {
  postId: string;
  /** Required auth context (CWE-639 gate). Customer callers are ownership-gated; system callers skip explicitly. */
  caller: DeletePostCaller;
}
```

No port, adapter, DI, or schema changes.

## Testing Strategy

| Layer                            | What to Test                                                                                                                                                 | Approach                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Unit (Vitest)                    | Customer mismatch → NOT_FOUND, `delete` never invoked; owner-null → NOT_FOUND; customer match → deletes; system caller → gate skipped, prior behavior intact | Mock `PostRepository` with `findOwnerAccountId` stub                                |
| Integration (node:test, real DB) | Owner deletes own DRAFT → 200; tenant A vs tenant B's post → 404 deep-equal to nonexistent-id 404; B's post survives                                         | Two seeded accounts/projects/posts, Fastify inject, byte-compare the two 404 bodies |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. In-process authorization pre-check on an existing handler.

## Migration / Rollout

No migration. No schema/config/DI changes; rollback is a single commit revert (both call sites revert with it).

## Residual Risks / Follow-ups

- `saga.ts:493-494` falls back to `createCommand.aggregateId` if `post.create` ever stopped returning the persisted postId; dead code today (handler always returns it), and the path remains system-marked. Flag for workstream Slice 6 audit.
- Migrate the 4 sibling use cases from optional `callerAccountId?` to the required `caller` union (Slice 6 recommendation).

## Open Questions

None.
