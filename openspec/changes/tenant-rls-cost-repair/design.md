# Design: tenant-rls-cost-repair

## Technical Approach

Approach B (harness-first), sequence 1 → 2+3 → 58 → gate, as confirmed in `proposal.md`.
Every schema-shaped artifact (policy form, index shape) is chosen FROM a
rollback-transaction A/B run in `scripts/rls-ab-measurement.ts` before its migration is
authored. Row-equivalence is the hard gate; timing is evidence; every out-of-band case
(> 6 µs / ≥ 1 %) gets a recorded adjudication.

## Architecture Decisions

### Decision: `__system__` disjunct form is decided by a `--policy-ab` arm, not by argument (research gap 7)

**Choice**: extend `POLICY_ARMS` to three arms and let the extended 13-case run decide:

| Arm  | `USING` body                                                                                                                        | Status                                                  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `A′` | shipped bare form, `using: null` (live control)                                                                                     | keep                                                    |
| `W`  | `(SELECT current_setting('app.account_id', true)) = '__system__' OR "accountId" = (SELECT current_setting('app.account_id', true))` | keep (is today's `A′+init`, already measured ~2.1–2.4×) |
| `S`  | `(SELECT current_setting('app.account_id', true)) IN ('__system__', "accountId")`                                                   | new — single SubLink                                    |

`B′`/`B′+sys` are retired: the decorrelated-set direction was rejected by the prior A/B
and neither can ship.

**Pre-declared tiebreak**: if `W` and `S` land inside the ≤6 µs / <1 % band on every case,
**`W` wins** — it is the textually minimal delta from the shipped form, the 58-sweep
rewriter stays a pure "wrap each `current_setting` call" transform (identical for standard
and variant policies), and the gate matcher stays one adjacency rule.

**InitPlan sharing**: not assumed either way. `walkPlan` is extended to collect
`Subplan Name`; the decision run records the InitPlan count per arm (`W` may show
`InitPlan 1` + `InitPlan 2`, each once-per-execution — two statement-scoped calls vs
per-row is noise, but the plan must say so, not the design).

**Semantic-equivalence obligations (both forms)**:

1. Row-digest equality across all arms for all 13 CASES and 3 AB_SHAPES (existing
   `runPolicyAb` refusal logic, extended to the cases).
2. NULL-GUC fail-closed and `__system__` bypass: the existing
   `rls-tenant-isolation.test.ts` behavioral suites must be green over the committed
   winner (unset GUC → NULL propagates through `=`/`IN` identically → row suppressed /
   `WITH CHECK` error).
3. For `S` specifically: `x IN ('__system__', "accountId")` ≡
   `x = '__system__' OR x = "accountId"` (text equality is symmetric, so ≡ the shipped
   `"accountId" = x` order); PG may deparse a Var-bearing IN-list as `= ANY (ARRAY[...])`
   — the gate read-back step (below) absorbs whichever rendering the winner has.

### Decision: sweep migration enumerates from `pg_policy`, variant on an explicit branch

**Choice**: `DO $$` loop over
`pg_policy JOIN pg_class JOIN pg_namespace WHERE polname='tenant_isolation'`, excluding
`Post/PostContent/PostMedia` (rewritten by the trio migration) and `AIPromptTemplate`
(explicit branch after the loop). Assert `rewritten = found` AND `found = 57`
(61 − 3 trio − 1 variant); after the explicit variant rewrite, assert
`pg_get_expr(polqual, polrelid)` still matches `IS NULL`.
**Alternatives rejected**: file-derived `TEXT[]` (the mechanism that would delete the
variant's third disjunct); no pinned count (a drifted catalog must stop the migration,
not be silently partially rewritten). Per-policy timing does NOT live in the migration —
evidence lives in the harness runs.

### Decision: form gate matches a normalized adjacency rule, written AFTER a catalog read-back

**Choice**: compliance per rendered expression =
`occurrences("current_setting(") === occurrences("select current_setting(")` after
lowercasing + whitespace collapse; `with_check IS NULL` is COMPLIANT (research lane 5);
expected policy count derived from `getTenantScopedModels().size`, never a literal.
The matcher is finalized only after reading `pg_policies.qual/with_check` back from our
16.14 with the winner installed (research gap 2) — the observed rendering is pasted into
the test as a fixture comment. If the winner is `S` and deparses as `= ANY (ARRAY[...])`,
the rule becomes the observed adjacency instead; read-back decides, bytes never guessed.

### Decision: 58-sweep evidence is form-in-plan + row equality, stated honestly

Most of the 58 tables are empty on the scratch DB, so their timings are meaningless. A
generic sweep-evidence pass (rollback arm per table: bare vs winner, `LIMIT 20` listing +
`count(*)`, digest by PK, EXPLAIN capture) proves the qual becomes a Param/InitPlan
reference in the plan and rows are identical where rows exist; timing claims remain
trio-only. This is the maximum closable portion of research gap 1 (the S2 flip) on a
scratch corpus, and the report says so.

## Target policy SQL (form `W`, the primary candidate)

Standard (60 tables — trio migration writes 3, sweep loop writes 57):

```sql
CREATE POLICY tenant_isolation ON "Post"
  USING (
    (SELECT current_setting('app.account_id', true)) = '__system__'
    OR "accountId" = (SELECT current_setting('app.account_id', true))
  )
  WITH CHECK (
    (SELECT current_setting('app.account_id', true)) = '__system__'
    OR "accountId" = (SELECT current_setting('app.account_id', true))
  );
```

`AIPromptTemplate` variant (USING keeps the third disjunct; WITH CHECK stays strict):

```sql
CREATE POLICY tenant_isolation ON "AIPromptTemplate"
  USING (
    (SELECT current_setting('app.account_id', true)) = '__system__'
    OR "accountId" = (SELECT current_setting('app.account_id', true))
    OR "accountId" IS NULL
  )
  WITH CHECK (
    (SELECT current_setting('app.account_id', true)) = '__system__'
    OR "accountId" = (SELECT current_setting('app.account_id', true))
  );
```

**Semantics-identity argument**: `current_setting('app.account_id', true)` has no row
dependency and the subselect reads no table (research facts 1–4), so per-statement and
per-row evaluation return the same value for every row of one statement; NULL propagation
(unset GUC) is unchanged; both halves are wrapped so USING and WITH CHECK stay one form
(research lane 5: an UPDATE evaluates USING + WITH CHECK + the SELECT policy — the
write-path multiplier argues for wrapping both, with no measured write-path claim).

## Migration Architecture

Three migrations, each `SET LOCAL lock_timeout = '5s'` + `SET LOCAL statement_timeout`
(`'30s'`; `'60s'` for the sweep — 116 DDLs in one `DO` statement) at the top
(Squawk `require-timeout-settings`), each with an operator-run `down.sql` following the
`20260909000500` down pattern (session-level `SET`, scope header).

| Migration                    | Content                                                                                                                                                                                                                                         | down.sql                                                                                | Squawk expectation                                                                                                                                                                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `..._rls_initplan_post_trio` | plain `DROP POLICY` (NOT `IF EXISTS` — a missing policy is state drift and must fail) + `CREATE POLICY` winner form ×3, explicit tables                                                                                                         | re-creates the bare form verbatim (bytes of `20260909000500:45-73`)                     | lints clean; a firing rule is investigated, never waived                                                                                                                                                                                                            |
| `..._post_feed_index_winner` | `DROP INDEX "Post_accountId_projectId_idx"` + winner (`CREATE INDEX ... ON "Post"(...) WHERE "deletedAt" IS NULL`), or DROP-only if the DROP arm wins; schema.prisma `:750` + docblock `:744-749` rewritten from measurement in the SAME commit | restores as-shipped `(accountId, projectId)` partial                                    | `require-concurrent-index-creation` + `require-concurrent-index-deletion` fire → **ADJUDICATION 4** in `audit.yml`, digest-pinned, ADJUDICATION 2/3's rationale (CONCURRENTLY cannot run in Prisma's tx; single deployable; live-path runbook named as remove-when) |
| `..._rls_initplan_sweep`     | `DO $$` enumeration per Decision 2 + explicit variant branch + variant postcondition                                                                                                                                                            | mirror `DO $$` re-creating the bare form + explicit bare variant, same count assertions | lints clean (policy DDL has no rule)                                                                                                                                                                                                                                |

