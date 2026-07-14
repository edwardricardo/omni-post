# Proposal: Post Delete Ownership Gate

## Intent

`DELETE /posts/:id` (`apps/api/src/posts/postRoutes.ts:358`) is a LIVE cross-tenant IDOR (CWE-639): it is the only mutating post route that does not pass `callerAccountId` to its use case. `DeletePostUseCase` performs an id-only `findById` + `delete` gated solely by post status, so an authenticated tenant A can soft-delete tenant B's DRAFT/FAILED/CANCELLED post by supplying its id. This change closes that hole now, as Slice 0 of the `project-scoped-tenant-guard` workstream — an app-level hotfix decoupled from the structural guard migration (Slice 8, Tier 4, far out).

## Scope

### In Scope

- `DeletePostInput.callerAccountId?: string` + ownership pre-check in `DeletePostUseCase` (mismatch → NOT_FOUND, anti-enumeration).
- `deletePost` route handler passes `callerAccountId` from `request.customerUser.accountId` (bound by `requireClientAuth`).
- Unit tests for the gate (mismatch, match, omitted → backward compat).
- Two-tenant integration test: foreign delete returns 404 identical to a nonexistent id; owner delete succeeds.

### Out of Scope

- Structural `accountId` denormalization on Post + `TENANT_SCOPED_MODELS`/RLS flip (Slice 8 supersedes this by-convention gate).
- The other 8 projectId-only models (their own slices).
- CQRS `DeletePostCommand` handler (`PostCommandHandlers.ts:505`) — internal surface; the sibling Update fix left it ungated for the same reason.

## Capabilities

### New Capabilities

- `post-tenant-isolation`: caller-account ownership gating on customer-facing post mutation surfaces (delete parity with update/archive/hard-delete/duplicate).

### Modified Capabilities

None.

## Approach

Mirror the exact pattern already in `UpdatePostUseCase` (verified, `packages/core/posts/src/UpdatePostUseCase.ts:78-83`): when `callerAccountId` is provided, resolve owner via `postRepository.findOwnerAccountId(postId)` (port exists at `PostRepository.ts:147`; adapter at `PrismaPostRepository.ts:430`) before loading the aggregate; on null or mismatch return `USE_CASE_ERRORS.NOT_FOUND` — never FORBIDDEN, matching the anti-IDOR canon (no enumeration via 403). Route side mirrors the conditional spread used at `postRoutes.ts:311/389/426/463`. No new mechanism, no repository changes.

## Affected Areas

| Area                                                   | Impact   | Description                          |
| ------------------------------------------------------ | -------- | ------------------------------------ |
| `packages/core/posts/src/DeletePostUseCase.ts`         | Modified | Input DTO + ownership pre-check      |
| `apps/api/src/posts/postRoutes.ts` (`deletePost`)      | Modified | Conditional `callerAccountId` spread |
| `apps/api/tests/unit/application/postUseCases.test.ts` | Modified | Gate unit tests                      |
| `apps/api/tests/integration/` (new file)               | New      | Two-tenant IDOR-closure test         |

## Risks

| Risk                                     | Likelihood | Mitigation                                                                               |
| ---------------------------------------- | ---------- | ---------------------------------------------------------------------------------------- |
| CQRS delete path remains ungated         | Low        | Internal surface (parity with Update fix); covered by workstream Slice 6 audit + Slice 8 |
| 404-shape divergence enables enumeration | Low        | Integration test asserts foreign response === nonexistent response                       |
| Gate check races with delete (TOCTOU)    | Negligible | Post ownership never migrates between accounts                                           |

## Rollback Plan

Single revert of the change commit. The parameter is optional — no schema, config, or DI changes; revert restores prior behavior exactly.

## Dependencies

None. `findOwnerAccountId` already exists on port and adapter.

## Success Criteria

- [ ] Foreign-tenant `DELETE /posts/:id` returns 404 byte-identical in shape to a nonexistent id.
- [ ] Owner delete of DRAFT/FAILED/CANCELLED posts still succeeds.
- [ ] Unit + two-tenant integration tests pass; lint/tsc/fitness gates at 0/0.
