# Archive Report — post-delete-ownership-gate

> Closure record for the `post-delete-ownership-gate` SDD change. Archived 2026-07-14.
> Store: openspec (files) + engram mirror. Branch: `workstream/cluster-c-post-delete-gate`.
> Slice 0 of the `project-scoped-tenant-guard` workstream.

## Outcome

The LIVE cross-tenant IDOR (CWE-639) on `DELETE /posts/:id` is closed. `DeletePostUseCase`
now requires a discriminated `caller` union — `{ type: "customer"; accountId }` or
`{ type: "system"; source }` — instead of the sibling routes' optional `callerAccountId?`.
For customer callers, ownership is resolved via `findOwnerAccountId(postId)` and compared
with `AccountId` value-object equality BEFORE `findById`/status check/delete; mismatch or
missing owner returns the identical `NOT_FOUND` (404) the nonexistent-id path returns —
never `FORBIDDEN` (403), closing the anti-enumeration requirement. Omitting the caller
context is a compile error, not a silently-ungated delete. The saga-compensation bus
handler (the only other production dispatcher) passes an explicit
`{ type: "system", source: "PostPublishingSaga:Compensation" }` context.

The full SDD cycle ran (proposal → spec → design → tasks → apply → verify → archive), Full
mode, Strict TDD active throughout.

### Adversarial design gate

The design phase went through an adversarial gate before apply, which surfaced two material
findings that shaped the final implementation:

1. **CQRS bus dispatch graph.** A repo-wide enumeration of every `post.delete` /
   `DeletePostCommand` / `deletePostUseCase` reference proved there are exactly two
   production entry points: the customer route (`postRoutes.ts`, gated by this change) and
   the saga-compensation bus handler (`PostCommandHandlers.ts:505`), whose `postId` always
   comes from the saga's own `post.create` result — never a caller-supplied id.
   `CQRSIntegration`'s generic command surface is unmounted dead code in production wiring;
   there is no third, attacker-steerable dispatch path. This proof is what allowed the
   bus handler to be marked as an explicit, auditable **system** caller rather than gated
   or left ambiguous.
2. **Spec requirement 5 reconciliation.** The gate forced a rewrite of spec requirement 5
   ("Caller context is explicit and required") to state the discriminated-union contract
   precisely and to document, inline, WHY the bus path is provably system-only — so the
   spec itself carries the dispatch-graph proof, not just the design doc.

The gate PASSED after these findings were folded back into spec + design; apply started
from the reconciled artifacts.

### Course-correction: required union over the sibling's optional pattern

The initial design direction mirrored the sibling `UpdatePostUseCase` pattern exactly — an
**optional** `callerAccountId?: string` that silently skips the gate when omitted. Per
product-owner directive (build the best version, not parity with a known-weaker pattern),
the design was corrected mid-flight to a **required** discriminated `caller` union with an
exhaustive `switch (caller.type)` and a `never`-default throw (fail-closed): a future call
site cannot obtain an ungated delete by forgetting a parameter — omission is a compile
error, and bypass requires deliberately writing `{ type: "system" }`, which is greppable
and stands out in review. This is deliberately NOT parity with Update/Archive/HardDelete/
Duplicate — it exceeds them. Migrating those four siblings to the same shape is the
documented follow-up below.

## Capabilities / specs applied

The change's delta spec (a NEW capability — no prior main spec existed) was copied to the
living specification, header/section normalized to living-spec conventions
(`## ADDED Requirements` → `## Requirements`), body verbatim:

- `post-tenant-isolation` → `openspec/specs/post-tenant-isolation/spec.md` (NEW capability;
  5 requirements, 3 MERGE-BLOCKING).

## Verification status

`sdd-verify` ran independently (re-executed runtime evidence, not just read the tasks
checklist). Verdict: **PASS WITH WARNINGS** — CRITICAL 0 · WARNING 1 (W-1) · SUGGESTION 3
(S-1, S-2, S-3).

- All 5 spec requirements (3 MERGE-BLOCKING) proven by a real two-tenant DB integration
  test through HTTP (`apps/api/tests/integration/postDeleteOwnership.test.ts`), not a
  mocked unit test — per the spec's own verification note, a mock cannot detect a missing
  ownership filter.