**audit.yml drive-by (required with ADJUDICATION 4)**: the stale-file existence loop at
`.github/workflows/audit.yml:473` checks only `$ALIGNMENT_MIGRATION` and
`$RETENTION_MIGRATION` — `$POST_TRIO_MIGRATION` was never added. Add both
`$POST_TRIO_MIGRATION` and the new index migration to that loop.

## Harness Architecture (`scripts/rls-ab-measurement.ts`)

**`--policy-ab` extension**: `runPolicyArm` additionally runs the 13 `CASES` SQL mirrors
(raw SQL — the Prisma half cannot run inside the owner tx; mirror fidelity is the standing
proof via `capture()`), with per-case digest + EXPLAIN×runs; `runPolicyAb`'s refusal logic
(empty → throw, digest divergence → throw, restore proof) extends over cases.

**New `--index-ab`**: arm transaction shape (owner client):
`SET LOCAL lock_timeout` → arm DDL (`DROP INDEX` / `CREATE INDEX`, plain, never
`CONCURRENTLY`) → `ANALYZE "Post"` (in-tx; `CREATE INDEX` refreshes `relallvisible`) →
`SET LOCAL ROLE omnipost_app` → `set_config('app.account_id', …, true)` → posture assert →
13 CASES (rows + digest + EXPLAIN×runs) → `throw DeliberateRollback`. **No DML inside the
arm**; `vacuumAnalyze()` runs before the transaction (lane 4 preconditions). Arms:
`{as-shipped(control), +createdAt → (accountId, projectId, createdAt), (accountId, createdAt), DROP}`
— all partial `WHERE "deletedAt" IS NULL`. Restore proof: `(indexname, indexdef)` tuples
from `pg_indexes` for `Post`, before == after. **Assert `Heap Fetches: 0`** on every
`Index Only Scan` node — converts lane 4's inference into evidence; a violation aborts the
arm as unrepresentative. `--index-ab` is a shortlist filter; the committed winner gets the
authoritative re-run.

