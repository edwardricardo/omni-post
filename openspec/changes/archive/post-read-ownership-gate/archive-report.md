# Archive Report — post-read-ownership-gate

> Closure record for the `post-read-ownership-gate` SDD change. Archived 2026-07-17.
> Store: openspec (files) + engram mirror. Branch: `workstream/post-read-ownership-gate`.
> Part of the `project-scoped-tenant-guard` workstream (companion to Slice 0's DELETE gate).

## Outcome

The LIVE cross-tenant **read** IDOR (CWE-639) on `Post` is closed across all four
customer-facing read surfaces. Post has no direct `accountId` column and is NOT in
`TENANT_SCOPED_MODELS` (Slice 8 pending), so neither the Prisma `$extends` guard nor any
pre-existing where-clause scoped these reads — Slice 0 (#112) had gated only `DELETE`, and
the reads stayed wide open. This change gates them with a server-derived `callerAccountId`
(from `request.customerUser.accountId`, never client input) threaded into each read use case
and pushed into the Prisma WHERE via the transitive `project: { accountId }` relation:

- **`GET /posts/:id`** (plain + thread-expanded) → foreign/nonexistent row never matches →
  `EntityNotFoundError` → `NOT_FOUND` (404), never `FORBIDDEN` (anti-enumeration parity).
- **`GET /posts?projectId=<id>`** → a client-supplied foreign `projectId` returns `200 + []`
  (closes guard-naturally), never that account's posts.
- **`GET /posts` (no projectId)** → global unfiltered list scoped to the caller's account
  (**Option A**), closing what was previously a bulk cross-tenant dump of ALL accounts' posts.

Ownership is the stored transitive relation `post.project.accountId == caller.accountId`,
resolved server-side. This is an interim app-level gate; the durable structural fix lands with
Slice 8 (Post enrolled in `TENANT_SCOPED_MODELS` + RLS).

The full SDD cycle ran (proposal → spec → design → tasks → apply → verify → archive), OpenSpec
store, Strict TDD active throughout (RED unit → GREEN → MERGE-BLOCKING integration proof).

### Provenance — extracted from a tangled, DO-NOT-SHIP PR

The change was surgically extracted from PR #97, which bundled this clean read gate together
with superseded tenant-guard work and the §2F provider-classifier (flagged DO-NOT-SHIP). Only
the clean read gate was lifted out and re-planned as its own focused, single-PR change
(~150–250 lines) — the rest of PR #97 was left out of scope deliberately.

### Bonus IDOR caught by the integration test — the HTTP response-cache leak

The MERGE-BLOCKING two-tenant HTTP integration test caught a SECOND, independent read-IDOR
that the query-layer gate alone did not close: `autoCacheMiddleware`
(`apps/api/src/lib/cache/cacheConfig.ts`) response-caches `GET /posts` and `GET /posts/:id` on
the `onRequest` hook — BEFORE `requireClientAuth` binds the principal — and the cache key
omitted any account discriminator. The owner's cached `200` was therefore served to a foreign
caller on a HIT: an auth-bypass-on-HIT that fully defeats the query-layer gate. The direct
adapter calls all passed; only the end-to-end HTTP path leaked, which is exactly why the
real-DB integration proof (not a mocked unit test) was required. Fix: added
`header:authorization` to both post cache configs — the only account-discriminating value
available at `onRequest`, consistent with the existing `/projects`, `/users/me`, `/mfa/status`
pattern. Distinct tokens compute distinct keys, so account B can never HIT account A's entry
(per-token isolation). Integration subtest ordering (B populates the cache first, then A's read
of the same id still returns 404) proves the live regression is closed.

## Design decisions (final)

1. **Scope in the query repository WHERE, not the use case.** `project: { accountId }` added to
   the WHERE of `getById`, `getByIdWithThread`, `listByProject`, `listGlobal` in
   `PrismaPostQueryRepository` — one scoped query, no second round-trip / N+1. (DELETE used a
   separate `findOwnerAccountId` lookup because the command side loads the aggregate anyway;
   reads must not add a lookup query.)
2. **`callerAccountId` is REQUIRED on all four read inputs** — a non-optional `string` on each
   use-case input; the port declares `accountId: AccountId` as a required positional param. A
   missed call site is a tsc error, not a silent skip (fail-closed by construction). Chosen over
   the optional-param (UpdatePostUseCase) and discriminated-union (DeletePostUseCase) patterns
   because the only read callers are `postRoutes` + tests — no system/internal read caller
   exists. If one ever appears, promote to a `ReadCaller` discriminated union then.
3. **Global list `GET /posts` → Option A (scope by accountId) — LOAD-BEARING, SIGNED OFF by
   Edward.** The adversarial design gate corrected the initial premise: `GET /posts` is under
   `requireClientAuth` (which REJECTS admin tokens), and the no-`projectId` path is live-used in
   production by the apps/client dashboard (`dashboard/page.tsx`, `dashboard/posts/page.tsx` via
   `usePosts()` with no `projectId`), which today receives ALL accounts' posts. Those callers
   want "all MY posts across MY projects" (cross-project, within-account), never cross-account.
   Option A (scope by the caller's `accountId`) is therefore not merely safe — it is REQUIRED;
   flipping to admin-only (Option B) would break the client dashboard and serve no one. A genuine
   cross-account admin list, if ever needed, belongs on a new `/admin/posts` route
   (`requireAdminAuth`) — out of scope.
4. **projectId list closes guard-naturally** (`200 + []` for a foreign `projectId`), matching the
   merged `GeneratedImage` precedent; no explicit up-front ownership check, no second query.
5. **No migration / DI / schema change** — params thread over the existing `project` FK.
   Single-revert rollback.

## Capabilities / specs applied

The change's delta spec MERGED into the EXISTING living spec (established by Slice 0's DELETE
gate — this is NOT a new capability):

- `post-tenant-isolation` → `openspec/specs/post-tenant-isolation/spec.md`. The 5 `## ADDED`
  read requirements (4 MERGE-BLOCKING + 1 principal-derivation) were APPENDED to the living
  spec's Requirements section, MERGE-BLOCKING tags preserved; the pre-existing DELETE
  requirements were kept intact (no duplication — the read requirement names
  "Anti-enumeration read parity" / "Read account derived from authenticated principal" are
  distinct from the DELETE ones "Anti-enumeration response parity" / "Account derived from
  authenticated principal"). The living-spec header + scope note were updated to record that
  the capability now covers both mutation (DELETE) and the four read surfaces, and the read
  integration test was added to the verification-method note.

## Verification status

`sdd-verify` ran independently (re-executed runtime evidence, not just read the tasks
checklist). Verdict: **PASS** — CRITICAL 0 · WARNING 0 · SUGGESTION 3.

### Gate evidence (0/0)

| Check                                                                       | Command                                                                                                   | Result                                              |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Unit suite                                                                  | `pnpm --filter @apps/api test`                                                                            | 510 files / **8030 pass / 0 fail**, exit 0          |
| Typecheck                                                                   | `tsc -p apps/api/tsconfig.json --noEmit` (6144MB)                                                         | **0 errors**, exit 0                                |
| Integration (10 consecutive)                                                | `postReadOwnership.test.ts` (node:test, `--conditions development`, real Postgres+Redis @ omnipost-infra) | **10/10 runs, 6/6 subtests each, 0 fail, 0 cancel** |
| Fitness (#3 any, #4 throw, #8 sprint, #9 @file, #10 @layer, #23 raw prisma) | grep suite                                                                                                | **0** across the board                              |

All 5 spec requirements (4 MERGE-BLOCKING) proven by a real two-tenant DB integration test
through HTTP (`apps/api/tests/integration/postReadOwnership.test.ts`), per the spec's own
verification note — a mocked unit test cannot detect a missing ownership filter. The
`callerAccountId`-required contract is tsc-enforced (mocks/stubs updated in lockstep, tsc = 0).

### Apply-phase deviations — both reviewed SOUND

- **DEVIATION A — HTTP cache fix** (`cacheConfig.ts`): the bonus IDOR described above. Verified
  sufficient for per-token isolation; consistent with the existing cache pattern.
- **DEVIATION B — dead CQRS handlers** (`PostQueryGetList.ts`, `PostQuerySearchAnalytics.ts`):
  confirmed genuinely DEAD (`new CQRSIntegration(` occurs nowhere; `createPostQueryHandlers`
  only called inside the never-instantiated `CQRSIntegration`). The signature change broke their
  compile because they call the port methods directly; made fail-closed with
  `AccountId.generate()` (an ephemeral random UUID owning nothing → NOT_FOUND / empty page,
  never leaks) rather than fabricating auth or leaving tsc broken. PR #110 removes these files.

The 3 SUGGESTIONs (cache-HIT served before bearer re-validation, bounded to 5-min TTL and
not cross-tenant; making the cache-leak regression guard order-independent; latent unscoped
port methods) are non-blocking follow-ups, tracked below.

## Follow-ups (tracked, NOT part of this change)

- **`POST /content/sync/:postId` — 5th LIVE post cross-tenant surface.** `SyncEngineImpl` reads
  `prisma.post.findUnique({ where: { id: postId } })` with no account scoping — an existence
  oracle (foreign→200 / nonexistent→500) + a cross-tenant sync ACTION that becomes body
  disclosure once the `detectChanges`/`detectConflicts` stubs are implemented. Needs its own
  focused slice.
- **Systemic account-agnostic HTTP-cache pattern.** The same `autoCacheMiddleware` `onRequest`
  pre-auth caching without an account discriminator likely affects other customer read routes —
  `GET /channels`, `GET /templates`, `GET /analytics/*`. Sweep and add `header:authorization`
  (or an equivalent account key) where a customer response is cached. Out of scope here.
- **Dead CQRS query-bus cleanup.** `CQRSIntegration` + its `PostQueryGetList` /
  `PostQuerySearchAnalytics` handlers are unmounted dead code (removed by PR #110); land that
  removal so the fail-closed `AccountId.generate()` shim is deleted with them.
- **Latent unscoped port methods.** `PostQueryRepository.search` / `getUpcoming` /
  `getRecentlyPublished` remain `projectId`-only. Verified unreachable by any mounted customer
  route today (`search` only via the dead CQRS handler; the other two have no callers). Scope or
  mark internal-only when next touched.
- **Slice 8 — structural Post enrollment (the durable fix).** Enroll `Post` in
  `TENANT_SCOPED_MODELS` + RLS (relation-scoped guard on `project.accountId`, or an `accountId`
  denormalization), which closes ownership enforcement structurally rather than per-use-case and
  supersedes this app-level gate.
- Out of scope (do not fix here): §2F provider-classifier; the rest of PR #97. UPDATE-post authz
  is already gated at `updatePost` — no action.

## Archive actions performed

- Merged the delta spec's 5 ADDED requirements into the existing living spec
  `openspec/specs/post-tenant-isolation/spec.md` (DELETE requirements preserved; MERGE-BLOCKING
  tags preserved; header/scope note updated).
- Copied the change folder to `openspec/changes/archive/post-read-ownership-gate/` (proposal,
  design, tasks, verify-report, delta spec, this archive report). The repo archive convention
  uses no date prefix (matching the sibling `post-delete-ownership-gate/`).
- **Source-folder deletion is deferred to the orchestrator.** This executor has no `mv`/`rm`
  tool, so the original `openspec/changes/post-read-ownership-gate/` still exists and must be
  removed by the orchestrator via `git rm -r openspec/changes/post-read-ownership-gate`.

## Merge reference

- Branch: `workstream/post-read-ownership-gate`
- Date archived: **2026-07-17**
- Companion change: `post-delete-ownership-gate` (Slice 0, PR #112, archived 2026-07-14).

## Traceability — Engram observation IDs

| Artifact                       | Engram topic_key                              | Observation ID          |
| ------------------------------ | --------------------------------------------- | ----------------------- |
| Proposal                       | `sdd/post-read-ownership-gate/proposal`       | #367                    |
| Spec (delta)                   | `sdd/post-read-ownership-gate/spec`           | #368                    |
| Design                         | `sdd/post-read-ownership-gate/design`         | #369                    |
| Tasks                          | `sdd/post-read-ownership-gate/tasks`          | #371                    |
| Apply progress                 | `sdd/post-read-ownership-gate/apply-progress` | #374                    |
| Verify report                  | `sdd/post-read-ownership-gate/verify-report`  | #375                    |
| Archive report (this document) | `sdd/post-read-ownership-gate/archive-report` | (written by this phase) |
