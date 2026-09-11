# Exploration: `tenant-rls-cost-repair` — SMELL-93's three repairs

Every `file:line` below was opened and verified on `workstream/tenant-isolation` with the
Slice 1 cluster landed (PRs #230/#232/#233 on `main`). Claims that could not be verified
without a live DB are marked **UNVERIFIED — measure it**.

## 1. Current state

The A′ slice (`20260909000000` → `20260909000500`) gave the trio a local `accountId`, a
composite FK, and a `tenant_isolation` policy. The §After capture found three regressions
with a common root plus one accepted:

| #   | Measured                                       | Root cause                                                                                                    |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | `Q3` ×1.57, `Q4` ×3.7–×4.2                     | policy qual evaluated **per row**, never an `Index Cond`                                                      |
| 2   | `Q3` cannot use the new index                  | `listGlobal` reaches its tenant through the `project` relation                                                |
| 3   | `Q1` ×2.39, `Q5` ×3.52, `Q2` ×1.66, `Q4` ×3.73 | `Post_accountId_projectId_idx` displaces `projectId`-led indexes that supplied ordering / index-only coverage |
| 4   | `Q8`, `Q12` lose index-only paths              | accepted, 1–2 µs                                                                                              |

Governing fact (report `:3777-3803`): 17× `Filter`, 0× `Index Cond`, proven by
`Q1`/`Q2`/`Q5` — each carries `accountId` in the index condition _from the query's own
literal_ while the policy's reference to that same column on that same node stays a per-row
filter. No index can change that; only the expression can. The four-arm A/B
(`:5406-5533`) isolates the expense as the `current_setting()` call: `B′+sys` is
indistinguishable from shipped (3.88–4.22 ms band), `A′+init` is **~2.1–2.4× cheaper** and
semantics-identical.

## 2. Artifact map (verified)

**The policies — the real count is 61, in 10 migrations, and the form is NOT uniform:**

| Where                                                          | Policies                                           | Form                                         |
| -------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------- |
| `20260527000000_add_rls_tenant_isolation/migration.sql:64-141` | 51 via `DO $$ FOREACH` over a hardcoded `TEXT[]`   | 2-arm, `USING` + `WITH CHECK`                |
| same file `:150-160`                                           | 1 — **`AIPromptTemplate` is a documented VARIANT** | **3-arm** `USING` (`OR "accountId" IS NULL`) |
| 8 later single-table migrations                                | 8                                                  | copied verbatim                              |
| `20260909000500_add_rls_post_trio/migration.sql:45-73`         | 3                                                  | copied verbatim                              |

51 − 1 (`PublishingQueue`, dropped by `20260601044455`) + 8 + 3 = **61**, matching fitness
#39's "61 enrolled" (`tasks.md:362`). The copy-forward convention is stated in the trio
migration itself (`:3-5`): _"COPIED from 20260527000000, which is never edited in place."_

**`listGlobal` and siblings:**

- Target: `PrismaPostQueryRepository.ts:432-441`; the predicate is line 437
  `project: { accountId: accountId.value, deletedAt: null }`, consumed by `findMany` `:444`
  (Q3) and `count` `:454` (Q4).
- Port `packages/core/domain/src/repositories/PostRepository.ts:321-325` — **already
  receives `accountId`**, no signature change needed.
- Liveness half is load-bearing and documented at `:434-436` (soft delete does not
  cascade). Only its `accountId` half can move local.
- Same-shape siblings on `Post`: `getById` `:108`, `getByIdWithThread` `:371`,
  `filterIdsByAccount` `PrismaPostRepository.ts:496` (Q6 — its docblock `:481-489` says the
  join _is_ the gate), `findOwnerAccountId` `~:527` (Q7 — the join is the method's
  purpose), `countHardDeleteImpact` `PrismaAccountRepository.ts:447`,
  `PrismaTopPerformersQuery.ts:56`, and three genuinely feed-shaped, unmeasured ones:
  `PrismaRepurposeDetectionAdapter.ts:204`, `zapierRoutes.ts:371`, `makeRoutes.ts:376`.

**The index:** `schema.prisma:750` (docblock `:744-749`), SQL at
`20260909000200/migration.sql:65`. Displaced siblings: `:739` `[projectId, createdAt]`,
`:742` `[projectId, archivedAt]` — both partial on `deletedAt`.

## 3. Judgment (explore judges the code it reads)

**3.1 The shipped policy form — ARREGLABLE; the copy-forward convention is the real
defect.** The disjunction is correct; the per-row `current_setting()` was never a decision.
A convention that says _copy the origin and never edit it_ is what turned one unmeasured
choice into 61. **Improvement beyond the three repairs:** the existing integration gate
(`apps/api/tests/integration/rls-tenant-isolation.test.ts`,
`describe("pg_catalog coverage gate")`) reads
`relrowsecurity`/`relforcerowsecurity`/owner/policy **count** — verified, it never reads
`qual`. Extending it to assert form uniformity makes drift impossible, and it cannot be
green over a mixed catalog.

**3.2 `listGlobal` — BIEN, with one stale docblock.** The liveness comment is the right
kind. But `:417-421` will be wrong after the reshape, and `getById`'s `:99-101` — _"Post
has no direct accountId — ownership is transitive via Project"_ — is **already false**
since `20260909000000`. Live doc defect today.

**3.3 The new index D-S1-1 — MAL HECHO.** `schema.prisma:744-749` justifies it with a
two-part claim the §After capture measured and failed on both halves (`:3883-3922`). The
defect isn't the index — it's that a justification written from reasoning is still sitting
in the schema in the voice of a decision after the measurement contradicted it. It must be
rewritten from the measurement whatever shape lands.

**3.4 The harness — BIEN, materially above the bar, four small holes.**

| Location                                    | What                                                              | Judgment                                                                                                                                                                                                               |
| ------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `:1142` + `:1212`                           | rollback sentinel is a **string compare on `error.message`**      | Cosmetic; 3-line fix to a sentinel class. Do it while the file is open                                                                                                                                                 |
| `:1101-1109` + `:1253`                      | restore proof reads `pg_policies.qual` **only**                   | **Worth fixing.** The arm re-creates with `USING` and **no `WITH CHECK`** (`:1149-1152`), so a committed swap leaves `with_check` NULL and this would not notice. Compare `(qual, with_check, permissive, cmd, roles)` |
| `:915-971`                                  | no `Q4` instability guard                                         | **Do NOT add a failing guard** — a 0.11 % planner tie would turn the harness red for being right. Emit per-run index sets, flag _intra-capture_ divergence as an annotation                                            |
| `:1478-1480`                                | `median` returns `?? -1` on empty                                 | **Worth fixing** — `-1` renders as a plausible `-1.000 ms`. Throw. Also document the even-length upper-middle behaviour (fine at `--runs 3`, wrong at `--runs 4`)                                                      |
| `:1436`                                     | generated preamble says the plan "is reproducible across reseeds" | **MAL HECHO** — a generated artifact asserting what the same artifact disproves (`:3715-3739`). Any re-run regenerates it, but only fixes it if the sentence is narrowed to what `VACUUM` actually buys                |
| residual #5 (`apply-progress.md:4063-4068`) | no scan-node median                                               | **Not optional here** — the A/B's headline numbers _are_ scan-node figures; re-running without a median repeats the false-precision defect                                                                             |

**3.5 Unnamed hole: `sourceSite` line refs go stale silently.** All seven
(`:571,:603,:628,:655,:675,:700,:724`) are accurate today. Mirror fidelity validates the
_query_, not the _reference_, so repair 2 shifts every ref below its edit and nothing
notices.

## 4. The mechanical finding this exploration adds

Edward's index decision is not re-litigated. Its mechanics are not what SMELL-93's row
implies.

```
Q3 after repair 2:  WHERE "accountId" = $1 AND "deletedAt" IS NULL
                      AND EXISTS (project live)
                    ORDER BY "createdAt" DESC LIMIT 20
```

With `(accountId, projectId, createdAt)`, fixing `accountId` leaves rows ordered by
`(projectId, createdAt)`. `createdAt` is **not a prefix of the remaining sort key**, so: no
ordered output (the `LIMIT 20` cannot stop early — the whole tenant slice is read and
sorted); no Incremental Sort (needs a prefix); no B-tree skip scan (PG 18; measured server
is **16.14**, report `:3951`).

**The extension repairs regression 3 and does not, by itself, make `Q3` index-served.**
The index that serves the feed's shape is `(accountId, createdAt)`.

Two consequences that change what "success" looks like:

1. **`Q2`'s loss is not addressed either.** `Q2` lost _index-only coverage of `archivedAt`_
   (`:3901`); `createdAt` does not restore it. The realistic mechanism is indirect — a
   wider index is costlier for a count, possibly pushing the planner back to
   `Post_projectId_archivedAt_idx`. **UNVERIFIED.** Do not write the justification as if it
   fixes `Q2`.
2. **After repair 2, `Post_projectId_createdAt_idx` may be redundant** for application
   reads (`buildWhereClause` always supplies `accountId`, `:196-200`). Not redundant for
   unscoped sweeps (SMELL-92) and it never served the cascade because it is partial
   (SMELL-89's mechanism). Flagged, **out of scope**.

Honest framing for the propose: _repair 3 undoes a self-inflicted displacement; whether the
feed becomes index-served is a separate question the re-run answers, and if it says no,
`(accountId, createdAt)` is the named follow-up candidate._ Writing "the extension fixes
Q3" repeats the D-S1-1 error verbatim.

## 5. Scope adjudication: trio-only vs all 61

|                       | Trio-only                                                                                                                                   | All 61                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Evidence              | A/B measured `Post` only; conclusions transfer to the trio and nowhere else                                                                 | 58 tables change with **zero** plan measurement                                                                                                                              |
| Correctness risk      | Near zero                                                                                                                                   | Low but concentrated: **`AIPromptTemplate`'s third disjunct** (`20260527000000:150-160`). A loop reusing the original `TEXT[]` silently deletes global-template visibility   |
| Enumeration risk      | None                                                                                                                                        | Real — the 61 live in 10 migrations. Enumerate from **`pg_policy` at migration time**, assert rewritten count == found count                                                 |
| Locks                 | 3 brief ACCESS EXCLUSIVE                                                                                                                    | 61 held simultaneously to commit. Acceptable here (§Completion: production _"not performed — there is no deployed environment"_) but it is the shape that would not be later |
| Catalog after         | **Mixed: 3 InitPlan + 58 bare**                                                                                                             | Uniform                                                                                                                                                                      |
| Drift cost            | High — the convention is literally _copy the origin_; two forms means the next author copies a coin-flip                                    | None                                                                                                                                                                         |
| Enables the form gate | No                                                                                                                                          | Yes                                                                                                                                                                          |
| Generalisation        | Left on the table for 58 tables, several unbounded (`SocialMessage`, `Mention`, `MediaAsset`, `Task`) that would feel it harder than `Post` | Collected everywhere                                                                                                                                                         |

**Recommendation: staged within one change — trio first, then the remaining 58 + the
`AIPromptTemplate` variant as its own work unit, then the form gate.** The mixed catalog is
the worst end state and must not be where this stops; the trio is where the evidence is.
Two commits get both. The gate ships last with its red demonstrated (`CLAUDE.md`
§Automated Compliance Checks step 3).

## 6. Sequencing

The interaction is real and asymmetric — `A′+init` measurably flipped S2's index
(0.024 → 0.063, `:5509-5514`).

| Order       | Risk                                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1 → 2+3** | Repair 1's capture is taken with the bad index in place, so `Q1`/`Q2`/`Q5` are already 1.7–3.5× regressed. Readable, because repair 1's capture is a **regression record**, not a decision |
| 2+3 → 1     | The index-shape **decision** is taken under a cost model about to change. If repair 1 re-flips it, the fix is a second migration — the outcome this change exists to avoid                 |

**Recommended: repair 1 (trio policy) → repairs 2+3 together → the 58 → the form gate.**
An index is the durable artifact and must be chosen against the final cost model; the
policy rewrite is semantics-preserving, has a four-arm A/B behind it, and its down
migration is one file. **Repairs 2 and 3 must land in the same measured step** — repair 2
alone gives Q3 an `accountId` predicate against a 2-column index that destroys its
ordering; repair 3 alone leaves Q3 untouched. Two commits inside one PR keeps a red
attributable.

**The de-risking move that changes the shape of the change.** `runPolicyArm`
(`:1136-1215`) already proves DDL-in-transaction + `SET LOCAL ROLE` + forced rollback
works, and `CREATE INDEX` (non-`CONCURRENTLY`) is transactional the same way. So: **extend
`--policy-ab` to run the 13 real `CASES` under each arm** (that _is_ "re-run the 13
cases", with no migration at all — DDL must precede the role switch, which is already the
arm's order `:1148-1154`), and **add an `--index-ab` mode** with arms `{as-shipped,
+createdAt, (accountId, createdAt), dropped}`. **Caveat, stated:** an in-transaction index
is fresh and `VACUUM` cannot run inside one; index-only scans read the _table's_
visibility map (set at `:371-375`) so they should survive — **UNVERIFIED**. Treat as a
shortlist filter, then commit the winner for the authoritative capture.

## 7. Approaches

| #   | Approach                                                                                                                | Pros                                                                                                   | Cons                                                                                 | Effort                    |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------- |
| A   | Three sequential migrations/edits, each with a full committed re-run                                                    | Simple; matches SMELL-93's wording                                                                     | Every candidate shape costs a migration; a rejected shape leaves a revert in history | Medium                    |
| B   | **Harness-first: extend `--policy-ab` to 13 cases, add `--index-ab`, choose from measurement, author only the winners** | The shape decision stops being a guess; closes the scan-node-median and preamble gaps as a side effect | ~1 work unit up front; the in-transaction index caveat needs one validation          | Medium-High               |
| C   | All three in one migration + one capture                                                                                | Fewest captures                                                                                        | A red cannot be attributed; the S2 flip proves the effects interact                  | Low effort, **high risk** |
| D   | All 61 policies first                                                                                                   | Uniform catalog immediately                                                                            | 58 tables unmeasured; `AIPromptTemplate` is the live trap                            | Medium                    |

**Recommendation: B, sequenced per §6.** The strongest fact in the §After capture is that
D-S1-1 was justified from reasoning and measured wrong afterwards. B is the only option
that makes repeating that structurally impossible: the measurement comes before the schema
object exists.

## 8. Open questions, with recommended answers

1. **Wrap `WITH CHECK` too?** — **Yes.** The A/B installed `USING` only (`:1149-1152`). A
   policy whose halves use different forms is the drift this change removes. The write-path
   cost is **unmeasured** — say so.
2. **Trio-only or 61?** — **Both, staged, in this change** (§5).
3. **Order?** — **1 → 2+3 → 58 → gate** (§6).
4. **Is `(accountId, projectId, createdAt)` right?** — Decided; not re-litigated. But
   **state its mechanics** (§4), name `(accountId, createdAt)` as the follow-up candidate,
   keep the DROP fallback.
5. **Drop `project: { accountId }` or keep both?** — **Drop the relation's `accountId`,
   keep `project: { deletedAt: null }`.** The composite FK (`schema.prisma:706`) makes
   disagreement unrepresentable, so keeping both is a redundant join predicate. State the
   FK as the reason, the way `:191-195` already does.
6. **Which siblings come along?** — `listGlobal` **only** in the measured step.
   `getById`/`getByIdWithThread` are point reads the policy already gates — a tidy, not a
   repair. `filterIdsByAccount`/`findOwnerAccountId` are **off-limits** (their docblocks
   say the join _is_ the semantics). The three genuinely feed-shaped ones
   (`PrismaRepurposeDetectionAdapter.ts:204`, `zapierRoutes.ts:371`, `makeRoutes.ts:376`)
   are unmeasured → named follow-up.
7. **How does the 61-table migration enumerate?** — **From `pg_policy` at migration time
   in a `DO $$` block, with a hard assertion that rewritten count == found count**, and
   `AIPromptTemplate` on an explicit branch. Enumerating from files is how the variant gets
   deleted.
8. **Which advisories come in?** — The five touching code this change opens (scan-node
   median, `median()` sentinel, restore-proof tuple, sentinel class, preamble sentence)
   plus the **mandatory** `sourceSite` refresh. Explicitly out: a failing `Q4` stability
   guard.
9. **Acceptance criterion per re-run?** — **Not "no case regresses."** Pre-declare:
   _every case moving outside the ≤6 µs / <1 % band is recorded with an adjudication, and
   no case may return different rows._ The row-equivalence guard (`:1259-1278`) is the
   gate; timing is evidence. The harness's own docblock (`:13-20`) says it is evidence,
   not a gate — keep it that way.
10. **Does the catalog preserve the `(SELECT ...)` wrapper in `pg_policies.qual`?** —
    Expected yes; the `Result → Result` InitPlan nodes in `A′+init`'s S1 plan (`:3997`)
    are consistent. **UNVERIFIED — check before the form gate is written**, since the gate
    compares against PostgreSQL's rendering, not the migration's source bytes (the
    distinction the PR 6 re-gate already corrected once, `apply-progress.md:4088`).

## 9. Risks

1. **The Q3/Q4 mirrors must be updated with the reshape and the fidelity check CANNOT
   catch a stale one.** `scripts/rls-ab-measurement.ts:634-641` and `:660-669` hard-code
   the old `EXISTS (SELECT 1 FROM "Project" …)`. Both texts return the same rows, so the
   identity comparison passes either way — the exact trap documented for Q1/Q2/Q5/Q8
   (`:549-561`). **Highest-risk mechanical item.**
2. **`AIPromptTemplate`'s third disjunct.** A loop-based 61-table rewrite reusing the
   original `TEXT[]` deletes global-template visibility for every tenant. **UNVERIFIED**
   whether any test would catch it.
3. **The mixed-catalog window.** If the change stops after the trio, the copy-forward
   convention is worse than it was.
4. **`WITH CHECK` is unmeasured.** Every number here is a read-path number.
   Semantics-preserving, so a claim-scope risk, not a correctness one — but the artifact
   must not imply a measured write-path win.
5. **Q4 will keep flipping** on a 0.11 % tie (708.06 vs 707.29). No repair removes the
   tie. Read it for its Δ, never for its plan.
6. **Migrations are token-gated** (`.claude/hooks-py/pre_edit.py:27-28`). Repairs 1 and 3
   need `omnipost-allow sensitive-edit`, and the schema edit + its migration must land
   together or `migrate status` drifts.
7. **`scripts/` is outside every fitness scope and every tsconfig project** (SMELL-91).
   Harness changes get hand-checked again — the state that keeps the gap invisible. Not
   this change's to fix, but it must be _named_ in the gate as PR 6 named it
   (`tasks.md:362`).
8. **One corpus shape.** 100 projects × 10 000 posts, exactly 100 posts per project — the
   report flags this as the condition under which `(projectId, createdAt)` beats
   `(accountId, projectId)` (`:3918-3920`). Say so where the decision is recorded.

## 10. Ready for proposal — Yes

Two things the propose must carry forward rather than inherit silently: the index
mechanics in §4, and Approach B in §7.