**Advisories (all in PR-1)**:

- **Scan-node median**: `walkPlan` collects `Relation Name`, `Actual Total Time`,
  `Actual Loops`, `Heap Fetches`, `Subplan Name`; per run, scan-time = Σ(time × loops)
  over nodes on the measured table; the quoted statistic is the median of THAT series,
  rendered beside the statement-time median (the statement-vs-node gap caused the
  retracted 4.198 defect).
- `median()` throws on empty input; JSDoc documents the even-length upper-middle choice
  (accurate at `--runs 3`, biased at `--runs 4` — keep runs odd).
- Restore proof reads the 5-tuple `(qual, with_check, permissive, cmd, roles)` from
  `pg_policies` (today: `qual` only).
- `class DeliberateRollback extends Error` replaces the `error.message` string compare.
- Generated preamble sentence narrowed to what `VACUUM` buys: "the visibility map is set,
  so index-only-scan costing reflects a settled heap" — the reproducibility claim is
  deleted.
- Per-run index-set annotation: `CaptureResult` keeps `indexNames` per run (today only the
  last run's survives); intra-capture divergence renders as an annotation line. **No
  failing Q4 guard.**
- `sourceSite` refresh: all seven refs re-verified in the reshape commit.

## `listGlobal` Reshape

`PrismaPostQueryRepository.ts:432-438` becomes:

```ts
const where: Record<string, unknown> = {
  accountId: accountId.value,
  deletedAt: null,
  // Liveness stays relational: soft delete does not cascade, so a soft-deleted
  // project's posts remain `deletedAt: null` themselves. The relation's accountId
  // half is gone — the composite FK (Post.projectId, Post.accountId → Project)
  // makes a Post whose accountId disagrees with its Project's unrepresentable.
  project: { deletedAt: null },
};
```

Same commit (highest mechanical risk — the fidelity check cannot catch stale mirrors):
Q3/Q4 mirror SQL becomes
`WHERE p."accountId" = … AND p."deletedAt" IS NULL AND EXISTS (SELECT 1 FROM "Project" pr WHERE pr.id = p."projectId" AND pr."deletedAt" IS NULL)`,
their Prisma mirrors mirror the new `where`, their `why` lines gain "EMISSION CHANGED with
the reshape", and every `sourceSite` line ref is refreshed. Docblock tidies ride along:
`getById :99-101` ("Post has no direct accountId" — false since `20260909000000`) and
`listGlobal :417-421`.

**Row-equivalence proof**: (1) the existing where-shape evaluator suite
`PrismaPostQueryRepository.test.ts §"listGlobal — project liveness (feed gate)"` (fixtures
already include a foreign-account project and a soft-deleted project) is updated to the
new shape and must keep proving both exclusions; (2) harness fidelity: new mirrors vs live
emission, digest-equal; (3) one-off cross-shape probe recorded in the report: old-shape
and new-shape SQL in one bound transaction, digests compared.

## File Changes

| File                                                                    | Action                                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `scripts/rls-ab-measurement.ts`                                         | Modify — arms, 13-case policy-ab, `--index-ab`, advisories, mirrors |
| `infra/prisma/migrations/…_rls_initplan_post_trio/{migration,down}.sql` | Create                                                              |
| `infra/prisma/migrations/…_post_feed_index_winner/{migration,down}.sql` | Create                                                              |
| `infra/prisma/migrations/…_rls_initplan_sweep/{migration,down}.sql`     | Create                                                              |
| `infra/prisma/schema.prisma`                                            | Modify — `:750` shape + `:744-749` docblock from measurement        |
| `apps/api/src/infrastructure/repositories/PrismaPostQueryRepository.ts` | Modify — reshape + docblocks                                        |
| `apps/api/tests/unit/infrastructure/PrismaPostQueryRepository.test.ts`  | Modify — evaluator shape                                            |
| `apps/api/tests/integration/rls-tenant-isolation.test.ts`               | Modify — form-uniformity `it()`                                     |
| `.github/workflows/audit.yml`                                           | Modify — ADJUDICATION 4 + existence-loop fix                        |
| `docs/reports/TENANT_RLS_AB_MEASUREMENT.md`                             | Modify — generated evidence                                         |

## Testing Strategy

| Layer              | What                                                                                                    | How                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Harness (evidence) | arm equivalence, restore proofs, Heap Fetches, winner verdicts                                          | `--policy-ab` / `--index-ab` on scratch DB, committed re-runs after each migration                                                                                          |
| Unit               | `listGlobal` exclusion contract under new shape                                                         | where-shape evaluator suite                                                                                                                                                 |
| Integration        | form uniformity across all enrolled policies; fail-closed + `__system__` semantics over the winner form | `rls-tenant-isolation.test.ts`, batch `integration:tenant-isolation` (#30 reachability)                                                                                     |
| Red path           | gate fails on a planted bare policy                                                                     | plant bare form on `WebhookEvent` (scratch), observe real non-zero exit naming the table, restore, prove 5-tuple byte-equal to pre-plant, re-green — recorded per repo rule |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or
process-integration boundary. (SQL migrations and a measurement script; no new process
seams.)

## Migration / Rollout

Rollback per proposal: each migration's `down.sql` restores the bare form / as-shipped
index verbatim; reshape is a single-file revert; gate is a test-extension revert.
`omnipost-allow sensitive-edit` per migration/schema invocation; schema edit + its
migration land in one commit (`migrate status` drift guard).

## Work Units (PR slicing per proposal; final decomposition belongs to tasks)

| Unit | PR      | Content                                                                                                                       | Verification                                                                                       | Rollback boundary                                     |
| ---- | ------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| U1   | PR-1    | harness advisories (all six) + arm set `{A′, W, S}`                                                                           | `--policy-ab` run green: guards fire on planted violations, restore proof 5-tuple                  | revert script file                                    |
| U2   | PR-1    | `--policy-ab` 13-case extension + decision run → form verdict recorded                                                        | digest equality across arms; InitPlan count in plan; verdict + adjudications in report             | revert script; no schema touched                      |
| U3   | PR-1    | `--index-ab` 4-arm run → index shortlist verdict                                                                              | `Heap Fetches: 0` asserted; `pg_indexes` restore proof; verdict in report                          | revert script; no schema touched                      |
| U4   | PR-2 c1 | trio policy migration (winner) + down.sql + committed re-run                                                                  | re-run in band ~2.1–2.4×; row-equivalence 13/13; RLS integration suite green                       | `down.sql` restores bare trio                         |
| U5   | PR-2 c2 | reshape + mirrors + `sourceSite` + docblock tidies + index-winner migration + schema edit + ADJUDICATION 4 + committed re-run | fidelity 13/13; Q1/Q2/Q5 displacement repaired or DROP taken; unit evaluator green; squawk green   | `down.sql` restores index; single-file reshape revert |
| U6   | PR-3    | 58-sweep migration + down.sql + sweep evidence                                                                                | count assertions hit (57 + variant `IS NULL` postcondition); form-in-plan + row equality per table | sweep `down.sql`                                      |
| U7   | PR-3    | form-uniformity gate + red demonstrated + SMELL-91 named in the gate comment                                                  | green on uniform catalog; red on planted bare policy, restored byte-exact                          | revert test extension                                 |

Delivery: `auto-chain`, `stacked-to-main`, 400-line budget per PR (`size:exception`
explicit when the forecast demands).

## Open Questions

- [ ] None blocking. The two deliberately unanswered values — winner arm (`W` vs `S`) and
      the exact 16.14 rendered bytes — are measurement outputs by this design's own
      mechanism, with `W` as the pre-declared tiebreak and read-back as the byte source.