- 0/0 gate confirmed independently: `tsc --noEmit` clean on `@core/posts` and `@apps/api`;
  `eslint --max-warnings 0` clean on all 7 touched files; integration 4/4 pass; full unit
  suite 7964/7964 pass, 0 failed, 0 cancelled.
- Adversarial pass found no bypass/cross-path, no weakened assertions, no sibling
  regression.
- Concern B (the `never`-default throw against the domain/application zero-throw canon)
  was resolved **KEEP**: it is an `assertNever`-style exhaustiveness guard, unreachable by
  construction, outside the spirit of the Result-type rule (which targets fallible
  business operations, not bug assertions), with repo precedent, and the louder failure
  mode is the CORRECT one for an unhandled-variant bug — rewriting it to a silent
  `err(NOT_FOUND)` would mask a future programming error as a benign 404.

### W-1 — fixed after verify, before archive

The verify report's WARNING (W-1) flagged that the anti-enumeration parity test
(integration case 3) reused the same foreign post as case 2 (the ownership-mutation case).
Case 2 alone already caught a removed-gate or 403-leak regression (it asserts both
`statusCode===404` and `deletedAt===null` on a post nothing else touches), so no
requirement was left unproven — but case 3, in isolation, would have false-greened under a
hypothetical gate removal (the shared post would already be gone from case 2, so case 3's
404 would mean "deleted", not "not yours").

This was corrected before archiving: `postDeleteOwnership.test.ts` case 3 now seeds its
own untouched foreign post (`antiEnumTargetPostId`, distinct from case 2's
`foreignTargetPostId`) and asserts it survives (`deletedAt === null`) after the 404,
pinning that the 404 came from the ownership gate and not from a prior delete. Re-run
after the fix: **4 pass / 0 fail**; `eslint` clean on the touched file. **W-1 is CLOSED**,
not an outstanding warning at archive time.

S-1 (sibling routes still fail-open), S-2 (undocumented single-file test command), and S-3
(tsc heap flag undocumented) remain open as non-blocking follow-ups; S-1 is tracked below,
S-2/S-3 are tooling-ergonomics notes with no functional risk.

## CI status

PR #112 (`workstream/cluster-c-post-delete-gate`): **32 checks green**. The only 4 red
checks are the pre-existing "Container Security" Docker jobs, which are red on every PR in
this repo today — the containerization workstream is paused (images never build; backend
runs via `tsx`, no emit). Unrelated to this change; not a regression it introduced.

## Follow-up (tracked, not part of this change)

- **Migrate the 4 sibling routes** (Update/Archive/HardDelete/Duplicate — currently the
  optional fail-open `callerAccountId?` pattern in
  `packages/core/posts/src/{Update,Archive,HardDelete,Duplicate}PostUseCase.ts`) to the
  required discriminated `caller` union established here. Tracked for the **Slice-6 audit**
  of the `project-scoped-tenant-guard` rollout (see
  `openspec/changes/project-scoped-tenant-guard/rollout-plan.md`).
- This change is **Slice 0** of `project-scoped-tenant-guard`. It is an app-level,
  by-convention gate; it is **superseded at the data layer by Slice 8** (the structural
  `Post` guard — `accountId` denormalization + `TENANT_SCOPED_MODELS`/RLS), which closes
  ownership enforcement structurally rather than per-use-case.

## Merge reference

- PR: **#112** (`workstream/cluster-c-post-delete-gate`)
- CI: 32/32 required checks green (4 pre-existing unrelated "Container Security" reds)
- Date archived: **2026-07-14**

## Traceability — Engram observation IDs

| Artifact                       | Engram topic_key                                | Observation ID          |
| ------------------------------ | ----------------------------------------------- | ----------------------- |
| Proposal                       | `sdd/post-delete-ownership-gate/proposal`       | #261                    |
| Spec (delta)                   | `sdd/post-delete-ownership-gate/spec`           | #262                    |
| Design                         | `sdd/post-delete-ownership-gate/design`         | #263                    |
| Tasks                          | `sdd/post-delete-ownership-gate/tasks`          | #265                    |
| Verify report                  | `sdd/post-delete-ownership-gate/verify-report`  | #269                    |
| Archive report (this document) | `sdd/post-delete-ownership-gate/archive-report` | (written by this phase) |
