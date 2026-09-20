# Apply progress — post-publish-partial-failure (N-COR-8)

Ledger of every applied work unit, with the evidence each one produced. One section per child
PR of the chain in `tasks.md` §0.1. Strict TDD is ACTIVE for this change: every behavioural task
records its RED before its GREEN, with the command, the exit code and the counts.

Environment for every command below: LXC, 9 GB. `turbo run typecheck` OOMs, so typechecking is
direct (`NODE_OPTIONS=--max-old-space-size=6144 pnpm exec tsc --noEmit`) per affected package, and
test runs are per package rather than monorepo-wide.

---

## PR 1b — WU 1b.A: schema, migration, enrollment, red path

**Branch**: `workstream/ncor8-1b` (child of `workstream/ncor8-1b3`, on the tracker
`feature/post-publish-partial-failure`, stacked on the relocation).
**Start state**: no table, no enum, no enrollment; `getTenantScopedModels()` at 61.
**Finish state**: `PostChannelPublication` exists and is EMPTY, tenant-enrolled in both layers, and
nothing writes it. **Rollback boundary**: revert this range AND apply
`infra/prisma/migrations/20260917093257_add_post_channel_publication/down.sql` AND remove the
`TENANT_SCOPED_MODELS` entry with its two guards-doc sections. Fitness #39 fails closed if any one
of those is left behind — that is the intended behaviour, proven below, not a nuisance.

### Tasks

| Task    | State | What landed                                                                                                                                                                                                                                                                                                              |
| ------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T1b.1   | done  | `apps/api/tests/integration/postChannelPublicationTenantIsolation.test.ts` — one case: the table exists, and the composite `(postId, accountId)` FK refuses a row whose account is not its post's. Registered in `integration:tenant-isolation` EXACTLY once (#30)                                                       |
| T1b.2   | done  | `schema.prisma`: model `PostChannelPublication` (27 scalar columns), 4 enums, 3 back-relations, the unique, 2 plain indexes and the partial sweep index; migration `20260917093257_add_post_channel_publication` with the timeout preamble first, 9 CHECKs, RLS + the InitPlan-wrapped policy, and a verbatim `down.sql` |
| T1b.3   | done  | `"postChannelPublication"` in `TENANT_SCOPED_MODELS` (61 → 62) + the model-list row and a full enrollment section in `docs/security/MULTI_TENANT_GUARDS.md`                                                                                                                                                              |
| T1b.4   | done  | #39 red path: planted unenrolled → real exit 1 naming `PostChannelPublication` → restored sha256-exact → 0. Transcript below                                                                                                                                                                                             |
| (added) | done  | Two Squawk adjudications in `.github/workflows/audit.yml`, digest-pinned, with their own red path. Scope added deliberately — see Deviations                                                                                                                                                                             |

### TDD cycle evidence

| Task  | RED (command · result)                                                                                                                                                                                                                                                                                                          | GREEN (command · result)                                                                              | REFACTOR                                                                                                                                                                                                                                                                                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1b.1 | `node --conditions development --import tsx --test … tests/integration/postChannelPublicationTenantIsolation.test.ts` → **exit 1**, `# fail 1`, `Raw query failed. Code: 42P01. Message: relation "PostChannelPublication" does not exist`                                                                                      | after T1b.2 + `pnpm db:migrate` + `prisma generate`: same command → **exit 0**, `# pass 1 / # fail 0` | The first GREEN attempt FAILED on `23505` (duplicate key) instead of `23503`: the control row was seeded on the same `(post, channel)` pair, and PostgreSQL evaluates unique indexes BEFORE foreign-key triggers, so the suite would have reported the wrong constraint as the tenant guarantee. The mismatched insert now goes first; the control follows on the same pair |
| T1b.3 | `pnpm exec vitest run tests/unit/security/tenantGuard.test.ts` after adding the enrollment block → **exit 1**, `Tests 6 failed \| 83 passed (89)`: membership false, and `accountId` injected on neither read, write nor create — the model was SKIPPED by the guard, which is the failure mode that reads as "no rule applies" | same command after the Set entry and the 61 → 62 count → **exit 0**, `Tests 89 passed (89)`           | —                                                                                                                                                                                                                                                                                                                                                                           |

The enrollment RED is the one worth reading twice: an unenrolled model does not fail loudly, it is
silently skipped, so every query runs cross-tenant while looking exactly like a guarded one. The six
assertions pin membership AND the three injection points AND both refusals, so no single line of the
Set can be deleted without a red.

### The #39 red path (T1b.4) — planted, measured, restored

```
$ sha256sum infra/prisma/src/extensions/tenantGuard.ts
a7d5824f3179f7a6cd980cb6a37de35893553de7940c0c59320c46efb922ee6e

$ bash fitness39.sh                                    # baseline
0
exit=0

# PLANT: the "postChannelPublication" entry removed from TENANT_SCOPED_MODELS
$ bash fitness39.sh
PostChannelPublication: accountId-bearing but neither enrolled in TENANT_SCOPED_MODELS nor named in the documented denylist
::error::fitness #39 measured 1
1
exit=1

# RESTORE
$ sha256sum infra/prisma/src/extensions/tenantGuard.ts
a7d5824f3179f7a6cd980cb6a37de35893553de7940c0c59320c46efb922ee6e   # byte-identical

$ bash fitness39.sh
0
exit=0
```

The exit is REAL (1, not an annotation over a green step), and the message NAMES the model.

### The Squawk adjudications — their own red path

```
$ squawk --config .squawk.toml -- …/migration.sql
warning[prefer-bigint-over-int] x3   ("attempts", "episode", "episodeAttempts")   exit=1
$ squawk --config .squawk.toml -- …/down.sql
warning[ban-drop-table] x1                                                        exit=1

# after ADJUDICATION 6 + 7 (re-enacting audit.yml's lint step verbatim: config drift
# guard, digest pin, and --exclude "${CONFIG_BASELINE_EXCLUDES},${EXC_RULES}")
$ bash squawk-lane.sh
Found 0 issues in 1 file 🎉   OK  …/migration.sql  (adjudicated: prefer-bigint-over-int)
Found 0 issues in 1 file 🎉   OK  …/down.sql       (adjudicated: ban-drop-table)
exit=0

# RED PATH of the waiver itself, on a COPY (the applied migration is never edited):
$ printf '\n-- one byte of drift\n' >> copy/migration.sql && sha256sum copy/migration.sql
::error title=Adjudicated migration changed::pinned to e0de4a0f…, now hashes to bc28dda4…
red-path exit=1
$ squawk --config .squawk.toml -- copy/migration.sql        # unwaived
unwaived squawk exit=1
```

Nothing beyond the named rule is waived on either file: both lint clean under the config once that
one rule is excluded, so the timeout preamble, the FK rules and everything else are still enforced.

### Work unit evidence

| Evidence             | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused test command | `node --conditions development --import tsx --test … tests/integration/postChannelPublicationTenantIsolation.test.ts` → exit 0, 1/1. `pnpm exec vitest run tests/unit/security/tenantGuard.test.ts` → exit 0, 89/89                                                                                                                                                                                                                                                                                                                                                                            |
| Runtime harness      | The whole `integration:tenant-isolation` batch against the real migrated database, at the batch's own `CONCURRENCY=1`: **23 suites, `# pass 247 / # fail 0 / # cancelled 0`, exit 0**. That run includes `rls-tenant-isolation.test.ts`'s `pg_catalog coverage gate`, which enumerates `getTenantScopedModels()` and therefore reads the new table's `relrowsecurity`, policy count and owner BY CONSTRUCTION the moment it is enrolled — no new test was needed for it, and it is green. Plus the full `apps/api` unit tier, `Test Files 577 passed (577) / Tests 8992 passed (8992)`, exit 0 |
| Rollback boundary    | The seven files listed below, plus the migration folder. Reverting them AND applying `down.sql` restores the previous state exactly: the table is new, so the drop takes its constraints, indexes, FKs and policy with it, and the four enum types drop cleanly because nothing else references them. No data migration, no backfill, no writer to unwind                                                                                                                                                                                                                                      |

### Gates — all read 0

| Gate            | Command                                                                                                                          | Result                                                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Migration state | `pnpm db:up` then `pnpm db:migrate` then `prisma migrate status`                                                                 | applied; **84 migrations found, "Database schema is up to date!"**                                                                |
| Schema          | `prisma validate`                                                                                                                | **valid**                                                                                                                         |
| Types           | `tsc --noEmit` in `infra/prisma` (build project), `packages/adapters/db-prisma`, `apps/api`; `pnpm --filter @infra/prisma build` | exit **0** in all four                                                                                                            |
| Lint            | `pnpm exec eslint --max-warnings 0` on the three touched `.ts` files                                                             | exit **0**                                                                                                                        |
| Format          | `pnpm exec prettier --check` on every touched file prettier can parse                                                            | exit **0** (the new suite was normalized with `--write` and re-checked; `.prisma` and `.sh` have no prettier parser in this repo) |
| Fitness suite   | all 39 runnable steps extracted VERBATIM from `.github/workflows/fitness.yml` and executed (#1-#36, #38-#41)                     | **every one exit 0**                                                                                                              |
| Fitness #39     | with its RED PATH proven, above                                                                                                  | **0**                                                                                                                             |
| Fitness #38     | scope guards: the `deletedAt`-bearing set is unchanged, the quarantine floor of 6 is intact, no new name                         | **0 / ratchet unmoved** — the record carries no `deletedAt`, by design                                                            |
| Fitness #40     | Part A seam hits 3 (floor 3), violations 0; Part B sites 10 (floor 10), violations 0                                             | **0 / 0**                                                                                                                         |
| Fitness #30     | unreached suites                                                                                                                 | **20**, against a ratchet baseline of 21 — below it, and the new suite is named by exactly ONE `run_batch` (`grep -c` = 1)        |
| Squawk          | `squawk --config .squawk.toml` on both new `.sql` files, through a verbatim re-enactment of audit.yml's lint step                | exit **0** under ADJUDICATION 6 + 7, whose own red path is proven above                                                           |
| Workflow shape  | `js-yaml` parse of `audit.yml` + `bash -n` on the edited step body                                                               | **both OK**; #34 (every `::error` pairs with a real failure in its step) reads 0                                                  |

**#37 is the one check NOT run**, and it is named rather than quietly skipped: it is
`pull_request`-only, it resolves its base through `git fetch`, and this work unit is forbidden from
running git. Its subject is the four coverage-threshold literals in `apps/api/vitest.config.ts`,
which this unit does not touch, so there is no lowered floor for it to find.

### Files touched

| File                                                                                                     | Action   | What                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `infra/prisma/schema.prisma` **(sensitive path)**                                                        | Modified | model `PostChannelPublication`; enums `ChannelPublicationOutcome`, `ChannelExclusionReason`, `ChannelRetractionBlock`, `ChannelRetractionClearance`; back-relations on `Account`, `Post`, `Channel` |
| `infra/prisma/migrations/20260917093257_add_post_channel_publication/migration.sql` **(sensitive path)** | Created  | generated by `prisma migrate dev --create-only`, then hand-extended: header, timeout preamble FIRST, 9 CHECKs, `ENABLE ROW LEVEL SECURITY` + the InitPlan-wrapped `tenant_isolation` policy         |
| `infra/prisma/migrations/20260917093257_add_post_channel_publication/down.sql` **(sensitive path)**      | Created  | verbatim inverse: drop the table, then the four types (not `IF EXISTS` — a missing type is drift, not idempotence)                                                                                  |
| `infra/prisma/src/extensions/tenantGuard.ts`                                                             | Modified | `"postChannelPublication"` in `TENANT_SCOPED_MODELS`; the count in its doc comment 61 → 62                                                                                                          |
| `docs/security/MULTI_TENANT_GUARDS.md`                                                                   | Modified | heading count 61 → 62, the model-list row, and a full `PostChannelPublication` enrollment section (three legs, the composite FK, the `NO ACTION` asymmetry, enforcement)                            |
| `apps/api/tests/integration/postChannelPublicationTenantIsolation.test.ts`                               | Created  | the skeleton suite (one case + its own raw-SQL fixtures for post, channel and record)                                                                                                               |
| `apps/api/tests/unit/security/tenantGuard.test.ts`                                                       | Modified | `postChannelPublication enrollment` block (6 cases); the model-count assertion 61 → 62                                                                                                              |
| `apps/api/scripts/run-tests.sh`                                                                          | Modified | the new suite appended to `integration:tenant-isolation`, once                                                                                                                                      |
| `.github/workflows/audit.yml`                                                                            | Modified | ADJUDICATION 6 + 7 for the two new `.sql` files, digest-pinned, added to the exception dispatch AND to the stale-path existence loop                                                                |

### Deviations from design

Three, all in the direction of the DESIGN over the TASK FILE, which `tasks.md`'s own preamble makes
authoritative ("`design.md` **rev 3.2** (authoritative on the PR chain)"):

1. **27 scalar columns, not "the 24" T1b.2 names.** The count in the task line does not match the
   column table it points at. Counted from design.md's D3 table: `id`, `postId`, `accountId`,
   `channelId`, `outcome`, `externalId`, `externalIdMissing`, `liveFragments`, `pendingRetraction`,
   `retractionBlockedCause`, `actionWindowStartedAt`, `actionWindowExpiredAt`, `retractionAlertHash`,
   `retractionClearedCause`, `retractionClearedAt`, `contentHash`, `publishedAt`, `reasonCode`,
   `reasonDetail`, `lastFailureCode`, `lastFailureDetail`, `lastAttemptAt`, `attempts`, `episode`,
   `episodeAttempts`, `createdAt`, `updatedAt` = 27. Every one is implemented; none was added.
   (`account` is the relation field, not a column, which is the likeliest source of the drift.)
2. **9 CHECK constraints, not "8".** Same cause: D3 states TWO CHECKs on `pendingRetraction` (the
   shape, and the converse that an excluded channel with fragments is always pending) and the task
   line counts them as one. All 9 are implemented.
3. **Two Squawk adjudications in `audit.yml`, which no task line asks for.** Added deliberately, and
   reported rather than absorbed: `Squawk (Prisma migrations)` is a required lane, it lints every
   CHANGED `.sql` file, and both of this unit's files fire on it — the forward one for three INTEGER
   counter columns, the rollback for the `DROP TABLE` that IS the rollback. Leaving them would hand
   over a PR that cannot merge, which is the "defer it as out of scope" move the canon forbids. The
   sanctioned alternative (fix the SQL) means `bigint`, which the design rejects for these three
   columns and which would push a JavaScript BigInt through the entity, the mapper and every payload
   carrying an attempt count. Both waivers are per-file, per-rule, digest-pinned and carry a trigger
   and a remove-when, exactly like the five that precede them.

Everything else follows D3 and D12 verbatim, including the two choices most likely to read as
mistakes: **`NO ACTION` on the channel FK** where every other `Channel` child cascades (a cascade
would silently shrink a post's recorded target set — and NO ACTION is checked at end of statement, so
an account-wide cascade that removes the posts too still succeeds), and **no `deletedAt`**, which is
what keeps fitness #38's swept set and its quarantine floor untouched.

### Findings (not fixed here — each needs its own decision)

1. **Fitness #30's ratchet baseline has already fallen to 20 and the comment still says 21.**
   Measured on this tree with the new suite registered: 20 unreached suites. The gate's rule is "may
   fall and must never rise", so 20 passes — but the baseline literal in `CLAUDE.md` and
   `fitness.yml` is now one higher than the truth, which is exactly the slack a future unwired suite
   could disappear into. Not this unit's to move (lowering a ratchet is a claim about which suite got
   wired, and that happened earlier in this chain). Backlog row recommended: re-measure and lower the
   baseline to 20 in the change that wired the suite.
2. **`jsonb_array_length` is the only thing standing between a non-array `liveFragments` and the
   three CHECKs that read it.** The column is `jsonb` with a `'[]'` default and the domain writes an
   array, so today it cannot happen — and if it did, `jsonb_array_length` RAISES rather than passing,
   so the write is refused either way (fail-closed). A tenth CHECK, `jsonb_typeof("liveFragments") =
'array'`, would turn that raise into a named refusal and make the other three total. Deliberately
   NOT added: the design names its CHECK list, and adding to it silently is the kind of drift this
   ledger exists to prevent. Worth one line in the design's next revision.
3. **`prefer-bigint-over-int` fires on every new INTEGER column in this repo, not just this one.**
   Measured: `20260717000200_add_mfa_last_used_totp_step` fires it twice and
   `20260901120000_deletion_record_retention…` once (the latter is adjudicated). The repo's
   convention is `Int` counters; the gate's default is `bigint`. Every future migration adding a
   counter will need the same waiver. The cheaper fix is one line in `.squawk.toml`
   (`excluded_rules`), but that turns the rule off for identity/sequence columns too, where it is
   right — so the per-file waiver is the correct trade today and the accumulating cost is worth a
   backlog row rather than a silent habit.

---

## PR 1b3 — the thread contract (D16)

**Branch**: `workstream/ncor8-1b3` (child of the tracker `feature/post-publish-partial-failure`).
**Start state**: `publishThread` returns `Result<ThreadReceipt, PublishError>`; a thread that breaks
part-way reports a bare string code and DISCARDS the ids of the fragments already live on the
provider. **Finish state**: every `publishThread` implementor answers `ThreadPublishFailure`
(`{ code, publishedFragments }`) on EVERY error path, and the worker carries the live set into the
tweet rows, the `ERR` publish log and the `publish.job.failed` notification. No publication record is
written here (that is 1c). **Rollback boundary**: revert this range; nothing outside the thread
failure path changes, no schema, no migration, no data.

### Tasks

| Task   | State | What landed                                                                                                                                                                                                                                                                                                 |
| ------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1b3.1 | done  | `XAdapter.publish.test.ts`: `THREAD_INTERRUPTED` case rewritten to assert two ordered refs; mid-thread non-4xx (`NETWORK`) with the same refs; first-fragment failure with `[]`; the AUTH and circuit-breaker cases re-pinned to the new shape                                                              |
| T1b3.2 | done  | `packages/shared/src/types.ts` `ThreadPublishFailure`; `packages/ports/src/ProviderAdapter.ts` `publishThread?` re-typed                                                                                                                                                                                    |
| T1b3.3 | done  | six implementors + `_template`: X (4 `err` sites, accumulator declaration moved above the credential check), Instagram (3 sites, atomic carousel ⇒ `[]`), Pinterest / Telegram / LinkedIn / Snapchat (1 site each ⇒ `[]`), `_template` (**7** sites, accumulator — counted: 2 guard exits + 5 in the catch) |
| T1b3.4 | done  | the five other provider suites re-pinned to `result.error.code` + a `publishedFragments` assertion; Instagram gained the `publishThread` block it never had                                                                                                                                                 |
| T1b3.5 | done  | `publishHandler.ts` failure path: live fragments marked PUBLISHED FIRST, then the `ERR` log, then `publish.job.failed`, all carrying the set; `publishHandlerTypes.ts` `PublishProvider.publishThread` re-typed; the thrown message is the code again                                                       |
| T1b3.6 | done  | gates below, all 0                                                                                                                                                                                                                                                                                          |

### TDD cycle evidence

| Task   | RED (command · result)                                                                                                                                                                                                                                                                                                                                                                                                                                        | GREEN (command · result)                                                                                                                                                                                              | REFACTOR                                                                                                                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1b3.1 | `cd packages/providers/x && pnpm exec vitest run tests/XAdapter.publish.test.ts` → **exit 1**, `Tests 5 failed \| 11 passed (16)`. Every failure reads `+ undefined - 'THREAD_INTERRUPTED' / 'NETWORK' / 'VALIDATION' / 'AUTH'`: the adapter returns a bare string, so `result.error.code` is `undefined` and the fragment ids are nowhere — the loss the spec names (`post-channel-publication-record` REC-4)                                                | — (GREEN is T1b3.2 + T1b3.3)                                                                                                                                                                                          | —                                                                                                                                                                                                         |
| T1b3.2 | The contract change is its own RED, at the compiler: `tsc --noEmit` in all six provider packages → **exit 2**, `error TS2416: Property 'publishThread' ... is not assignable to the same property in base type 'ProviderAdapter'` in `XAdapter.ts(301,9)`, `InstagramAdapter.ts(447,9)`, `PinterestAdapter.ts(217,9)`, `TelegramAdapter.ts(225,9)`, `LinkedInAdapter.ts(216,9)`, `SnapchatAdapter.ts(222,9)` — six of six, which is the point (design.md:216) | `tsc --noEmit` in `packages/shared` and `packages/ports` → **exit 0**                                                                                                                                                 | —                                                                                                                                                                                                         |
| T1b3.3 | (the six compile errors above)                                                                                                                                                                                                                                                                                                                                                                                                                                | `tsc --noEmit` × 6 provider packages → **exit 0 each**; `cd packages/providers/x && pnpm exec vitest run tests/XAdapter.publish.test.ts` → **exit 0**, `Tests 16 passed (16)`                                         | X: the `publishedTweets` declaration moved above the credential check so the AUTH exit answers with the same accumulator instead of a literal — no error path can drift from the others                   |
| T1b3.4 | `pnpm exec vitest run tests/*Adapter.test.ts` in telegram / pinterest / linkedin / snapchat → **1 failed each**: `publishThread returns THREAD_INTERRUPTED error` (telegram) and `publishThread returns VALIDATION error` (the other three), each asserting the retired string shape                                                                                                                                                                          | same command after the rewrite → telegram `73 passed`, pinterest `49 passed`, linkedin `96 passed`, snapchat `111 passed`; instagram `tests/index.test.ts` `24 passed` (22 before: the two new `publishThread` cases) | —                                                                                                                                                                                                         |
| T1b3.5 | `cd apps/workers && pnpm exec vitest run tests/publishThreadPost.test.ts` → **exit 1**, `Tests 5 failed \| 14 passed (19)`: no tweet row is updated for a live fragment, the saga payload carries no `publishedFragments`, the `ERR` log carries none, and the thrown message is `[object Object]`                                                                                                                                                            | same command → **exit 0**, `Tests 19 passed (19)`; whole package `pnpm exec vitest run` → `Test Files 17 passed (17)`, `Tests 130 passed (130)`                                                                       | the success loop was extracted to `markFragmentsPublished(threadId, fragments)` and both outcomes now call it — the failure path reuses the loop instead of copying it (D16: "the same loop as :627-651") |

The interrupted-thread red is one of the three the tasks call "dangerous" (§10.1): it asserts the
PERSISTED effect, not the returned value — which tweet rows were written, with which provider ids,
and in which order relative to the saga notification.

### Work unit evidence

| Evidence             | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Focused test command | `cd apps/workers && NODE_OPTIONS=--max-old-space-size=6144 pnpm exec vitest run tests/publishThreadPost.test.ts` → exit 0, 20/20 (19 before the gate corrections; whole package 131/131). Per-provider: `cd packages/providers/<p> && NODE_OPTIONS=--max-old-space-size=6144 pnpm exec vitest run` → x 72/72, instagram 127/127, pinterest 49 passed + 11 todo, telegram 73 passed + 11 todo, linkedin 96 passed + 12 todo, snapchat 111 passed + 9 todo                                                                                                                                                                                                                                                                             |
| Runtime harness      | **N/A for this slice, deliberately.** 1b3 crosses no runtime boundary: no schema, no queue payload contract, no HTTP route. The one process seam it touches — the `publish.job.failed` message on the Redis `saga:events` channel — was verified by INSPECTION of its only consumer instead: `SagaIntegration.handleSagaEventMessage` (`apps/api/src/saga/SagaIntegration.ts:842-866`) `JSON.parse`s the message, reads `type`, and forwards the whole object; `SagaManagerLifecycle.handleEvent` (`:1020-1036`) filters on `type` and `metadata.sagaId`. Neither validates `data` against a closed schema, so the added key is additive. The integration proof belongs to 1c, where the record write makes it observable end to end |
| Rollback boundary    | The eleven source files and eight test files listed below. Reverting them restores the string-coded contract with no residue: nothing persisted changes shape, no migration, no queue payload is required by a consumer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

### Gates — all read 0

| Gate                    | Command                                                                                                                                                                                                        | Result                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Types                   | `tsc --noEmit` in `packages/shared`, `packages/ports`, the six touched provider packages, the six untouched ones (`bluesky`, `facebook`, `threads`, `tiktok`, `youtube`, `shared`), `apps/workers`, `apps/api` | exit **0** in all 17                                                                                                               |
| Lint                    | `pnpm exec eslint --max-warnings 0 <the 19 touched files>`                                                                                                                                                     | exit **0**                                                                                                                         |
| Format                  | `pnpm exec prettier --check <the 19 touched files>`                                                                                                                                                            | exit **0** (one file, `apps/workers/tests/publishThreadPost.test.ts`, was written then normalized with `--write` and re-run green) |
| Fitness #32             | no `.only` / `.skip` in committed tests                                                                                                                                                                        | **0**                                                                                                                              |
| Fitness #9              | files missing `@file`                                                                                                                                                                                          | **0**                                                                                                                              |
| Fitness #10             | invalid `@layer` values                                                                                                                                                                                        | **0**                                                                                                                              |
| Fitness #8              | sprint / phase references in comments                                                                                                                                                                          | **0**                                                                                                                              |
| Fitness #2 / #3 / #5    | core framework-free · no `any` · no `@ts-ignore`                                                                                                                                                               | **0 / 0 / 0**                                                                                                                      |
| Fitness #11 / #15 / #19 | raw `setInterval` · insecure secret fallbacks · `process.env` in provider adapters                                                                                                                             | **0 / 0 / 0**                                                                                                                      |

`_template`'s residual compiler error is NOT counted here; it is reported under Findings below
because no gate in this repo can see it.

### Files touched

| File                                                          | Action   | What                                                                                                                                                       |
| ------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/types.ts`                                | Modified | `ThreadPublishFailure = { code: PublishError; publishedFragments: ThreadReceipt["tweets"] }`                                                               |
| `packages/ports/src/ProviderAdapter.ts`                       | Modified | `publishThread?` returns `Result<ThreadReceipt, ThreadPublishFailure>`; the obligation stated in the port's own doc                                        |
| `packages/providers/x/src/XAdapter.ts`                        | Modified | accumulator declared above the credential check; 4 `err` sites carry it                                                                                    |
| `packages/providers/instagram/src/InstagramAdapter.ts`        | Modified | 3 `err` sites carry `[]`; the carousel's atomicity is stated in the method doc                                                                             |
| `packages/providers/pinterest/src/PinterestAdapter.ts`        | Modified | stub `err` site carries `[]`                                                                                                                               |
| `packages/providers/telegram/src/TelegramAdapter.ts`          | Modified | stub `err` site carries `[]`                                                                                                                               |
| `packages/providers/linkedin/src/LinkedInAdapter.ts`          | Modified | stub `err` site carries `[]`                                                                                                                               |
| `packages/providers/snapchat/src/SnapchatAdapter.ts`          | Modified | stub `err` site carries `[]`                                                                                                                               |
| `packages/providers/_template/src/index.ts`                   | Modified | accumulator declared first; all 7 `err` sites carry it — the scaffold teaches the contract                                                                 |
| `apps/workers/src/publishHandler.ts`                          | Modified | `markFragmentsPublished` extracted; failure path marks the live rows, then logs `ERR`, then notifies the saga, all carrying the set; throws the code again |
| `apps/workers/src/publishHandlerTypes.ts`                     | Modified | `PublishProvider.publishThread` re-typed to the contract                                                                                                   |
| `packages/providers/x/tests/XAdapter.publish.test.ts`         | Modified | 3 rewritten + 2 new thread-failure cases; `failingAtCall` / `fragmentRefs` helpers                                                                         |
| `packages/providers/telegram/tests/TelegramAdapter.test.ts`   | Modified | `publishThread` case re-pinned to code + empty fragment set                                                                                                |
| `packages/providers/pinterest/tests/PinterestAdapter.test.ts` | Modified | same                                                                                                                                                       |
| `packages/providers/linkedin/tests/LinkedInAdapter.test.ts`   | Modified | same                                                                                                                                                       |
| `packages/providers/snapchat/tests/SnapchatAdapter.test.ts`   | Modified | same                                                                                                                                                       |
| `packages/providers/instagram/tests/index.test.ts`            | Modified | new `publishThread` block: AUTH with `[]`, and a rejected carousel slide proving nothing was published                                                     |
| `apps/workers/tests/publishThreadPost.test.ts`                | Modified | new `when the thread is interrupted mid-way` block (5 cases: rows, ordering, notification, log, nothing-live); two existing failure cases re-pinned        |
| `apps/workers/tests/setup.ts`                                 | Modified | the mock provider's `publishThread` typed to the contract                                                                                                  |

### Carried window (what 1b3 leaves open until 1c)

Between 1b3 and 1c the `Tweet` rows of a failed thread read as `PUBLISHED` while nothing in the tree
names that channel excluded — the rows are the only durable trace 1b3 can write, and the state that
qualifies them is the `PostChannelPublication` record 1c introduces (design D16 / D6). Until then the
live fragments are addressable (which is the point of this slice) but their channel's outcome is
readable only from the `ERR` publish log and the saga notification.

### Corrections applied after the 1b3 gate (PASS WITH WARNINGS, on the same branch)

| Id  | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Evidence                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1  | The failure path awaited `markFragmentsPublished` before everything else, and that method RETHROWS on a repository error — so a DB blip replaced the publish code with the DB error and the saga was never told. The call is now wrapped: on error it logs (`postId`, `channelId`, `threadId`, `code`, `liveFragmentCount`, `err`), counts `recordError("publisher", "thread_live_fragments_unrecorded", true)`, and CONTINUES to the ERR log, the metrics, the notification and the rethrow of the publish code. The design order (rows first, then report) is unchanged; the success path keeps its rethrow | RED first: new case `should still report the publish failure when a tweet row cannot be written` → **exit 1**, `Tests 1 failed \| 19 passed (20)`, `AssertionError: the publish code survives a failure to write the row · + 'DB_UNAVAILABLE' - 'THREAD_INTERRUPTED'`. GREEN: **20/20** |
| S2  | `getTweetsByThread(threadId)` hoisted above the loop in `markFragmentsPublished` — one read per call instead of one per fragment. Behaviour held identical on purpose: an empty fragment list still reads nothing (early return), a `!ok` read still leaves every fragment untouched, a throwing read still counts `tweet_update_failed` and rethrows, and the per-fragment `update_tweet` timer is unchanged                                                                                                                                                                                                 | existing cases stay green: `20/20` in the file, `131/131` in the package                                                                                                                                                                                                                |
| S3  | `ThreadPublishFailure`'s two fields are `readonly` — the live set is a report, not a workspace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `tsc --noEmit` **0** in `packages/shared`, `packages/ports`, the six provider packages, `apps/workers`, `apps/api`; `packages/shared` dist rebuilt so the providers resolving it through `exports` see the same shape                                                                   |
| S1  | ledger correction: `_template` has **7** `err` sites in `publishThread`, not 6 (2 guard exits + 5 in the catch; counted, not estimated)                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | the two tables above                                                                                                                                                                                                                                                                    |
| W2  | ledger addition: the "Carried window" section above                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | —                                                                                                                                                                                                                                                                                       |

### Deviations from design

None. D16's two prescriptions are followed verbatim — the type as written at `design.md:343`, and the
worker order "tweet rows FIRST, then report" (`design.md:218`). The two pieces D16 assigns to 1c are
absent as required: no `RecordChannelPublicationAttemptUseCase` call, and the `logPublish ERR` stays
(its deletion is D10, in 1c).

One judgement call worth naming: X and `_template` answer their credential/capability exits with the
same `publishedFragments` accumulator rather than a literal `[]`, which is why the declaration moves
to the top of the method (T1b3.3 asks for exactly this). The uniformity is the safeguard — no error
path can be written that forgets to consult what actually went out. The five adapters that CANNOT
publish partially state a literal `[]`, with the reason in the method doc: for them the empty set is
a property of the provider, not of the accumulator.

### Findings (not fixed here — each needs its own decision)

1. **`packages/providers/_template` is compiled by nothing.** It has no `tsconfig.json`, no
   `typecheck` script, and is in no project reference, so the template new providers are copied FROM
   is never typechecked. An ad-hoc check
   (`tsc --ignoreConfig --strict --module nodenext --moduleResolution nodenext --customConditions development src/index.ts`)
   compiles the `publishThread` change cleanly and surfaces ONE pre-existing error:
   `src/index.ts(345,29): error TS2554: Expected 2 arguments, but got 1` — `fetchProviderAnalytics`
   calls `fetchAnalytics?.({...})` while the port has required `(query, credentials)` since
   credentials became per-call. Untouched by this slice (it is in `fetchAnalytics`, not
   `publishThread`) and invisible to every gate. Fixing it means reshaping the template's analytics
   credential handling, which is a change of its own. Backlog row recommended: give `_template` a
   tsconfig + `typecheck` script, then fix what that surfaces.
2. **Instagram classifies a rejected carousel slide as `NETWORK`.** `InstagramAdapter.publishThread`
   throws `AppError.badRequest` for a slide with no media URL; `AppError` carries `statusCode`, while
   `mapErrorToPublishError` (`packages/providers/shared/src/helpers.ts`) reads `status`, so it falls
   through to `NETWORK`. Measured with a throwaway probe: `"status" in AppError.badRequest("x")` is
   `false` and the mapping returns `NETWORK`. A permanent content defect therefore presents as a
   transient failure, and 1c's classifier (`design.md:156`) maps `NETWORK` to transient — it would be
   RETRIED, budget after budget, for a post that can never succeed. Out of 1b3's scope (this slice
   changes the failure SHAPE, not its classification) and named here because 1c is where it starts to
   cost something. The new Instagram test deliberately does not assert that code — pinning it would
   ratify the defect.
3. **A second, parallel `ProviderAdapter` lives in `apps/api/src/providers/providerAdapter.interface.ts:256`**
   with its own `publishThread?(...): Promise<Result<ThreadReceipt, PublishError>>`. Nothing
   implements it with a real adapter, so it did not break and was left alone, but it is a duplicate
   port declaration that will drift from `@ports/core` — N-COR-10 will consume the seam through the
   real port and could easily be written against this one.
4. **`@providers/telegram` reports one SKIPPED test FILE on every run** (`Test Files 4 passed | 1
skipped (5)`): `packages/providers/telegram/tests/integration/apiClient.integration.test.ts`,
   whose cases are `.todo` behind a runtime gate. Pre-existing, untouched by this slice, and the same
   class fitness **#30** exists for (`a suite no runner names never executes` — there the ratchet is
   `apps/api`'s 21 unreached suites). It reads as coverage in the tree and in review while running
   nothing. Backlog line recommended: decide whether that suite gets a tier and a service, or goes.

### RDD receipt — the committed range tracker → 1b3 (2026-09-20)

Lineage `review-7c43029e81e41c35`, selected in the docs worktree with `--base-ref c4fa81c1
--committed-only` (candidate `539bf8ad`): 21 paths / 836 lines, tier **medium**, correction
budget 200, one `review-reliability` slot. Consent/v3 answered `granted` under Edward's standing
rule. Terminal state **`approved`**; the exact `acknowledge-approved` returned
`gentle-ai.review-acknowledged/v1` with `authority: burned`. No correction was opened. With this
receipt every child of the chain (1b3, 1b, 1b2) carries a burned committed-range review.

**Advisory findings — 3, informational.** `R3-silent-skip-on-repo-not-ok` (WARNING,
`apps/workers/src/publishHandler.ts:459-466`: a repository `!ok` result is skipped without a
report), `R3-partial-loop-throw-untested` (SUGGESTION, `:478-489`) and `R3-timer-success-on-no-op`
(SUGGESTION, `:468-489`). The WARNING is the swallowed-failure class; 1c's D16 rework (the recorder
returns a `Result` and runs outside the catch) touches exactly this region, so its fix belongs with
T1c.14 rather than a separate follow-up — to be confirmed in the tasks amendment.

---

## PR 1b — WU 1b.B / 1b.C / 1b.D / 1b.E: the domain, the events, the narrow save

**Branch**: `workstream/ncor8-1b` (the same branch WU 1b.A landed on).
**Start state**: the table exists and is EMPTY, tenant-enrolled, with no writer and no
domain vocabulary for it. **Finish state**: the domain can compute every predicate and
every word from the record; the two channel events and the two alert events exist; the
port and the relocated adapter can write a publication; still nothing writes one.
**Rollback boundary**: the twenty source files and nine test files listed below. Reverting
them removes the whole publication vocabulary at once — the table, the migration and the
enrollment (WU 1b.A) stay, and the tree is exactly the state 1b.A left: a table nothing
knows how to write.

**Commit order inside this range is NOT the task order.** WU 1b.D must be committed
BEFORE WU 1b.C: the root emits the four internal event classes, so a 1b.C commit ahead of
them would not compile. D is additive and self-contained (four new event classes, no
behaviour change to the existing ones), so ordering it first costs nothing.

### Tasks

| Task   | WU   | State | What landed                                                                                                                                                                                                                                 |
| ------ | ---- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1b.5  | 1b.B | done  | `channelPublication.test.ts` (34 cases): the full entity table — budget, the transient / nontransient / unclassifiable split, Q11 all-or-nothing, the pending-retraction exits, the bounded window, `alertTransition` over all four clauses |
| T1b.6  | 1b.B | done  | the five value objects + `ChannelPublication`; `PublishStatus` gains `PARTIALLY_PUBLISHED`, its two edges and `isPublicationFamily()`; barrels                                                                                              |
| T1b.7  | 1b.B | done  | `channelPublications.derive.test.ts` (13 cases, incl. all 39 combinations over 1–3 channels and all 6 permutations of one multiset) then `ChannelPublications`                                                                              |
| T1b.8  | 1b.C | done  | `postAggregate.publications.test.ts` (32 cases): the S2 five fixtures, the lock from the live-content predicate, `ContentLockedError` distinct from the lifecycle refusal, W7, the C2 edges, Q10, the content-write door enumeration        |
| T1b.9  | 1b.C | done  | `PostAggregate` gains the publication facet + `assertPublicationProjection()` + the record-read `isEditable`; `markAsPublished`/`markAsFailed` reshaped; `ContentLockedError` added                                                         |
| T1b.10 | 1b.D | done  | `PostEvents.ts`: `PostChannelPublished`, `PostChannelExcluded` **and the two alert events**; `postEvents.publication.test.ts` (8 cases) pins the v1 key sets byte for byte                                                                  |
| T1b.11 | 1b.E | done  | `PrismaPostRepository.test.ts` +7 cases: the narrow save's exact `data` key set, the per-record upsert, the outbox, the edit tripwire on both doors, the CAS conflict, the projection refusal                                               |
| T1b.12 | 1b.E | done  | `PostRepository.savePublication`; `PostPublicationWrites.ts` (new); the mapper reads records back with the joined provider; `findById` includes them                                                                                        |
| T1b.13 | 1b.E | done  | `savePublication` added to the eight `PostRepository` doubles across the core and api unit tiers                                                                                                                                            |
| T1b.14 | all  | done  | gates below, all 0                                                                                                                                                                                                                          |

### TDD cycle evidence

| Task            | RED (command · result)                                                                                                                                                                                                                                                       | GREEN (command · result)                          | TRIANGULATE                                                                                                                                                 | REFACTOR                                                                                                                                                                                                                                                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1b.6 (VOs)     | `pnpm exec vitest run tests/unit/publicationValueObjects.test.ts` → **exit 1**, `Cannot find package '@core/domain/value-objects/FragmentReference.js'` — the five modules do not exist                                                                                      | same command → **exit 0**, `Tests 26 passed (26)` | 26 cases over 5 objects; each object has a rejecting case and an accepting one                                                                              | One RED was the TEST's fault, not the code's: the bounded-detail case fed 620 identical characters, which the credential redaction ate BEFORE the bound was reached (`10 !== 500`). The assertion was wrong about which rule it proved, so the fixture became short words and a second case now pins redaction PAST the bound. The production rule was not weakened |
| T1b.5 (entity)  | `pnpm exec vitest run tests/unit/channelPublication.test.ts` → **exit 1**, `Cannot find package '@core/domain/entities/ChannelPublication.js'`                                                                                                                               | same command → **exit 0**, `Tests 34 passed (34)` | the budget is exercised at 1, 2 and 3 attempts; the interruption at 1 and 2 live fragments; `alertTransition` across all four clauses plus clause 1's veto  | —                                                                                                                                                                                                                                                                                                                                                                   |
| T1b.7 (derive)  | `pnpm exec vitest run tests/unit/channelPublications.derive.test.ts` → **exit 1**, `Cannot find package '@core/domain/aggregates/ChannelPublications.js'`                                                                                                                    | same command → **exit 0**, `Tests 13 passed (13)` | totality asserted over **39** generated combinations (3 + 9 + 27) and order-independence over all **6** permutations of `{published, excluded, unresolved}` | `record.outcomeKind === "unresolved"` replaced by the exported constant; suite still 13/13                                                                                                                                                                                                                                                                          |
| T1b.10 (events) | `pnpm exec vitest run tests/unit/postEvents.publication.test.ts` → **exit 1**, `Tests 6 failed \| 2 passed (8)`. The 2 that PASSED are the point: they are the v1 regression pins on `PostPublished` / `PostPublishingFailed`, green before and after                        | same command → **exit 0**, `Tests 8 passed (8)`   | the published payload is asserted with and without an external id; the raised alert with and without a superseded key                                       | —                                                                                                                                                                                                                                                                                                                                                                   |
| T1b.8 (root)    | `pnpm exec vitest run tests/unit/postAggregate.publications.test.ts` → **exit 1**, `Cannot find package '@core/domain/errors/ContentLockedError.js'`                                                                                                                         | same command → **exit 0**, `Tests 32 passed (32)` | the lock is proven on all three content doors and on both lifecycle exits; the word is driven to all four family values                                     | The 1461-line root was split (below). The split broke 11 cases at once and the suite caught it                                                                                                                                                                                                                                                                      |
| T1b.11 (save)   | `cd apps/api && pnpm exec vitest run tests/unit/infrastructure/PrismaPostRepository.test.ts` → **exit 1**, `Tests 7 failed \| 50 passed (57)`, every failure `TypeError: repo.savePublication is not a function`. The 50 passing are the adapter's existing contract, intact | same command → **exit 0**, `Tests 57 passed (57)` | the tripwire is proven through the content door AND the media door; the narrow save is proven by an EXACT key-set assertion, not by an absence              | —                                                                                                                                                                                                                                                                                                                                                                   |

### The seam — why `PostAggregate.ts` was split, and what it measured

T1b.9 forecast the root at ~714 lines and named the seam to apply "if it crosses":
`aggregates/post/PostPublicationMethods.ts`. It crossed, and not narrowly — **measured
1461** with the facet inline, against a 619-line file before the change and a band of
400–600 (≤800 only when strictly necessary). The seam was therefore applied, and then
applied once more inside the companion, because an 874-line companion is the same defect
one directory down:

| File                                        | Before |   After | Holds                                                    |
| ------------------------------------------- | -----: | ------: | -------------------------------------------------------- |
| `aggregates/PostAggregate.ts`               |    619 | **902** | the public entry points and the narrow view it hands out |
| `aggregates/post/PostPublicationMethods.ts` |      — | **667** | the state machine: targets, episodes, attempts, the word |
| `aggregates/post/PostPublicationEvents.ts`  |      — | **185** | what the outbox is told, and the two v1 payloads         |
| `aggregates/post/PostPublicationTypes.ts`   |      — |  **89** | the context and the input shapes both halves need        |

The root is still **102 lines over the ≤800 ceiling**, and that is reported rather than
smoothed: 619 of its lines pre-date this change, and the 283 it adds are its public
surface (nine entry points with their JSDoc), the context builder and the imports. They
cannot move without taking the aggregate's public API with them. Splitting the
pre-existing 619 is a different change with a different blast radius.

**The split's own red, caught by the suite it was refactoring.** The first context builder
captured `status`, `publishedAt` and `records` BY VALUE. A companion function that sets the
word and then re-reads it saw the state before its own write, and 11 cases went red at once
(`Tests 11 failed | 157 passed`). The three mutable reads are getters now; 168/168 green.
That failure is the argument for testing the seam through the root rather than directly:
no test changed, and the refactor still had to prove itself.

### Work unit evidence

| Evidence             | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused test command | `cd packages/core/domain && NODE_OPTIONS=--max-old-space-size=6144 pnpm exec vitest run` → exit 0, **`Test Files 9 passed (9)`, `Tests 168 passed (168)`** (55 before this range, 113 added). `cd apps/api && … vitest run tests/unit/infrastructure/PrismaPostRepository.test.ts` → exit 0, 57/57                                                                                                                                                                                                  |
| Regression tiers     | `apps/api` unit tier **577 files / 8999 tests, exit 0** (8992 before, +7 from the narrow save); `@core/posts` 27/27; `@core/recurring` 13/13                                                                                                                                                                                                                                                                                                                                                        |
| Runtime harness      | `cd apps/api && TIER=pr-integration bash scripts/run-tests.sh` against the real migrated database → **537 tests, 537 pass, 0 fail, 0 cancel, exit 0**, run BOTH before and after the seam split. The harness matters more than a unit double here: `integration:repositories` exercises the real `findById` with its new `channelPublications` include under row security, and `integration:saga-recovery` (33 tests) exercises the record-less promotion path this range deliberately left working |
| Rollback boundary    | The files listed below. The table, its migration and its enrollment belong to WU 1b.A and are NOT part of this revert; reverting this range returns the tree to "a table nothing knows how to write", which is exactly 1b.A's finish state                                                                                                                                                                                                                                                          |

### Gates — all read 0

| Gate          | Command                                                                                                                                                                | Result                                                                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Types         | `tsc --noEmit` in `@core/domain`, `@core/posts`, `@core/recurring`, `@adapters/db-prisma`, `@shared/types`, `@ports/core`, `apps/api`, `apps/workers`, `@infra/prisma` | exit **0** in all nine                                                                                                                                |
| Prisma client | `pnpm --filter @infra/prisma build` after adding the model type + four enums to the re-export list                                                                     | exit **0**; `Generated Prisma Client (7.9.1)`                                                                                                         |
| Lint          | `pnpm exec eslint --max-warnings 0` on all 36 touched files                                                                                                            | exit **0** (the first run surfaced 6 unused-import warnings left by the split; all six removed, none suppressed)                                      |
| Format        | `pnpm exec prettier --check` on all 36                                                                                                                                 | exit **0**                                                                                                                                            |
| Fitness       | the 40 runnable steps extracted VERBATIM from the fitness workflow (#1-#36, #38-#41)                                                                                   | **every one exit 0**                                                                                                                                  |
| Fitness #39   | tenant enrollment                                                                                                                                                      | **0** — this range adds no `accountId`-bearing model                                                                                                  |
| Fitness #38   | soft-delete read coherence                                                                                                                                             | **0 swept / 11 db-prisma (baseline 11, unmoved)** — the new `tx.post.findUnique` in the narrow save's conflict recovery carries the DELIBERATE marker |
| Fitness #40   | one transaction seam                                                                                                                                                   | **A: 0 / B: 0** — the narrow save opens no transaction of its own; it reuses the unit of work or the same GUC-bound seam the full save uses           |
| Fitness #30   | unreached suites                                                                                                                                                       | **20** (baseline 21) — unmoved; every new suite here is vitest-collected by an `include` glob, so none needs a `run_batch`                            |
| Fitness #2/#4 | core framework-free · no raw throws in the core                                                                                                                        | **0 / 0** — `Result` everywhere, `node:crypto` only (the same import `EntityId` and `ShortCode` already use)                                          |
| #9/#10/#8     | `@file` headers · valid `@layer` · no phase references                                                                                                                 | **0 / 0 / 0**                                                                                                                                         |

**#37 is again the one check NOT run**, for the same reason as WU 1b.A: it is
`pull_request`-only and resolves its base through `git fetch`, which this work unit is
forbidden from running. Its subject is the four coverage-threshold literals in
`apps/api/vitest.config.ts`, which this range does not touch.

### Files touched

| WU       | File                                                                 | Action   | What                                                                                                                                 |
| -------- | -------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1b.B     | `packages/core/domain/src/value-objects/FragmentReference.ts`        | Created  | one live fragment: one-based index, provider id, optional address; parses its own JSON back                                          |
| 1b.B     | `packages/core/domain/src/value-objects/ProviderReference.ts`        | Created  | `provided` vs `none-returned` — the explicit absence                                                                                 |
| 1b.B     | `packages/core/domain/src/value-objects/ExclusionReason.ts`          | Created  | the closed failure set; detail redacted THEN bounded, so a secret cannot survive by sitting past the cut                             |
| 1b.B     | `packages/core/domain/src/value-objects/ContentFingerprint.ts`       | Created  | sha256 over body + ORDERED media ids; plus `digestOfFragments` for the alert dedupe                                                  |
| 1b.B     | `packages/core/domain/src/value-objects/PublicationOutcome.ts`       | Created  | the three-kind outcome, the retraction state, the attempt result, the outcome-level live-content predicate                           |
| 1b.B     | `packages/core/domain/src/value-objects/PublishStatus.ts`            | Modified | `PARTIALLY_PUBLISHED` + `PUBLISHING → PARTIALLY_PUBLISHED` + `PARTIALLY_PUBLISHED → PUBLISHING`; `isPublicationFamily()`             |
| 1b.B     | `packages/core/domain/src/entities/ChannelPublication.ts`            | Created  | the record: episodes, the budget, all-or-nothing, the retraction exits, the window, `alertTransition()`                              |
| 1b.B     | `packages/core/domain/src/aggregates/ChannelPublications.ts`         | Created  | `derive()` + the three predicates every lock and admission reads                                                                     |
| 1b.B     | `packages/core/domain/src/value-objects/index.ts`, `src/index.ts`    | Modified | barrels                                                                                                                              |
| 1b.D     | `packages/core/domain/src/events/PostEvents.ts`                      | Modified | `PostChannelPublished`, `PostChannelExcluded`, `PostChannelRetractionAlertRaised`, `PostChannelRetractionAlertResolved`; union grown |
| 1b.C     | `packages/core/domain/src/errors/ContentLockedError.ts`              | Created  | names the channel and the live fragments; distinct from the lifecycle refusal                                                        |
| 1b.C     | `packages/core/domain/src/errors/index.ts`                           | Modified | export                                                                                                                               |
| 1b.C     | `packages/core/domain/src/aggregates/PostAggregate.ts`               | Modified | the publication entry points, the narrow view, the record-read `isEditable`, the lock on every door and exit, the reshaped `markAs*` |
| 1b.C     | `packages/core/domain/src/aggregates/post/PostPublicationMethods.ts` | Created  | the facet's state machine (the seam T1b.9 named)                                                                                     |
| 1b.C     | `packages/core/domain/src/aggregates/post/PostPublicationEvents.ts`  | Created  | the facet's event builders and the two v1 payloads                                                                                   |
| 1b.C     | `packages/core/domain/src/aggregates/post/PostPublicationTypes.ts`   | Created  | the context and input shapes both halves share                                                                                       |
| 1b.E     | `packages/core/domain/src/repositories/PostRepository.ts`            | Modified | `savePublication(post)` with the reason it is narrower than `save`                                                                   |
| 1b.E     | `packages/adapters/db-prisma/src/post/PostPublicationWrites.ts`      | Created  | the CAS, the per-record upsert, the edit tripwire                                                                                    |
| 1b.E     | `packages/adapters/db-prisma/src/post/PostAggregateMapper.ts`        | Modified | reads records back with the joined `Channel.provider`; fills `accountId`                                                             |
| 1b.E     | `packages/adapters/db-prisma/src/post/PrismaPostRepository.ts`       | Modified | `savePublication`; the `findById` include; the full save now writes the declared set too                                             |
| 1b.E     | `infra/prisma/src/client.ts`                                         | Modified | re-exports `PostChannelPublication` + the four enums the adapter types against                                                       |
| 1b.E     | `apps/api/tests/unit/infrastructure/PrismaPostRepository.test.ts`    | Modified | +7 cases and three root-built fixtures                                                                                               |
| 1b.E     | 7 more test files (core posts ×2, core recurring, api ×4)            | Modified | `savePublication` on every `PostRepository` double                                                                                   |
| 1b.B/C/D | 5 new suites under `packages/core/domain/tests/unit/`                | Created  | 113 cases                                                                                                                            |

### Deviations from design

Six, each reported rather than absorbed. The first three exist because **1b must be sound
on `main` alone** (`tasks.md` section 0.1), and the design's literal wording would have
broken that.

1. **`markAsPublished` / `markAsFailed` keep their arguments, as optional.** D5 reshapes
   them to "no argument", gated on the derivation. Taken literally at 1b, every publish-now
   would break the moment this lands: `CompletePostPublishingUseCase` (1c's file, rewritten
   by T1c.5) calls them today for posts that have NO record, and a record-gated method
   refuses those. Implemented instead: **with a record** the derivation gates the word and
   the v1 payload is built FROM the record — exactly D5; **with no record** the caller's
   arguments and the lifecycle transition decide, as today. 1c deletes the last caller of
   the second path and can then delete the parameters.
2. **`startPublishing` keeps its provider-keyed signature.** D5 describes
   `startPublishing(targetChannelIds)`. The signature is unchanged; what changed is that
   **no root path asks a caller for providers any more** — `openPublicationEpisode` and the
   projection resolve them from the records' joined channel rows, which is the stated
   purpose of the reshape ("`targetProviders` filled from the joined provider attribute").
   Re-keying the parameter would have forced a rewrite of 1c's use case inside 1b.
3. **`PostAggregateState.publications` and `.accountId` are OPTIONAL.** Required would
   break `PostAggregate.create()` (a new post has no tenant until the repository derives it
   from the project) and every in-memory fixture. The mapper always supplies both.
4. **The two ALERT events land here, not in 1b2.** T1b.10 names only the two channel
   events. They were added anyway, and the reason is a live hazard rather than tidiness:
   `alertTransition()` is 1b's (section 0.1) and it MUTATES the alerted-set digest. A root
   that writes the digest without emitting the event would leave the first real alert in 1c
   undeliverable — the digest would already match, so clause 2 would answer "none". 1b2's
   consumer stays purely additive.
5. **`PublishStatus.ts` landed in WU 1b.B, not 1b.C.** T1b.9 lists it, but
   `ChannelPublications.derive()` (T1b.7, WU 1b.B) RETURNS `PARTIALLY_PUBLISHED`, so the
   value has to exist by then. The whole `PublishStatus` change is the new value and its two
   edges; the `noLiveContent()`-gated exits T1b.9 also names live in the aggregate, where
   the record is readable, and those did land in 1b.C.
6. **The seam was applied and then applied again.** T1b.9 names one companion file; three
   exist, because the first companion came out at 874 lines.

### Findings (not fixed here — each needs its own decision)

1. **A record read under `withSystemContext` sees an EMPTY record set, and that fails
   OPEN.** `findById` now includes `channelPublications`, and that include is row-secured
   like everything else: with no tenant bound the policy returns no child rows, the
   aggregate reads as "no records", and "no records" means `noLiveContent()`, which means
   EDITABLE. Inert in 1b (nothing writes a record), but 1c's worker and sweep both read
   posts under a derived tenant and 1e's reconstruction script runs system-scoped by design.
   The durable answer is for the loader to distinguish "no records" from "records not
   visible"; the cheap one is for every system-scoped caller to bind a tenant first. Worth a
   design line before 1c's worker container lands.
2. **The internal channel events carry `accountId` OPTIONALLY.** The aggregate has no
   tenant until it is loaded from persistence, so an event emitted on an in-memory post
   omits the key. 1b2's `RetractionAlertEventHandler` binds its tenant FROM that payload
   (T1b2.10), so it must fail closed on an absent key rather than fall back to a system
   context. Named here because that handler is written in another slice.
3. **`excludedAt` is not a column.** The design's composed outcome carries it; the D3 column
   table does not. The mapper reads it from `lastAttemptAt` and falls back to the row's
   `updatedAt`. Accurate for every exclusion this change can produce (all of them are
   recorded at an attempt), but it is a derived value and the next revision of D3 should
   either name it or say so.
4. **`PostAggregate.ts` remains 102 lines over the ≤800 ceiling** after the split, all of it
   public surface over a file that was already 619. A backlog row belongs beside the four
   section 7.2 already names.

### Corrections applied after the 1b gate (PASS WITH WARNINGS, same branch)

Commits under correction: `1a1daede` / `17442c74` / `16e4cf73` / `4a90089d`.

| Id  | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1  | **Both `upsertPublications` calls REVERTED out of the full `save()`** (`doCreate` and `doUpdate`). The narrow `savePublication` is now the only production writer of the record. Nothing forced the calls: no domain event and no invariant needed them — they were an unrequested reading of "the target set travels with the post", which is REC-1 and belongs to T1c.6. They were also the worse shape twice over: untested (every upsert assertion sat in the narrow-save describe) and unchecked (the full save runs NEITHER of the narrow save's two refusals). **HALF RE-DECIDED 2026-09-20 in `1c-1d` (Edward's shape (b)), and the half that changed is named rather than the row rewritten.** What STANDS: `savePublication` is still the only writer of the record, and the full save still upserts nothing. What was WITHDRAWN: the SILENCE. This row's own red pinned `result.ok` on a declared-but-unwritten aggregate, so `declarePublicationTargets()` + `save()` reported success and dropped the records — and because a declaration emits no domain event, nothing downstream could notice. The full save now REFUSES such an aggregate (`err(InvariantViolationError)` naming `savePublication`), and the case at `PrismaPostRepository.test.ts:1242` was re-decided in place to assert the refusal | RED first, and it fails by WRITING: new case `writes NO publication row from the full save, even with targets declared` → **exit 1**, `Tests 1 failed \| 57 passed (58)`, `expected 0 … received 1` on `postChannelPublication.upsert.mock.calls.length`. GREEN after the revert: **58/58**. **2026-09-20**: that case is now `REFUSES the full save when the aggregate carries publication changes it will not write`, with its own red (`expected true to be falsy`) |
| W2  | **`savePublication`'s JSDoc and body moved to `PostPublicationWrites.savePublicationRecord`**; the repository keeps one delegating expression. The transaction BINDING deliberately did NOT move — it is passed in as a `TenantBoundRunner`, so `withGucBoundTransaction(this.prisma, resolveGucScope(this.tenantProvider), statements)` stays in the class that holds the provider                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | The first shape moved the binding too and **fitness #40 part B caught it**: `1 seam call(s) bind a scope that is not getAmbientGucScope() or resolveGucScope(this.tenantProvider)`, naming `PostPublicationWrites.ts:281`, exit 1. Reshaped → **part A 0 / part B 0**. The gate was right: both isolation layers must be fed from the same provider object                                                                                                             |
| S3  | Ledger line counts corrected to the committed measurement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `PostAggregate.ts` **900** at the gate (the ledger said 902) and `PostPublicationMethods.ts` **664** (said 667) — the ledger was written before the unused-import cleanup. Overrun at the gate **100**, not 102. After S4's JSDoc the root reads **912**, overrun **112**                                                                                                                                                                                              |
| S4  | `PostAggregate.startPublishing`'s "Start publishing process" replaced with the rationale for the surviving provider-keyed parameter: nothing inside the aggregate asks a caller for providers any more, and the parameter is held open only for the one caller outside it that runs over posts carrying no record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Fitness **#8 = 0** (no slice or phase reference in the new text); prettier + eslint clean                                                                                                                                                                                                                                                                                                                                                                              |

#### Measured line counts, base → HEAD

| File                                                                 | Base |    HEAD |   Δ | Note                                                                            |
| -------------------------------------------------------------------- | ---: | ------: | --: | ------------------------------------------------------------------------------- |
| `packages/adapters/db-prisma/src/post/PrismaPostRepository.ts`       |  913 | **942** | +29 | W2 brought it back inside T1b.12's ≤30 budget (it was 981, +68)                 |
| `packages/adapters/db-prisma/src/post/PostPublicationWrites.ts`      |  223 | **296** | +73 | receives the refusals, the unit-of-work choice and the try/catch                |
| `packages/core/domain/src/aggregates/PostAggregate.ts`               |  900 | **912** | +12 | S4's rationale JSDoc; still 112 over the ≤800 ceiling, all of it public surface |
| `packages/core/domain/src/aggregates/post/PostPublicationMethods.ts` |  664 | **664** |   0 | untouched by these corrections                                                  |

The first reshape reached +31 on the repository; the `findById` include's rationale was
tightened from six lines to three (same claim, fewer words) rather than dropped, which is
what brought it to +29.

#### Gates after the corrections — all 0

`tsc --noEmit` exit **0** in `packages/adapters/db-prisma`, `apps/api`, `packages/core/domain` ·
`vitest run tests/unit/infrastructure/PrismaPostRepository.test.ts` → **58 passed (58)** ·
`@core/domain` **168/168** · `@core/posts` **27/27** · prettier `--check` and eslint
`--max-warnings 0` on the four touched files exit **0** (one unused
`InvariantViolationError` import surfaced by the move was removed, not suppressed) ·
**all 40 runnable fitness steps exit 0**, with **#38 = 0 swept / 11 db-prisma (baseline 11,
unmoved)**, **#40 part A 0 / part B 0**, **#30 = 20 (baseline 21)** · runtime harness
`TIER=pr-integration bash scripts/run-tests.sh` → **537 tests, 537 pass, 0 fail, exit 0**.

Files touched by the corrections (4):
`packages/adapters/db-prisma/src/post/PrismaPostRepository.ts`,
`packages/adapters/db-prisma/src/post/PostPublicationWrites.ts`,
`packages/core/domain/src/aggregates/PostAggregate.ts`,
`apps/api/tests/unit/infrastructure/PrismaPostRepository.test.ts`.

### Correction after CI (`cda2c7d4`, cherry-picked from 1b2's `ae08587a`)

The Code Quality job on PR #268 failed on `pnpm check:circular`: `ContentLockedError.ts` imported
`FragmentReferenceJson` from the value objects, and every value object imports the errors barrel,
so 1b had closed an `errors → value-objects → errors` cycle that no local gate named. The error now
carries a structural `LockedFragmentReference` (index, externalId, url?) that mirrors the value
object's JSON shape without importing it; madge is clean over `apps/api/src/ packages/`, `tsc` 0
in `@core/domain` and `apps/api`, `@core/domain` 168/168, eslint and prettier 0. `pnpm
check:circular` was added to the tasks §10 gate list so the next child cannot repeat this.

### RDD receipt — the committed range 1b3 → 1b (2026-09-20)

Lineage `review-5700b58b95e0941c`, selected in the docs worktree with `--base-ref 539bf8ad
--committed-only` (gentle-ai resolves the ref to the commit's tree, `201a7e56`; candidate
`cda2c7d4`): 47 paths / 7,406 lines, tier **high**, correction budget 200. Consent/v3 answered
`granted` under Edward's standing rule. Four lenses captured concurrently (the resilience capture
closed the transaction). Terminal state **`approved`**; the exact `acknowledge-approved` returned
`gentle-ai.review-acknowledged/v1` with `authority: burned` (consumed revision `a89c58ff…`). No
correction was opened.

**Advisory findings — 12, every one informational**, recorded so nothing stays hidden; each is
separate later work with its own decision. Ids are the reviewer's.

| Id                                                | Lens        | Severity   | Location                                                                             |
| ------------------------------------------------- | ----------- | ---------- | ------------------------------------------------------------------------------------ |
| R1-content-fingerprint-empty-fallback             | risk        | WARNING    | `packages/core/domain/src/entities/ChannelPublication.ts:275-282`                    |
| R1-exclusion-detail-redaction-scope               | risk        | SUGGESTION | `packages/core/domain/src/value-objects/ExclusionReason.ts:38-46`                    |
| R1-findById-system-context-lock-bypass            | risk        | WARNING    | `packages/adapters/db-prisma/src/post/PrismaPostRepository.ts:70-76`                 |
| R2-alerthash-vs-supersededalertkey-naming         | readability | SUGGESTION | `packages/core/domain/src/entities/ChannelPublication.ts:80-120`                     |
| R2-interspersed-export-between-imports            | readability | SUGGESTION | `packages/core/domain/src/aggregates/post/PostPublicationMethods.ts:14-45`           |
| R3-integration-test-skeleton-coverage-gap         | reliability | SUGGESTION | `apps/api/tests/integration/postChannelPublicationTenantIsolation.test.ts:1-31`      |
| R3-mapper-reconstitute-drops-invalid-fragment     | reliability | WARNING    | `packages/adapters/db-prisma/src/post/PostAggregateMapper.ts:126-134`                |
| R3-narrow-save-non-tenant-transaction             | reliability | WARNING    | `packages/adapters/db-prisma/src/post/PostPublicationWrites.ts:266-273`              |
| R3-publication-events-swallowed-on-missing-reason | reliability | WARNING    | `packages/core/domain/src/aggregates/post/PostPublicationEvents.ts:38-53`            |
| R3-publications-derive-empty-optional-vs-union    | reliability | SUGGESTION | `packages/core/domain/src/aggregates/ChannelPublications.ts:73-107`                  |
| R3-published-outcome-null-hash-fallback           | reliability | WARNING    | `packages/core/domain/src/entities/ChannelPublication.ts:308-320`                    |
| R4-down-sql-non-atomic                            | resilience  | WARNING    | `infra/prisma/migrations/20260917093257_add_post_channel_publication/down.sql:22-28` |

**Proposed disposition (Edward decides; nothing here is applied).** The `findById` system-context
lock bypass is design D19's subject and is closed by 1c (T1c.4a) — an independent reviewer reached
the same finding as the 1b gate. The silent-fallback class — an empty content fingerprint, a null
hash on a published outcome, a reconstitute that drops an invalid fragment, publication events
swallowed on a missing reason — is the class this ledger is obliged to surface rather than absorb;
it belongs in one bounded follow-up before the tracker merges. The narrow save's transaction scope
sits beside the `TenantBoundRunner` binding the 1b gate corrected and needs its own adjudication.
The naming, import-order, `derive` shape and skeleton-coverage suggestions are backlog rows.

### Hardening after the 1b RDD review (advisory WARNINGs) — `5f054304`

Six advisory WARNINGs from the independent review of the committed 1b range. None was deferred:
each is fixed with a failing test first, or rejected with a test that proves the rejection. Four
of them were ONE defect — the record held its settled outcome as six separately-optional fields,
so `get outcome()` had to invent whatever was missing. The settlement is now one value per kind
(`_published`, `_excluded`), `outcomeKind` is derived from which one is held, and `reconstitute`
refuses a state the record could never have produced. Every fabricated fallback deleted itself.

| Id                                                  | Disposition  | What changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | RED evidence                                                                                                                                                                                                                                                     |
| --------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `R1-content-fingerprint-empty-fallback`             | FIXED        | `get outcome()` answered a missing fingerprint with `ContentFingerprint.ofContent({ body: "", mediaIds: [] })` — a valid-looking sha256 of empty content. REACHABLE, and the DB CHECK does not close it: `outcome <> 'PUBLISHED' OR contentHash IS NOT NULL` constrains NULL-ness, not FORMAT, so a published row holding `'garbage'` satisfied it, failed `fromString`, and the mapper turned that into `undefined`. `reconstitute` now returns `Result` and refuses it. The gate later found this UNDERSTATED: the migration has NO CHECK for `publishedAt` nor for head presence on a PUBLISHED row, so two fallbacks were reachable on a plain NULL | `vitest run tests/unit/channelPublication.test.ts` → exit 1, `Tests 7 failed \| 34 passed (41)`, `AssertionError: ok(rebuilt.ok)`. GREEN `41 passed (41)`; package 178/178                                                                                       |
| `R3-published-outcome-null-hash-fallback`           | FIXED        | The same getter's `publishedAt ?? new Date(0)` and `head ?? noneReturnedReference()`, and `PostPublicationEvents`' `publishedAt ?? new Date()` — which stamped the CURRENT time as a publication moment. All read from the one validated settlement now                                                                                                                                                                                                                                                                                                                                                                                                 | Same RED. A post-fix sweep for all five fallback spellings across `core/domain/src` and `db-prisma/src` returns nothing                                                                                                                                          |
| `R3-mapper-reconstitute-drops-invalid-fragment`     | FIXED        | `toChannelPublication` dropped any `liveFragments` entry that would not parse — live content invisible to the aggregate; the same swallow for the reason, the fingerprint and an unknown outcome. Now `PostAggregateMapper.reconstitute(row): Result<PostAggregate, PostRowCorruptedError>`, with `toDomain` keeping its signature and the file's ONE throw; the pre-existing bare `throw new Error("Invalid status")` became the SAME typed error, so SMELL-126 narrows rather than grows (`rg -c 'throw ' PostAggregateMapper.ts` → 1)                                                                                                                | `vitest run tests/unit/infrastructure/PrismaPostRepository.test.ts` → exit 1, `Tests 5 failed \| 58 passed (63)`, `AssertionError: promise resolved "{ ok: true, …(1) }" instead of rejecting`. GREEN `63 passed (63)`                                           |
| `R3-publication-events-swallowed-on-missing-reason` | FIXED        | `emitChannelOutcome` decided by a field's ABSENCE. The only transition that legitimately lacks a reason is a failure inside the budget, where the channel is unresolved — now a NAMED third case. The old shape also had the mirror defect: a stale `_reason` survived a later transient attempt, so the emitter announced `PostChannelExcluded` for a channel that was unresolved again                                                                                                                                                                                                                                                                | Planted the old desync (dropped `this._excluded = undefined` from the transient tail) → exit 1, `Tests 1 failed \| 34 passed (35)`, `AssertionError: the channel is unresolved again, so the stale reason must not be re-announced`. Restored → `35 passed (35)` |
| `R3-narrow-save-non-tenant-transaction`             | **REJECTED** | The reviewer misread the reused-unit-of-work branch. Both branches bind the tenant: the runner through `withGucBoundTransaction(this.prisma, resolveGucScope(this.tenantProvider), …)`, and the ambient one because `PrismaUnitOfWork.executeInTransaction` issues `set_config('app.account_id', …, true)` as its FIRST statement before putting the client in AsyncLocalStorage — and only that method populates `txStorage` (one write site, `PrismaUnitOfWork.ts:115`, confirmed by the gate). Every statement of `writePublicationSave` runs on the one client. No source change; two tests added so the claim is checkable                         | Planted both violations (scope `undefined`; `activeTx` bypassed) → exit 1, `Tests 2 failed \| 63 passed (65)`: `expected +0 to be 1` (the bind never happened) and `expected 2 to be 1` (a SECOND transaction opened). Restored → `65 passed (65)`               |
| `R4-down-sql-non-atomic`                            | FIXED        | The five DROPs now run inside `BEGIN; … COMMIT;`. Checking the convention first surfaced a SECOND defect the file already had: the four RLS sibling rollbacks use session-level `SET` precisely because `SET LOCAL` outside a transaction block only warns and no-ops — this file used `SET LOCAL` with no block, so both its timeout bounds had never done anything. Opening the block fixes atomicity and makes them effective; the divergence from the siblings is stated in the file, and the runner (`psql -f`) is named beside the atomicity claim with the repo's measured precedent                                                             | Not executed: PostgreSQL is not up on this host and the script is destructive to the dev schema. The change is a transaction wrapper around statements that already existed                                                                                      |

Gates after the hardening — `tsc --noEmit` exit 0 in `@core/domain`, `@adapters/db-prisma`,
`@core/posts`, `@core/recurring`, `apps/api`, `apps/workers`, `@infra/prisma` · eslint
`--max-warnings 0` and `prettier --check` exit 0 on all six TS files · `@core/domain` 178/178,
`@core/posts` 27/27, `@core/recurring` 13/13, `@adapters/db-prisma` 70/70, `apps/api` unit tier
577 files / 9007 tests · fitness #4 = 0, #23 = 0, #32 = 0, #38 = 0 swept / 11 db-prisma (baseline
11, unmoved), #40 part A 0 (seams 3, floor 3) / part B 0 (sites 14, floor 10), plus
#2/#3/#5/#8/#9/#10 all 0. Measured by numstat: CODE 391 / EVIDENCE 339 changed lines.

### Gate corrections after the hardening — `b52047c2`

The fresh-context gate on `5f054304` returned PASS WITH WARNINGS: no Critical, the narrow-save
rejection confirmed, and the fabrication paths confirmed reachable and UNDERSTATED — the migration
has CHECKs for `contentHash` and `reasonCode` but NONE for `publishedAt` or for head presence on a
PUBLISHED row. Seven warnings, all closed in the second work unit; the bounded re-gate then caught
one Critical inside that unit and it was closed in a single corrective pass.

| Id                                           | Disposition                      | What changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Evidence                                                                                                                                                                                                            |
| -------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Export the typed error                       | FIXED                            | `PostRowCorruptedError` now leaves the db-prisma barrel. Unexported, the class `toDomain` RAISES could only be matched by message, which makes the wording of an error an API nobody agreed to                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `AssertionError: The instanceof assertion needs a constructor but undefined was given.` GREEN after the export                                                                                                      |
| Asymmetric invariant                         | FIXED                            | `reconstitute` refused settlements MISSING their facts but silently DISCARDED an UNRESOLVED state that ARRIVED carrying them — and a discarded `head` is a provider id for content that may still be live. The shape is storable because every CHECK on the table is ONE-DIRECTIONAL. Refusal driven by one `UNRESOLVED_FORBIDDEN_FACTS` list, pinned in BOTH directions after the re-gate: a `satisfies` over the facts unions and a compile-time coverage assertion (`_everySettledFactIsForbidden`), red proven by planting a fact on `PublishedFacts` (`TS2322`, `TSC_EXIT=2`)                                                                                                                                                                                                                                                                                                                                                                               | Table-driven, one row per fact → exit 1, `Tests 3 failed \| 43 passed (46)`, `AssertionError: an unresolved row carrying head is a corrupted row, not a row to strip`; plus the row-level case in the adapter suite |
| `reconstitute` JSDoc (a) the content default | FIXED — default KEPT             | A post with NO content row is a REAL state: `Post.contents` is a to-many so zero rows is schema-valid; integration fixtures create bare posts (`postHardDeleteCascade.test.ts:70`); and `PrismaApproveVariantAdapter` creates post and content in TWO statements OUTSIDE a transaction (SMELL-142). Refusing it would make a bare post permanently unloadable, including for the delete that would clean it up. The doc now says "ONE value IS defaulted, and it is a default rather than a repair"                                                                                                                                                                                                                                                                                                                                                                                                                                                              | n/a — a documentation correction; the three writers were read to establish it                                                                                                                                       |
| `reconstitute` JSDoc (b) the media drop      | FIXED — W4's other half          | `if (mediaResult.ok) media.push(…)` dropped the row. Bounded before taking it: one refusal arm, no signature change, and every media fixture in the tree uses a valid absolute URL — including the three integration `toDomain` call sites (`:553`/`:591`/`:639`) — so the refusal is inert for existing tests. The re-gate then corrected the BLAST RADIUS: the publication refusals are `findById`-only, but `media` is included by the four list loaders too, so one corrupted media row rejects a WHOLE PAGE from a `PaginatedResult` loader with no error channel. That reach is bounded by the loaders' zero production consumers (measured three times, receiver-agnostic) and by their retirement; the deletion mechanism (`doUpdate` removes media the aggregate no longer carries) fires only on `save()`, so on a list path the old drop under-REPORTED rather than destroyed. The `media` includes were not dropped and the refusal was not weakened | `AssertionError: promise resolved "{ ok: true, …(1) }" instead of rejecting`                                                                                                                                        |
| Silent repair on `head`                      | FIXED                            | `head = provided.ok ? provided.value : noneReturnedReference()` flipped `externalIdMissing` false → true. A published row with `externalId = "   "` and `externalIdMissing = false` satisfies CHECK `:120`, so it is storable. Refused now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | exit 1, `Tests 3 failed \| 66 passed (69)`. GREEN `69 passed (69)`                                                                                                                                                  |
| `toDomain` justification                     | FIXED — the old reason was FALSE | It claimed the raise survives because five of six reads carry no error channel; `channelPublications` is included by `findById` ONLY (`:73`), which HAS an error channel and raises through it uncaught at `:84`. The truthful reason is recorded: the raise survives until `findById` returns `err(PostRowCorruptedError)` through a widened port error union, which belongs to 1c's `findById` rework. The port was NOT widened here                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | n/a — a documentation correction, measured against the include site                                                                                                                                                 |
| Guard the attempt                            | FIXED                            | `recordAttempt` guarded only the episode and the replay ordinal, so an attempt on a PUBLISHED or pending-retraction record cleared `_published` while `_liveFragments` stayed populated and `hasLiveContent()` read FALSE. The refusal is `if (this.hasLiveContent())`, THE predicate `openEpisode` already refuses on, placed AFTER the replay check so an at-least-once redelivery still gets `applied: false` (pinned by a test). EXCLUDED-with-nothing-live stays admissible — NOT because it is a no-op (a published result overturns the exclusion; a transient failure resurrects the record to UNRESOLVED and moves the word backwards, SMELL-141) but because refusing would turn a benign late report into an error the worker must special-case                                                                                                                                                                                                       | exit 1, `Tests 3 failed \| 43 passed (46)`: `a published channel would double-post or orphan what is live` and `fragments are still on the provider`. GREEN `46 passed (46)`, package 184/184                       |
| Name the runner in `down.sql`                | FIXED (orchestrator)             | The writer was blocked by an expired sensitive-edit token; the orchestrator applied the exact clause with a fresh token: the runner is `psql -f`, and the atomicity claim is a claim about how psql executes the file (precedent: `docs/reports/TENANT_RLS_AB_MEASUREMENT.md`, "psql exited 3, the transaction rolled back")                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | n/a — a comment                                                                                                                                                                                                     |

Gates after the second unit — `tsc --noEmit` exit 0 in `@core/domain`, `@adapters/db-prisma`,
`apps/api` · eslint `--max-warnings 0` and `prettier --check` exit 0 on all touched files ·
`@core/domain` 184/184, `@adapters/db-prisma` 70/70, `PrismaPostRepository.test.ts` 69/69,
`apps/api` unit tier 577 files / 9011 tests · fitness #4 = 0, #40 part A 0 / part B 0, plus
#2/#3/#8/#9/#10/#23/#32 all 0. Measured by numstat: CODE 212 / EVIDENCE 201. Backlog rows opened:
SMELL-140 (the `mapMediaKind` default arm), SMELL-141 (the excluded-to-unresolved resurrection),
SMELL-142 (the untransacted approve-variant pair), SMELL-143 (module-scope circuit breaker
construction in the provider packages).

### CI root cause fix — the circuit breaker no longer opens a dead-letter queue — `57430ca4`

The "Package Tests" job (`turbo run test`, no Redis service) failed in `@apps/workers#test` with
`EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending`, after a flood of
`connect ECONNREFUSED 127.0.0.1:6379`. A unit test that imported `mentionIngestWorker` for ONE
pure helper pulled in ten `@providers/*` packages, each of which calls
`createExternalApiCircuitBreaker(...)` at module scope, and the breaker's constructor built a
`DeadLetterQueueManager` whenever `REDIS_URL` was set.

`lazyConnect: true` does not hold under BullMQ: `RedisConnection`'s constructor runs `init()`
eagerly and `init()` calls `connect()` on a client in `wait` status, for `Queue` and `QueueEvents`
alike (`redis-connection.js:63-64`, `:84-85`; proven by the gate with a live probe against
`127.0.0.1:1`). A real socket therefore opened at IMPORT time. With no `error` listener on those
objects, BullMQ's `emit` override fell through to raw `console.error` (`queue-base.js:80-92`),
ioredis retried forever, vitest buffered the output over the worker RPC, and the shortest-lived
test file tore the channel down mid-flush.

Fixed at the root, per the DI canon (only a composition root constructs a singleton):

- `ExternalApiCircuitBreaker`'s constructor no longer creates a dead-letter queue: it constructs
  no connection and no queue. Its READ path (`getDeadLetterQueue()`, null-safe) is unchanged, so a
  root that creates the queue still gets dead-lettering; when none is configured the breaker now
  WARNS once per failed operation, naming service and operation. `redisUrl` is kept because the
  fallback response cache genuinely uses it — that client is `lazyConnect` and issues no command
  at construction, so it opens nothing (verified).
- `DeadLetterQueueManager` is honest when a root DOES build it: `error` listeners on the Queue,
  the QueueEvents and every retry queue built by `getRetryQueue()`, all routed to the logger;
  `QueueEvents` built with `autorun: false` and its loop started in `startProcessing()`; the raw
  `pino({...})` replaced with `createLogger("dead-letter-queue")` per the logging canon; the three
  pre-existing suites mock `@observability/logger` (the unit's own dependency) and their doubles
  model `on()` and `run()`.

Behaviour changes, stated: (1) `createDeadLetterQueue()` memoizes a process-global singleton and
ignores later callers' config. In `apps/api` the breaker won that race at import (`index.ts ->
setup.ts -> setupServices.ts -> providerService.ts -> providerRegistry.ts -> @providers/x ->
apiClient.ts` module scope), so the composition root's `queueName: DEAD_LETTER_QUEUE` at
`index.ts:364` was dead config and dead-lettering landed on `failed-operations-dlq`. The root is
now the only creator, so the queue name becomes `dead-letter-queue` — the name
`setupServices.ts`'s job options and the admin queue-health panel already carry; nothing consumed
the old queue (the constant, one job-options entry, one admin panel row, two i18n keys and two
docs rows describe it — its deletion is a separate authorisation, and the constant says so).
(2) `apps/workers` got a dead-letter queue only by the breaker's accident and now gets none; the
skip is logged. Separately observed, not fixed: `DeadLetterQueueManager.startProcessing()` has no
production caller anywhere in the repo, so the dead-letter queue is write-only today.

Proof: `apps/workers` vitest with `REDIS_URL` pointed at an unreachable host went from 10
`ECONNREFUSED` lines across two processes to 0, with 0 teardown errors and 131/131 tests passing.
Gates re-run sequentially after the LXC incident: prettier and eslint `--max-warnings 0` exit 0;
`tsc -b` exit 0 for `dead-letter-queue`, `external-apis`, `apps/workers`, `apps/api`;
`@adapters/dead-letter-queue` 94/94; `@adapters/external-apis` 79/79. Measured: CODE 104 /
EVIDENCE 541 (+ the lockfile's two workspace links). Residual, named: the eager-queue test mutates
`process.env.REDIS_URL` with save/restore — the only honest way to exercise the module-scope
production path.

### RDD receipt — the committed hardening range `cda2c7d4` → `57430ca4` (2026-09-20)

Lineage `review-3a57d384e98346df`, selected with `--base-ref cda2c7d4 --committed-only` over the
three hardening commits (24 paths / 1,778 lines, tier **medium**, one `review-reliability`
slot). Consent/v3 answered `granted` under Edward's standing rule. Terminal state
**`approved`**; the exact `acknowledge-approved` returned `gentle-ai.review-acknowledged/v1`
with `authority: burned`. No correction was opened. Three advisory SUGGESTIONS, all informational
and recorded here: `R3-emit-channel-outcome-relies-on-refined-invariant`
(`PostPublicationEvents.ts:33-56` — the emitter now trusts the entity's refined settlement
invariant), `R3-mapper-throws-through-result-returning-port`
(`PostAggregateMapper.ts:257-303` — the same single raise the `toDomain` comment names, owned by
1c's `findById` rework) and `R3-worker-autorun-inconsistent-with-queueevents-gate`
(`dead-letter-queue/src/index.ts:316-321` — the BullMQ `Worker` still autoruns while
`QueueEvents` is gated; both start in `startProcessing()` today, and no production caller starts
either).
---

## PR 1b2 — the retraction alert consumer — COMPLETE (T1b2.1 … T1b2.12)

Branch `workstream/ncor8-1b2`, child of `workstream/ncor8-1b` @ `7e4e4be2`. Both halves landed:
**1b2-i** (the type, the migration, `isTypeEnabled`, the enrollment adjudication) and **1b2-ii**
(the ports, the three media adapters, the ledger adapter, the two use cases, the event handler,
the email template, the wiring and the docs).

**Finish state**: a `PostChannelRetractionAlertRaised` event that nothing yet emits would be
consumed, deduplicated per `(alertKey, medium, target)`, and delivered in-app + by email to every
member whose per-type row is not disabled, plus to every active Slack/Teams config regardless of
that config's `events` filter. Inert until an event flows — PR 1c is the producer.

### The blocked first attempt, kept as history

The first run of this batch stopped at T1b2.4: `infra/prisma/schema.prisma` is a token-gated
sensitive path and the pre-edit hook refused the write.

```text
BLOCKED [pre-edit]: /root/omni-post/infra/prisma/schema.prisma matchea pattern sensible
'/infra/prisma/schema.prisma' (token: missing). Autorización time-boxed por token:
pedíle a Edward que ejecute 'omnipost-allow sensitive-edit' (TTL 15 min), igual que para push.
```

That refusal was honoured rather than worked around — no Bash write, no reordering of the later
tasks ahead of the schema — and the batch reported `blocked`. Edward issued the token; this run
resumed AT T1b2.4 and completed the PR. The entry stays because the refusal is the evidence that
the gate works, and because the compiler proof below is what made stopping correct rather than
merely obedient.

### Tasks — all twelve `[x]`

| Task         | Evidence                                                                            |
| ------------ | ----------------------------------------------------------------------------------- |
| T1b2.1 / .2  | RED recorded below; both inlined call sites migrated, their own suites unchanged    |
| T1b2.3       | the tenth type + `isUrgent()` as rank; RED was 5 failures                           |
| T1b2.4       | migration `20260919222448_add_retraction_alert_notifications`, applied and verified |
| T1b2.5 / .7  | 19-case raise suite, the ports, the ledger port, the two use cases                  |
| T1b2.6       | 7-case resolve suite — **test-after, declared**, see the TDD table                  |
| T1b2.8       | `broadcast` promoted to `ExternalNotifierPort` with `toEveryActiveConfig`           |
| T1b2.9 / .10 | three media adapters, the ledger adapter, the handler, the wiring, the registry     |
| T1b2.11      | the email template case, 5 new cases on the adapter's own suite                     |
| T1b2.12      | the handler suite, `docs/api/notifications.md`, the gates below                     |

### TDD cycle evidence

| Task    | Test file                                                                                                                       | Layer  | Safety net                             | RED                                                                                                                                                                                                                                                                                               | GREEN                                                  | TRIANGULATE                                                                                                                                                                                                                                                                        | REFACTOR                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| T1b2.1  | `packages/core/notifications/tests/unit/isTypeEnabled.test.ts`                                                                  | Unit   | ✅ 4/4 (`@core/notifications`)         | ✅ `Cannot find module '../../src/isTypeEnabled.js'` — `Test Files 1 failed`, `no tests`                                                                                                                                                                                                          | ✅ `Test Files 2 passed`, `10 passed`                  | ✅ 6 cases: absent row, sibling rows only, disabled, enabled, mixed, unknown type                                                                                                                                                                                                  | ➖ the predicate is one expression                                   |
| T1b2.2  | the two existing suites, unchanged                                                                                              | Unit   | ✅ 4/4 + 6/6                           | ➖ refactor task — approval reds are the two suites' own pre-existing cases                                                                                                                                                                                                                       | ✅ 4/4 and 6/6 still pass unchanged                    | ➖ covered by T1b2.1's six                                                                                                                                                                                                                                                         | ✅ the inlined predicate is gone from both sites                     |
| T1b2.3  | `apps/api/tests/unit/domain/notification.test.ts` + `.../application/sendEmailNotification.test.ts`                             | Unit   | ✅ 29/29 and 6/6                       | ✅ `Tests 5 failed \| 36 passed (41)` — `Invalid notification type: "PUBLICATION_RETRACTION_PENDING"` ×2, `result.value.isUrgent is not a function` ×2, allow-list drop ×1                                                                                                                        | ✅ `Tests 41 passed (41)`                              | ✅ 6 new cases: accepts the tenth value, urgent true, urgent false over four routine types, outside every existing category, email admitted, email opt-out still honoured                                                                                                          | ➖ additive                                                          |
| T1b2.4  | the migration itself, verified against the live database                                                                        | Schema | ✅ `prisma migrate status` clean at 84 | ✅ the compiler: `apps/api` `tsc` exit **2**, `PrismaNotificationRepository.ts(162,7)` `Type '"PUBLICATION_RETRACTION_PENDING"' is not assignable to type 'NotificationType'`                                                                                                                     | ✅ applied, 85 migrations, `apps/api` `tsc` exit **0** | ✅ read-back probe: enum label at sort order 10, the ledger's 6 columns, both indexes, `relrowsecurity=false`                                                                                                                                                                      | ➖ DDL                                                               |
| T1b2.5  | `packages/core/notifications/tests/unit/raiseRetractionAlert.test.ts`                                                           | Unit   | N/A (new)                              | ✅ `Cannot find module '../../src/RaiseRetractionAlertUseCase.js'` — `no tests`                                                                                                                                                                                                                   | ✅ `Tests 19 passed (19)`                              | ✅ 19 cases over the design's whole list: both per-member media, the Q21 shared switch (zero recipients, every member off, deactivated sibling, events filter ignored), the three reasons kept apart, idempotency as NUMBERS, superseded-before-claim ordering, one medium failing | ✅ two TEST expectations corrected — see below                       |
| T1b2.6  | `.../resolveRetractionAlert.test.ts`                                                                                            | Unit   | N/A (new)                              | ❌ **test-after, declared rather than claimed** — the resolve use case is a CONSTRUCTOR DEPENDENCY of the raise use case, so its type had to exist for T1b2.5's RED to compile. Per strict TDD this row is a FAILURE of the cycle, not a pass; it is recorded as such instead of being dressed up | ✅ `Tests 7 passed (7)`                                | ✅ 7 cases incl. delete-order, skipped unattached row, `ACTION_WINDOW_EXPIRED`, idempotency, store failure → `INTERNAL_ERROR`                                                                                                                                                      | ➖                                                                   |
| T1b2.8  | `apps/api/tests/unit/infrastructure/adapters/ExternalNotificationDispatcher.test.ts`                                            | Unit   | N/A (the dispatcher had NO suite)      | ✅ `Tests 5 failed \| 1 passed (6)` — only the pre-existing filtered branch passed                                                                                                                                                                                                                | ✅ `Tests 6 passed (6)`                                | ✅ both branches: filter honoured by default, ignored under the option; deactivated skipped; per-channel routing; partial failure counted; repo failure propagated                                                                                                                 | ➖                                                                   |
| T1b2.9  | three mirror suites under `tests/unit/infrastructure/adapters/`                                                                 | Unit   | N/A (new)                              | ✅ `Cannot find module '.../InAppRetractionAlertDelivery.js'` — `no tests`                                                                                                                                                                                                                        | ✅ 5 + 4 + 7 = **16 passed**                           | ✅ per adapter: kind declaration, happy path, the preference-skip (no id, no broadcast), the failure path, the empty-target path                                                                                                                                                   | ✅ relocated out of `container/adapters/` mid-cycle — see Deviations |
| T1b2.10 | `.../repositories/PrismaRetractionAlertDeliveryLedger.test.ts` + `tests/unit/notifications/RetractionAlertEventHandler.test.ts` | Unit   | N/A (new)                              | ✅ both `Cannot find module` — `no tests`                                                                                                                                                                                                                                                         | ✅ `7 passed` and `11 passed`                          | ✅ ledger: claim, P2002 → `false`, any OTHER error rethrown, medium mapping, attach, list, delete. Handler: tenant bound from payload, REFUSED when absent (both event types), superseded carried, malformed fragment dropped, use-case failure swallowed                          | ➖                                                                   |
| T1b2.11 | `.../adapters/TransactionalEmailAdapter.test.ts` (+5 cases)                                                                     | Unit   | ✅ 9/9                                 | ✅ `Tests 3 failed \| 9 passed (12)`                                                                                                                                                                                                                                                              | ✅ `Tests 12 passed (12)`                              | ✅ 5 cases: fragments + links + excerpt, both causes, deadline present/absent, no credential-shaped field, empty fragment list                                                                                                                                                     | ➖                                                                   |
| metrics | `tests/unit/metrics/retractionAlertMetrics.test.ts`                                                                             | Unit   | N/A (new)                              | ✅ `Cannot find module`                                                                                                                                                                                                                                                                           | ✅ `3 passed`                                          | ✅ 3 cases, incl. "two reasons collapsed into one series" as an explicit assertion                                                                                                                                                                                                 | ➖                                                                   |
| context | `.../adapters/RetractionAlertContextAdapter.test.ts`                                                                            | Unit   | N/A (new)                              | ✅ `Cannot find module`                                                                                                                                                                                                                                                                           | ✅ `6 passed`                                          | ✅ 6 cases: provider derived, title preferred, body excerpt BOUNDED at 160, unreadable post / unreadable channel / malformed id all still alertable                                                                                                                                | ➖                                                                   |

**Two test expectations were corrected during T1b2.5's GREEN, and neither weakened the test.**
Both were MY errors in the test, caught by the implementation: (1) the "one medium failing"
case asserted the whole medium's result list and forgot the second member, who is legitimately
reported `suppressed-by-preference` — rewritten to assert per TARGET, which is stricter; (2) the
second-run case expected an EMPTY report, but a preference is not a claim and does not collide,
so the opted-out member is still explained on the second run — rewritten to assert that nothing
is `delivered` twice, which is the invariant that actually matters.

RED transcript, T1b2.1 (verbatim):

```text
❯ tests/unit/isTypeEnabled.test.ts (0 test)
Error: Cannot find module '../../src/isTypeEnabled.js' imported from
  /root/omni-post/packages/core/notifications/tests/unit/isTypeEnabled.test.ts
Test Files  1 failed (1)      Tests  no tests
```

RED transcript, T1b2.3 (the two distinct failure shapes):

```text
FAIL tests/unit/domain/notification.test.ts > NotificationType
     > accepts PUBLICATION_RETRACTION_PENDING, the tenth member of the closed set
FAIL tests/unit/domain/notification.test.ts > NotificationType
     > returns false for isUrgent on every routine type
TypeError: result.value.isUrgent is not a function
Test Files  2 failed (2)      Tests  5 failed | 36 passed (41)
```

### Why T1b2.3 cannot be committed without T1b2.4 — measured, not argued

`NOTIFICATION_TYPES` is not only a TypeScript union. Two things read it at runtime and one reads
it at compile time, and the third is what turns the coupling from prudence into a build failure:

1. `apps/api/src/notifications/notificationRoutes.ts:43` derives the request-validation enum for
   BOTH `POST /notifications` and `PUT /notifications/preferences` from `Object.values(NOTIFICATION_TYPES)`.
   Adding the tenth value widens both schemas immediately, so the API starts ACCEPTING a type the
   database's own `NotificationType` enum does not hold.
2. `PrismaNotificationRepository` casts the value straight onto that Postgres enum, so an accepted
   request would reach the database and be rejected there — a 500 on a route that validated the
   input as legal.
3. The compiler refuses the state outright. Measured with the type added and the schema not:

```text
src/infrastructure/repositories/PrismaNotificationRepository.ts(162,7): error TS2375:
  Types of property 'type' are incompatible.
  Type '"PUBLICATION_RETRACTION_PENDING"' is not assignable to type 'NotificationType'.
```

That was `apps/api` `tsc --noEmit` at exit **2**. It is the design's own instruction
(design.md:196 — "Schema edit and migration in ONE commit") enforced by the toolchain rather than
by discipline, and it is why stopping at the refusal was correct rather than merely obedient:
committing half of 1b2-i would have left `main` unable to compile. **RESOLVED** — the schema and
the migration landed in this run, `prisma generate` ran, and `apps/api` `tsc` reads **0**. The two
belong in ONE commit.

### T1b2.4, as applied

Migration **`20260919222448_add_retraction_alert_notifications`** (+ `down.sql`). The schema block
sits immediately after `enum NotificationType`:

```prisma
enum NotificationType {
  ...
  PUBLICATION_RETRACTION_PENDING
}

enum RetractionAlertMedium {
  IN_APP
  EMAIL
  SLACK_TEAMS
  SMS
  PUSH
}

model RetractionAlertDelivery {
  id             String                @id @default(uuid())
  alertKey       String
  medium         RetractionAlertMedium
  target         String
  notificationId String?
  deliveredAt    DateTime              @default(now()) @db.Timestamptz(6)

  @@unique([alertKey, medium, target])
  @@index([alertKey])
}
```

It follows `20260917093257_add_post_channel_publication`'s form: the timeout preamble FIRST even
though no policy is created, then `ALTER TYPE "NotificationType" ADD VALUE` with no row of that
value written in the same migration, then the medium enum and the table. `Notification` is NOT
touched (W-a-2). `down.sql` inverts the table and the medium enum and states honestly that
PostgreSQL cannot drop an enum label in place, so the added label survives a rollback — the one
documented non-reversal, and the rollback's own cost (dropping the ledger loses the record of
what was already delivered, so a re-apply delivers again) is named there rather than discovered.

**Applied and verified**: `prisma migrate deploy` → 85 migrations, `migrate status` clean,
`prisma validate` ok, `pnpm --filter @infra/prisma build` → `Generated Prisma Client (7.9.1)`,
`apps/api` `tsc` back to **0**. A read-only probe of the live database confirms the DDL rather
than assuming it: `NotificationType` carries `PUBLICATION_RETRACTION_PENDING` at sort order **10**
(last, which is what the `AFTER` clause specifies), `RetractionAlertMedium` holds its five labels,
`RetractionAlertDelivery` has its six columns plus both indexes, and `relrowsecurity` is **false**.

**#39 stays at zero WITHOUT enrolling anything, and that is a decision, not an omission.** The
ledger carries no `accountId`, so it is not a bearing model — the same class as `Notification` and
`NotificationPreference` (design.md:196, tasks T1b2.4). It holds an opaque alert hash, member ids
and external-config ids, and every read of it is keyed by an `alertKey` only a tenant-bound event
can produce. Nothing was added to `TENANT_SCOPED_MODELS`, no row was added to
`MULTI_TENANT_GUARDS.md`, and no RLS policy was created. There is therefore **no #39 red path to
plant for this PR**: the red path belongs to a model that SHOULD be enrolled, and 1b.A already
proved it for `PostChannelPublication`. Say this in the PR body (tasks 10.2's 1b2 row asks for
exactly that).

#### Squawk: one finding FIXED, one adjudicated

The forward migration fired `require-enum-value-ordering` on its bare `ADD VALUE`. That was
**fixed, not waived**: the statement now names its anchor,
`ADD VALUE 'PUBLICATION_RETRACTION_PENDING' AFTER 'INBOX_MENTION_RECEIVED'`, which produces the
IDENTICAL sort order (the anchor was already the last label — confirmed by the probe above) and
states the position instead of leaving a reader to infer it. `squawk lint` on the forward file
now reads `Found 0 issues`, so it gets NO entry in the workflow's exception list.

`down.sql` fired `ban-drop-table`, which is unsatisfiable by construction — the forward migration
CREATES the table, so its rollback is the statement that drops it. **ADJUDICATION 8** in
`.github/workflows/audit.yml`, per-file, per-rule and digest-pinned to
`9ab334f03f70fa8b0772ffcb6b9a286475eb2ff079844db802727b989f333338`, following ADJUDICATION 7's
shape for the same situation one migration earlier. The name is added to all three arms the step
requires (rules, digest, stale-name loop) — verified present exactly once in each.

**Fixing rather than adjudicating was the point.** An exception list that absorbs a finding a
one-token edit would close is how a gate stops meaning anything; ADJUDICATION 2's own text sets
that precedent (`constraint-missing-not-valid` was fixed, and only the five unsatisfiable findings
were adjudicated).

#### The one residual this migration leaves on the DEV database

The forward file was edited AFTER it was applied (the Squawk fix), so its recorded checksum in
`_prisma_migrations` no longer matches the file: recorded `debb2e70…`, on disk `9c884bf4…` —
measured, not assumed. It blocks nothing: Prisma 7.9.1's `migrate status` and `migrate deploy`
both read clean over it (measured both), and CI applies the history to a FRESH database where
only the on-disk bytes exist. The clean fix is `prisma migrate reset`, and **Prisma's own AI-agent
gate refuses that command without Edward's explicit consent** — the refusal was honoured, not
worked around, so the drift is reported here instead of being silently cleared. Anyone who wants
it gone runs the reset themselves; nothing depends on it.

### Work unit evidence

| Evidence             | Value                                                                                                                                                                                                                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused test command | `cd packages/core/notifications && … vitest run` → exit **0**, `Test Files 4 passed (4)`, `Tests 36 passed (36)` · the eleven new/extended `apps/api` suites → **55 new cases**, all passing                                                                                                                                  |
| Regression tier      | `apps/api` unit tier **585 files / 9060 tests, exit 0** · `@core/domain` **168/168** · `@core/notifications` **36/36**. The first full run was `1 failed                                                                                                                                                                      | 9059 passed`, and the failure was the RIGHT one — `EventSchemaRegistry.test.ts` asserts an EXHAUSTIVE list of registered events, so the two new schemas broke it by design; the list was extended to 14 with a note on why the two are internal |
| Runtime harness      | `cd apps/api && TIER=pr-integration bash scripts/run-tests.sh` against the real migrated database → **537 tests, 537 pass, 0 fail, 0 cancel, 0 skip, exit 0** — identical to the 1b baseline, incl. `integration:tenant-isolation` 247 (the `pg_catalog` coverage gate) and `integration:saga-recovery` 33                    |
| Rollback boundary    | the files listed below, plus `down.sql` for the migration. Reverting the range returns the tree to "email admits four types, the predicate is inlined twice, and no alert consumer exists" — `main`'s state. Nothing in the chain emits the two alert events yet (PR 1c is the producer), so the consumer is inert either way |

### Gates — all 0

| Gate                  | Command                                                                                                                                                   | Result                                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Types                 | `tsc --noEmit` in `@core/domain`, `@core/notifications`, `@ports/core`, `@core/posts`, `@adapters/db-prisma`, `apps/api`, `apps/workers`, `@infra/prisma` | exit **0** in all eight                                                                                                                |
| Prisma                | `prisma validate` · `migrate status` · `pnpm --filter @infra/prisma build`                                                                                | valid · 85 migrations, up to date · `Generated Prisma Client (7.9.1)`                                                                  |
| Lint                  | `eslint --max-warnings 0` on all 45 touched files, in three batches                                                                                       | exit **0** (44 files at once OOMs the 9 GB LXC — the batching is an environment fact, recorded so the next run does not rediscover it) |
| Format                | `prettier --check` on every touched file + `prisma format`                                                                                                | exit **0** (10 files reformatted by `--write`, then re-checked AND re-tested)                                                          |
| Squawk                | `squawk lint` on both migration files                                                                                                                     | forward **0 issues** (the finding was FIXED); `down.sql` adjudicated, digest-pinned                                                    |
| #2 / #3 / #4 / #5     | core framework-free · no `any` · no raw throws · no `@ts-ignore`                                                                                          | **0 / 0 / 0 / 0**                                                                                                                      |
| #6 / #7 / #11         | CQRS handlers without prisma · no generated dedupe key · no raw `setInterval`                                                                             | **0 / 0 / 0**                                                                                                                          |
| #8 / #9 / #10 / #12   | no phase references · `@file` headers · valid `@layer` · `@component`                                                                                     | **0 / 0 / 0 / 0**                                                                                                                      |
| #13 / #14 / #16       | no direct `pino` · no per-class cache `Map` · no `process.env` outside `config/env.ts`                                                                    | **0 / 0 / 0**                                                                                                                          |
| #21 / #22 / #23 / #26 | no prisma singleton outside composition roots · no `@layer application` in apps/api · no raw queries · no `.js` in frontend                               | **0 / 0 / 0 / 0**                                                                                                                      |
| #32 / #34             | no committed `.only` / `.skip` · every `::error` pairs with a real failure (audit.yml was edited)                                                         | **0 / 0**                                                                                                                              |
| #38                   | soft-delete read coherence                                                                                                                                | **0 swept / 11 db-prisma** (baseline 11, unmoved)                                                                                      |
| #39                   | tenant enrollment                                                                                                                                         | **0** — unmoved, WITHOUT enrolling the ledger; see the adjudication above                                                              |
| #40                   | one transaction seam                                                                                                                                      | **A: 3 seams / 0 violations · B: 14 sites / 0 underived**                                                                              |
| #41                   | single-use claim shape                                                                                                                                    | **8 sites (floor 8), 1 exception hit, 0 violations**                                                                                   |
| #30                   | unreached suites                                                                                                                                          | **20** (baseline 21) — unmoved; every new suite is vitest-collected by an `include` glob, so none needs a `run_batch`                  |

`#37` is again not run, for the reason WU 1b.A and 1b.B-E both recorded: it is `pull_request`-only
and resolves its base through `git fetch`, which this batch is forbidden from running. Its subject
— the four coverage-threshold literals in `apps/api/vitest.config.ts` — is untouched here.

### Files touched

| Half   | File                                                                                                      | Action           | What                                                                                                                                                  |
| ------ | --------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1b2-i  | `packages/core/notifications/src/isTypeEnabled.ts`                                                        | Created          | the ONE per-type predicate; absence of a row means enabled, stated once                                                                               |
| 1b2-i  | `packages/core/notifications/src/CreateNotificationUseCase.ts`                                            | Modified         | calls the predicate instead of inlining it (`:64-71` gone)                                                                                            |
| 1b2-i  | `packages/core/notifications/src/SendEmailNotificationService.ts`                                         | Modified         | same refactor at `:37-41`; `EMAIL_ENABLED_TYPES` admits the new type with the reason it must                                                          |
| 1b2-i  | `packages/core/notifications/src/index.ts`                                                                | Modified         | exports `isTypeEnabled` and `SendEmailNotificationService` (the latter is about to gain its first production caller)                                  |
| 1b2-i  | `packages/core/domain/src/value-objects/NotificationType.ts`                                              | Modified         | the tenth value + `isUrgent()` as RANK only, with the "never a permission" rule in its JSDoc                                                          |
| 1b2-i  | `packages/core/notifications/tests/unit/isTypeEnabled.test.ts`                                            | Created          | 6 cases                                                                                                                                               |
| 1b2-i  | `apps/api/tests/unit/domain/notification.test.ts`                                                         | Modified         | +4 cases for the new type and the rank predicate                                                                                                      |
| 1b2-i  | `apps/api/tests/unit/application/sendEmailNotification.test.ts`                                           | Modified         | +2 cases: the allow-list admits the type, and the per-type opt-out still silences it                                                                  |
| 1b2-i  | `infra/prisma/schema.prisma` **(sensitive)**                                                              | Modified         | the enum value, `RetractionAlertMedium`, `RetractionAlertDelivery` — with the no-`accountId` reasoning in the model's own doc comment                 |
| 1b2-i  | `infra/prisma/migrations/20260919222448_add_retraction_alert_notifications/migration.sql` **(sensitive)** | Created          | timeout preamble, the anchored `ADD VALUE`, the enum, the table, both indexes                                                                         |
| 1b2-i  | `.../20260919222448_add_retraction_alert_notifications/down.sql` **(sensitive)**                          | Created          | the inverse, with the enum-label non-reversal and the rollback's own cost named                                                                       |
| 1b2-i  | `.github/workflows/audit.yml` **(sensitive)**                                                             | Modified         | ADJUDICATION 8 + its three arms (rules, digest, stale-name loop)                                                                                      |
| 1b2-i  | `infra/prisma/src/client.ts`                                                                              | Modified         | re-exports the model type and the medium enum                                                                                                         |
| 1b2-ii | `packages/core/domain/src/value-objects/AlertMedium.ts`                                                   | Created          | the medium vocabulary, the two KINDS, and the five delivery results                                                                                   |
| 1b2-ii | `packages/core/domain/src/value-objects/index.ts`                                                         | Modified         | barrel                                                                                                                                                |
| 1b2-ii | `packages/core/domain/src/repositories/RetractionAlertDeliveryLedger.ts`                                  | Created          | the ledger port; `claim` answers a boolean because a collision is not a failure                                                                       |
| 1b2-ii | `packages/core/domain/src/repositories/ExternalNotifierPort.ts`                                           | Modified         | `broadcast` PROMOTED from the dispatcher class to the port, with `BroadcastOptions`                                                                   |
| 1b2-ii | `packages/ports/src/RetractionAlertDeliveryPort.ts`                                                       | Created          | one medium's seam, the alert view, the targets                                                                                                        |
| 1b2-ii | `packages/ports/src/index.ts`                                                                             | Modified         | barrel                                                                                                                                                |
| 1b2-ii | `packages/core/notifications/src/retractionAlertMessage.ts`                                               | Created          | the pure message builder — the whole of AL-2, testable without a double                                                                               |
| 1b2-ii | `packages/core/notifications/src/RaiseRetractionAlertUseCase.ts`                                          | Created          | claims then delivers, per medium and per target                                                                                                       |
| 1b2-ii | `packages/core/notifications/src/ResolveRetractionAlertUseCase.ts`                                        | Created          | deletes exactly what the ledger names, rows last                                                                                                      |
| 1b2-ii | `packages/core/notifications/tests/unit/{raise,resolve}RetractionAlert.test.ts`                           | Created          | 19 + 7 cases                                                                                                                                          |
| 1b2-ii | `apps/api/src/infrastructure/adapters/{InApp,Email,SlackTeams}RetractionAlertDelivery.ts`                 | Created          | the three media                                                                                                                                       |
| 1b2-ii | `apps/api/src/infrastructure/adapters/RetractionAlertContextAdapter.ts`                                   | Created          | post excerpt, channel name, DERIVED provider, account name; degrades, never fails                                                                     |
| 1b2-ii | `apps/api/src/infrastructure/adapters/ExternalNotificationDispatcher.ts`                                  | Modified         | the `toEveryActiveConfig` branch; inactive configs filtered in ONE place                                                                              |
| 1b2-ii | `apps/api/src/infrastructure/adapters/TransactionalEmailAdapter.ts`                                       | Modified         | the new render case + the fragment reader                                                                                                             |
| 1b2-ii | `apps/api/src/infrastructure/email/templates/emailTemplates.tsx`                                          | Modified         | `retractionPendingEmail` — fragments with links, cause, action, deadline                                                                              |
| 1b2-ii | `apps/api/src/infrastructure/repositories/PrismaRetractionAlertDeliveryLedger.ts`                         | Created          | P2002 → `claimed: false`; any OTHER error rethrown                                                                                                    |
| 1b2-ii | `apps/api/src/notifications/RetractionAlertEventHandler.ts`                                               | Created          | binds the tenant from the payload, REFUSES an event that carries none                                                                                 |
| 1b2-ii | `apps/api/src/metrics/retractionAlertMetrics.ts`                                                          | Created          | the two series; the three not-delivered reasons stay distinct                                                                                         |
| 1b2-ii | `apps/api/src/infrastructure/container/{types,setupNotificationUseCases}.ts`                              | Modified         | 7 tokens + the whole wiring, incl. `SendEmailNotificationService`'s first registration                                                                |
| 1b2-ii | `apps/api/src/infrastructure/integration-events/EventSchemaRegistry.ts`                                   | Modified         | the two alert events at v1 (INTERNAL — validated on the way through, not projected outward)                                                           |
| 1b2-ii | `apps/api/src/index.ts`                                                                                   | Modified         | registers the handler for both event types beside the triage bridge                                                                                   |
| 1b2-ii | 8 `apps/api` unit suites                                                                                  | Created/Modified | the three adapter mirrors + fixtures, the dispatcher, the context adapter, the ledger, the handler, the metrics, the email adapter, the registry list |

**Sensitive paths written under the `sensitive-edit` token (4)**: `schema.prisma`, the two
migration files, `audit.yml`. Each was written with the Edit/Write tool so the hook saw it; none
was written through Bash.

### Deviations from design

Four, each reported rather than absorbed.

1. **The three media adapters live in `apps/api/src/infrastructure/adapters/`, not under
   `container/adapters/`.** design.md D17.4 and tasks T1b2.9 say "three adapters in the composition
   root", which this repo's canon means as INSTANTIATED there — and they are, in
   `setupNotificationUseCases.ts`. The files themselves sit beside `ExternalNotificationDispatcher`
   and `TransactionalEmailAdapter`, which is where notification media adapters already live; the
   `container/` tree wires, it does not host behaviour. (They were first written under
   `container/adapters/` following `NotificationDispatchAdapter`'s precedent, and relocated
   mid-batch on that reading.) Their suites mirror the source path exactly, as the repo's stop hook
   requires: `tests/unit/infrastructure/adapters/<File>.test.ts`.
2. **`AlertMedium` is defined in `@core/domain` and RE-EXPORTED from `@ports/core`.** D17.4 puts the
   union in `packages/ports`. Taken literally it is a dependency CYCLE: the ledger port lives in
   `@core/domain` and records a claim per medium, while `@ports/core` already depends on
   `@core/domain`. The vocabulary therefore lives in the domain and the port re-exports it, so the
   design's import surface (`AlertMedium` from `@ports/core`) still resolves.
3. **`deliver` returns `Result<AlertDeliveryOutcome, string>`, not `Result<void, string>`.** The
   in-app medium has to hand its `notificationId` back, or `attachNotification` cannot be fed and
   resolution loses its ability to delete exactly the notifications this alert created. The
   alternative was handing the ledger to the adapter, which couples a medium to the idempotency
   mechanism.
4. **A `RetractionAlertContextAdapter` was added.** The design says the use case gets the channel
   name and post excerpt "via the read model" without naming a seam. Putting the three lookups
   behind one adapter keeps the use case free of query repositories and keeps every suite under
   four doubles; the handler passes the resolved names in as input.

### Findings (not fixed here — each needs its own decision)

1. **The tenth type widens two request schemas the moment it exists.**
   `notificationRoutes.ts:43` builds its zod enums from `Object.values(NOTIFICATION_TYPES)`, so
   `NOTIFICATION_TYPES` is a public API surface, not only an internal union. That is convenient
   (the preference toggle 2b needs appears for free) and it is also why the type and the enum
   migration are inseparable. Worth stating in the 1b2 PR body so a reviewer does not read the
   schema edit as bookkeeping.
2. **`SendEmailNotificationService` is exported from the barrel for the first time.** It was
   reachable only by deep path before (`@core/notifications/SendEmailNotificationService.js`, which
   is how its own test imports it). The export is what lets the composition root register it in
   T1b2.9-.10; SMELL-41's other half — the four older types that still have no production email
   caller — stays open and untouched.
3. **`apps/api/tests/unit/domain/notification.test.ts` carries `@layer domain`.** It is a test, so
   the canon's mapping table says `infrastructure`. Fitness #10 accepts it (the value is one of the
   three legal ones), so this is a silent mis-tag rather than a gate failure, and it predates this
   change. Not corrected here: re-tagging somebody else's file would put an unrelated edit in the
   diff.
4. **FIXED by the corrections below — kept because the consequence was worse than first
   written.** **The email medium can never report `failed`, and the report says `delivered` for it
   regardless.** `SendEmailNotificationService.send` returns `void` and swallows every error by
   design ("email is a non-blocking side effect"), so the adapter has nothing to inspect. The
   consequence is precise: `retraction_alert_delivery_total{medium="email",result="failed"}` was
   unreachable, and a mailer outage showed up as `delivered`.
   **The consequence was worse than that sentence admitted, and the gate was right to flag it.**
   The claim is taken BEFORE the send, so a silently failed send left a CLAIMED ledger row: the
   redelivery then collided with it and sent nothing. The alert was not merely mis-counted — it was
   **permanently lost for that member**, while the counter read `delivered`.
   **Also measured while fixing it, and also wrong in the original line: "its four existing call
   paths" is FALSE.** `send` has exactly ONE production caller
   (`EmailRetractionAlertDelivery.ts:52`); the four figure came from `EMAIL_ENABLED_TYPES` holding
   four legacy types, none of which has any production email caller at all (that is SMELL-41's
   other half, still open). And the service did not only swallow THROWN errors — `NotificationMailer`
   reports failure as an `err` VALUE and the service discarded that too, so a provider answering in
   the canon-shaped way was ignored just as completely.
5. **The Slack/Teams fan-out can re-send after a config is ADDED between a raise and its
   redelivery.** The claim is per `(alertKey, medium, configId)`, so a redelivery claims only the
   NEW config — but the fan-out itself is `toEveryActiveConfig`, so the message reaches the old
   ones again. The narrow alternative (broadcasting per config id) would multiply every normal
   delivery instead, which is worse. Design residual, restated: per-medium delivery is best-effort
   by spec.
6. **FIXED by the corrections below.** **`RetractionAlertContextAdapter` degrades instead of
   failing.** An unreadable post yields `Post <id>` as the excerpt rather than suppressing the
   alert. That is deliberate — the obligation exists whether or not a title loads — but it meant a
   systematic read failure would produce a run of alerts naming ids instead of content, with
   nothing counting that.

### Corrections applied after the 1b2 gate (PASS WITH WARNINGS, same branch)

Gate verdict: PASS WITH WARNINGS, two warnings, both accepted and reworked rather than deferred.
The plan-mode guard blocked the first attempt at this round (a `workstream/*` branch with no recent
plan activity in the parent transcript); it was reported and cleared by the orchestrator rather
than routed around — in particular the hook's sub-30-line auto-pass was NOT used to slice the
edits through.

| #        | Correction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | RED (measured)                                                                                                                                                                                                                        | GREEN                               |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **W1.1** | `SendEmailNotificationService.send` returns `Result<void, NotificationDeliveryError>`; the empty catch is gone. New typed error `packages/core/domain/src/errors/NotificationDeliveryError.ts` carries the transport's own message — no existing domain error models "the outside world refused", and `InvariantViolationError` would have claimed an invariant broke when none did. A deliberate skip (off the allow-list, or the recipient's opt-out) stays `ok`, because reporting it as a failure would make a caller retry something nobody wants sent | `Tests 6 failed \| 8 passed (14)` — all six new cases fail against `Promise<void>`                                                                                                                                                    | `Tests 14 passed (14)`              |
| **W1.2** | `EmailRetractionAlertDelivery.deliver` maps `err` → the medium's `failed` outcome, so `retraction_alert_delivery_total{medium="email",result="failed"}` is now reachable for an OUTAGE and not only for a missing address                                                                                                                                                                                                                                                                                                                                   | `Tests 1 failed \| 5 passed (6)` — `AssertionError: a mailer outage was reported as a delivered alert`                                                                                                                                | `Tests 6 passed (6)`                |
| **W1.3** | `release` added to the ledger port and the Prisma repository; the raise use case RELEASES the claim of any medium that reports `failed`, per-member and for the whole claimed set of a failed shared fan-out. **Claim-first is kept** — it is the concurrency guard that stops two deliveries of one event from both sending; releasing on failure is what stops that guard from becoming a permanent loss                                                                                                                                                  | use case `Tests 2 failed \| 20 passed (22)` — `AssertionError: the failed member was never retried — the stale claim blocked the redelivery`; ledger `Tests 2 failed \| 7 passed (9)` — `TypeError: ledger.release is not a function` | `39 passed (39)` and `9 passed (9)` |
| **W2**   | `retraction_alert_context_degraded_total{field}` + a WARN log on every degraded path (post, channel, account; `malformed-id` and `unreadable` distinguished in the log)                                                                                                                                                                                                                                                                                                                                                                                     | metrics `TypeError: recordAlertContextDegraded is not a function`; adapter `Tests 3 failed \| 6 passed (9)` — `retraction_alert_context_degraded_total is not registered`                                                             | `13 passed (13)` across both        |

**A `delivered` medium is never released** — asserted as its own case, because releasing one would
hand the redelivery permission to send the same alert twice, which is the exact defect the ledger
exists to prevent. The shared fan-out releases only when the WHOLE call failed; a partial failure
never reaches that branch, since the adapter reports `ok` when at least one destination accepted.

**Two `override` modifiers were needed** on `NotificationDeliveryError` (`cause` narrows `Error`'s
own ES2022 `cause?: unknown`; `toJSON` extends the base's). The compiler caught both — `TS4114`,
three packages at once — before any test ran.

**Gates after the corrections**: `tsc --noEmit` **0** in `@core/domain`, `@core/notifications` and
`apps/api` · the 25 affected `apps/api` suites **270 passed** · `@core/notifications` **39/39** ·
eslint `--max-warnings 0` and prettier `-c` on every touched file **0** · fitness **#4 = 0** (the
new `err` paths are values, not throws) and **#32 = 0**.

### RDD receipt — the committed range 1b → 1b2 (2026-09-20)

Lineage `review-d1ca099a3e89ec06`, selected with `--base-ref cda2c7d4 --committed-only` (base tree
`7d81de6a`, candidate tree `2f70e718`): 54 paths / 5,209 lines, tier **high**, correction budget 200. The consent/v3 envelope was answered `granted` under Edward's standing rule for review
envelopes. Four lenses captured — risk, resilience, reliability, readability (the readability
capture closed the transaction). Terminal state **`approved`**; the exact `acknowledge-approved`
returned `gentle-ai.review-acknowledged/v1` with `authority: burned` (consumed revision
`1424f997…`). No correction was opened.

Two preflight refusals on the orchestrator's side, both retry-safe with nothing consumed: a
hand-typed STATUS carried a `--target` flag the command does not define, and two captures were
launched with empty tokens from a mis-scoped shell chain. The bound STATUS re-offered exactly the
two missing slots under a new revision and they were captured with the re-issued tokens.

**Advisory findings — 26, every one informational.** None opened a correction and none reopens
this review; they are recorded here so nothing stays hidden, and each is separate later work with
its own decision. Ids are the reviewer's.

| Id                                             | Lens        | Severity   | Location                                                                                        |
| ---------------------------------------------- | ----------- | ---------- | ----------------------------------------------------------------------------------------------- |
| R1-001                                         | risk        | SUGGESTION | `packages/core/domain/src/repositories/RetractionAlertDeliveryLedger.ts:1-96`                   |
| R1-002                                         | risk        | SUGGESTION | `apps/api/src/infrastructure/adapters/SlackTeamsRetractionAlertDelivery.ts:52-79`               |
| R1-003                                         | risk        | SUGGESTION | `apps/api/src/notifications/RetractionAlertEventHandler.ts:104-140`                             |
| R2-CAUSE_SENTENCES-duplicated                  | readability | WARNING    | `apps/api/src/infrastructure/email/templates/emailTemplates.tsx:434-437`                        |
| R2-EXCERPT-LIMIT-unexplained                   | readability | SUGGESTION | `apps/api/src/infrastructure/adapters/RetractionAlertContextAdapter.ts:41`                      |
| R2-P2002-hardcoded-string                      | readability | SUGGESTION | `apps/api/src/infrastructure/repositories/PrismaRetractionAlertDeliveryLedger.ts:47-55`         |
| R2-RETRACTION_PENDING_EVENT-literal-duplicated | readability | SUGGESTION | `apps/api/src/infrastructure/adapters/SlackTeamsRetractionAlertDelivery.ts:31`                  |
| R2-STORED_MEDIUM-brittle-mapping               | readability | WARNING    | `apps/api/src/infrastructure/repositories/PrismaRetractionAlertDeliveryLedger.ts:29-37`         |
| R2-duplicated-fragment-reader                  | readability | WARNING    | `apps/api/src/notifications/RetractionAlertEventHandler.ts:50-63`                               |
| R2-import-after-code-block                     | readability | WARNING    | `apps/api/src/infrastructure/adapters/TransactionalEmailAdapter.ts:67`                          |
| R2-magic-timeout-literal-duplicated            | readability | SUGGESTION | `infra/prisma/migrations/20260919222448_add_retraction_alert_notifications/migration.sql:35-36` |
| R2-projectId-fallback-silent                   | readability | WARNING    | `apps/api/src/notifications/RetractionAlertEventHandler.ts:132`                                 |
| R2-retractionPendingEmail-forward-reference    | readability | SUGGESTION | `apps/api/src/infrastructure/email/templates/emailTemplates.tsx:396-411`                        |
| R3-account-fallback-may-widen-recipients       | reliability | SUGGESTION | `packages/core/notifications/src/RaiseRetractionAlertUseCase.ts:157-165`                        |
| R3-context-adapter-throws-not-degrades         | reliability | WARNING    | `apps/api/src/infrastructure/adapters/RetractionAlertContextAdapter.ts:71-77`                   |
| R3-handler-swallows-context-throws             | reliability | WARNING    | `apps/api/src/notifications/RetractionAlertEventHandler.ts:135-165`                             |
| R3-in-app-broadcast-failure-swallowed          | reliability | WARNING    | `apps/api/src/infrastructure/adapters/InAppRetractionAlertDelivery.ts:82-101`                   |
| R3-provider-string-coercion-loses-fidelity     | reliability | SUGGESTION | `apps/api/src/infrastructure/adapters/RetractionAlertContextAdapter.ts:126`                     |
| R3-release-on-broadcast-exception-missing      | reliability | WARNING    | `packages/core/notifications/src/RaiseRetractionAlertUseCase.ts:206-244`                        |
| R3-resolve-nonatomic-partial-crash             | reliability | SUGGESTION | `packages/core/notifications/src/ResolveRetractionAlertUseCase.ts:60-73`                        |
| R3-shared-fanout-partial-failure-lost          | reliability | WARNING    | `packages/core/notifications/src/RaiseRetractionAlertUseCase.ts:271-289`                        |
| R4-context-adapter-no-timeout                  | resilience  | SUGGESTION | `apps/api/src/infrastructure/adapters/RetractionAlertContextAdapter.ts:66-72`                   |
| R4-handler-drops-shared-when-no-recipients     | resilience  | WARNING    | `apps/api/src/notifications/RetractionAlertEventHandler.ts:150-160`                             |
| R4-in-app-broadcast-swallowed                  | resilience  | WARNING    | `apps/api/src/infrastructure/adapters/InAppRetractionAlertDelivery.ts:86-99`                    |
| R4-listbyalertkey-unbounded                    | resilience  | SUGGESTION | `apps/api/src/infrastructure/repositories/PrismaRetractionAlertDeliveryLedger.ts:129-140`       |
| R4-raise-partial-shared-orphan-claims          | resilience  | WARNING    | `packages/core/notifications/src/RaiseRetractionAlertUseCase.ts:249-278`                        |

**Proposed disposition (Edward decides; nothing here is applied).** The reliability and resilience
WARNINGs that describe a thrown exception leaving a CLAIMED ledger row behind — release missing on
a broadcast exception, a shared fan-out partial failure lost, orphan claims on a partial shared
raise, the in-app broadcast failure swallowed, the handler swallowing context throws and dropping
the shared media when there are no recipients — are the same class as gate correction W1 (a failure
that is not reported is a claim that is never released, and a claim never released is an alert
lost). They belong in one bounded follow-up on this branch before the tracker merges. The readability
findings and the remaining suggestions are backlog rows.

### Hardening after the 1b2 RDD review (advisory WARNINGs) — `acf91453`

The RDD receipt above lists THIRTEEN WARNING rows. The in-app finding appears under two lenses, so
there are **twelve distinct WARNINGs — eleven fixed, one rejected** — plus one SUGGESTION
(`R3-account-fallback-may-widen-recipients`) rejected with proof. They were taken as one slice on
this branch rather than deferred, because seven of them are ONE class, and it is the class gate
correction W1 opened: **a failure that is not reported is a ledger claim that is never released,
and a claim never released is an alert lost forever.** The rework is therefore in the protocol,
not at the sites.

**Class A — the protocol** (`RetractionAlertDeliveryPort`, `AlertMedium`, `ExternalNotifierPort`,
`RaiseRetractionAlertUseCase`, `SendEmailNotificationService`, the dispatcher, the three media
adapters, the context adapter, the metrics). **Class B — readability** (`retractionAlertMessage`,
`readAlertFragments`, the notifications barrel, `TransactionalEmailAdapter`, the Prisma ledger,
`emailTemplates`). `RetractionAlertEventHandler` carries both.

| Id                                                      | Disposition                | What changed                                                                                                                                                                                                            | RED evidence                                                                                                                                                                         |
| ------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `R3-release-on-broadcast-exception-missing`             | FIXED (A)                  | The port STATES that `deliver` must not throw and the use case ENFORCES it at the seam (`attempt()`): a thrown medium becomes `err`, its claim is released, its target reads `failed`, and the media after it still run | `Tests 6 failed \| 24 passed (30)` — `one medium breaking its contract must not fail the raise`                                                                                      |
| `R3-shared-fanout-partial-failure-lost`                 | FIXED (A)                  | The fan-out is SCOPED to the claimed destinations (`toConfigIds`) and reports `sentConfigIds`/`failedConfigIds`; the adapter derives unreached as `targets − sent`, and the use case releases exactly those claims      | `a destination nobody reached was counted as delivered`; later `a caller retrying ONE destination reached its siblings too, telling them twice`                                      |
| `R4-raise-partial-shared-orphan-claims`                 | FIXED (A)                  | Same rework. A redelivery now reaches exactly the destination that was missed — end to end, not only in the argument list                                                                                               | `the fan-out was not scoped to the claimed destination, so a retry re-sends to its siblings`                                                                                         |
| `R3-in-app-broadcast-failure-swallowed`                 | FIXED (A)                  | Decided with evidence: the STORED ROW is the delivery, the live push is an accelerator. A failed push is counted (`retraction_alert_realtime_push_failed_total`), WARN-logged, and KEEPS its claim                      | `a failed push released the ledger claim, so the redelivery will create a SECOND row`                                                                                                |
| `R4-in-app-broadcast-swallowed`                         | FIXED (A)                  | Same decision; the push can no longer destroy the run                                                                                                                                                                   | `retraction_alert_realtime_push_failed_total is not registered`                                                                                                                      |
| `R3-handler-swallows-context-throws`                    | FIXED (A+B)                | The handler propagates a processing failure so the outbox redelivers; only a structurally invalid payload is refused, and every refusal is COUNTED by `retraction_alert_refused_total{reason}`                          | `Missing expected rejection: the failure was logged and swallowed, so the relay marks the event published and the alert is lost`; `retraction_alert_refused_total is not registered` |
| `R3-context-adapter-throws-not-degrades`                | FIXED (A)                  | `attemptRead` makes a thrown read degrade on the same path as a refused one, `unreadable` and `unreachable` distinguished in the log, counted alike                                                                     | `Error: the connection pool is exhausted` ×4                                                                                                                                         |
| `R4-handler-drops-shared-when-no-recipients`            | **REJECTED — not present** | The medium loop runs the shared fan-out independently of the recipient set. Pinned by `delivers to the active config when the project has ZERO recipients` and `raises the alert even when the project has NO member`   | both pass unmodified; spec §Delivery ("delivery SHALL happen even when NO member has the type enabled") satisfied                                                                    |
| `R2-STORED_MEDIUM-brittle-mapping`                      | FIXED (B)                  | `Record<AlertMedium, RetractionAlertMedium>` against the generated enum, imported as a TYPE (a value import breaks the unit tier's vitest entry)                                                                        | planted drift `"SLACK_TEAM"` → `error TS2418`; restored byte-exact (`sha256sum -c` OK)                                                                                               |
| `R2-projectId-fallback-silent`                          | FIXED (B)                  | The `?? ""` is gone; project joins channel in one refusal rule, and the refusal is counted                                                                                                                              | `expected "vi.fn()" to not be called at all, but actually been called 1 times`                                                                                                       |
| `R2-duplicated-fragment-reader`                         | FIXED (B)                  | ONE `readAlertFragments` in `@core/notifications`, used by the handler and the email adapter                                                                                                                            | `Cannot find module '../../src/readAlertFragments.js'`                                                                                                                               |
| `R2-import-after-code-block`                            | FIXED (B)                  | Not a lazy import: it sat after a function block that is now deleted                                                                                                                                                    | safety net — the adapter's own suite                                                                                                                                                 |
| `R2-CAUSE_SENTENCES-duplicated`                         | FIXED (B)                  | `describeRetractionCause` exported from the message builder; the email test asserts against that function, not a literal                                                                                                | `TypeError: describeRetractionCause is not a function`                                                                                                                               |
| `R3-account-fallback-may-widen-recipients` (SUGGESTION) | **REJECTED — proven**      | The account query is never called while the project has members, and the fallback is called with the EVENT's `accountId` under `withTenantContext`. Design D17 §5 mandates it                                           | both new cases pass on the unmodified use case                                                                                                                                       |

**Corrections applied after the fresh gate of this slice (PASS WITH WARNINGS) and its re-gate.**

| #      | Correction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | RED                                                                                                                                                                                       | GREEN                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **W1** | The shared fan-out is TARGET-SCOPED. `BroadcastOptions.toEveryActiveConfig` is replaced by `toConfigIds` (one selector, not two — the flag had exactly one caller), `BroadcastReport` returns `sentConfigIds`/`failedConfigIds` instead of counts, and the adapter derives unreached from what was REACHED. The release protocol no longer buys its retry with a duplicate: a redelivery that claimed only the missed destination reaches that one alone. A config deactivated between claim and send becomes unreached and released; the unattributable-refusal guard is deleted; an id outside the claimed set cannot enter the answer by construction                                                                                                                                                                        | `Tests 14 failed \| 5 passed (19)` — `a caller retrying ONE destination reached its siblings too, telling them twice`                                                                     | `19 passed (19)`           |
| **W2** | `AlertDeliveryReportEntry.reason`; `settle` carries each target's reason; the handler WARNs one line per FAILED entry with `{medium, target, reason}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `Tests 3 failed \| 32 passed (35)`; handler `no warning was logged; levels were info`                                                                                                     | `56 passed`, handler green |
| **W4** | `retraction_alert_refused_total{reason}` — one increment per refused event, labelled by the first missing field                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `retraction_alert_refused_total is not registered` ×5                                                                                                                                     | 5 cases green              |
| **W5** | A target the medium DECLINED to send to is neither delivered nor failed: `AlertTargetSuppression` + `suppressedTargets`, documented as port rule 4. It reports `suppressed-by-preference` (the existing value — the skip IS the per-type preference, so no fourth vocabulary word) and **RELEASES its claim**, exactly as the use case's own `typeOn` suppression never claims: nothing was written, so nothing is owed, and a member who switches the type back on is reached by the next redelivery. Safe by rule 3 — with no durable artifact a redelivery either suppresses again or delivers once. The release condition is now ONE rule (a claim is kept only where a durable artifact exists), which removed a branch from `settle`                                                                                      | `a target nothing was sent to was counted as delivered`; then `a member who was not sent to kept a claim nothing owes, so re-enabling the preference could never reach them`              | `57 passed` / `31 passed`  |
| **W9** | Counts corrected: 13 WARNING rows → 12 distinct (in-app appears twice) → 11 fixed + 1 rejected; the account-fallback finding is a SUGGESTION                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | —                                                                                                                                                                                         | —                          |
| **R2** | The email medium did not honour rule 4: `SendEmailNotificationService.send` answered `ok(undefined)` for both skip paths, so a skipped email was byte-identical to a sent one and the member was reported DELIVERED with the claim STANDING. `send` now returns `Result<EmailSendOutcome, …>` whose two reasons ARE the report's own `suppressed-by-preference` / `unavailable`; the adapter maps the recipient's opt-out to `suppressedTargets` (claim released, as in-app) and the allow-list skip to `err` (our gap, not the customer's answer; unreachable today, written out so removing the type from the allow-list goes loudly red). One production caller, measured. The use-case-level pin through the email double passed on arrival: `settle`/`entryFor` are medium-agnostic, so rule 4 is a per-ADAPTER obligation | `sendEmailNotification.test.ts` 3 failed / 14 passed (`TypeError: … reading 'sent'`); `EmailRetractionAlertDelivery.test.ts` 2 failed / 7 passed (`… reading 'SUPPRESSED_BY_PREFERENCE'`) | `60 passed` / `48 passed`  |
| **R3** | Port JSDoc said "The contract, in three rules" above four; corrected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | —                                                                                                                                                                                         | —                          |
| **R4** | The handler compared the bare literal `"failed"`; it compares `ALERT_DELIVERY_RESULTS.FAILED` now, so a value rename cannot disable the WARN in silence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | —                                                                                                                                                                                         | —                          |
| **R5** | `deliverShared`'s two early exits emitted report lines with no `target` and no `reason`; both name the project and say why (the repository's own message; "the project has no active destination of this kind"), and the handler's WARN omits keys it has no value for                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | use case `Tests 2 failed \| 37 passed (39)`; handler `1 failed \| 21 passed (22)`                                                                                                         | green                      |

**The misleading test and the misleading sentence, both addressed.** `retries ONLY the unreached
destination on a redelivery` asserted an end-to-end property against a double the shipped adapter
discarded — "parece proteger y no protege". It is renamed to `HANDS the medium only the
destinations this run claimed, so a redelivery names just the missed one`, and the adapter and
dispatcher suites hold the end-to-end pins. The adapter's "and nothing else" sentence is KEPT,
because after W1 it is true end to end (three hops, each pinned).

**Behaviour changes, stated.** A retraction alert event can now DEAD-LETTER after the relay's
retries (before: marked published and lost in silence) — T1c.18 carries its rule. A payload with no
`projectId` is refused and counted instead of delivered to account members (producer-defect-only:
`emitAlertTransition` emits `projectId` unconditionally); `accountId` is conditional there, so
`missing-tenant` is the refusal that is reachable by construction — 1c owns the producer question.
The API's shared destinations are now reached only through the claimed config ids.

Gates after the slice — `tsc --noEmit` exit 0 in `@ports/core`, `@core/domain`,
`@core/notifications`, `@core/external-notifications`, `apps/api` · eslint `--max-warnings 0` and
`prettier --check` exit 0 on every touched file · `@core/notifications` 60/60, `@core/domain`
184/184, the touched `apps/api` suites green (12 files / 122 at the re-gate; the email trio 48/48
after R2–R5), `apps/api` unit tier 585 files / 9101 before the gate corrections · fitness #4 = 0,
#32 = 0, #3/#8/#9/#10/#13 = 0. Measured by numstat: **CODE 933 / EVIDENCE 1,165** — over the
400-line CODE ceiling and recorded for Edward's ratification rather than sliced: the port change,
its implementers, the dispatcher and the use case cannot be split without an uncompilable
intermediate, and the class was fixed once rather than at seven sites.

**Backlog rows this opens (with evidence):** (1) `missing-tenant` is reachable by construction
(`PostPublicationEvents.ts:85-106`) — pre-existing, previously invisible, now counted; 1c owns
the producer question. (2) A per-medium `failed` is released but not force-retried (forcing a
retry per target would dead-letter every alert event over one member with no email address);
D17.5's "redelivery = the outbox's at-least-once meeting a released claim" is unchanged, now
stated at the seam. (3) `CreateNotificationUseCase` signals "skipped" with a sentinel `""` id
whose UoW branch gives it a second possible meaning. (4) Two new series have no Prometheus rule
(`retraction_alert_realtime_push_failed_total`, `retraction_alert_refused_total`) — T1c.18. (5)
Neither `apps/api/tsconfig.json` nor `packages/core/notifications/tsconfig.json` includes
`tests/**`, so no `tsc` in this repo type-checks the unit suites; vitest strips types without
checking them.

### RDD receipt — the committed hardening range `fcddefa8` → `acf91453` (2026-09-20)

Lineage `review-5cddd3d1b371834e`, selected with `--base-ref fcddefa8 --committed-only` over the
hardening commit (28 paths / 2,098 lines, tier **medium**, one `review-reliability` slot).
Consent/v3 answered `granted` under Edward's standing rule. Terminal state **`approved`**; the
exact `acknowledge-approved` returned `gentle-ai.review-acknowledged/v1` with
`authority: burned`. No correction was opened. Six advisory findings, recorded here: three
WARNINGs — `R3-refused-counter-double-inc-project` (`RetractionAlertEventHandler.ts:114-132`),
`R3-context-adapter-throw-catches-all` (`RetractionAlertContextAdapter.ts:71-78`),
`R3-shared-medium-hides-failed-target-reason` (`SlackTeamsRetractionAlertDelivery.ts:76-111`) —
taken as a follow-up work unit on this branch (below), and three SUGGESTIONs —
`R3-attempt-swallows-throw-details-partial` (`RaiseRetractionAlertUseCase.ts:196-221`),
`R3-email-recipient-id-vs-address` and `R3-inapp-realtime-broadcast-signature-double` (two test
doubles whose signatures drift from production) — backlog.

### Follow-up after the range review — `1dab4984`

| Id                                            | Disposition                   | What changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Evidence                                                                                                                                                                                                              |
| --------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `R3-refused-counter-double-inc-project`       | **REJECTED — false positive** | The refusal counter cannot double-count: the two sites are mutually exclusive by construction (the first `return`s before `withTenantContext`, so the second — inside `raise()` — is unreachable for the same event); `resolve()` holds no refusal counter; `withTenantContext` is a bare `AsyncLocalStorage.run`; `InMemoryEventDispatcher.dispatch` keys handlers by `eventType`, one registration per type, one `handle` call; `recordAlertRefused` is a single `inc` on a get-or-create counter                                                                                                                                                                                                                                                                                                         | Probed with 9 refused events across both branches, including three payloads missing fields from both rules: counter total 9. The probe stays as the regression pin, stating the metric's own help text                |
| `R3-context-adapter-throw-catches-all`        | FIXED                         | `attemptRead` caught everything, so a `TypeError` from a bad refactor reported as `unreachable` and every alert degraded to an identifier while the defect hid in a WARN. It now degrades on an ALLOWLIST of store-failure shapes (Prisma client class names except `PrismaClientValidationError`, `/^P\d/` codes, eight Node connection codes — duck-typed like `handleAnyError` and `classifyPersistenceFailure`, the repo's two existing classifiers; no ORM import) and propagates anything else after an ERROR log with the stack. Verified end to end: no ledger claim is taken before this read, the handler propagates so the outbox redelivers, `OutboxRelay` dead-letters with the message at `maxRetries`. Residual in the JSDoc: Prisma names and codes by value, failing in the safe direction | RED `2 failed \| 16 passed (18)` — `Missing expected rejection` for a programming error and for a malformed query; GREEN `18 passed`. The `exploding()` double now carries `code: "P1001"` instead of posing as a bug |
| `R3-shared-medium-hides-failed-target-reason` | FIXED                         | The dispatcher held each refusal's `result.error` and pushed only the id, so a revoked webhook token reached the operator as "no longer an active config". `BroadcastReport.failedConfigIds: string[]` is now `failedConfigs: BroadcastFailure[]` carrying `{ id, reason }` (renamed — a field named for ids must not hold records); the dispatcher fills the reason from the channel adapter; the Slack/Teams medium carries it into `failedTargets`, keeping the specific sentence for a config that stopped being a destination (unreached is still DERIVED from `sentConfigIds`, so that case cannot be lost). Both ends pinned: the dispatcher's reason and the report line                                                                                                                            | RED `6 failed` — `+ 'the destination is no longer an active config of this project' − '403 invalid_token'`; GREEN dispatcher + Slack 21, `@core/notifications` 61                                                     |

Gates — four `apps/api` suites in one invocation 62/62 · `@core/notifications` 61/61 · tsc 0 in
`@core/domain`, `@core/notifications`, `apps/api` · eslint `--max-warnings 0` and prettier 0 ·
fitness #4 = 0, #32 = 0. Measured: CODE 164 / EVIDENCE 185. Discovery worth a line: the repo has
no shared infrastructure-error predicate — the convention is duck-typing on `.code` in two places;
`isStoreFailure` is the first and is deliberately local to the adapter.

### RDD receipt — the follow-up commit `acf91453` → `1dab4984` (2026-09-20)

Lineage `review-325ed17f72284498`, selected with `--base-ref acf91453 --committed-only` over the
follow-up commit (9 paths / 349 lines, tier **medium**, one `review-reliability` slot).
Consent/v3 answered `granted` under Edward's standing rule. Terminal state **`approved`**; the
exact `acknowledge-approved` returned `gentle-ai.review-acknowledged/v1` with
`authority: burned`. No correction was opened and no advisory finding was left. With this
receipt, every code commit of the hardening on both branches carries a burned committed-range
review: 1b `cda2c7d4 → 57430ca4`, 1b2 `fcddefa8 → acf91453` and `acf91453 → 1dab4984`.

---

## PR 1c — grandchild `1c-1a` (T1c.4a) — COMPLETE

Branch `workstream/ncor8-1c`, child of `workstream/ncor8-1b2` @ `e6d734b1`. One task, the D19
doors: the mapper's input type, the five cast deletions, the four unconsumed list loaders and
their orphaned machinery, and the two scope refusals. Landed in the **authorised (deletion)**
form — Edward authorised it on 2026-09-20 and extended the authorisation to "cualquier artefacto
asociado que carezca de una funcionalidad real", so D19 (b)'s declined-branch `PostListItem`
fallback was never a branch here.

**Finish state**: no object that answers `isEditable`, `hasLiveContent()`, `redrivable()` or
`derive()` can be produced from a load without the per-channel records — the mapper's parameter
type is the payload of the one include, so a query issued without it does not compile. A
publication write without a tenant, or under the system sentinel, is refused before any
statement.

### What each mechanism is, as built

| Mechanism             | As built                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (i) input type        | `POST_AGGREGATE_INCLUDE` exported from `PostAggregateMapper.ts`, `as const satisfies Prisma.PostInclude`; `PrismaPostWithRelations` is now `Prisma.PostGetPayload<{ include: typeof POST_AGGREGATE_INCLUDE }>`, still exported from the package barrel at **`packages/adapters/db-prisma/src/index.ts:54`** (the design cites `:48`; as built it is `:54`, and the citation is corrected HERE rather than in the design) — the optional `channelPublications?` and the `?? []` are gone |
| (ii) casts            | all five `as PrismaPostWithRelations` deleted; `findById` passes the const to `findFirst`                                                                                                                                                                                                                                                                                                                                                                                               |
| (iii) loaders         | `findByProjectId`, `findByStatus`, `findReadyForPublishing`, `findWithFilters` deleted from the port and the adapter, from **TEN** stubbing test files (tasks.md names nine; the tenth is below) and from the two adapter suites' describes                                                                                                                                                                                                                                             |
| (iii-b) sweep         | seven orphaned adapter artefacts deleted, measured — table below                                                                                                                                                                                                                                                                                                                                                                                                                        |
| (iv) `findById`       | resolves `resolveGucScope(this.tenantProvider)` BEFORE the query and throws the guard's own `TenantContextMissingError("Post", "findFirst")` on `undefined`; `__system__` is ADMITTED                                                                                                                                                                                                                                                                                                   |
| (v) `savePublication` | refuses `undefined` AND `SYSTEM_TENANT_SCOPE` with `err(InvariantViolationError)` before `savePublicationRecord` — zero statements, no transaction. The fitness #40 Part B token is untouched and sits at **`PrismaPostRepository.ts:142`** as built (`withGucBoundTransaction(this.prisma, resolveGucScope(this.tenantProvider), statements)`; the design cites `:121`, which was its pre-change line)                                                                                 |

### The recorded reds

**(e) the runtime RED on the list path — recorded DELIBERATELY, restored sha256-exact.** The
design predicted `[...undefined]` at `PostAggregate.ts:154`. Measured, the throw lands one frame
EARLIER: the mapper is the first consumer of the absent relation, so its own `for…of` raises
before the root's spread is reached. Same class, stricter site — stated rather than smoothed over.

Two further corrections to the design's recipe, both measured:

1. Removing ONLY `PostAggregate.ts:154`'s default was not enough — the run stayed green, because
   the mapper's `?? []` fills `state.publications` with `[]` before the root ever sees it. BOTH
   defaults had to go for `undefined` to reach anything.
2. `PrismaPostRepository.test.ts`'s `basePostRow()` carries `channelPublications: []`, so the
   suite's own `findByStatus` case could not produce the state either: its double returns the key
   the production include never requested. The red was therefore recorded against a double that
   returns exactly what `findByStatus`'s include block yields — a row with no such key — in a
   temporary file deleted immediately afterwards.

```text
 FAIL  tests/unit/infrastructure/ncor8RedE.test.ts > D19 (e) — the list loader maps a load without the records
TypeError: prismaPost.channelPublications is not iterable
 ❯ PostAggregateMapper.reconstitute ../../packages/adapters/db-prisma/src/post/PostAggregateMapper.ts:406:34
 ❯ PostAggregateMapper.toDomain ../../packages/adapters/db-prisma/src/post/PostAggregateMapper.ts:303:39
 ❯ PrismaPostRepository.findByStatus ../../packages/adapters/db-prisma/src/post/PrismaPostRepository.ts:313:25
```

The fail-open half is recorded too, and it is the half that matters: with both defaults in place
that SAME row mapped to `publications: []` and the test asserting `publications.size === 0`
PASSED — a post whose records were never loaded reading as a post with no records.

Restored: `packages/core/domain/src/aggregates/PostAggregate.ts`
`e2c6a3be0cc7809fe8669bb9ed840c0cd453bed3dcc471b6e139be5c1c928db9` and
`packages/adapters/db-prisma/src/post/PostAggregateMapper.ts`
`bd9a33fbc1a7a50c0ec4b27cb446bfce16518a4140f2cb440e1bed903b815022`, both byte-identical to the
pre-edit hashes; the temporary recorder file was deleted and never entered the diff.

**(d) the compile RED — exactly what D19 predicted.** After (i) and (ii) and BEFORE (iii),
`tsc -p packages/adapters/db-prisma` refused the four list loaders and passed `findById`:

```text
src/post/PrismaPostRepository.ts(308,65): error TS2345: Argument of type '{ media: …; contents: …;
  contentVersions: …; } & { … }' is not assignable to parameter of type '{ media: …;
  channelPublications: ({ … } & { … })[]; contents: …; contentVer…'.
  Property 'channelPublications' is missing in type '…' but required in type '…'.
src/post/PrismaPostRepository.ts(346,65): error TS2345: … (findByStatus)
src/post/PrismaPostRepository.ts(372,58): error TS2345: … (findReadyForPublishing)
src/post/PrismaPostRepository.ts(405,65): error TS2345: … (findWithFilters)
```

The `as const` is what makes that error exist: the property stayed REQUIRED instead of dissolving
into a union of payload variants. No assertion was added to silence it — the loaders were deleted.

**(a) / (c) the behavioural RED**, recorded before the refusals were written:

```text
 ❯ tests/unit/infrastructure/PrismaPostRepository.test.ts (74 tests | 3 failed)
   × refuses a load with neither a tenant nor a system context, issuing no statement
     AssertionError: promise resolved "{ ok: true, …(1) }" instead of rejecting
   × refuses a write with no tenant scope, opening no transaction
     AssertionError: expected true to be falsy
   × refuses a write under the system scope, opening no transaction
     AssertionError: expected true to be falsy
```

**(b) is an APPROVAL case, declared as such.** The system-scoped load already carried the include,
so the case was green on arrival. That is what D19 asked for — the FULL hydration pinned as
MEASURED behaviour, not assumed — and it is characterization, not a red-then-green cycle. Its
tenant-scoped twin was added as the triangulating second admit branch (`getSystemContext` vs
`getTenantContext` are different arms of `resolveGucScope`).

### Associated-artefact sweep (iii-b) — every artefact measured, none guessed

Method: `rg` over `{apps,packages,infra}/**/src/**/*.ts` excluding `node_modules`, `dist`,
`.next`, `.stryker*`. Module-private constants and `private` methods are additionally
structurally unreachable from outside their file, so their in-file count IS their consumer count.

| Artefact                                                                                                                                     | Consumers measured                                                                                                                                                                                                                                                        | Disposition                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PostRepository.findByProjectId/findByStatus/findReadyForPublishing/findWithFilters` (port)                                                  | 0 production call sites — every `findByProjectId(` hit in `src/**` is on another repository (campaigns, channels, external configs, customer users, reports, images, recurring, analytics, tracked links); the other three names appear ONLY on this port and its adapter | **DELETED**                                                                                                                                                                                                                            |
| `PrismaPostRepository.normalizePagination`                                                                                                   | 1 in-file occurrence after the loaders left = its own declaration                                                                                                                                                                                                         | **DELETED**                                                                                                                                                                                                                            |
| `PrismaPostRepository.buildOrderBy`                                                                                                          | 1 (declaration only)                                                                                                                                                                                                                                                      | **DELETED**                                                                                                                                                                                                                            |
| `PrismaPostRepository.buildWhereClause`                                                                                                      | 1 (declaration only). The five other files holding that name declare their OWN private copies                                                                                                                                                                             | **DELETED**                                                                                                                                                                                                                            |
| `PrismaPostRepository.buildPaginatedResult`                                                                                                  | 1 (declaration only)                                                                                                                                                                                                                                                      | **DELETED**                                                                                                                                                                                                                            |
| `DEFAULT_PAGE` / `DEFAULT_LIMIT` / `MAX_LIMIT` (module consts)                                                                               | 2 each = declaration + the one use inside `normalizePagination`                                                                                                                                                                                                           | **DELETED** with it                                                                                                                                                                                                                    |
| type imports `PostFilterCriteria`, `PostSortField`, `PaginationParams`, `PaginatedResult`, `SortParams` in the adapter                       | 1 each (the import line)                                                                                                                                                                                                                                                  | **import removed** from the adapter — the types themselves are KEPT                                                                                                                                                                    |
| `PostFilterCriteria` / `PostSortField` / `PaginationParams` / `PaginatedResult` / `SortParams` (the types in `@core/domain`)                 | LIVE — `PostQueryRepository.listByProject`, `search`, `getUpcoming`, `listGlobal`                                                                                                                                                                                         | **KEPT and NAMED**                                                                                                                                                                                                                     |
| `PrismaPostChannelPublicationWithChannel`                                                                                                    | LIVE — `toChannelPublication`'s parameter                                                                                                                                                                                                                                 | **KEPT and NAMED**                                                                                                                                                                                                                     |
| `PrismaPostWithRelations` (the exported name)                                                                                                | LIVE — the package barrel exports it and the 1b ledger's reasoning stands                                                                                                                                                                                                 | **KEPT**, re-typed as the payload alias                                                                                                                                                                                                |
| `apps/api/tests/unit/cqrsIntegration.test-helpers.ts` (the WHOLE file)                                                                       | **0 importers, tree-wide** — and it is not collected either (`vitest.config.ts` collects `*.test.ts`, this is `.test-helpers.ts`)                                                                                                                                         | **REPORTED, NOT DELETED.** Only its four loader stubs were removed. A whole orphan file is outside the authorisation's subject (the four methods) and "orphan ≠ delete" is the standing rule; it needs its own report-authorise-delete |
| `apps/api/tests/unit/unitOfWork.useCases.test.ts:46` — `createMockPostRepo(): PostRepository` carrying `findByProjectId: async () => ok([])` | **the TENTH stub file**, missed by the first pass. Caught by the fresh-context gate, not by any tool                                                                                                                                                                      | **DELETED** (suite re-run: **4/4**)                                                                                                                                                                                                    |

**Why the tenth hid, and the rule it forces.** Two mechanisms, both measured. The literal ends in
`as PostRepository`, which turns EXCESS-PROPERTY checking off, so a member the port no longer
declares is not an error — the stub did not even return the port's shape (`ok([])` where the deleted
method declared `PaginatedResult<PostAggregate>`), and that was not an error either. And nothing
typechecks the file at all: `apps/api/tsconfig.json` includes `src` only, and
`tsconfig.type-tests.json` opens only `tests/**/*.type-test.ts`. **`tsc` = 0 proves nothing about
doubles.** For any port NARROWING, an `rg` over `**/tests/**` for EACH deleted member name is
MANDATORY, not optional — it is the only instrument that sees them. Run here afterwards:
`findByStatus`, `findReadyForPublishing` and `findWithFilters` return **zero** hits tree-wide, and
every surviving `findByProjectId` belongs to another repository (channel, analytics, tracked link,
recurring, campaign, external-notification, customer-user, generated-image, project-member,
ai-image, providers) — including `PostCommandHandlers.test-helpers.ts:287` and
`sagaIntegration.helpers.ts:320`, both `MockChannelRepository`, both correctly left alone.

Two doc claims that the deletion falsified were rewritten rather than left standing: the
`toDomain` JSDoc's "the MEDIA refusal is wider … rejects the WHOLE PAGE from those four"
paragraph (the blast radius is now uniformly per-post, because `findById` is the only read that
reaches the mapper), and `PostQueryRepository.listByProject`'s "the same criteria shape used by
the command-side `findWithFilters`". The port's interface doc gained the reason the four are gone,
so a future contributor re-adding them meets the argument instead of the absence.

### Two divergences the change surfaced — both measured, neither smoothed over

**1. `createCustomerAuthMock` did not bind the tenant the real middleware binds.** The shared
double at `apps/api/tests/unit/helpers/mockAuthMiddleware.ts` set `request.customerUser` and
`request.user` and stopped; production `requireClientAuth` also calls
`enterTenantContext({ accountId: payload.accountId })`. Nothing noticed because the suites using
it inject a MOCK Prisma, where the guard never runs — so the double had been standing in for a
middleware whose one security-relevant side effect it omitted. Probed rather than assumed: with
the binding restored, `approvalRoutes` is 13/13; with the binding disabled again, it is
`1 failed | 6 passed | 6 skipped`. Fixed in the double, with the reason in the comment.

**2. A post fixture that the mapper can no longer read.** `approvalRoutes.test.ts`'s `postDefaults`
had no `channelPublications`, so `SubmitForReviewUseCase`'s `findById` raised and the route
answered 500 — the SAME class as red (e), found in a route suite. Fixed by making the double
return the key its include requests. The three hand-built rows in the integration suite's
`PostAggregateMapper` describes needed the same key for the same reason.

Both are stated as findings because each was a place where a double disagreed with production and
no gate could tell.

### Tests — the five D19 cases

| Case                                                                                                                              | Where                                | Result                                |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------- |
| (a) no context → `findById` throws, `post.findFirst` never called                                                                 | `PrismaPostRepository.test.ts`       | RED → GREEN                           |
| (b) system provider → the `include` argument carries `channelPublications` with the `channel.provider` join                       | same                                 | approval (green on arrival), declared |
| (b') tenant provider → same include                                                                                               | same                                 | triangulation of (b)                  |
| (c) `savePublication` under no scope AND under the system scope → `err(InvariantViolationError)`, zero statements, no transaction | same                                 | RED → GREEN                           |
| (d) compile red                                                                                                                   | `tsc -p packages/adapters/db-prisma` | recorded above                        |
| (e) runtime red on the list path                                                                                                  | temporary recorder, deleted          | recorded above                        |

Seventeen existing cases in that suite now bind a tenant through a local `asTenant()` helper, and
three in the integration suite do the same — the refusals have their own cases, so the rest of the
suite states the precondition instead of tripping over it.

### TDD cycle evidence

| Task          | Test file                                                         | Layer   | Safety net       | RED                                                                      | GREEN                                                                    | TRIANGULATE                                                                                      | REFACTOR                                                 |
| ------------- | ----------------------------------------------------------------- | ------- | ---------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| T1c.4a (e)    | temporary recorder, deleted after                                 | Unit    | ✅ 69/69         | ✅ `TypeError: prismaPost.channelPublications is not iterable`           | ➖ deliberately not made green — the loader that produced it was deleted | ✅ the fail-open half recorded too (same row → `publications: []`, PASSING)                      | ➖ file removed                                          |
| T1c.4a (d)    | `tsc` on `packages/adapters/db-prisma`                            | Compile | ✅ exit 0 before | ✅ 4 × TS2345 `Property 'channelPublications' is missing … but required` | ✅ exit 0 after the four loaders left                                    | ➖ one error shape, four sites                                                                   | ➖ n/a                                                   |
| T1c.4a (a)(c) | `apps/api/tests/unit/infrastructure/PrismaPostRepository.test.ts` | Unit    | ✅ 69/69         | ✅ `3 failed \| 71 passed (74)`                                          | ✅ `55 passed (55)`                                                      | ✅ refuse vs admit-system vs admit-tenant; write refused under BOTH `undefined` and `__system__` | ✅ `asTenant()` extracted rather than 17 inline wrappers |
| T1c.4a (b)    | same                                                              | Unit    | ✅ 69/69         | ➖ approval case — declared, not a red                                   | ✅ passes, pinning the include argument                                  | ✅ the tenant-scoped twin                                                                        | ➖ none needed                                           |

### Gates

| Gate                                                                  | Result                                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `tsc --noEmit` per touched package                                    | `@core/domain` 0 · `@core/posts` 0 · `@adapters/db-prisma` 0 · `apps/api` 0 (`6144`) · `apps/workers` 0      |
| `eslint --max-warnings 0` on the 16 touched files                     | 0                                                                                                            |
| `eslint apps packages infra --ext .ts,.tsx --max-warnings 0`          | 0                                                                                                            |
| `prettier -c` on the 16 touched files + `pnpm format:check`           | clean                                                                                                        |
| `pnpm check:circular`                                                 | no circular dependency (1596 files)                                                                          |
| `apps/api` unit tier (full)                                           | **585 files, 9112 passed, 0 failed, 0 skipped**                                                              |
| `@core/posts` · `@core/domain` · `@adapters/db-prisma` suites         | 27 · 184 · 70, all passing                                                                                   |
| integration `PrismaPostRepository.test.ts` (node:test, real Postgres) | **16/16**, `# fail 0`                                                                                        |
| fitness #3 / #4 / #5 / #8 / #9 / #10 / #23 / #32                      | 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0                                                                                |
| fitness #38                                                           | swept tree 0 · `db-prisma` ratchet **11**, unchanged                                                         |
| fitness #40                                                           | Part A seams 3 (floor 3), violations 0 · Part B sites 14 (floor 10), underived 0 · the literal token present |

Two environment notes, stated rather than hidden. The repo-wide `pnpm lint` OOMs at node's default
2 GB heap in this LXC (`FATAL ERROR: Ineffective mark-compacts near heap limit`) — the same class
as §10.2's note about the turbo `typecheck` task — and passes under
`NODE_OPTIONS=--max-old-space-size=6144`. Under that heap it reports 5 `no-console` errors, all in
`/root/omni-post/.config/opencode/plugins/*.ts`; `.config/` is gitignored (`.gitignore:187`), so
those files are untracked local agent tooling, never reach CI, and are NOT part of this change —
the tracked tree (`apps packages infra`) is 0/0. The full `apps/api` unit tier ran at the config's
own `maxWorkers: 1` rather than the suggested 2: that value is the repo's considered OOM setting
and this LXC has one test process budget.

### Budget — measured, and it does not fit the forecast

Net line deltas (`wc -l` before → after; exact numstat is the orchestrator's measurement):

| File                                                                           | Δ                                      |
| ------------------------------------------------------------------------------ | -------------------------------------- |
| `packages/adapters/db-prisma/src/post/PrismaPostRepository.ts`                 | 942 → 701 (**−241**)                   |
| `packages/adapters/db-prisma/src/post/PostAggregateMapper.ts`                  | 573 → 573 (**0** net; ~34 out, ~34 in) |
| `packages/core/domain/src/repositories/PostRepository.ts`                      | ~342 → 318 (**−24**)                   |
| `apps/api/tests/unit/infrastructure/PrismaPostRepository.test.ts`              | 1390 → 1258 (**−132**)                 |
| `apps/api/tests/integration/repositories/PrismaPostRepository.test.ts`         | 694 → 617 (**−77**)                    |
| the seven remaining stub files                                                 | **−92** combined                       |
| `apps/api/tests/unit/helpers/mockAuthMiddleware.ts` · `approvalRoutes.test.ts` | **+7** · **+3**                        |

CHANGED lines (additions + deletions, the budget's unit), from the orchestrator's **numstat** —
these supersede the reconstructed estimates this paragraph first carried, and they were wrong in
BOTH directions, so both corrections are stated rather than only the flattering one:

| Stream       |                                                                 Measured | Forecast (§9.4.1) | Verdict                                       |
| ------------ | -----------------------------------------------------------------------: | ----------------: | --------------------------------------------- |
| **CODE**     | **519** — adapter 54/295, mapper 59/59, port 14/38 (additions/deletions) |               225 | **2.3× over** — `size:exception` recommended  |
| **EVIDENCE** |              **611** tests, or **846** counting `tasks.md` + this ledger |               603 | **OVER**, marginally on tests and 1.4× on 846 |

The EVIDENCE line is the correction that matters, because the first estimate (~545) had it
comfortably UNDER and it is not: `tasks.md:908` defines EVIDENCE as tests **+ docs + runbooks +
openspec**, and this task rewrote `tasks.md` and this ledger. Counted the way the change's own
definition counts, EVIDENCE is 846 against 603. Stated so nobody reads an over-budget stream as
headroom.

`PostAggregateMapper.ts` is the file worth naming twice: **59 / 59** — net zero in `wc -l`, 118
changed lines in numstat. A `wc -l` delta is not a budget measurement and this file is the proof.

The CODE forecast under-counted the deletion by more than a factor of two: it allowed "157 deleted
adapter+port lines" and the adapter alone deleted 295, because it counted the four methods and
NOT the seven private helpers and module constants that existed ONLY for them — artefacts the
authorisation explicitly covers and that cannot be left behind (they would be dead code the next
reader has to re-adjudicate). It also counted no line for the two refusals' bodies and JSDoc, for
the include constant and its payload type, or for the doc paragraphs the deletion falsified.

**It cannot be sliced smaller.** The port, the adapter and the orphaned helpers must move in one
commit or the tree does not compile: deleting the port methods without the adapter leaves
`implements PostRepository` unsatisfied in the other direction, and deleting the adapter methods
without their helpers leaves seven unreferenced privates that `eslint` and the next reviewer both
have to be told about. Per the review-workload rule the work is reported honestly rather than
compressed: **`size:exception` is recommended for `1c-1a` on the CODE side**, at **519** against
400, with deletion accounting for **392 of those 519** — roughly three of every four changed
lines, and every one of them authorised.

### Follow-up after the fresh-context gate of `1c-1a` — PASS WITH WARNINGS, six items closed

No Critical was raised; every claim in this section was confirmed, no non-loader assertion was
found lost, and `PostAggregate.ts:154` was verified untouched by hash. The six warnings:

| Id     | Disposition         | What changed                                                                                                                                                                                                                                                                                                                  |
| ------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **W1** | FIXED               | the TENTH stub file — `apps/api/tests/unit/unitOfWork.useCases.test.ts:46`. Deleted under the same authorisation, added as the sweep table's tenth row with the two mechanisms that hid it, and the mandatory `rg` over `**/tests/**` recorded as the rule a port narrowing owes. Suite re-run **4/4**                        |
| **W2** | FIXED               | the budget paragraph was wrong in BOTH directions and now carries the orchestrator's numstat: CODE **519** (not ~560), EVIDENCE **611** tests / **846** including openspec — **over** the 603 forecast, where the estimate had it under                                                                                       |
| **W3** | FIXED               | `@throws TenantContextMissingError` documented on the **interface's own JSDoc block**, because `findById` is INHERITED from `Repository<PostAggregate, PostId>` and is not redeclared on `PostRepository`. Documented there rather than redeclaring the signature: a redeclaration would add a member the port never declared |
| **W4** | RUN                 | `integration:saga-recovery` — the batch that owns `publishNowPromotionHarness.ts`'s only consumer (`sagaPublishNowPromotion.test.ts`, with `sagaCrashRecovery` and `sagaCompensationRecovery` sharing it): **33 tests, 33 pass, 0 fail, 0 cancelled, 0 skipped**, against the live Postgres + Redis                           |
| **W5** | RECORDED (residual) | the `enterWith` residual, below                                                                                                                                                                                                                                                                                               |
| **W6** | FIXED               | citations corrected to AS BUILT: the barrel export is `packages/adapters/db-prisma/src/index.ts:54` (design cites `:48`) and the fitness #40 Part B token is `PrismaPostRepository.ts:142` (design cites `:121`, its pre-change line). The design was NOT edited                                                              |

**W5 residual — `enterTenantContext` uses `enterWith`, not `run`.** `apps/api/src/security/tenantContext.ts:88`
is `tenantStorage.enterWith(context)`, which binds for the REMAINDER of the current async resource
rather than for a scoped callback. In production that is correct and deliberate — a Fastify
preHandler has no callback to wrap the rest of the request in. In a TEST process it means the
binding is NOT torn down when the case that triggered it ends, so a later case in the same file can
observe a tenant it never bound. Measured today across the ELEVEN suites that consume the double:
no leak is observable — every one of them passes, and none asserts scopeless behaviour. It is named
here anyway, because the day someone adds a scope-REFUSAL case to one of those files it will pass
for the wrong reason: the refusal will not fire, and nothing will say why. The fix when that day
comes is `tenantStorage.run(context, fn)` in the double (not in production), or an explicit
`beforeEach` that re-enters an empty store.

Gates re-run after the six items: `@core/domain` tsc **0** · `apps/api` tsc **0** · eslint
`--max-warnings 0` on the three newly touched files **0** · prettier **clean** ·
`unitOfWork.useCases.test.ts` **4/4** · `integration:saga-recovery` **33/33**.

**Final numstat expectation after the six items.** The numstat above was taken BEFORE W1 and W3
landed, so the closing figures move by exactly two edits and nothing else: **CODE 519 → ~532**
(W3 adds 13 doc lines to `packages/core/domain/src/repositories/PostRepository.ts`, so its 14/38
becomes ~27/38) and **EVIDENCE 611 → 612** on the tests stream (W1 deletes one line from
`apps/api/tests/unit/unitOfWork.useCases.test.ts`), or **846 → ~900** counting this ledger's own
growth. The `size:exception` recommendation is unchanged and its reason is unchanged: the overage
is deletion the authorisation covers, and the slice does not compile if split.

### RDD receipt — the committed range `e6d734b1` → `f3caa204`

Lineage `review-a2e658c48711714c`, MEDIUM tier, ONE reliability lens. The review reached
**approved**, the acknowledgement was executed exactly once and the authority is **burned**; no
Critical was raised. Three ADVISORY findings, and what became of each:

| Finding                                     | Level      | Where                                                       | Disposition                                                                                                                                                                                                                                                                                   |
| ------------------------------------------- | ---------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `R3-enterWith-leak`                         | WARNING    | `apps/api/tests/unit/helpers/mockAuthMiddleware.ts:171-176` | **CLOSED by MEASUREMENT, not by a change** — the four cases below, landed on `workstream/ncor8-1c-1c`. The W5 residual above is superseded by that measurement                                                                                                                                |
| `R3-findById-guard-vs-adapter-duplication`  | SUGGESTION | `PrismaPostRepository.findById` vs the tenant guard         | **BACKLOG, deliberately NOT actioned.** The adapter's scope refusal duplicates the guard's ON PURPOSE — the `resolveClientIp` reason the design gives: the adapter states the invariant itself rather than inheriting it, so an upstream change to the guard's walk cannot silently remove it |
| `R3-savePublication-scope-message-coupling` | SUGGESTION | `PrismaPostRepository.test.ts` refusal cases                | **BACKLOG.** The test couples to the refusal's message WORDING; a code-keyed assertion would survive a re-phrasing. Left as-is because changing it now would edit a case the same review just approved                                                                                        |

**`R3-enterWith-leak`, closed by measurement rather than by a change.** The WARNING said the
double's `enterTenantContext` uses `AsyncLocalStorage.enterWith`, so in a test process the binding
could outlive the case that made it and a future scope-REFUSAL case would pass for the wrong reason.
The instruction was to fix the DOUBLE only, after measuring which shape is honest. **Measured: there
is nothing to fix.** `apps/api/tests/unit/helpers/mockAuthMiddleware.tenantScope.test.ts` (NEW,
4 cases) pins it: the handler reads its own account INSIDE the request; the test's own context is
unbound once the request completed; one request's account does not carry into the next; and an
UNAUTHENTICATED request leaves the store empty, which is exactly the precondition a refusal case
needs. **4/4 green with the double unchanged** — `app.inject()` gives each request its own async
resource, so `enterWith` does not escape it.

The probe was proven able to go RED, because a green assertion nobody can make fail is not a
measurement. A temporary file calling `enterTenantContext` from the TEST's own async resource and
asserting the store empty failed as required:

```text
 × observes a binding made in the test's own async resource
AssertionError: expected { Object (accountId) } to be undefined
```

It was deleted and the kept file is byte-identical across the experiment —
`81c8b7e95f79c6fd3c84937a357295aec4635a4228756013dcaa686b0910cef2` before and after. The four cases
were first written on the parked `1c-1b` branch (`08391306`) and are carried onto
`workstream/ncor8-1c-1c` unchanged (same hash, re-run there: 4/4) so the closure travels up the
chain with the range it closes; the production `enterWith` is untouched (it is correct there, and a
preHandler has no callback to wrap).

### RDD receipt — the docs commit `7010da92` (the §9.4.1 re-order)

Lineage `review-b44a2a529ed694d2`, MEDIUM tier, ONE reliability lens: **approved**, acknowledged
once, authority **burned**. Three ADVISORY findings, all on `tasks.md`:

| Finding                        | Level      | Where                | Disposition                                                                                                                                                                                                                                                                                        |
| ------------------------------ | ---------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `R3-duplicate-order-10`        | WARNING    | `tasks.md:1088-1099` | **REJECTED — the duplication is the finding's own subject.** Order 10 carries `1c-2a` AND `1c-3e` on purpose: the ordering audit found them mutually fail-closed (a true cycle), and the paragraph directly under the table says so and names the three shapes for Edward's decision (§9.9 item 6) |
| `R3-order-numbering-gap`       | SUGGESTION | `tasks.md:1088-1101` | **REJECTED, same reason.** The numbering is 1–9, 10, 10, 11, 12 — the doubled 10 is the cycle, not a gap; renumbering would hide that two units cannot be ordered against each other                                                                                                               |
| `R3-forecast-delta-arithmetic` | SUGGESTION | `tasks.md:1163-1166` | **Re-computed, the table is right:** 529 − 225 = +304 = 135 % of 225; 614 − 335 = +279 = 83 % of 335. Left as written                                                                                                                                                                              |

**Process defect, owned.** The three narratives above are reconstructed from the cited lines, not
quoted: the capture envelope retains only `id`, `lens`, `location` and `severity`, and the reviewer's
text lives in the transaction store, which the acknowledgement burns. For the 1c-1a range the
narrative was copied into the ledger BEFORE the acknowledgement (the table above quotes it); for this
docs commit it was not, and it is gone. Rule from here: the reviewer's narrative is written into the
ledger between the final capture and the acknowledgement, never after.

---

## PR 1c — grandchild `1c-1c` (T1c.1, T1c.2, T1c.4 first half) — COMPLETE

Branch `workstream/ncor8-1c-1c`, child of `workstream/ncor8-1c` @ `7010da92` — **order 2 of
§9.4.1**, the first of the re-ordered writers. Three tasks' worth of subject: the two RED suites
(T1c.1, T1c.2) and the FIRST HALF of T1c.4's GREEN, which is
`OpenPublicationEpisodeUseCase` and `RecordChannelPublicationAttemptUseCase`. The retraction pair
and the `@core/posts` barrel are `1c-1d`, so **T1c.4 stays UNTICKED** and carries the half-landed
note in `tasks.md` instead.

**Finish state**: an episode can be opened over a post's record and an attempt can be recorded
against one channel of it, each in ONE transaction through `executeResultInTransaction` and the
narrow `savePublication` — and neither is reachable from production yet, which is the point of the
order (measurement below). **Rollback**: delete the five new files; nothing else references them.

### What each mechanism is, as built

| Mechanism                                | As built                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OpenPublicationEpisodeUseCase`          | `execute` validates the ids with zero I/O, then `executeResultInTransaction` → load → `admitTargets` → `post.openPublicationEpisode` → `savePublication`. D9's three branches live in `admitTargets` and nowhere else                                                                                                                          |
| admission, no record                     | the request MUST name channels (an unnamed one is `VALIDATION_FAILED` — there is nothing to declare from); `declarePublicationTargets(requested)` then open                                                                                                                                                                                    |
| admission, nothing live                  | an unnamed request opens every recorded channel; a named one goes through `declarePublicationTargets`, which no-ops on an identical set and REPLACES a different one                                                                                                                                                                           |
| admission, live content                  | the requested set must EQUAL the recorded set; the refusal NAMES the differing ids. The root then refuses a named channel pending retraction by itself, with its fragments                                                                                                                                                                     |
| the conditional write                    | an `alreadyOpen` answer that moved no word and emitted no event writes NOTHING. A re-drive retry therefore does not spend a row version on a step that already ran; the status and pending-event terms are what keep "already open BUT now entering the family" a write                                                                        |
| `RecordChannelPublicationAttemptUseCase` | load → `post.recordChannelAttempt` → `savePublication`, and `applied: false` returns BEFORE the save: a redelivered ordinal applied nothing, so writing would bump the version for a message the record already accounted for                                                                                                                  |
| refusal classification                   | a channel OUTSIDE the recorded set answers `NOT_FOUND`; every other aggregate refusal answers `CONFLICT` (or `FORBIDDEN` for a lifecycle one). The aggregate stays the decider — the use case only reads the record to name WHICH refusal it just got, because the worker acts differently on `missing_record` than on `stale_episode` (D6/W4) |
| `publicationWriteOutcome.ts` (NEW)       | the two translations both writers perform — a domain refusal and a `savePublication` failure — in one module, narrowing on the STABLE `code` string and never on `instanceof` (the dual conditional-export hazard `CompletePostPublishingUseCase` documents). `1c-1d`'s two use cases consume it unchanged                                     |

### The recorded reds

**Module-absence RED, both suites, before a line of production code existed:**

```text
 FAIL  tests/unit/openPublicationEpisode.test.ts [ tests/unit/openPublicationEpisode.test.ts ]
Error: Cannot find module '../../src/OpenPublicationEpisodeUseCase.js' imported from …
 FAIL  tests/unit/recordChannelPublicationAttempt.test.ts [ … ]
Error: Cannot find module '../../src/RecordChannelPublicationAttemptUseCase.js' imported from …
 Test Files  2 failed (2)
      Tests  no tests
```

**Two fixture corrections the GREEN run forced, both stated rather than smoothed over. Neither
changed production code — in both the code was right and the TEST was wrong.**

1. **A FAILED post cannot be re-driven in schedule mode, and the aggregate says so.** The first
   draft of "opens every recorded channel when the caller names none" recorded two nontransient
   failures and then asked for `enterPublishing: false`. It failed:

   ```text
   × opens every recorded channel when the caller names none
     AssertionError: an excluded channel with nothing live is re-drivable
     - true  + false
   ```

   The derived word after two exclusions is `FAILED`, and `openPublicationEpisode` admits a
   non-entering open only from `DRAFT`/`SCHEDULED` — which is D9's "a delayed re-drive of a
   `FAILED`/`PARTIALLY_PUBLISHED` post is REFUSED; publish-now is the only re-drive route (Q14)",
   enforced by the domain rather than by the route. The case was corrected to publish-now AND a
   new case was added that pins the refusal (`FORBIDDEN`), so the rule is now asserted instead of
   merely not violated.

2. **`type: "IMAGE"` is not a media type, and `tsc` never said so.** The tripwire fixture built its
   pending edit with the uppercase literal. `MediaType` is `"image" | "video" | "gif"`, so this is
   a type error — and it reached RUNTIME as `AssertionError: the fixture edit is accepted by the
aggregate`, because **no tsconfig in `@core/posts` opens `tests/**`** (`include` is
   `["src/**/*"]`). That is the `1c-1a` W1 lesson arriving from the other direction: there it was a
   stub of a deleted method, here a wrong literal in a new file. Both are invisible to `tsc = 0`.
   **Instrument used, and kept as a habit rather than a repo change**: a THROWAWAY
   `tsconfig.__probe.json` extending the package config with `tests/**` added, run once, then
   deleted. It is recorded here so the next unit in this chain runs it too; making it a permanent
   config is a separate decision nobody has taken.
   **CORRECTION — the first run of this probe was reported as a gate and was not one.** Its command
   was `tsc … | head -30; echo "EXIT=$?"`, so the `$?` it printed was **`head`'s** status, not
   `tsc`'s; it printed `EXIT=0` over a tsc whose own exit code was never read. **Nothing surfaced
   this at runtime, and that is the point**: the pipeline exits 0 and prints `EXIT=0` whatever
   `tsc` did, so there was no signal to notice. It was found by re-reading the command. (The
   occasion for re-reading it: the wrapper shell of that command never exited — its trailing
   `eza | rg probe` pipeline hung after the probe file was already gone — the orchestrator
   terminated it after the hand-back, and the task was reported as **exit 144**, which is that
   termination and not a `tsc` failure.) Re-run afterwards with the exit captured directly off
   `tsc` (no pipe) and the probe removed by a `trap`: **`TSC_OWN_EXIT=0`** — so the claim is true,
   but it is true by MEASUREMENT now and was an assumption before. The re-run is also strictly
   stronger than the original, because it covers the two gate corrections (the W1 case and
   `replacedTargets`) that did not exist when the first probe ran. **The rule it forces: never read
   `$?` through a pipe when the number IS the gate.** A `| head` or a `| tail` makes the exit code
   that of the filter, and a gate that reports a filter's success is a gate that cannot go red. The
   repo already encodes the guard: every newer fitness check in `CLAUDE.md` (#33 through #41) opens
   with `set -uo pipefail`, which makes a pipeline's status its rightmost non-zero — exactly what
   the first probe lacked and what its re-run script sets.

### Two decisions the design does not make, taken here and named

1. **An absent channel list under live content is REFUSED.** D9 says "the request set must EQUAL the
   recorded set (else `VALIDATION_FAILED`)" and says nothing about a request that names no set at
   all. An unstated set cannot be compared to anything, and reading it as "assume it equals" would
   let a re-drive of a locked post proceed without naming the channel that is holding content — the
   exact thing the equality rule exists to prevent. It is refused, with the recorded set named in
   the message so the caller can restate it. An EMPTY list is refused too, in the pure-validation
   phase: `declarePublicationTargets([])` would WIPE the record set, and "open nothing" and "open
   everything" must not collapse into one request shape.
2. **`publicationWriteOutcome.ts` is a file T1c.4 does not name.** T1c.4 lists four use cases and a
   barrel. The refusal/save translations are identical in all four, and the alternative to a shared
   module was either duplicating ~45 lines into each writer or importing one use case from another
   — the second couples two use cases for no reason. It is reported rather than slipped in, it is
   NOT exported from the barrel (the barrel is `1c-1d`'s), and its line count is inside this unit's
   CODE stream below.

### Unreachable by claim — RE-MEASURED at this tip, not inherited

§9.4.1's ordering audit claims row 2 is unreachable. Measured after the code landed
(`rg` over `apps packages infra`, excluding `node_modules` and `dist`):

| Claim                                              | Measurement                                                                                                                                                                 |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No production reference to either use-case class   | 4 files hold the names: the two that DECLARE them and their two test files. Zero container registrations, routes, handlers                                                  |
| Not reachable through the package barrel           | `packages/core/posts/src/index.ts` is UNTOUCHED — neither class is exported; `apps/api` depends on `@core/posts` and still cannot reach them                                |
| The command token arrives at order 4               | `OPEN_PUBLICATION_EPISODE`: **0** occurrences tree-wide                                                                                                                     |
| `apps/workers` gains `@core/posts` only at order 8 | `"@core/posts"` appears in `apps/api/package.json:98` and **not** in `apps/workers/package.json`                                                                            |
| The root methods have no new production caller     | `.openPublicationEpisode(` / `.recordChannelAttempt(` / `.declarePublicationTargets(` outside `@core/domain` + `db-prisma`: only the two new use cases and three test files |

So `RecordChannelPublicationAttemptUseCase`'s `CONFLICT` on a stale or zero episode refuses nothing
that exists, and `OpenPublicationEpisodeUseCase`'s D9 tolerance of an absent record is exercised by
its suite alone. The tip is sound.

### Deleted or renamed members — the mandatory `rg` over `**/tests/**`

**This unit deletes and renames NOTHING**: five new files, no existing file modified, no port or
signature changed. The search's subject is empty and that is stated as a RESULT rather than left
unrun — §10.2's rule is about port narrowings, and this unit performs none.

### TDD cycle evidence

| Task               | Test file                                                       | Layer | Safety net | RED                                                                   | GREEN                     | TRIANGULATE                                                                                                                             | REFACTOR                                                          |
| ------------------ | --------------------------------------------------------------- | ----- | ---------- | --------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| T1c.1              | `packages/core/posts/tests/unit/openPublicationEpisode.test.ts` | Unit  | ✅ 27/27   | ✅ `Cannot find module '…/OpenPublicationEpisodeUseCase.js'`          | ✅ 16/17 → **17/17**      | ✅ 17 cases: three admission branches × named/unnamed/unequal request, alreadyOpen × (no-op \| word moves), CAS \| generic save failure | ✅ `setsDiffer` extracted; `admitTargets` split from `open`       |
| T1c.2              | `.../recordChannelPublicationAttempt.test.ts`                   | Unit  | ✅ 27/27   | ✅ `Cannot find module '…/RecordChannelPublicationAttemptUseCase.js'` | ✅ 12/13 → **13/13**      | ✅ 13 cases: published \| transient \| stranding result, stale \| zero episode, unknown channel, replay, plan-size, CAS, tripwire       | ✅ the two translations extracted to `publicationWriteOutcome.ts` |
| T1c.4 (first half) | both files above                                                | Unit  | ✅ 27/27   | ➖ the GREEN of the two RED tasks                                     | ✅ **57/57** package-wide | ➖ covered by the two rows above                                                                                                        | ✅ `answer()` closure removes the duplicated ok-payload           |

### Gates

| Gate                                                                                         | Result                                                                                                                                                                |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsc --noEmit` on `@core/posts` (the only touched package)                                   | **0**                                                                                                                                                                 |
| `tsc -p` over `src` + `tests` (throwaway probe config, deleted)                              | **0**, and see the correction above: the FIRST run read `head`'s exit, not `tsc`'s, and the number here comes from the re-run that captured `TSC_OWN_EXIT=0` directly |
| `eslint --max-warnings 0` on the 5 touched files                                             | **0**                                                                                                                                                                 |
| `eslint apps packages infra --ext .ts,.tsx --max-warnings 0`                                 | **0**                                                                                                                                                                 |
| `prettier -c` on the 5 touched files · `pnpm format:check`                                   | clean · clean                                                                                                                                                         |
| `pnpm check:circular` (madge, 1601 files)                                                    | no circular dependency                                                                                                                                                |
| `@core/posts` suite                                                                          | **4 files, 57 passed** (baseline was 2 files / 27)                                                                                                                    |
| `apps/api` unit tier, full, once                                                             | **585 files, 9112 passed, 0 failed, 0 skipped**, exit 0 — identical to the `1c-1a` tip                                                                                |
| `integration:saga-recovery` (real Postgres + Redis, the per-tip guard)                       | **# tests 33 · # pass 33 · # fail 0 · # cancelled 0 · # skipped 0**, runner exit 0                                                                                    |
| fitness #1 / #2 / #3 / #4 / #5 / #6 / #7 / #8 / #9 / #10 / #11 / #16 / #21 / #22 / #23 / #32 | 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0                                                                                                         |
| fitness #38                                                                                  | swept tree **0** · `db-prisma` ratchet **11**, unchanged                                                                                                              |
| fitness #40                                                                                  | Part A seams 3 (floor 3), violations **0** · Part B sites 14 (floor 10), underived **0**                                                                              |
| fitness #41                                                                                  | sites 8 (floor 8), exception hits 1, violations **0**                                                                                                                 |

### Budget — measured, and it does not fit the forecast either

Every file in this unit is NEW, so additions equal the line count and deletions are zero: `wc -l`
IS the numstat here, which is the one case where it is (the `1c-1a` ledger's warning about
`PostAggregateMapper.ts` applies to MODIFIED files).

| File                                                                | Stream   | Changed lines |
| ------------------------------------------------------------------- | -------- | ------------: |
| `packages/core/posts/src/OpenPublicationEpisodeUseCase.ts`          | CODE     |       **318** |
| `packages/core/posts/src/RecordChannelPublicationAttemptUseCase.ts` | CODE     |       **224** |
| `packages/core/posts/src/publicationWriteOutcome.ts`                | CODE     |        **74** |
| `packages/core/posts/tests/unit/openPublicationEpisode.test.ts`     | EVIDENCE |       **563** |
| `.../recordChannelPublicationAttempt.test.ts`                       | EVIDENCE |       **472** |

| Stream       |                                            Measured | Forecast (§9.4.1) | Verdict                                       |
| ------------ | --------------------------------------------------: | ----------------: | --------------------------------------------- |
| **CODE**     |                                             **616** |               400 | **1.54× over** — `size:exception` recommended |
| **EVIDENCE** | **1035** tests, ~1300 with this ledger + `tasks.md` |               754 | **1.4× over** on tests alone                  |

**The third consecutive under-count, and this one is NOT deletions.** `1c-1a` was +135%, `1c-1b`
+83%, this one +54%. The previous two were under-counted because the line-item method costs what it
PLANS to write and deletions are discovered while writing; here nothing was deleted, so the cause is
different and worth naming: the forecast counted two use-case bodies and not the canon they are
written under. Of the 616 CODE lines, roughly 210 are JSDoc that `CODING_STANDARDS §Documentation`
makes mandatory on every file and every public member, and 74 are a third file the task list does
not name. §9.4.1's closing advice — "treat any remaining forecast at or near 400 as already over" —
held exactly, and the remaining grandchildren at 371, 301, 280 and 275 should be read the same way.

**It was not compressed to fit.** Per the review-workload rule, comments, JSDoc and test cases were
not deleted and nothing was restyled to reach the number. It could be split further — the two use
cases are independent files — but the split would be a RE-SLICE of §9.4.1's order 2, which is
Edward's decision and not this run's: each half's RED suite is one of the two assigned tasks, and
landing a suite whose subject does not exist is the one shape the order exists to prevent.

### What is deliberately NOT in this unit

`ConfirmManualRetractionUseCase`, `ExpireRetractionActionWindowUseCase`, the `@core/posts` barrel
entries for all four, T1c.6's `SchedulePostUseCase` seam (all `1c-1d`), and T1c.7's command token,
handlers and container registration (`1c-1e`). No DI token, no route and no CQRS command was added
here — which is why the unreachability measurement above reads the way it does.

### Follow-up after the fresh-context gate of `1c-1c` — PASS WITH WARNINGS

No Critical was raised and every claim in this section was confirmed, including the
unreachability measurement and the byte-exactness of the `1c-1a` restores. Seven findings, two
FIXED here and five recorded with an owner — a finding whose owner is another unit is written into
`tasks.md` at that unit's task, not carried in prose alone.

| Id     | Finding                                                                                                                                                                                                                                                                                                       | Disposition                                                                                   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **W1** | `channelIds: []` was UNTESTED, and the refusal is load-bearing: over a non-empty recorded set with nothing live, `declarePublicationTargets([])` passes the identical-set guard (0 ≠ 2) AND the live-content guard, and reaches `replaceRecords([])` — it WIPES the record                                    | **FIXED** — one case added, with its red recorded below                                       |
| **W2** | `changed` rested on a CROSS-FILE invariant: it is correct only because `ChannelPublication.declare` builds records at episode 0, so a replaced set can never report `alreadyOpen`. The use case already knew it had replaced the set and did not use that knowledge                                           | **FIXED** — `replacedTargets`, below                                                          |
| **W3** | `CHANNEL_HAS_LIVE_FRAGMENTS` collapses into a generic `CONFLICT`; the only discriminator left to a route is the message PREFIX, while D9 wants 409 `{ code: "CHANNEL_HAS_LIVE_FRAGMENTS" }` carrying the fragments                                                                                            | **OWNER `1c-2b`** — written at T1c.11 in `tasks.md`                                           |
| **W4** | `INVALID_STATE_TRANSITION_CODE` is a LOCAL literal in `publicationWriteOutcome.ts` because `@core/domain` exports `VERSION_CONFLICT_CODE` but no equivalent for the lifecycle refusal. Mitigated today by the `FORBIDDEN` case, which drives a REAL `InvalidStateTransitionError` rather than a hand-made one | **OWNER `1c-1d`** — written at T1c.3 in `tasks.md`                                            |
| **W5** | `CompletePostPublishingUseCase` still carries its own `isVersionConflict`, now duplicated by `publicationSaveFailure`                                                                                                                                                                                         | **PRE-EXISTING; OWNER T1c.5** (parked `1c-1b`) — written at T1c.5 in `tasks.md`               |
| **W6** | CODE 616 vs forecast 400 as the gate raised it; **649 as shipped** (W2 added 33 to the same file)                                                                                                                                                                                                             | **EDWARD'S DECISION** — `size:exception`, or the split measured below                         |
| **W7** | REC-8 (`PARTIALLY_PUBLISHED` RESTS) is covered here for `FAILED` only                                                                                                                                                                                                                                         | **NOTED, not a gap** — `PARTIALLY_PUBLISHED` travels the IDENTICAL arm and is T1b.9 / T1d.5's |

**W1 as fixed, and the red that proves the case bites.** The new case builds the state in which the
aggregate WOULD accept the wipe — two recorded channels, nothing live — asks with `channelIds: []`,
and asserts on the RECORD rather than only on the returned error. Probe: the refusal in
`parseChannelIds` was neutralised by changing its condition from `channelIds.length === 0` to
`channelIds.length === -1` (one token, trivially reversible), the single case was run, and the
request reached the aggregate exactly as predicted:

```text
 FAIL  tests/unit/openPublicationEpisode.test.ts > OpenPublicationEpisodeUseCase > a record with
   nothing live — the set is replaced, then opened (D9) > refuses an empty channel list and leaves
   the recorded target set intact
AssertionError: the recorded target set survives an empty request
+ actual - expected
+ []
- [
-   'aa000000-0000-4000-8000-00000000000a',
-   'aa000000-0000-4000-8000-00000000000b'
- ]
 Test Files  1 failed (1)
      Tests  1 failed | 17 skipped (18)
```

The assertion order is deliberate: the record comes BEFORE the error code, so the failure names the
WIPE rather than a code mismatch. Restored and verified byte-exact —
`packages/core/posts/src/OpenPublicationEpisodeUseCase.ts`
`4f963ae909f4261a7f12b8995767e31b4a5c17fc34c930d8284051d62eac7160` before the probe and
`4f963ae909f4261a7f12b8995767e31b4a5c17fc34c930d8284051d62eac7160` after it (`sha256sum -c` → `OK`);
the suite then read **18/18**. That hash is a point-in-time value: W2 edited the same file
afterwards, so the shipped file does not match it and a later `sha256sum -c` against it reads as a
failed restore that never happened.

**W2 as fixed.** `admitTargets` now answers an `AdmittedTargets` — `{ channelIds, replacedTargets }`
— and `replacedTargets` is measured with `setsDiffer` BEFORE `declarePublicationTargets` runs,
because afterwards the record already holds the requested set and the difference is gone. It is
`true` exactly when this call handed the aggregate a DIFFERENT set (an empty record answers
"differs" for any request, which is right: declaring the first targets rewrites the record too), and
it is OR-ed into `changed` as its first term. The invariant it stops depending on is named in the
comment at the branch: that a replaced set can never report `alreadyOpen`, which holds today only
because `ChannelPublication.declare` builds records at episode 0 — a fact of another file. If that
ever stopped holding, the old form would read "nothing changed" over a rewritten record set and skip
the write in silence, with every test still green.

**No red is available for W2 without altering the aggregate, and none was invented.** The defect it
closes is unreachable while `declare` builds at episode 0: to observe it one would have to make
`openEpisode` preserve episodes across a replacement, which is a change to `@core/domain` and
outside this unit. Observable behaviour is unmoved and that IS asserted — the no-op case still reads
`post.version === 3` with zero `savePublication` calls, and the replacement case still writes once.

### For Edward — a product question the gate raised, NOT answered here

> D9 says (1) with `hasLiveContent()` the request set must EQUAL the recorded set, and (2) Slice 2's
> retry route starts the same saga with `channelIds: [channelId]`. A partially published post has
> live content, so a one-channel retry against a recorded set of 2+ would be refused — exactly the
> retry spec's merge-blocking scenario (`specs/post-channel-publication-retry/spec.md:96`). The
> equality rule appears in no spec, only D9 and T1c.1. Candidate answers: (i) the route sends the
> full recorded set and the use case filters to `redrivable()` (but another channel pending
> retraction would then refuse the whole retry by name); (ii) relax to "requested ⊆ recorded" on the
> retry path.

Due before `1c-2b`; recorded as a new §9.9 item in `tasks.md`. Nothing in this unit was changed in
anticipation of either answer: the equality rule is implemented exactly as D9 states it.

### The split option for W6, measured

| Unit       | Content                                                                | CODE, as the gate measured it | CODE, re-measured after the corrections |
| ---------- | ---------------------------------------------------------------------- | ----------------------------: | --------------------------------------: |
| `1c-1c-i`  | T1c.1 + `OpenPublicationEpisodeUseCase` + `publicationWriteOutcome.ts` |                           392 |                                 **425** |
| `1c-1c-ii` | T1c.2 + `RecordChannelPublicationAttemptUseCase`                       |                           224 |                                 **224** |

**The re-measured column is the one to decide on, and it changes the answer.** The gate measured the
split BEFORE correction W2 landed; `replacedTargets` added 33 CODE lines to
`OpenPublicationEpisodeUseCase.ts` (318 → 351), so half **i** is now **425 — over the 400 budget by
itself**, and the split no longer makes both halves fit. Stated rather than left standing, because
"both halves fit" was true of the figures the gate had and is false of the tree that exists. Half
**ii** is unaffected. The whole unit now measures **CODE 649** (351 + 224 + 74) against the 400
forecast, and EVIDENCE **1066** on tests (594 + 472).

So the real choice is narrower than it looked: `size:exception` for `1c-1c` at 649, or a split whose
first half still needs one at 425 — unless the shared helper travels with `1c-1c-ii` instead
(`1c-1c-i` 351 / `1c-1c-ii` 298, both under budget), which inverts the "the first to need it carries
it" rule and is offered only because the measurement forces the question. The split is NOT acted on
here: it re-slices a ratified §9.4.1 order, which is Edward's call.

### Gates re-run after the two corrections

| Gate                                                              | Result                                                                                                                                    |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `@core/posts` vitest suite                                        | **4 files, 58 passed** (was 57; the W1 case is the one added)                                                                             |
| `tsc --noEmit` in `@core/posts`                                   | **0** (`TSC_EXIT` read directly off `tsc`, no pipe)                                                                                       |
| `eslint --max-warnings 0` on the two changed `.ts` files          | **0**                                                                                                                                     |
| `prettier -c` on every changed file, incl. the two `.md`          | clean                                                                                                                                     |
| `tsc -p` over `src` + `tests`, probe RE-RUN after the corrections | **`TSC_OWN_EXIT=0`** — the honest measurement of the row the section above corrects; it now also covers the W1 case and `replacedTargets` |

### RDD receipt — the committed range `7010da92` → `ff1c41a1`

Lineage `review-e5c939093cdb3581`, MEDIUM tier (7 files / 2,065 lines), ONE reliability lens. The
review reached **approved** on its first admitted capture, the acknowledgement was executed exactly
once and the authority is **burned**; no Critical and no WARNING was raised. Two ADVISORY
SUGGESTIONs, quoted from the reviewer BEFORE the acknowledgement (the transaction store is deleted
by the burn), and what becomes of each:

| Finding                          | Level      | Where                                                                                                      | Reviewer's claim (quoted)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `R3-noUowBranchUntested`         | SUGGESTION | `OpenPublicationEpisodeUseCase.ts:88-96`; same shape at `RecordChannelPublicationAttemptUseCase.ts:97-105` | "The `unitOfWork` constructor parameter is optional, and when omitted the use case calls the inner `doWork` closure directly, bypassing `executeResultInTransaction`. No test … exercises this branch — every test constructs the use case with `makeRecordingUow()` — so the behaviour of a `savePublication` failure or a domain refusal returned from the closure when the seam is absent is unproved by this candidate."                                                                                                                                                               | **OWED to `1c-1d`, which adds the two remaining T1c.4 use cases of the same shape**: one case per use case constructed WITHOUT a unit of work, asserting that a domain refusal and a `savePublication` failure both come back as the same outcomes the transactional path answers, and that nothing is written. The branch exists for the canon's own reason (the UoW parameter is optional for tests) and is unreachable from the composition root, which always injects the seam; its behaviour is nonetheless a contract this package states and should be pinned once for all four                                                                                                     |
| `R3-tripwireContractIsLocalMock` | SUGGESTION | `recordChannelPublicationAttempt.test.ts:135-153`, asserted at `:433-461`                                  | "The narrow-save tripwire is re-implemented inside the test's own `makePostRepo` double via a locally hard-coded `TRIPWIRE_EVENTS` list, then the use-case's INTERNAL_ERROR translation is asserted against it. … if the production adapter's `PUBLICATION_TRIPWIRE_EVENTS` set diverges (event renamed, added, removed), this suite continues to pass while production silently changes behaviour. Consider a cross-package contract test at the adapter tier (or exporting the tripwire set from a package `@core/posts` can depend on) so the two definitions cannot drift undetected." | **ACCEPTED, written at T1c.14 in `tasks.md`, not done here.** The drift the reviewer names is real and the suite's own comment already states the trade-off. The adapter suite (`apps/api/tests/unit/infrastructure/PrismaPostRepository.test.ts`) pins the production set directly; what is missing is the link between the two definitions. The honest fix is the reviewer's second option — the tripwire set moves to a package both `@core/posts` and the adapter can import (it is a statement about the aggregate's events, which live in `@core/domain`) — a small relocation with its own red, owned by the unit that next touches `PUBLICATION_TRIPWIRE_EVENTS` (T1c.14, `1c-3e`) |

### RDD receipt — the follow-up commit `ff1c41a1` → `8454bab9`

Lineage `review-4ae0d5245ff71220`. The review reached **approved** on its first admitted capture,
the acknowledgement was executed exactly once and the authority is **burned**. **ZERO advisory
findings** — no Critical, no WARNING and no SUGGESTION, so unlike the two receipts above this one
carries nothing forward to another unit. The commit under review is the enterWith measurement test
(`test(auth): the customer-auth double's tenant binding does not outlive the request that made it`),
and it is recorded here rather than left out because a receipt nobody wrote is indistinguishable
from a review nobody ran.

---

## PR 1c — grandchild `1c-1d` (T1c.3, T1c.4 second half, W4, half of T1c.6) — COMPLETE WITH ONE BLOCKER

Branch `workstream/ncor8-1c-1d`, child of `workstream/ncor8-1c-1c` @ `8454bab9` — **order 3 of
§9.4.1**, the second of the re-ordered writers. Subject: the RED suites for the retraction pair
(T1c.3), the SECOND HALF of T1c.4's GREEN (`ConfirmManualRetractionUseCase`,
`ExpireRetractionActionWindowUseCase`, the `@core/posts` barrel and the no-UoW branch for all four
use cases), the `INVALID_STATE_TRANSITION_CODE` export carried from the `1c-1c` gate (W4), and
**half of T1c.6** — the `executeResultInTransaction` migration. **T1c.6's `declarePublicationTargets`
call is NOT here**, and it is the one blocker of this unit; the measurement that stops it is below
under "For Edward", and the task keeps its `[ ]`.

**Finish state**: the two acts a stranded channel needs — the customer's confirmation that they
removed the fragments, and the sweep's closure of their action window — are writers of the same
shape as the two that landed in `1c-1c`, each in one transaction through the narrow save; all four
are reachable through the package barrel; and a lifecycle refusal is recognised through a constant
the domain owns instead of a literal each consumer copies. **Rollback**: delete the four new files,
revert the barrel block, revert the constant in `@core/domain` (the class goes back to its inline
literal), and revert nine lines of `SchedulePostUseCase`. Nothing outside the change references any
of it.

### What each mechanism is, as built

| Mechanism                             | As built                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ConfirmManualRetractionUseCase`      | validate ids with zero I/O, then `executeResultInTransaction` → load → `post.clearPendingRetraction({ cause: "manually-removed" })` → `savePublication`. The whole of D4's "available after an expired window" is inherited from the aggregate, which is why the Q17 case needed no branch here — only a case that proves it |
| the idempotency discrimination        | `retractionClearedCause === MANUALLY_REMOVED` is read BEFORE the act, because afterwards this call's clearance is indistinguishable from an earlier one's. That read is the ONLY thing separating "already confirmed" (`applied: false`, 200) from "nothing was ever pending" (409)                                          |
| `NOTHING_PENDING`                     | an `err` whose `code` is `CONFLICT` — so every existing route mapping answers 409 unchanged — carrying a `refusal` discriminator read by VALUE through the exported `refusalOf()`. A route switches on that, never on the message                                                                                            |
| `hasLiveContent` on both outputs      | the predicate the confirm act EXISTS for, and not derivable from `status`: a `FAILED` post with live fragments is locked and one without them is editable, and both read `FAILED`                                                                                                                                            |
| `ExpireRetractionActionWindowUseCase` | the caller's `now` and `window` travel to the root unchanged; the root re-asserts the cutoff. `applied: false` (not an error) for a window that is unopened, already closed, or unelapsed — a sweep must not fail on a row that raced with a customer                                                                        |
| the window guard                      | a non-finite or negative `window` is refused BEFORE the load. Not cosmetic: `now < startedAt + NaN` is FALSE, so the record's guard is not taken and every selected row expires. It is the one malformed value here that fails OPEN, and the probe below measures it rather than asserting it                                |
| `INVALID_STATE_TRANSITION_CODE` (W4)  | declared beside `VERSION_CONFLICT_CODE` and CONSTRUCTED INTO `InvalidStateTransitionError`, so the value has exactly one definition; `publicationWriteOutcome.ts` imports it and its local literal is gone. A new domain suite compares the constant against a REAL error rather than against a second literal               |
| the `@core/posts` barrel              | all four T1c.4 use cases with their input/output types, plus `RETRACTION_REFUSALS` / `refusalOf` / `RetractionRefusal` for the route. `publicationWriteOutcome.ts` stays UNEXPORTED — it is the writers' shared translation, not package surface                                                                             |
| the no-UoW branch (R3)                | two cases per use case, eight in all: a domain refusal and a `savePublication` failure answer the same outcomes as the transactional path and write nothing                                                                                                                                                                  |
| `SchedulePostUseCase` (half of T1c.6) | `executeResultInTransaction` replaces the `let result` capture. The capture stored an `err` and let the callback RESOLVE, so the unit of work saw a success and COMMITTED — and this save is multi-statement (post row, content, media, outbox), which is exactly the partial write ADR-0023 exists to stop                  |

### The recorded reds

**1. W4 — the constant does not exist.** Written first, against an export that had no declaration:

```text
 FAIL  tests/unit/domainErrorCodes.test.ts > domain error discriminators > exports the code a real
   InvalidStateTransitionError carries
AssertionError: a lifecycle refusal must be recognisable by the exported constant
+ actual - expected
+ 'INVALID_STATE_TRANSITION'
- undefined
 Test Files  1 failed (1)
      Tests  1 failed | 2 passed (3)
```

**2. T1c.3 — module absence, both suites, before a line of production code existed:**

```text
 FAIL  tests/unit/confirmManualRetraction.test.ts [ tests/unit/confirmManualRetraction.test.ts ]
Error: Cannot find module '../../src/ConfirmManualRetractionUseCase.js' imported from …
 FAIL  tests/unit/expireRetractionActionWindow.test.ts [ … ]
Error: Cannot find module '../../src/ExpireRetractionActionWindowUseCase.js' imported from …
 Test Files  2 failed (2)
      Tests  no tests
```

**3. T1c.6's seam — the `err` that used to commit.** RED in `apps/api`, before the migration:

```text
 FAIL  tests/unit/application/postUseCases.test.ts > SchedulePostUseCase > the transaction seam >
   aborts the transaction when the save fails, instead of resolving over the failure
AssertionError: expected [] to have a length of 1 but got +0
- Expected  1
+ Received  0
      Tests  2 failed | 45 skipped (47)
```

**The GREEN of the retraction pair passed 28/28 on its first run, which is a reason to distrust it,
not to celebrate it.** Two probes were run to decide whether the load-bearing branches are pinned or
merely unvisited. Both are recorded, both restored sha256-exact.

**Probe A — the window guard.** Condition weakened from
`!Number.isFinite(input.window) || input.window < 0` to `input.window < 0` (one term, trivially
reversible) and the single case run. It does not merely pass the guard — it EXPIRES:

```text
 FAIL  tests/unit/expireRetractionActionWindow.test.ts > … > refuses a window that is not a finite
   number, which would otherwise expire EVERY row
AssertionError: the window the malformed value would have closed is still open
+ actual - expected
+ 2026-03-01T11:00:00.000Z
- undefined
```

The window assertion was MOVED to the front of that case for this run, so the failure names the
expiry it caused rather than a code mismatch — the assertion-order lesson from `1c-1c`'s W1, applied
at write time instead of after a review. Restored and verified:
`packages/core/posts/src/ExpireRetractionActionWindowUseCase.ts`
`fafdaca4be0109029c843b545586f38b28fb047edc738b501c28602f8e6bafdd` before the probe, `sha256sum -c`
→ `OK` after it.

**Probe B — the idempotency discrimination.** `if (alreadyConfirmed)` inverted to
`if (!alreadyConfirmed)`. Three cases fail, which is the point: the discriminator carries the
`NOTHING_PENDING` refusal, the duplicate submit AND the no-UoW refusal case at once.

```text
 × refuses NOTHING_PENDING as a conflict a caller can identify without matching the message
 × answers a duplicate submit with applied:false and writes nothing a second time
 × answers a domain refusal exactly as the transactional path does, and writes nothing
      Tests  3 failed | 10 passed (13)
```

Restored and verified: `packages/core/posts/src/ConfirmManualRetractionUseCase.ts`
`8dd9351fdc73c5758f3bd9c50385861042d35017c2cc8adafc7669b260ca7090`, `sha256sum -c` → `OK`.

**Probe C — the eight no-UoW cases, where NO natural red exists and none was invented.** The branch
already behaves correctly, so writing a test for it cannot fail first; what CAN be measured is
whether the cases would catch a divergence. In `RecordChannelPublicationAttemptUseCase`,
`return await doWork()` was replaced by
`return err(new UseCaseError("no transaction seam", USE_CASE_ERRORS.INTERNAL_ERROR))` — the
"fail closed without a seam" shape a future author might reasonably add:

```text
 × answers a domain refusal exactly as the transactional path does, and writes nothing
 × answers a save failure exactly as the transactional path does
      Tests  2 failed | 13 passed (15)
```

Restored and verified: `packages/core/posts/src/RecordChannelPublicationAttemptUseCase.ts`
`5b833619c7d265ed72c917970a8d474b6b2d4d6388cd35ffa81dd559e2adbd95`, `sha256sum -c` → `OK`. The other
three use cases carry the identical branch and the identical pair of cases; one probe is reported
rather than four identical ones.

### Decisions the design does not make, taken here and named

1. **A confirmation is idempotent only against the CUSTOMER'S own act.** D4 says `applied: false` on
   a second call and design.md:246 says 409 `NOTHING_PENDING` when nothing is live — but the
   aggregate answers `applied: false` for BOTH, so the use case had to pick a discriminator. It reads
   `retractionClearedCause === MANUALLY_REMOVED`. **Rejected**: treating every non-pending channel as
   an idempotent success, which would report "your confirmation was recorded" to a customer
   confirming a channel that published cleanly, for an act no record holds. The cost of the rule
   chosen is that a channel cleared by N-COR-10's `RETRACTED` path answers 409 to a customer who
   clicks afterwards; that path has **no production caller in N-COR-8** (design.md:171), so the
   decision is cheap today and is flagged here for N-COR-10 rather than discovered by it.
2. **`NOTHING_PENDING` is carried as a value, not a message prefix.** The `1c-1c` gate's W3 is exactly
   this defect one refusal over — a route left matching on a message PREFIX — and its owner is
   `1c-2b`. Repeating the shape here and paying for it later would be the worse trade, so this
   refusal ships with an exported discriminator and `refusalOf()` reads it by value (the `domainCode`
   reasoning: `instanceof` cannot survive this package's dual conditional export). **Rejected**: a
   distinct `USE_CASE_ERRORS` member, which would change the HTTP mapping of an existing code family
   for every other consumer.
3. **`hasLiveContent` is on both output DTOs.** **Rejected**: letting the caller re-read the post,
   which buys the same value at the price of a second query that can fail. It is reported on the
   EXPIRE path too, where it is always `true`, because "the lock did not release" is the property
   that path deliberately does not change and a caller should be able to see it rather than infer it.
4. **`now` and `window` are REQUIRED on the expire input.** D4's signature has them non-optional and
   a default would let the sweep's discovery and the root's re-assertion disagree — the precise thing
   S-a-2 makes the window an argument to prevent.
5. **`publicationWriteOutcome.ts` stays out of the barrel.** It is the writers' shared translation,
   not package surface; the four use cases are exported, the helper they share is not.

### A design line this unit falsifies

**design.md:189 — "`save(post)` (full) additionally upserts the records; `SchedulePostUseCase` keeps
it" — is no longer true of the tree.** The 1b gate's correction W1 reverted both `upsertPublications`
calls out of `doCreate` and `doUpdate` with its own recorded red, leaving the narrow
`savePublication` as the only production writer of the record. Measured at this tip:
`tx.postChannelPublication.upsert` appears in `packages/adapters/db-prisma/src/post/PostPublicationWrites.ts`
and nowhere else. The design sentence is not amended here — a design revision is not this unit's to
write — but it is named so the next reader of T1c.6 does not plan against it. It is the direct cause
of this unit's blocker.

### Deleted or renamed members — the mandatory `rg` over `**/tests/**`

| Member                                        | Search                                                                           | Result                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `INVALID_STATE_TRANSITION_CODE` (local const) | `rg -n 'INVALID_STATE_TRANSITION_CODE' apps packages infra --glob '**/tests/**'` | 3 hits, all in the NEW `packages/core/domain/tests/unit/domainErrorCodes.test.ts`. It was module-private, so no double held it                                                                                                                                                                                                 |
| `SchedulePostUseCase`'s transaction seam      | `rg -n 'new SchedulePostUseCase' apps packages infra`                            | **ONE** production construction site (`setupPostUseCases.ts:141`) — corrected after the gate; `setupRecurringPostUseCases.ts` RESOLVES the token rather than constructing, so it is a consumer, not a second site — and one test file, which constructed it WITHOUT a unit of work before this unit. No existing double breaks |

`executeResultInTransaction` is a REQUIRED member of the `UnitOfWork` port
(`packages/core/domain/src/repositories/Repository.ts:204`) and `PrismaUnitOfWork` implements it
(`:136`), so the migration reaches no double that lacks it. **The nesting shape is UNCHANGED**:
`executeResultInTransaction` is implemented on top of `executeInTransaction`, which has always opened
its own `$transaction`, so the recurrence path's nested transaction behaves exactly as it did — what
changes is that an inner failure now rolls that inner transaction back instead of committing it.

### Doubles added or updated

| Double                                              | Where                                                  | Why                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `createRecordingUnitOfWork`                         | `apps/api/tests/unit/application/postUseCases.test.ts` | NEW. Records WHICH seam was opened and what rolled back — the only way to see the ADR-0023 difference from outside |
| `makePostRepo` / `makeRecordingUow` (two new files) | the two new `@core/posts` suites                       | The `1c-1c` shape, unchanged, including the narrow save's edit tripwire                                            |

### TDD cycle evidence

| Task          | Test file                                                        | Layer | Safety net | RED                                                                | GREEN            | TRIANGULATE                                                                                                                                                        | REFACTOR                                     |
| ------------- | ---------------------------------------------------------------- | ----- | ---------- | ------------------------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| W4 (at T1c.3) | `packages/core/domain/tests/unit/domainErrorCodes.test.ts`       | Unit  | ✅ 184/184 | ✅ `+ 'INVALID_STATE_TRANSITION' - undefined`                      | ✅ 3/3           | ✅ both discriminators against real errors, plus the distinctness the FORBIDDEN/CONFLICT fork needs                                                                | ➖ nothing to reshape                        |
| T1c.3 / T1c.4 | `packages/core/posts/tests/unit/confirmManualRetraction.test.ts` | Unit  | ✅ 58/58   | ✅ `Cannot find module '…/ConfirmManualRetractionUseCase.js'`      | ✅ 13/13         | ✅ 13 cases: clears with cause, re-drivable, after expiry, 404 ×2, 409, duplicate, CAS, other save failure, 2 pure refusals, 2 no-UoW                              | ✅ `answer(applied)` closure, one ok-payload |
| T1c.3 / T1c.4 | `.../expireRetractionActionWindow.test.ts`                       | Unit  | ✅ 58/58   | ✅ `Cannot find module '…/ExpireRetractionActionWindowUseCase.js'` | ✅ 15/15         | ✅ 15 cases: the window pair at one `now`, keeps fragments + lock, second tick, never-opened, 404 ×2, NaN, negative, CAS, other failure, 2 pure refusals, 2 no-UoW | ✅ same `answer(applied)` shape              |
| T1c.4 (R3)    | the two `1c-1c` suites                                           | Unit  | ✅ 86/86   | ➖ none available (existing branch) — probe C measures instead     | ✅ 90/90 package | ➖ two cases per use case                                                                                                                                          | ➖                                           |
| T1c.6 (seam)  | `apps/api/tests/unit/application/postUseCases.test.ts`           | Unit  | ✅ 45/45   | ✅ `expected [] to have a length of 1`                             | ✅ 47/47         | ✅ commit path and abort path                                                                                                                                      | ➖ nine lines replaced by one call           |

### Gates

| Gate                                                                               | Result                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@core/domain` vitest                                                              | **10 files, 187 passed** (baseline 9 / 184)                                                                                                                                                                                                                                                                                                                          |
| `@core/posts` vitest                                                               | **6 files, 90 passed** (baseline 4 / 58)                                                                                                                                                                                                                                                                                                                             |
| `tsc --noEmit` `@core/domain` · `@core/posts` · `apps/api` (6144)                  | **0 · 0 · 0**, each exit code read directly off `tsc`, never through a pipe                                                                                                                                                                                                                                                                                          |
| `tsc -p` over `@core/posts` `src` + `tests` (throwaway probe config)               | **`TSC_OWN_EXIT=0`** — no repo tsconfig opens `tests/**`, so this is the only thing that type-checks the new suites. The config lives in the scratchpad, never in the repo                                                                                                                                                                                           |
| `apps/api` unit tier, full, once                                                   | **586 files, 9118 passed, 0 failed, 0 skipped**, exit 0                                                                                                                                                                                                                                                                                                              |
| `integration:saga-recovery` (real Postgres + Redis, the per-tip guard)             | **# tests 33 · # pass 33 · # fail 0 · # cancelled 0 · # skipped 0**, runner exit 0 — the previous tip's count, reached                                                                                                                                                                                                                                               |
| §10.2's PR-1c fitness list (#1, #6, #21, #22, #7, #11, #16, #23, #40 A+B, #41, #4) | **all 0** — and the reason is structural rather than lucky: this candidate touches ZERO files under `apps/api/src`, `apps/workers/src`, `packages/adapters/` or `infra/`, which is the entire scope of #1/#6/#21/#22/#11/#16/#23/#41 and of #40 Part A. The row is listed because a fitness list the gate ran and the ledger did not name reads as a list nobody ran |

### Budget — measured, and the fourth consecutive under-count

Re-measured after the gate's nine corrections; the pre-correction figures were CODE 561 /
EVIDENCE 1088 / docs 361, which the gate confirmed.

| File                                                                  | Stream   | Changed lines |
| --------------------------------------------------------------------- | -------- | ------------: |
| `packages/core/posts/src/ExpireRetractionActionWindowUseCase.ts`      | CODE     |       **237** |
| `packages/core/posts/src/ConfirmManualRetractionUseCase.ts`           | CODE     |       **227** |
| `packages/core/posts/src/retractionRefusals.ts`                       | CODE     |        **76** |
| `packages/core/domain/src/entities/ChannelPublication.ts`             | CODE     |        **27** |
| `packages/core/posts/src/index.ts`                                    | CODE     |        **22** |
| `packages/core/domain/src/errors/DomainError.ts`                      | CODE     |        **16** |
| `packages/core/posts/src/SchedulePostUseCase.ts`                      | CODE     |        **13** |
| `packages/core/domain/src/aggregates/post/PostPublicationMethods.ts`  | CODE     |         **6** |
| `packages/core/posts/src/publicationWriteOutcome.ts`                  | CODE     |         **5** |
| `packages/core/domain/src/errors/index.ts`                            | CODE     |         **1** |
| `packages/core/posts/tests/unit/confirmManualRetraction.test.ts`      | EVIDENCE |       **561** |
| `packages/core/posts/tests/unit/expireRetractionActionWindow.test.ts` | EVIDENCE |       **445** |
| `apps/api/tests/unit/application/postUseCases.test.ts`                | EVIDENCE |        **91** |
| `packages/core/domain/tests/unit/channelPublication.test.ts`          | EVIDENCE |        **52** |
| `packages/core/domain/tests/unit/domainErrorCodes.test.ts`            | EVIDENCE |        **50** |
| `packages/core/posts/tests/unit/openPublicationEpisode.test.ts`       | EVIDENCE |        **42** |
| `.../recordChannelPublicationAttempt.test.ts`                         | EVIDENCE |        **32** |

| Stream       |                                                                                                                                                                         Measured | Forecast (§9.4.1) | Verdict                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: | ----------------: | --------------------------------------------- |
| **CODE**     |                                                                                                                                                                          **630** |               371 | **1.70× over** — `size:exception` recommended |
| **EVIDENCE** | **1273** tests, **1848** with this ledger + `tasks.md` + the backlog row (docs 575, measured by the orchestrator's numstat: the first pass carried `tasks.md` at its earlier 50) |               566 | **2.25× over** on tests alone                 |

**630 CODE is 1.58× the hard 400 budget, and it does NOT include T1c.6's record write** — the half
that is blocked would only have added to it. The cause is the same one `1c-1c` named and is now
measurable as a pattern rather than a surprise: roughly 190 of the 540 lines in the three new
`@core/posts` files are JSDoc that `CODING_STANDARDS §Documentation` makes mandatory on every file
and every public member, and the forecast costs bodies, not the canon they are written under.
`1c-1a` +135%, `1c-1b` +83%, `1c-1c` +54%, this one **+70%**.

**The +51% → +70% move is itself worth reading**: the corrective pass added 69 CODE lines, and 33 of
them are two DOMAIN fixes (`ChannelPublication` + its facet) that no forecast line item could have
predicted, because they are defects the unit's own tests found in code it did not write. The
line-item method costs what a task PLANS to write; `1c-1a` proved it misses deletions, and this one
proves it also misses the repairs a task's evidence turns up. **Nothing was compressed to fit**: no
comment, JSDoc or case was removed to reach a number.

### For Edward — the T1c.6 blocker, and the three shapes it leaves

> **T1c.6 cannot persist the declared target set without a decision that is not this unit's to
> take.** The task says `SchedulePostUseCase` calls `declarePublicationTargets` after
> `post.schedule()` and that REC-1's validated identities are PERSISTED. The mechanism the design
> named for that — the full `save()` upserting the records (design.md:189) — was DELETED by the 1b
> gate's own correction W1, which reverted both `upsertPublications` calls out of `doCreate`/`doUpdate`
> with a recorded red and named T1c.6 as the owner of what to do next. So the task's premise is
> stale, and every substitute costs something:
>
> - Calling `declarePublicationTargets` and then `save(post)` would mutate the aggregate and **drop
>   the records in silence** — measured: `tx.postChannelPublication.upsert` exists only in
>   `PostPublicationWrites.ts`.
> - Routing the write through `savePublication` **refuses every recurring and every bulk-scheduled
>   post**. `savePublication` refuses `undefined` and `__system__` (T1c.4a (v)), and
>   `RecurrenceScheduler.tick()` runs the whole chain inside `withSystemContext("recurrence-sweep")`
>   (`apps/api/src/recurring/RecurrenceScheduler.ts:82` → `CreatePostFromRecurrenceUseCase` →
>   `PostCreationAdapter.schedulePost` → `SchedulePostUseCase`), while `bulkScheduleWorker.ts` binds
>   no context at all (SMELL-145).
> - **Any two-save shape needs a `clearDomainEvents()` between the saves, and without it the
>   transaction ABORTS.** The full save writes `aggregate.domainEvents` to the outbox
>   (`PrismaPostRepository.ts:560` / `:698`) and so does the narrow one
>   (`PostPublicationWrites.ts:244`); `PrismaOutboxWriter.ts:55-57` inserts with `createMany` keyed on
>   `id: event.eventId` and **no `skipDuplicates`**, so the second insert is a P2002 on the same ids.
>   Not a torn write, a hard failure. The CAS is fine either way — `doUpdate` calls
>   `aggregate.incrementVersion()` (`PrismaPostRepository.ts:613`), so the narrow save's compare
>   matches — but the schedule then costs a second version bump.
>
> **The three shapes. The honest framing of (c) is the one that changed after the gate.**
>
> **(a) Re-add `upsertPublications` to the full save**, this time with the tests and the refusals 1b's
> W1 said were missing. One write, one version bump, matches design.md:189 literally — but it
> re-creates a SECOND production writer of the record and reverses a landed gate decision. W1's
> objection splits: the edit-tripwire half **dissolves** (the tripwire exists because the narrow save
> writes no content; the full save writes content), the projection-invariant half **does not** —
> `savePublicationRecord` calls `assertPublicationProjection()` (`PostPublicationWrites.ts:272-275`)
> and the full save calls nothing equivalent. Cost: invert or delete the red W1 left behind
> (`apps/api/tests/unit/infrastructure/PrismaPostRepository.test.ts:1242`), add the invariant to
> `doCreate`/`doUpdate`, and re-decide W1's ledger row.
>
> **(b) Keep the narrow save as the only writer and convert the recurrence sweep to a per-tenant
> re-read** — the shape the retraction sweep already uses (design.md:317 step 2). Canon-clean and it
> fixes a real asymmetry, but it needs `accountId` on `ProcessRecurrenceUseCase`'s output, it needs
> the **bulk worker bound too** (SMELL-145), it is in no 1c task, and it still needs the full save for
> `scheduledAt` — so the shape is full save → `clearDomainEvents()` → narrow save, inside one
> `executeResultInTransaction`.
>
> **(c) Is NOT "defer a `[static]` scenario" — it is dropping REC-1 for schedule mode.** The earlier
> framing understated it and the gate was right to say so. REC-1 is **MERGE-BLOCKING**
> (`specs/post-channel-publication-record/spec.md:88`: "Scheduling a post SHALL persist one
> publication record per intended channel … the record set SHALL be the system's answer to 'where was
> this post meant to go'"), its FIRST scenario is `[integration]` (`:103`: three channels scheduled →
> three records read back), and `design.md:523` assigns REC-1 ×3 `[integration]` to T1c.6. Under (c) a
> scheduled post holds ZERO records until the saga runs, so those three scenarios fail and the
> requirement's own sentence is false for the whole interval. It also blurs REC-13: "no record" stops
> meaning "a legacy post from before this change" and starts meaning "or any post scheduled normally
> and not yet published", so the fail-closed refusal can no longer name its own cause.
> **What (c) does NOT cost, measured**: no reader breaks. The gate found no C3 guard, `/start`
> admission, sweep or content-lock path that depends on the record between scheduling and publishing
> — so (c) is cheap in code and expensive in contract, which is exactly the trade that should be
> stated rather than buried.
>
> **The product question under (c), which is not a technical one**: for a post scheduled for later,
> does the customer see WHERE IT IS GOING? REC-1 says yes and makes the record the answer. (c) says
> no for the entire interval between scheduling and publishing.
>
> Nothing in this unit was changed in anticipation of any of them.

### What is deliberately NOT in this unit

T1c.6's `declarePublicationTargets` call (blocked, above); T1c.7's command token, handlers and
container registration (`1c-1e`); the confirm ROUTE and the sweep that call these two use cases
(`1c-3a` and `1c-3b`, orders 6 and 7). No DI token and no route was added here, so both new use
cases remain unreachable from production at this tip — the same property the order exists to keep,
re-measured below.

### Unreachable by claim — RE-MEASURED at this tip, not inherited

§9.4.1's ordering audit row 3 claims the retraction pair is unreachable because its only planned
callers are T1c.15 (order 6) and T1c.16 (order 7). Measured after the code landed: the two classes
are named by 4 files — the two that declare them, their two suites — plus the barrel this unit adds.
**The barrel entry is the one thing that changed**, and it makes them IMPORTABLE from `apps/api`
without making them REACHABLE: no container registration, no route, no handler and no scheduler
registration names either class, so nothing constructs one. That is a weaker claim than `1c-1c`'s
and it is stated as the weaker claim rather than copied forward.

### Follow-up after the fresh-context gate of `1c-1d` — PASS WITH WARNINGS, nine items

Every gate and budget figure was confirmed (CODE 561 / EVIDENCE 1088 / docs 361) and the T1c.6
blocker was confirmed independently. No Critical. The findings are what the unit stopped one
measurement short of, and three of them are defects in code this unit shipped.

| Id     | Finding                                                                                                                                                                                                                                        | Disposition                                                                                                                             |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **C1** | Shape (c) was framed as deferring a `[static]` scenario. REC-1 is MERGE-BLOCKING with a `[integration]` first scenario, and `design.md:523` assigns it ×3 to T1c.6 — so (c) DROPS a requirement for schedule mode rather than deferring a test | **FIXED** — the `For Edward` block is rewritten above, with the product question it was hiding                                          |
| **W1** | `refusalOf` compared against ONE literal while its signature promised the union: a second `RETRACTION_REFUSALS` member compiles clean and comes back `undefined` — the W3 defect it exists to prevent                                          | **FIXED** — the reader is now derived from the set; red recorded below                                                                  |
| **W2** | The ROOT's cutoff did not fail closed on a non-finite or negative window, while two JSDoc blocks said it did. `x < NaN` is false, so the record EXPIRED on it                                                                                  | **FIXED** at the entity, where ARCHITECTURE_CANON puts the invariant; both JSDoc sentences made true                                    |
| **W3** | `openEpisode` reset four fields but not `_retractionClearedCause`, so confirm → re-drive → confirm answered 200 instead of 409: the idempotency discriminator was not episode-scoped                                                           | **FIXED** — red at the entity AND at the use case, below                                                                                |
| **W4** | `makePublishedPost()` built a declared-but-unresolved channel, not a published one; and decision (1)'s named cost (a `RETRACTED` clearance answers 409) had no test at all                                                                     | **FIXED** — the fixture is split in two and both states are now exercised; the `markRetractionOutcome` case is added with its own probe |
| **W5** | Probe C ran the substitution in ONE of four use cases and inferred the rest                                                                                                                                                                    | **FIXED** — run in all four, four restores, transcript below                                                                            |
| **W6** | The bulk worker binds no tenant context while its siblings do; `accountId` is declared on its input and never read                                                                                                                             | **BACKLOG, not fixed here** — `docs/reports/roadmap-detected-smells-backlog.md`, **SMELL-145**                                          |
| **W7** | `RETRACTION_REFUSALS` / `RetractionRefusal` / `refusalOf` were package surface living inside a use-case file                                                                                                                                   | **FIXED** — new `packages/core/posts/src/retractionRefusals.ts`; T1c.11 told to extend it, not clone it                                 |
| **W8** | `as any` went 8 → 12 in `postUseCases.test.ts`, unmarked, and one of them coerced a structurally complete double                                                                                                                               | **FIXED** — the `UnitOfWork` cast is gone (the double is typed as the port), the other three are marked                                 |
| **W9** | The ledger said `new SchedulePostUseCase` had "2 production sites"; there is ONE. The gates table omitted §10.2's PR-1c fitness list                                                                                                           | **FIXED** — both corrected above                                                                                                        |

**W1's red — a declared member the reader silently drops.** With the literal comparison, adding a
second member to the set (the probe used `CHANNEL_HAS_LIVE_FRAGMENTS`, which T1c.11 will really add)
is accepted by the error class, satisfies the return type, keeps `tsc` at 0, and comes back
`undefined`:

```text
 FAIL  tests/unit/confirmManualRetraction.test.ts > refusalOf > recognises the declared refusal
   CHANNEL_HAS_LIVE_FRAGMENTS
AssertionError: Expected values to be strictly equal:
+ actual - expected
+ undefined
- 'CHANNEL_HAS_LIVE_FRAGMENTS'
      Tests  1 failed | 16 passed (17)
```

The permanent case iterates `Object.values(RETRACTION_REFUSALS)` instead of naming a member, so the
coverage is a property of the code. Probe restored byte-exact
(`3ef82d80f44a01b4…`, `sha256sum -c` → OK), the derived-set fix applied, and the probe RE-RUN against
the fix: **17/17**, then restored again (`add1704afd4d5225…` → OK).

**W2's red — at the entity this time, which is where probe A's hole was.** The use case's refusal
was real but it was the only one; the record itself expired on both values:

```text
 FAIL  tests/unit/channelPublication.test.ts > ChannelPublication > the action window > refuses a
   window that is not a finite number instead of expiring on it
AssertionError: the window the malformed argument would have closed is still open
+ actual - expected
+ 2026-03-05T13:00:00.000Z
- undefined

 FAIL  … > refuses a negative window instead of expiring on it
+ 2026-03-01T09:00:00.000Z
- undefined
      Tests  2 failed (49)
```

The negative case is the sharper one: `window: -1` expires the record at the very moment its window
OPENED. The entity now answers `err(InvariantViolationError)` rather than `applied: false`, and the
asymmetry is deliberate — `applied: false` means "the RECORD says there is nothing to do", while an
unusable duration is a fact about the CALLER. Collapsing them would let a misconfigured sweep report
`skipped` on every row forever, which is indistinguishable from a quiet night.

**W3's red — the discriminator was not episode-scoped.** At the entity:

```text
 FAIL  tests/unit/channelPublication.test.ts > ChannelPublication > clearing live fragments >
   returns the clearance FORGOTTEN once a new episode opens over it
AssertionError: the previous episode's clearance does not describe this one
+ actual - expected
+ 'MANUALLY_REMOVED'
- undefined
```

and at the use case, where the consequence is the customer-visible one:

```text
 FAIL  tests/unit/confirmManualRetraction.test.ts > … > refuses a confirmation of a channel
   RE-DRIVEN since the customer cleared it
AssertionError: there is nothing live on the re-driven channel to confirm
- Expected  true
+ Received  false
```

`openEpisode` now resets the clearance pair beside the seven fields it already cleared. Checked
before changing it: `strand()` already resets the same pair (`ChannelPublication.ts:890-891`), so
this is the entity's own convention through its other door; `alertTransition`'s resolve branch
cannot read a stale cause because `openEpisode` clears `_retractionAlertHash` first; and
`UNRESOLVED_FORBIDDEN_FACTS` does not list the pair, so `reconstitute` is unaffected. **Should the
pair join `UNRESOLVED_FORBIDDEN_FACTS`? Asked, and closed as NO by the re-gate, for two measured
reasons.** (1) The list cannot take it without changing its meaning: it is typed
`satisfies readonly (keyof ChannelPublicationState & (keyof PublishedFacts | keyof ExcludedFacts))[]`
with a compile-time coverage assertion (`ChannelPublication.ts:173-180`), and the clearance pair is
top-level state, not a member of either facts interface — adding it fails `tsc` until the constraint
and the coverage check are both loosened, i.e. "settled facts an unresolved record cannot hold" would
have to mean something else. (2) The remedy is heavier than the defect: the list refuses at
RECONSTITUTION, so a legacy row carrying the pair would make the whole post fail to hydrate — a
fail-closed on the entire aggregate for a field one use case reads and no view exposes. The state is
also unreachable in memory (`clearLiveFragments` leaves `_excluded` intact, so a confirmed channel is
EXCLUDED, not UNRESOLVED) and the only door to it is a row written by a tip before this correction,
which no released capability produced. If it ever exists, the proportionate instrument is a
one-column data migration or an episode-scoped read, not the reconstitution refusal.

**W3's fixture correction, same class as `1c-1c`'s two.** The first draft of the use-case case
re-drove with `enterPublishing: false` and failed at the FIXTURE line, not the subject: the derived
word after a stranding is `FAILED`, and a delayed re-drive of a `FAILED` post is refused by the
aggregate (D9 / Q14). Production was right, the test was wrong; the case re-drives through
publish-now, which is the only re-drive route.

**W4's probe — the decision that case exists to pin.** Widening the discriminator to
`retractionClearedCause !== undefined` (the alternative decision (1) rejected) turns the new case
green-to-red in the direction that matters:

```text
 FAIL  … > refuses a confirmation of a channel a RETRACTION already cleared
AssertionError: a clearance nobody's confirmation produced is not a duplicate
- Expected  true
+ Received  false
```

Restored byte-exact (`419cd2e812263bca…` → OK).

**W5 — probe C, now in all four.** The same substitution
(`return await doWork()` → a "no transaction seam" error) applied to all four use cases at once:

```text
 ❯ tests/unit/expireRetractionActionWindow.test.ts   (15 tests | 2 failed)
 ❯ tests/unit/confirmManualRetraction.test.ts        (19 tests | 2 failed)
 ❯ tests/unit/recordChannelPublicationAttempt.test.ts (15 tests | 2 failed)
 ❯ tests/unit/openPublicationEpisode.test.ts         (20 tests | 2 failed)
      Tests  8 failed | 88 passed (96)
```

Two per use case, eight in all — the inference in the first hand-back is now a measurement. All four
restored byte-exact in one `sha256sum -c` pass.

### Gates re-run after the nine corrections

| Gate                                                                                                         | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@core/domain` vitest                                                                                        | **10 files, 190 passed** (was 187; +3 entity cases)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `@core/posts` vitest                                                                                         | **6 files, 96 passed** (was 90; +6 cases)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `tsc --noEmit` `@core/domain` · `@core/posts` · `apps/api` (6144)                                            | **0 · 0 · 0**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/api` unit tier, full                                                                                   | **586 files, 9118 passed, 0 failed, 0 skipped**, exit 0 — re-run because `openEpisode` changed domain behaviour a consumer could see. This is the SECOND run; see the incident below                                                                                                                                                                                                                                                                                                                                                                                                    |
| `eslint --max-warnings 0` on every changed `.ts` · `prettier -c` on every changed file · `pnpm format:check` | **0** · clean · clean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `pnpm check:circular`                                                                                        | clean, **1607** files (the first pass wrote 1606, the count before `retractionRefusals.ts` existed — a copied-forward number, re-measured by the re-gate)                                                                                                                                                                                                                                                                                                                                                                                                                               |
| fitness #3 / #4 / #5 / #8 / #9 / #10 / #32 · #40 A+B                                                         | 0 · 0 · 0 · 0 · 0 · 0 · 0 · A 3 seams (floor 3) / 0, B 14 sites (floor 10) / 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `integration:saga-recovery`                                                                                  | NOT re-run after the corrections, on a measurement rather than an assertion: `PostAggregate.openPublicationEpisode` has exactly ONE production caller tree-wide (`OpenPublicationEpisodeUseCase.ts:230`) and the entity's window guard is reachable only through `ExpireRetractionActionWindowUseCase` — both unregistered (zero hits in `apps/api/src` + `apps/workers/src`), so no production path, saga or otherwise, can reach either changed method at this tip; 33/33 stands from the pre-correction tip, and the api unit tier (where a domain consumer would notice) WAS re-run |

**Incident on the FIRST api-tier run, recorded rather than re-rolled.** It exited **1** with **zero
failed tests**: `Test Files 585 passed (586) · Tests 9116 passed (9118) · Errors 1 error`, the error
being `[vitest-pool]: Worker forks emitted error … Caused by: Error: write EPIPE`. A worker fork died
and took one file's two results with it, so that run is a NON-RESULT — neither a pass nor a failure —
and it is written down because a gate that exits 1 and is quietly re-run until green is not a gate.
It did NOT reproduce: the second run reached **586 / 9118, exit 0**, the exact count of the
pre-correction tip, over the identical tree. Host memory at the re-run: 9216 MB total, 7840 MB
available, so exhaustion is not the explanation and **the cause is UNDIAGNOSED**. What rules this
candidate out: a behavioural break from the `openEpisode` change would surface as a failing assertion
in a named suite, not as a dead IPC channel, and both runs bracket the same bytes. The re-gate added
the measurement that names the victim's shape: the failed run lost ONE file and exactly TWO tests
(585/586, 9116/9118 — collected totals, so the dead file was collected and held two cases), and no
file this candidate touches has two tests (`postUseCases.test.ts` has 47; the `packages/core` suites
are not in the api tier). The fork that died was running a file this candidate does not touch. Loop
left open: the file is not named — the run log was not kept. If EPIPE recurs on this tier it gets a
backlog row of its own (a known vitest-forks class: worker crash / pool teardown race), not a
paragraph per unit; this is the second infrastructure non-result this change has recorded.

### RDD receipt — the committed range `8454bab9` → `6e5408ac`

Lineage `review-ac9ff6594d2303bc`, MEDIUM tier, ONE reliability lens. The review reached
**approved** on its first admitted capture, the acknowledgement was executed exactly once and the
authority is **burned**; **zero findings** — no Critical, no WARNING, no SUGGESTION — so nothing is
carried forward from it to another unit.

---

## PR 1c — grandchild `1c-1d`, SECOND HALF (T1c.6 + T1c.6a + T1c.6b + T1c.6c) — COMPLETE

Same branch, continuing from `6e5408ac`. Subject: **Edward's shape (b) with a LOUD refusal**, decided
2026-09-20 after the first half reported T1c.6's record write as blocked. The blocker is resolved,
not worked around: `savePublication` stays the only writer of publication records, the schedule path
persists the declared target set through it, both schedulers that reach that path are bound per
tenant, and the FULL save refuses rather than dropping records in silence.

### The ordering constraint, solved by measurement rather than by argument

The instruction posed it as a possible dead end: the narrow save carries a tripwire, the full save
was to gain its mirror, and a sequence might exist that satisfies neither. Two measurements settled
it, and the first CORRECTS the instruction's own premise.

**1. `PUBLICATION_TRIPWIRE_EVENTS` is not what the brief described.** It was described as "the set of
publication-family events the narrow save is FOR". Measured
(`PostPublicationWrites.ts:57-61`), it is the set of **EDIT** events the narrow save REFUSES —
`PostContentUpdated`, `PostMediaAdded`, `PostMediaRemoved` — because the narrow save writes no
content statement and would lose the edit. So the narrow save's tripwire never fires on a
publication event at all, and "full save → clear → declare → narrow save" cannot refuse at step 1
for the reason the brief anticipated.

**2. `declarePublicationTargets` emits NO domain event.** It calls `replaceRecords` and `touch` and
returns (`PostPublicationMethods.ts:90-114`). Two consequences, and the second is the load-bearing
one:

- the declaration adds nothing to the outbox, so ONE `clearDomainEvents()` before it is sufficient;
- **an event-based refusal on the full save cannot see the drop it exists to prevent.** The brief
  proposed the mirror as "the full save refuses an aggregate whose pending events include a
  publication-family event". Against `declarePublicationTargets()` + `save()` — the exact case
  Edward's item (5) names — that check passes, because there is no event. Implementing it would have
  produced a refusal that looks like a guard and guards nothing.

So the refusal keys on the RECORDS, not on the events: the aggregate tracks whether it owes a
publication write and the full save asks it. **The sequence, and why each step cannot move:**

| #   | Step                                    | Why it is there                                                                                                                                                                                                                                                                           |
| --- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `post.schedule()`                       | emits `PostScheduled`; changes no record                                                                                                                                                                                                                                                  |
| 2   | FULL save                               | writes `scheduledAt`, content, media, and `PostScheduled` to the outbox. Must precede the declaration, because it refuses an aggregate that owes a publication write                                                                                                                      |
| 3   | `dispatchAll` + `clearDomainEvents()`   | the outbox already holds those ids. Both adapters hand `aggregate.domainEvents` to `PrismaOutboxWriter`, which inserts with `createMany` keyed on `id: event.eventId` and NO `skipDuplicates` — carrying them into step 5 is a **P2002 that aborts the transaction**, not a duplicate row |
| 4   | `declarePublicationTargets(channelIds)` | records the validated identities. Emits nothing, so step 3 stays sufficient                                                                                                                                                                                                               |
| 5   | NARROW save                             | the only writer of the records. Carries zero events, so the edit tripwire is satisfied by construction, and it clears the aggregate's debt                                                                                                                                                |

Both tripwires hold at their own save, every domain event reaches the outbox exactly once, and both
saves run inside the ONE `executeResultInTransaction` the use case already opened. Pinned by
`writes the full save FIRST and the narrow save SECOND, each carrying its own events`, which counts
event ids across both writes and asserts the set has no duplicate.

### What each mechanism is, as built

| Mechanism                     | As built                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1c.6 — the schedule path     | the five-step sequence above. The parsed `ChannelId[]` from the existing validation loop is now KEPT rather than discarded — REC-1's `[static]` scenario is satisfied by the identities that were already validated, not by re-parsing them                                                                                                   |
| T1c.6c — the loud refusal     | `PostAggregate._publicationsDirty`, set by the publication context's `replaceRecords` and by the five facet functions that mutate a RECORD, read by `PrismaPostRepository.save` (which answers `err(InvariantViolationError)` naming `savePublication`, before any statement) and cleared by `writePublicationSave` beside `incrementVersion` |
| T1c.6a — the recurrence sweep | discovery stays inside `withSystemContext("recurrence-sweep")`; the per-row create-and-schedule chain moved OUT of it into `withTenantContext({ accountId })`. `ProcessedRecurrence` gains `accountId` from the entity that already held it. A row without an account is skipped with a named reason and counted                              |
| T1c.6b — the bulk worker      | `withTenantContext({ accountId })` around the row, from the payload field that was declared and never read; a payload with no account is refused with a named reason rather than run under the system scope                                                                                                                                   |

### The recorded reds

**T1c.6b** — the row ran with no tenant bound:

```text
 × runs the use case INSIDE a tenant context bound to the payload's account
AssertionError: the row runs in the account its payload names
undefined !== 'a1'
 × refuses a row whose payload names no account, rather than running unbound
      Tests  2 failed (8)
```

**T1c.6a** — the chain ran under the system scope, and the skip path did not exist:

```text
 × runs the create-and-schedule chain under the ROW's tenant, not the system scope
AssertionError: expected { account: undefined, system: true } to deeply equal
                        { account: 'acct-1', system: false }
 × skips a due recurrence that carries no account, with a named reason
      Tests  2 failed | 6 passed (8)
```

**T1c.6c** — the full save accepted an aggregate whose records it would not write:

```text
 × REFUSES the full save when the aggregate carries publication changes it will not write
AssertionError: expected true to be falsy
 × admits the full save for an aggregate whose publication records it did not touch
TypeError: post.markPublicationsPersisted is not a function
      Tests  2 failed | 54 passed (56)
```

**T1c.6** — nothing persisted the targets, and only one save ran:

```text
 × PERSISTS the validated identities through the narrow save, not only in the DTO
AssertionError: expected "vi.fn()" to be called once, but got 0 times
 × writes the full save FIRST and the narrow save SECOND, each carrying its own events
AssertionError: expected [ 'full' ] to deeply equal [ 'full', 'narrow' ]
      Tests  2 failed | 47 skipped (49)
```

### Two corrections the runs forced, both in code this unit wrote

**1. The dirty marker was in the wrong place, and `integration:saga-recovery` is what said so.**
The first version marked inside the publication context's `touch()`, reasoning that the context is
built only for the publication facet so marking there covers every mutation and every future one.
That reasoning is true about REACHABILITY and false about MEANING: `touch()` is the facet's generic
"something changed" hook, and `markAsPublishedWithoutRecord` calls it while changing the post's WORD
and no record at all. The publish-now promotion does exactly that and then uses the full save, so
the refusal fired on a correct caller:

```text
 integration:saga-recovery   33 tests  10 pass  2 fail  21 cancel  exit 1
 hookFailed: the pre-crash run must finish cleanly or the replay proves nothing
             (error=Failed to save the promoted post)
 + 'FAILED'  - 'COMPLETED'
```

The marker now keys on RECORD changes: `replaceRecords` (the declaration, which emits nothing) plus
the five facet functions that mutate a record entity — and NOT `markAsPublished`, `markAsFailed`,
`startPublishing` or `reconcilePublicationProjection`, which move only the word. After the rework:
**33/33, exit 0**. The unit tiers were green through both versions; only an end-to-end batch could
see it, which is the per-tip guard earning its place for the second time in this change.

**2. The REC-1 integration fixture used the wrong enum spelling.** `provider: "x"` against
`enum Provider { X … }` — `Invalid value for argument 'provider'. Expected Provider.` in the `before`
hook, which cancels every case in the file. Domain outcome kinds are lowercase and the Prisma enum is
not, a split the adapter already carries a mapping table for; the suite was written from the domain
half of it.

### Doubles updated — the mandatory `rg` over `**/tests/**`

| Member                                                                             | Search                                                                    | Result                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ProcessedRecurrence.accountId` (new REQUIRED field)                               | `rg -n 'recurringPostId: "rec-' apps packages infra --glob '**/tests/**'` | 4 fixtures in `apps/api/tests/unit/recurring/RecurrenceScheduler.test.ts` (`rec-1`, `rec-2`, `rec-ok`, `rec-fail`) — all four updated. `CreatePostFromRecurrenceUseCase.test.ts:79` builds that use case's INPUT, not a `ProcessedRecurrence`, and is correctly untouched                                                                                                        |
| `PostAggregate.markPublicationsPersisted` / `hasUnsavedPublications` (new members) | `rg -n 'savePublication' apps packages --glob '**/tests/**'`              | the `PostRepository` doubles that stub `savePublication`. `postUseCases.test.ts`'s double was updated to implement BOTH halves of the production contract — refuse on `hasUnsavedPublications()`, clear on a narrow save — so the suite is tested against the contract rather than a laxer one. The `@core/posts` doubles need neither: those use cases never call the full save |
| `PublicationContext.markRecordsChanged` (new member)                               | `rg -n 'PublicationContext' apps packages --glob '**/tests/**'`           | zero hits — no test builds a `PublicationContext`; only the root constructs one                                                                                                                                                                                                                                                                                                  |

### The `run_batch` wiring, proved by the runner's own count

Fitness #30's rule is that a suite no `run_batch` names never executes. The new suite is named by a
new batch, and the proof is the runner's per-batch line rather than an assertion that the line exists:

```text
  integration:schedule-target-set    3 tests     3 pass  0 fail  0 cancel  0 skip  exit 0  [OK]
```

It is its OWN batch rather than an append to `integration:repositories`, because its subject is a
USE CASE's persistence contract rather than a repository's, and a separate batch makes its count
independently visible — which is what turned the wiring into a measurement here.

### REC-1's three `[integration]` scenarios, and the one asserted in a weaker form

Scenario 1 (three channels → three unresolved records) and scenario 2 (the set is answerable with no
saga row in existence — asserted by counting `SagaInstance` rows for the post, which is zero) are
proved in their full form. **Scenario 3 is not, and the suite says so in its own header**: "a channel
that never ran is recorded, not missing" is exercised in its SCHEDULE-time form, where no job has run
for any channel. Its post-publish form — one channel of a real publish never reporting — needs the
worker's attempt writes and belongs to the unit that adds them. A scenario asserted in a weaker form
than its text is a scenario half-proved, and naming that is cheaper than discovering it later.

### Design-silent decisions

1. **The refusal keys on records, not events** — forced by measurement (above). The rejected
   alternative is the one the brief proposed.
2. **`markRecordsChanged` is a context method, not a `touch()` side effect** — the first shape was
   the second, and the integration tier refuted it. The separation states that changing the WORD and
   changing a RECORD are different facts, which is the whole distinction between the two saves.
3. **The recurrence binding is SEQUENTIAL to discovery, not nested inside it** — not a style choice:
   `resolveGucScope` answers the system sentinel whenever a system context is present, so a nested
   `withTenantContext` binds `__system__`.
4. **The bulk worker refuses rather than skipping** an account-less payload: a skip resolves the job
   and loses the row silently; a throw lets BullMQ retry and then routes it to the DLQ, which is
   where a payload that cannot be processed belongs.
5. **T1c.6b binds at the WORKER, not in `ProcessBulkScheduleRowUseCase`** — the use case is
   `@core/bulk-scheduling` and the tenant context is `apps/api` infrastructure; binding there would
   put an infrastructure concern in the core and break the layering fitness gates. The three sibling
   in-process consumers bind at the handler for the same reason.

### Gates

| Gate                                                                                                          | Result                                                                                     |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `@core/domain` vitest                                                                                         | **10 files, 190 passed**                                                                   |
| `@core/posts` vitest                                                                                          | **6 files, 96 passed**                                                                     |
| `@adapters/db-prisma` vitest                                                                                  | **70 passed**                                                                              |
| `tsc --noEmit` `@core/domain` · `@core/posts` · `@core/recurring` · `@adapters/db-prisma` · `apps/api` (6144) | **0 · 0 · 0 · 0 · 0**                                                                      |
| `apps/api` unit tier                                                                                          | **586 files, 9125 passed, 0 failed**, exit 0 (JSON reporter run; see the EPIPE note below) |
| DB integration tier, `TIER=pr-integration` through the real runner                                            | **TOTAL: 534 tests, 534 pass, 0 fail, 0 cancel, 0 skip**, exit 0                           |
| `integration:schedule-target-set` (new)                                                                       | **3 tests · 3 pass · 0 fail · 0 cancel · 0 skip**, exit 0                                  |
| `integration:saga-recovery` (the mandatory per-tip guard)                                                     | **33 tests · 33 pass · 0 fail · 0 cancel · 0 skip**, exit 0                                |
| `integration:repositories` (holds the integration `PrismaPostRepository` suite)                               | included in the tier run above, exit 0                                                     |

**The EPIPE, third occurrence — the log is kept and the file is still NOT named.** The api tier's
first run this half exited **1** with zero failed tests again:
`Test Files 585 passed (586) · Tests 9123 passed (9125) · Errors 1 error`,
`[vitest-pool]: Worker forks emitted error … write EPIPE`. Two runs were then made specifically to
identify the dead file and BOTH came back clean — a JSON-reporter run (`586 / 9125`, exit 0) and a
`--reporter=verbose` run that prints every file as it completes (`586 / 9125`, exit 0). So it is
4 clean runs against 2 failures across the two halves, and the instrumentation that WOULD name it
was in place for a run that did not fail.

What is known rather than guessed: the dead file holds **exactly two tests** (586 − 585 = 1 file,
9125 − 9123 = 2 tests), and the previous occurrence lost 2 tests as well, so it is plausibly the
same file both times. Thirteen files in this tier have exactly two tests, and naming one of them
would be a guess:

```text
adminAuthRoutes.resetConfirm · backfillAdminMfaBackupCodesIsolation · sagaRetryRecovery
GetPostWithThreadQuery.ownership · ListPostsGlobalQuery.ownership · ListPostsUseCase.ownership
providerOAuthX.pilot · HttpClientPort.contract · mentionFetchEnqueue
FailBulkScheduleRowUseCase · ListGlossaryByLocaleQuery · ListStyleGuideRulesByLocaleQuery
setupExternalNotificationUseCases
```

**The run logs are kept** in this run's scratchpad (`api-unit4.out` is the failing one,
`api-verbose.out` the instrumented clean one). The instrumentation that names it is
`--reporter=verbose`: the last `✓` line before the error identifies the file whose worker died. The
honest state is that this is an intermittent pool failure nobody has yet caught under a reporter
that would name it, and it has never coincided with a failing assertion.

| Gate                                                      | Result                                                                                                                                         |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check:circular`                                     | clean, 1607 files                                                                                                                              |
| `eslint --max-warnings 0` on the 14 changed `.ts`         | **0**                                                                                                                                          |
| `prettier -c` on every changed file · `pnpm format:check` | clean · clean (`run-tests.sh` excluded from the file list: prettier infers no parser for shell, and the repo script does not format it either) |
| fitness #3 / #4 / #5 / #8 / #9 / #10 / #32                | 0 · 0 · 0 · 0 · 0 · 0 · 0                                                                                                                      |
| fitness #21 / #23                                         | 0 · 0                                                                                                                                          |
| fitness #38                                               | swept **0** · `db-prisma` ratchet **11**, unchanged                                                                                            |
| fitness #40                                               | A: 3 seams (floor 3) / **0** · B: 14 sites (floor 10) / **0**                                                                                  |
| fitness #41                                               | sites 8 (floor 8), exception hits 1, violations **0**                                                                                          |

### Budget — this half, measured

| File                                                                   | Stream   | Changed lines |
| ---------------------------------------------------------------------- | -------- | ------------: |
| `apps/api/src/recurring/RecurrenceScheduler.ts`                        | CODE     |        **75** |
| `packages/core/posts/src/SchedulePostUseCase.ts`                       | CODE     |        **49** |
| `packages/core/domain/src/aggregates/PostAggregate.ts`                 | CODE     |        **43** |
| `apps/api/src/bulk-scheduling/bulkScheduleWorker.ts`                   | CODE     |        **83** |
| `packages/adapters/db-prisma/src/post/PrismaPostRepository.ts`         | CODE     |        **23** |
| `packages/core/domain/src/aggregates/post/PostPublicationTypes.ts`     | CODE     |         **7** |
| `packages/core/recurring/src/ProcessRecurrenceUseCase.ts`              | CODE     |         **7** |
| `packages/core/domain/src/aggregates/post/PostPublicationMethods.ts`   | CODE     |         **5** |
| `packages/adapters/db-prisma/src/post/PostPublicationWrites.ts`        | CODE     |         **4** |
| `apps/api/tests/integration/schedulePostTargetSet.integration.test.ts` | EVIDENCE |       **193** |
| `apps/api/tests/unit/recurring/RecurrenceScheduler.test.ts`            | EVIDENCE |        **94** |
| `apps/api/tests/unit/application/postUseCases.test.ts`                 | EVIDENCE |        **84** |
| `apps/api/tests/unit/bulk-scheduling/bulkScheduleWorker.test.ts`       | EVIDENCE |        **38** |
| `apps/api/tests/unit/infrastructure/PrismaPostRepository.test.ts`      | EVIDENCE |        **33** |
| `apps/api/scripts/run-tests.sh`                                        | EVIDENCE |        **10** |

**This half, CORRECTED after the gate re-measured it: CODE 237 · EVIDENCE 442 · SCRIPTS 10 ·
DOCS 349.** The first figures counted `run-tests.sh`'s 10 lines inside EVIDENCE (it is a harness
SCRIPT, its own stream) and understated DOCS by 54. With the committed first half (`6e5408ac`, CODE
630 / EVIDENCE 1273 / docs 550) the unit totals **CODE 867 · EVIDENCE 1715**, against a §9.4.1
forecast of 371 / 566 — **2.34×** and **3.05×**.

The forecast is not the right comparison and saying so is more useful than restating the ratio:
**three of the four tasks in this half did not exist when §9.4 was written.** T1c.6a, T1c.6b and
T1c.6c are Edward's shape-(b) decision, taken after the first half measured T1c.6's blocker, and a
line-item forecast cannot cost a decision that a later measurement forces. What the number does say
is that T1c.6 was never a 371-line task: persisting the target set required a tenant binding in two
schedulers and a refusal in the full save, and the original estimate costed only the call site.

### For Edward — one product question this half raises, unanswered

> **A recurrence whose row carries no `accountId` is now SKIPPED rather than created.** The field is
> non-optional on the entity, so the case should be unreachable — but the scheduler refuses instead
> of assuming, because the alternative is creating a post under the system scope and writing it
> wherever its ids point. The skip is counted in the tick summary (`skipped`) and logged per row.
> **The question is whether silence is enough**: nothing alerts on it, so a systematic cause (a
> migration that left rows behind, a repository that stops selecting the column) would show up only
> as posts quietly not being created. The same applies to the bulk worker's refusal, which at least
> routes to the DLQ after retries. If these should raise rather than only count, that is a metric and
> an alert rule, and it belongs with the sweep's own alerting (T1c.18) rather than here.
>
> **The PAIR, stated for your eye because two people would not choose it independently.** The two
> refusals this half added answer the same condition — a job/row that names no account — in opposite
> ways: the **bulk worker THROWS** (BullMQ retries, exhausts, routes to the DLQ, and the manifest
> records a terminal failure), the **recurrence sweep SKIPS** (a warn log and a `skipped` counter,
> and the tick moves on). Each is locally defensible: a queue job has a retry-and-DLQ apparatus to
> fall into, and a sweep that threw would abandon every later row in the same tick. But they are two
> local calls that ought to be one stated decision, and nobody has taken it. **A third variant lives
> inside the bulk worker itself** (re-gate finding): the row path THROWS on a missing account
> (`bulkScheduleWorker.ts:63-70`), the failure callback RETURNS (`:144-150`, logs and skips) — so an
> account-less payload's terminal failure is never recorded and its batch never settles, the exact
> outcome the callback's binding exists to prevent, in the one case it cannot reach. Unreachable in
> practice (the primary producer guards `accountId` at `BulkScheduleDispatchEventHandler.ts:68-82`);
> it belongs to the same decision.

### Follow-up after the fresh-context gate of the second half — PASS WITH WARNINGS, one Critical

Every measurable claim was confirmed (three integration counts, five `tsc`, three package suites,
all fitness), and the loud refusal was judged SOUND. One Critical, eight warnings.

| Id       | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Disposition                                                                                                               |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **C1**   | `SchedulePostUseCase` dispatched events INSIDE its transaction. `ComposedEventDispatcher.dispatchAll` (`:75-92`) runs in-process handlers and then a BullMQ `publishBatch` — the external call ARCHITECTURE_CANON §UoW Rules forbids in a transaction. A pre-existing placement, DORMANT before because nothing fallible followed it; my sequence put `declarePublicationTargets` and `savePublication` after it, so a narrow-save failure or a declare conflict now rolled back a schedule consumers had already been told about | **FIXED** — events captured before the clear, dispatched after the transaction resolves `ok`, nothing dispatched on `err` |
| **(i)**  | In all five facet functions the mark sat at the END, after `applyDerivedStatus`'s `err` branch — so a refused call left a MUTATED record reading CLEAN                                                                                                                                                                                                                                                                                                                                                                            | **FIXED** — moved to immediately after each entity mutation                                                               |
| **(ii)** | `PostAggregate.publications` hands out the LIVE mutable entity, so a caller could mutate outside the marking                                                                                                                                                                                                                                                                                                                                                                                                                      | **RECORDED** — measured (4 production call sites, all reads); backlog **SMELL-147**                                       |
| **W1**   | REC-1 scenario 2 asserted `sagaInstance.count === 0` — "never had one", not "OUTLIVES one" — and the ledger called it full                                                                                                                                                                                                                                                                                                                                                                                                        | **FIXED** — a terminal saga row is seeded and the records are then read without it                                        |
| **W2**   | `markPublicationsPersisted()` runs before the outbox write and before commit                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **RECORDED** below as the same weakness, not only as a precedent                                                          |
| **W3**   | The recurrence skip has a log but no metric                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **ROUTED** to T1c.18, and the PAIR stated for Edward above                                                                |
| **W4**   | SMELL-145 residual (3) is a LIVE pre-existing defect: `handleBulkScheduleRowFailure` runs outside the binding and writes tenant-scoped rows, so the guard throws for every retry-exhausted row and the batch never settles                                                                                                                                                                                                                                                                                                        | **FIXED** — the failure callback binds from the same payload field, refusing when absent                                  |
| **W5**   | Three new `!.` in `postUseCases.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **FIXED** — `toHaveLength` + destructuring; zero `!.` remain in the file                                                  |
| **W6**   | The EPIPE has no backlog row                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | **ADDED** — **SMELL-146**                                                                                                 |
| **W7**   | Ledger completeness                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | **THIS SECTION**                                                                                                          |

**C1's red, and what it shows.** The order log records the dispatch alongside the saves:

```text
 × dispatches the events only AFTER the transaction has closed
AssertionError: expected [ 'full', 'dispatch', 'narrow' ] to deeply equal
                        [ 'full', 'narrow', 'dispatch' ]
 × dispatches NOTHING when the transaction rolls back
AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times
      Tests  2 failed | 3 passed | 46 skipped (51)
```

`['full','dispatch','narrow']` is the defect in one line: the world was told between the two saves.
The fix costs nothing in durability — the events are in the OUTBOX from the full save, so a crash
between the commit and the dispatch is exactly what the relay recovers. One follow-on the red also
forced: the sequence case now filters the order log to SAVES before counting event ids, because the
dispatch carries the same ids the full save wrote and counting it would read the outbox contract's
own success as a duplicate.

**The other four in-transaction dispatchers, measured — and one is NOT dormant.** The gate's premise
was that they all have nothing fallible after the dispatch. Three do:
`CreatePostUseCase.ts:204`, `UpdatePostUseCase.ts:183`, `DuplicatePostsBatchUseCase.ts:189` (that one
inside a LOOP, so later iterations follow earlier dispatches). **`CreatePostFromRecurrenceUseCase.ts:199`
does not**: it dispatches and then calls `postCreation.schedulePost(...)`, which is fallible. It
compounds with a second pre-existing defect in the same function — `executeInTransaction` with a
`let result` capture, the ADR-0023 hazard, so an `err` resolves the callback and the partial write
commits instead of rolling back. All four are **NOT fixed here** and are backlog **SMELL-148**, with
the recurrence one named as the live member to take first.

**(i)'s red, and the branch that turned out unreachable.** The instruction suggested driving
`applyDerivedStatus`'s `err` branch. Measured: **it is not reachable from a real mutation.** The
three `*FromRecord` arms err only when `derive()` disagrees with the value `applyDerivedStatus` just
read from it, and the `PUBLISHING` arm calls `startPublishing` only after `canTransitionTo` already
said yes. A first attempt built a CANCELLED post whose record derives `PUBLISHED` and it did NOT
refuse — `markAsPublishedFromRecord` sets the status directly and consults no FSM.

A genuinely reachable refusal after a real mutation exists elsewhere, so no probe was needed:
`openPublicationEpisode` opens the episode on every re-drivable record FIRST and runs the lifecycle
check that refuses a delayed re-drive of a `FAILED` post (D9 / Q14) AFTER.

```text
 × reads TRUE after a mutation whose call then REFUSED
AssertionError: a mutated record is owed a publication write even when the call returned err
```

The case is permanent rather than probe-only, which is the better outcome of the two the instruction
allowed.

**W2, named as the weakness it is.** `markPublicationsPersisted()` runs at
`PostPublicationWrites.ts:242`, before the outbox write at `:245` and before the transaction commits.
So an aggregate whose transaction later ROLLS BACK reads clean while the database holds none of its
records. It is the same weakness `incrementVersion` has had in the same function, and citing that
precedent is an explanation, not a defence: both make the in-memory aggregate claim a durability the
transaction has not yet granted. It is bounded in practice because the aggregate is discarded with
the failed request, and the seam that would fix both — persisting these marks after the commit —
belongs to whoever revisits `writePublicationSave`, not to this unit.

**The nesting sweep.** `withTenantContext` nested inside `withSystemContext` binds the system
sentinel; `RecurrenceScheduler` was the only instance and it is fixed. Measured across the tree: **no
second instance**. The durable guard — `withTenantContext` refusing or logging at ERROR when
`getSystemContext()` is already set — is backlog **SMELL-149**, not done here because it changes a
primitive every tenant-bound path runs through.

**Figures corrected.** Four carried-forward numbers were wrong and are fixed above: EVIDENCE 442 (not
452 — `run-tests.sh` is a SCRIPTS stream, not evidence), DOCS 349 (not 295), eslint on 14 changed
`.ts` (not 17), unit-total EVIDENCE 1715 (not 1725).

### Gates after the corrections

| Gate                                                                                                          | Result                                                        |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `@core/domain` vitest                                                                                         | **10 files, 191 passed** (was 190; +1 marker case)            |
| `@core/posts` vitest                                                                                          | **6 files, 96 passed**                                        |
| `@adapters/db-prisma` vitest                                                                                  | **4 files, 70 passed**                                        |
| `tsc --noEmit` `@core/domain` · `@core/posts` · `@core/recurring` · `@adapters/db-prisma` · `apps/api` (6144) | **0 · 0 · 0 · 0 · 0**                                         |
| the four touched `apps/api` unit suites                                                                       | **4 files, 125 passed**                                       |
| `integration:repositories`                                                                                    | **157 tests · 157 pass · 0 fail · 0 cancel · 0 skip**, exit 0 |
| `integration:schedule-target-set`                                                                             | **3 · 3 · 0 · 0 · 0**, exit 0                                 |
| **`integration:saga-recovery`**                                                                               | **33 · 33 · 0 · 0 · 0**, exit 0                               |
| DB tier total (`TIER=pr-integration`)                                                                         | **534 tests, 534 pass, 0 fail, 0 cancel, 0 skip**, exit 0     |
| `pnpm check:circular`                                                                                         | clean                                                         |
| `eslint --max-warnings 0` on the 15 changed `.ts` · `prettier -c` · `pnpm format:check`                       | **0** · clean · clean                                         |
| fitness #3 #4 #5 #8 #9 #10 #32 #21 #23                                                                        | 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0                             |
| fitness #40                                                                                                   | A 3 seams (floor 3) / **0** · B 14 sites (floor 10) / **0**   |
| fitness #41                                                                                                   | sites 8 (floor 8), exception hits 1, violations **0**         |

**One gate lied to me, in the way this change has a rule about.** A first eslint invocation piped
into `rg` to strip the `[boundaries]` deprecation noise and reported exit **1** — which was `rg`'s
exit for matching no lines, not eslint's. Re-run with the output redirected and the exit read
directly off `eslint`: **0**. The `1c-1c` lesson ("never read `$?` through a pipe when the number IS
the gate") was written in this same ledger, and I still did it; it is recorded because catching it
only because the message looked wrong is luck, not method.

### Budget — the WHOLE second half, re-measured from `git diff --numstat HEAD` at write time

Supersedes the pre-gate table above: these are the figures as the tree stands, not the earlier ones
plus a correction.

| File                                                                   | Stream   | Changed lines |
| ---------------------------------------------------------------------- | -------- | ------------: |
| `packages/core/posts/src/SchedulePostUseCase.ts`                       | CODE     |        **90** |
| `apps/api/src/recurring/RecurrenceScheduler.ts`                        | CODE     |        **75** |
| `apps/api/src/bulk-scheduling/bulkScheduleWorker.ts`                   | CODE     |        **83** |
| `packages/core/domain/src/aggregates/PostAggregate.ts`                 | CODE     |        **43** |
| `packages/adapters/db-prisma/src/post/PrismaPostRepository.ts`         | CODE     |        **23** |
| `packages/core/domain/src/aggregates/post/PostPublicationMethods.ts`   | CODE     |         **8** |
| `packages/core/domain/src/aggregates/post/PostPublicationTypes.ts`     | CODE     |         **7** |
| `packages/core/recurring/src/ProcessRecurrenceUseCase.ts`              | CODE     |         **7** |
| `packages/adapters/db-prisma/src/post/PostPublicationWrites.ts`        | CODE     |         **4** |
| `apps/api/tests/integration/schedulePostTargetSet.integration.test.ts` | EVIDENCE |       **220** |
| `apps/api/tests/unit/application/postUseCases.test.ts`                 | EVIDENCE |       **150** |
| `apps/api/tests/unit/recurring/RecurrenceScheduler.test.ts`            | EVIDENCE |        **94** |
| `apps/api/tests/unit/bulk-scheduling/bulkScheduleWorker.test.ts`       | EVIDENCE |        **85** |
| `apps/api/tests/unit/infrastructure/PrismaPostRepository.test.ts`      | EVIDENCE |        **33** |
| `packages/core/domain/tests/unit/postAggregate.publications.test.ts`   | EVIDENCE |        **33** |
| `apps/api/scripts/run-tests.sh`                                        | SCRIPTS  |        **10** |

**Second half: CODE 306 · EVIDENCE 615 · SCRIPTS 10 · DOCS 508** (`apply-progress.md` 450,
`tasks.md` 50, `roadmap-detected-smells-backlog.md` 6, `design.md` 2). With the committed first half
(CODE 630 / EVIDENCE 1273 / DOCS 550) the unit totals **CODE 936 · EVIDENCE 1888 · SCRIPTS 10 ·
DOCS 1058**. The `apply-progress.md` figure counts this section's own lines; the orchestrator's
numstat at commit is authoritative and will differ by whatever the final formatting pass moved.

The corrective pass added **69 CODE** on top of the pre-gate 237, and every line of it is a defect
the gate found rather than a feature: the dispatch moved out of the transaction, five marks moved to
their mutation sites, and a tenant binding on the failure callback that was missing from a task
whose whole subject is tenant binding. The DOCS figure is dominated by this ledger, which is where
the reasoning for all of it lives.

### Re-gate of the second half — PASS, three notes closed by the orchestrator before commit

The bounded re-gate confirmed C1 fixed exactly as specified (both reds, the `if (result.ok …)`
guard, a throw from the commit landing in the outer catch that never dispatches), all five marks
ahead of every fallible step, the permanent hole-(i) case non-vacuous (the episode assertion), the
recurrence dispatch live, twenty files, every gate re-run green, and five of six budget streams
reconciling to the line (DOCS off by the backlog row's one deleted line). Three notes, none
blocking, closed here rather than carried:

| Note | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| N1   | **SMELL-148 undercounted its class 4 → 11.** The survey covered `@core/posts` + the recurrence caller; a tree-wide sweep finds seven more in `@core/crisis` and `@core/inbox`, all dormant (`return ok(...)` after the dispatch, verified by the re-gate), plus `SendReplyUseCase` breaking the same rule a second way (the PROVIDER send inside the transaction). The row now sizes the class at eleven with the file:line list. A backlog row's job is to size the class, so the sweep is the whole tree, not the directory at hand                                                                                                                                                      |
| N2   | **Hole (i)'s fix widened what "dirty" means, and nothing said so.** With the marks ahead of every fallible step, the `applied: false` no-op returns (a replayed attempt, a duplicate confirm, a second sweep tick) also set the flag, so `hasUnsavedPublications()` reads TRUE after a call that changed nothing — a false positive that refuses a full save loudly, where the old false negative dropped records silently. Kept, deliberately: the mark stays adjacent to the mutation because that is what makes the rule legible. Both JSDoc blocks now say "reached the records" instead of "changed", and name the trade (`PostAggregate.ts`, the field and `hasUnsavedPublications`) |
| N3   | **A third variant of the THROWS/SKIPS pair inside the bulk worker**: the row path throws on a missing account, the failure callback returns — so an account-less payload's terminal failure is never recorded and its batch never settles, unreachable in practice because the producer guards the field. Added to the `For Edward` paragraph as part of the same decision                                                                                                                                                                                                                                                                                                                 |

### RDD receipt — the committed range `6e5408ac` → `8b86b1ca`

Lineage `review-205de02a990a3222`, **HIGH** tier (the range touches `run-tests.sh`), the full
four-lens fan-out. The review reached **approved**, the acknowledgement was executed exactly once and
the authority is **burned**. **13 advisory findings, 0 blocking.** Seven WARNINGs, and they are three
defects seen by several lenses rather than seven separate ones. Claims are quoted from the reviewers.

| Id                                           | Lens        | Sev        | Where                                               | Claim (quoted)                                                                                                                                                                                                                                                                                                              | Disposition                                                                                                                                                                                                                                                                                        |
| -------------------------------------------- | ----------- | ---------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `R2-mark-persisted-before-commit`            | readability | WARNING    | `PostPublicationWrites.ts:240-245`                  | "on a transaction rollback the in-memory aggregate reads clean while the database holds none of the records — exactly the state the marker exists to prevent, only inverted … leaving the marker here makes the JSDoc … misleading, since the mark runs before persistence is guaranteed"                                   | **FIXED** (A)                                                                                                                                                                                                                                                                                      |
| `R3-mark-persisted-before-commit`            | reliability | WARNING    | `PostPublicationWrites.ts:242-245`                  | "no test in this PR asserts the behavior on a failed commit — the double in postUseCases.test.ts calls `markPublicationsPersisted()` inside its `savePublication` mock, which does not simulate the commit-failure ordering"                                                                                                | **FIXED** (A), and the double reworked to model the new shape                                                                                                                                                                                                                                      |
| `R4-markPublicationsPersisted-pre-commit`    | resilience  | WARNING    | `PostPublicationWrites.ts:242-243`                  | "A caller that then attempts a full save on that same aggregate … would pass the `hasUnsavedPublications()` refusal in `PrismaPostRepository.save` and the schedule/declared target set would be silently dropped — the exact silence the loud-refusal mechanism was introduced to prevent"                                 | **FIXED** (A)                                                                                                                                                                                                                                                                                      |
| `R4-bulk-failure-callback-swallow`           | resilience  | WARNING    | `bulkScheduleWorker.ts:144-150`                     | "a retry-exhausted BullMQ job whose payload lacks accountId will resolve successfully to the queue but never record the terminal failure … the batch can remain in a non-terminal state indefinitely … the terminal-failure path is precisely where a silent skip is worst because there is no further retry to compensate" | **FIXED** (B)                                                                                                                                                                                                                                                                                      |
| `R3-bulk-failure-callback-error-arity`       | reliability | WARNING    | `bulkScheduleWorker.ts:148-150`                     | "the RETURN after logging (no throw) means BullMQ has no signal that the terminal failure was not recorded … The unit test only asserts `fail.execute` not called; it does not assert that anything alerts on the ghost state produced"                                                                                     | **FIXED** (B) — and its BullMQ premise corrected by measurement, below                                                                                                                                                                                                                             |
| `R2-pendingEvents-let-capture`               | readability | WARNING    | `SchedulePostUseCase.ts:203-268`                    | "the same pattern is reintroduced here for events … Returning the captured events as part of the doWork Result (e.g. `Result<{ output, events }, ...>`) would make the dispatch site read the events from the same value it reads `ok` from"                                                                                | **FIXED** (C), in exactly that shape                                                                                                                                                                                                                                                               |
| `R3-schedule-pending-events-shared-closure`  | reliability | WARNING    | `SchedulePostUseCase.ts:189-273`                    | "if `executeResultInTransaction` reruns `doWork` on serialization conflict … the SECOND attempt captures an empty array while the outbox row exists from the retried transaction. The result-aware seam's retry semantics are not proved by the added tests"                                                                | **FIXED** (C); the retry premise **REFUTED** by measurement, below                                                                                                                                                                                                                                 |
| `R3-schedule-target-set-integration-cleanup` | reliability | SUGGESTION | `schedulePostTargetSet.integration.test.ts:118-131` | "a silent cleanup failure is not surfaced in test output — it becomes invisible pollution of the shared i[ntegration database] … the identifiers use `Date.now()` at `before`, a rerun within the same millisecond boundary could collide"                                                                                  | **FIXED** (D) — a canon violation (`CODING_STANDARDS`: empty catch, zero tolerance), so fixed despite its severity                                                                                                                                                                                 |
| `R2-throw-check-untyped-catch`               | readability | SUGGESTION | `bulkScheduleWorker.ts:62-70`                       | "the divergent behavior for the same condition (missing account) makes maintainers reason about two failure modes for one invariant. Naming both a shared refusal helper … would keep the two arms readable together"                                                                                                       | **FIXED** (B) — one error class, one message, one helper                                                                                                                                                                                                                                           |
| `R2-publications-live-mutable-getter`        | readability | SUGGESTION | `PostAggregate.ts:281-283`                          | "the invariant 'every record change sets the dirty flag' is spread across method call sites rather than enforced by the type surface"                                                                                                                                                                                       | **BACKLOG — SMELL-147**, unchanged. A read-only projection changes the shape every publication reader consumes                                                                                                                                                                                     |
| `R3-publications-getter-live-mutable`        | reliability | SUGGESTION | `PostAggregate.ts:281`                              | "the invariant is bounded only by convention … no test in this PR pins the type-level guarantee"                                                                                                                                                                                                                            | **BACKLOG — SMELL-147** (same defect, second lens)                                                                                                                                                                                                                                                 |
| `R3-recurrence-account-invariant-unproved`   | reliability | SUGGESTION | `RecurrenceScheduler.ts:110-116`                    | "`ProcessedRecurrence.accountId` is declared `string` (non-optional) … the tests thus only prove the defensive skip triggers for a synthetic fixture"                                                                                                                                                                       | **ACCEPTED as stated, not removed.** The check is a fail-closed net over a boundary the type system does not actually police (the DTO is built from an entity field the compiler trusts, and the sweep reads rows the compiler never sees). Routed to the `For Edward` paragraph and to **T1c.18** |
| `R4-recurrence-skip-observability`           | resilience  | SUGGESTION | `RecurrenceScheduler.ts:104-110`                    | "a systematic upstream failure … would present only as scheduled posts quietly not being created … recording it in the resilience view as well so it is not lost when the ledger is archived"                                                                                                                               | **ROUTED to T1c.18**, which now names this counter and the bulk one explicitly                                                                                                                                                                                                                     |

### The hardening — three defects, and two reviewer premises corrected by measurement

**A. The mark is now a property of a COMMITTED transaction.** Three lenses saw it and they were
right: the flag the full save's refusal READS was being cleared by statements that could still be
rolled back, so a rolled-back publication write left an aggregate the next full save would accept and
silently drop. Two reds:

```text
 × leaves the aggregate OWING a publication write when the transaction fails
 × clears the debt only after the ENCLOSING unit of work commits
AssertionError: expected false to be true
```

**The shape chosen, and why it is not the one the instruction preferred. The argument is STRUCTURAL
first; the doubles are a secondary cost.** `PostPublicationWrites` holds no `UnitOfWork` reference
and never has: it reaches the ambient transaction through the STATIC
`PrismaUnitOfWork.getTransactionClient()`, which is the precedent this file already follows. Putting
`onCommitted` beside that static therefore adds NO coupling — the caller that needs it already
depends on exactly this surface — whereas routing it through the port would mean handing a
`UnitOfWork` instance to a module whose whole design is that it does not have one. It is also
strictly more correct than option (1), because it handles BOTH of the narrow save's branches: inside
someone else's transaction it registers with the unit of work, and when it opened its own
transaction through the tenant-bound runner it marks after that runner resolves, which IS that
transaction's commit. A port method could only ever serve the first.

The doubles are the secondary cost, and the first telling of it overstated the failure mode.
Measured now: `rg -l "executeInTransaction" … --glob '**/tests/**'` = **67 files** (66 before this
unit added its own `PrismaUnitOfWork` suite), of which **59** also reference
`executeResultInTransaction`. No tsconfig opens a `.test.ts`, so `tsc` would indeed have stayed at 0
— but a double missing a new port member does NOT fail silently: the first test that reaches the
call fails LOUDLY with `TypeError: uow.onCommitted is not a function`. The real cost is narrower and
worth stating precisely: loud wherever the member is exercised, invisible in every double that never
reaches it, and 67 files to audit by hand to tell the two apart. **The port diff is ZERO lines**
(`git diff HEAD -- packages/core/domain/src/repositories/Repository.ts` = 0) and not one double
changed.

**`incrementVersion` deliberately does NOT move with it, and the reason is structural.** The
instruction expected it to ("a rolled-back CAS must not leave the aggregate at N+1"). Measured: the
aggregate's version is read again INSIDE the same transaction. `SchedulePostUseCase` runs the full
save and then the narrow one, and the narrow save's compare-and-swap matches on the version the full
save just wrote; deferring the bump to the commit would make that CAS look for a row version the
first statement had already advanced past, and every two-save transaction would fail with a version
conflict. It is in-transaction state because the transaction itself reads it — a different fact from
the marker, which nothing inside the transaction reads. The `PostAggregate.markPublicationsPersisted`
JSDoc now states both, and no longer claims the placement it used to have.

**B. One refusal, both arms, counted — and the reviewer's BullMQ premise is wrong.**
`R3-bulk-failure-callback-error-arity` says a return "means BullMQ has no signal that the terminal
failure was not recorded", implying a throw would give it one. **Measured: it would not.** The
callback is a `failed` LISTENER (`worker.on("failed", …)`, invoked as `void handle…(…)`), not a
handler the queue awaits — the job has already failed by the time it runs. Throwing there does not
re-queue, does not DLQ, and does not reach the queue at all: it becomes an unhandled promise
rejection, which under Node's default can take the process down. So the fix is the one that achieves
the finding's GOAL rather than its mechanism: both arms now share ONE typed refusal
(`BulkScheduleTenantMissingError`) with one message and one helper, the terminal arm THROWS like the
row arm so its contract matches, the listener wiring gained a `.catch` that logs (the throw can no
longer become an unhandled rejection), and the refusal is COUNTED —
`omnipost_bulk_schedule_rows_refused_total{reason}` with a `row` / `terminal-failure` label, so the
unsettled batch is observable rather than merely logged. The red asserts all three: the throw, that
`fail.execute` was never called, and that the counter moved.

**C. The events ride on the Result, and the retry premise is refuted.**
`R3-schedule-pending-events-shared-closure` worries that a re-run of `doWork` would capture an empty
array. **Measured: the seam runs its callback exactly ONCE.**
`PrismaUnitOfWork.executeInTransaction` calls `this.prisma.$transaction(...)` a single time
(`PrismaUnitOfWork.ts:119` as it now stands) with no retry loop, `executeResultInTransaction` calls
`fn()` once (`:215`), and the repo's retry helper (`retryOnWriteConflict`) wraps use cases, not this seam. So the
scenario cannot arise today. The fix landed anyway, because the reviewers' READABILITY point stands
on its own: `doWork` now returns `Result<{ output, events }, …>` and the dispatch site reads the
events from the same value it reads `ok` from, so there is no outer mutable to reason about and no
way to pair one attempt's `ok` with another attempt's events. A new case pins that the dispatched
ids are exactly the ids the full save wrote.

**D. The cleanup is loud and the identifiers are collision-proof.** Every delete is still attempted
(a leftover child must not stop the parents being tried) but failures are collected and the hook
ends in `assert.fail` naming them; the suffix is `randomUUID()` rather than `Date.now()`.

**The double reworked so it does not disagree with production.** `R3` named this precisely: the
`savePublication` mock marked inside its own body. It now mirrors production's two branches — given
an after-commit list it REGISTERS the discharge, without one it marks immediately (which is exactly
what production does outside a transaction) — and the recording unit of work drains that list on
`ok` and never on `err`. This change has been bitten twice by doubles that disagreed with production
(`1c-1a`'s two); making the double model the new shape was not optional.

### Gates after the hardening

| Gate                                                                                                          | Result                                                           |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `@core/domain` · `@core/posts` · `@adapters/db-prisma` vitest                                                 | **10 files / 191** · **6 / 96** · **4 / 70**                     |
| `tsc --noEmit` `@core/domain` · `@core/posts` · `@core/recurring` · `@adapters/db-prisma` · `apps/api` (6144) | **0 · 0 · 0 · 0 · 0**                                            |
| `apps/api` unit tier, full (the unit of work was touched)                                                     | **586 files, 9133 passed, 0 failed**, exit 0 — no EPIPE this run |
| `integration:repositories`                                                                                    | **157 · 157 · 0 · 0 · 0**, exit 0                                |
| `integration:schedule-target-set`                                                                             | **3 · 3 · 0 · 0 · 0**, exit 0                                    |
| **`integration:saga-recovery`**                                                                               | **33 · 33 · 0 · 0 · 0**, exit 0                                  |
| DB tier total (`TIER=pr-integration`)                                                                         | **534 tests, 534 pass, 0 fail, 0 cancel, 0 skip**, exit 0        |
| `pnpm check:circular`                                                                                         | clean                                                            |
| `eslint --max-warnings 0` on the 10 changed `.ts` · `prettier -c` · `pnpm format:check`                       | **0** · clean · clean                                            |
| fitness #3 #4 #5 #8 #9 #10 #32 #21 #23                                                                        | 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0                                |
| fitness #40                                                                                                   | A 3 seams (floor 3) / **0** · B 14 sites (floor 10) / **0**      |
| fitness #41                                                                                                   | sites 8 (floor 8), exception hits 1, violations **0**            |

It did not: `git diff HEAD -- packages/core/domain/src/repositories/Repository.ts` is **0 lines**.
The survey is reported anyway because it is a secondary input to the shape decision (the primary
one is structural, above): `rg -l "executeInTransaction" apps packages infra --glob
'**/tests/**'` finds **67 files** — 66 before this unit added its own `PrismaUnitOfWork` suite —
of which **59** also reference `executeResultInTransaction`. No tsconfig opens any of them, so a
port change would have been invisible to `tsc`; at runtime it fails LOUDLY wherever the new member
is actually called (`TypeError: uow.onCommitted is not a function`) and not at all in the doubles
that never reach it — which is why the cost is 67 files to audit, not 67 files that break.

### Budget — the hardening, measured from `git diff --numstat HEAD` at write time

| File                                                                           | Stream   | Changed lines |
| ------------------------------------------------------------------------------ | -------- | ------------: |
| `apps/api/src/bulk-scheduling/bulkScheduleWorker.ts`                           | CODE     |        **83** |
| `packages/adapters/db-prisma/src/unitofwork/PrismaUnitOfWork.ts`               | CODE     |        **81** |
| `packages/core/posts/src/SchedulePostUseCase.ts`                               | CODE     |        **48** |
| `apps/api/src/metrics/businessMetrics.ts`                                      | CODE     |        **42** |
| `packages/adapters/db-prisma/src/post/PostPublicationWrites.ts`                | CODE     |        **27** |
| `packages/core/domain/src/aggregates/PostAggregate.ts`                         | CODE     |        **15** |
| `packages/adapters/db-prisma/tests/prismaUnitOfWork.afterCommit.test.ts` (new) | EVIDENCE |       **138** |
| `apps/api/tests/unit/application/postUseCases.test.ts`                         | EVIDENCE |        **71** |
| `apps/api/tests/unit/infrastructure/PrismaPostRepository.test.ts`              | EVIDENCE |        **56** |
| `apps/api/tests/integration/schedulePostTargetSet.integration.test.ts`         | EVIDENCE |        **48** |
| `apps/api/tests/unit/bulk-scheduling/bulkScheduleWorker.test.ts`               | EVIDENCE |        **44** |

**Hardening, re-measured at write time after the bounded correction: CODE 296 · EVIDENCE 357 ·
DOCS 238** (`apply-progress.md` 228, `tasks.md` 10). No SCRIPTS. With the committed halves
(CODE 630 + 312, EVIDENCE 1273 + 615, SCRIPTS 10, DOCS 550 + 530) the SUM of the three commits'
deltas is **CODE 1238 · EVIDENCE 2245 · SCRIPTS 10 · DOCS 1318** — lines touched across the three
commits, which double-counts a line the hardening rewrote after a half had written it. The figure the
PR shows is the NET diff against the unit's base `8454bab9`, measured by the orchestrator at commit:
**CODE 1170 · EVIDENCE 2189 · SCRIPTS 10 · DOCS 1353** (docs grow because this ledger keeps growing).
Both are stated because they answer different questions — how much work the unit did, and how much
the reviewer reads. The `apply-progress.md` figure counts this section's own lines.

The correction added **41 CODE and 138 EVIDENCE** on the first hardening pass, and the EVIDENCE is
almost entirely one new file: the `PrismaUnitOfWork` after-commit suite that did not exist when
`onCommitted` was introduced. A public API shipped with no suite of its own is the gap the gate
found — the unguarded loop inside it was the symptom.

255 CODE to fix three defects and a canon violation is the price of the mechanism being right rather
than merely present, and the largest single file is the bulk worker — where one refusal replaced two
divergent ones and gained a counter. None of it is feature work; all of it is the review's.

### Bounded correction after the hardening gate — PASS, no Critical, four warnings

Both premise refutations (the BullMQ listener, the seam's single run) were judged correct on their
merits, and the `onCommitted` no-transaction fallback was read as deliberate rather than accidental.
Four warnings, all fixed.

| Id     | Finding                                                                                                                                                                                                                                                                                                          | Disposition                                                                                                                                                          |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **W1** | `onCommitted` is a public API and the drain was a bare `for … hook()`. A throwing hook would skip every later hook AND propagate out of `executeInTransaction` AFTER the commit succeeded — a committed transaction reported to its caller as a failure. Unreachable today (the only hook is a field assignment) | **FIXED** — each hook in its own `try/catch`, logged at ERROR with its index and the hook count, never changing the transaction's outcome                            |
| **W2** | `afterCommitStorage` and `txStorage` were two independent `AsyncLocalStorage` instances whose co-scoping was guaranteed only by ONE call site                                                                                                                                                                    | **FIXED structurally** — one store holding `{ tx, afterCommit }`; `getTransactionClient()` reads `.tx`, `onCommitted` reads `.afterCommit`. Public surface identical |
| **W3** | The port-vs-static decision led with the doubles count; the count was wrong and so was the failure mode                                                                                                                                                                                                          | **FIXED** — both tellings now lead with the structural argument and state the measurement correctly                                                                  |
| **W4** | DOCS off by one; the `fn()` citation was stale                                                                                                                                                                                                                                                                   | **FIXED** — every figure re-measured at write time, both line citations re-read from the file                                                                        |

**W1's reds.** Two cases, and the second is the one that matters:

```text
 × runs the later hooks even when an earlier one throws
 × still resolves with the callback's value when a hook throws
Error: hook exploded
      Tests  2 failed | 4 passed (6)
```

That second red IS the false negative: the throw escaped `executeInTransaction` after
`$transaction` had already resolved, so a caller would have read a COMMITTED transaction as a
failure — and retried it, or told a customer their write was lost, over work the database had kept.
The new suite (`packages/adapters/db-prisma/tests/prismaUnitOfWork.afterCommit.test.ts`, 6 cases)
also pins three properties nothing tested before: hooks run after the work, hooks do NOT run when
the transaction rejects, and a hook registered outside a transaction runs immediately.

**W2 has no red available, and that is stated rather than worked around.** It is a CONSTRUCTION
change: two stores that were always entered together become one value, so no behaviour differs and
no test can tell before from after. What it buys is that the bad state stops being representable —
"inside the transaction, with no hook list" was a state the types allowed and one edit at the single
entry site could produce, and a hook registered in it would have been silently dropped. The existing
suites are the guard that the refactor changed nothing: `@adapters/db-prisma` **76**, the four
touched api suites **129**, `integration:repositories` **157**, `integration:schedule-target-set`
**3**, `integration:saga-recovery` **33**. One new case pins the co-scoping directly — the client
and the hook list are reachable from the same context.

**The minor, taken.** `incrementBulkScheduleRowRefused(reason: string)` widened the label to
`string`, which accepts any typo forever while the dashboards quietly split in two. The two labels
are now declared BESIDE the counter (`BULK_SCHEDULE_REFUSAL_ARMS` in `businessMetrics.ts`) and the
worker imports them — that direction and not the reverse, because the label set belongs to the
metric and the metrics module must not depend on a worker.

### Gates after the bounded correction

| Gate                                                                                   | Result                                                                 |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `@adapters/db-prisma` vitest                                                           | **5 files, 76 passed** (was 4 / 70; the new UoW suite is the fifth)    |
| `@core/posts` vitest                                                                   | **6 files, 96 passed**                                                 |
| the four touched `apps/api` unit suites                                                | **4 files, 129 passed**                                                |
| `tsc --noEmit` `@adapters/db-prisma` · `apps/api` (6144)                               | **0 · 0**                                                              |
| `integration:repositories`                                                             | **157 · 157 · 0 · 0 · 0**, exit 0                                      |
| `integration:schedule-target-set`                                                      | **3 · 3 · 0 · 0 · 0**, exit 0                                          |
| **`integration:saga-recovery`**                                                        | **33 · 33 · 0 · 0 · 0**, exit 0                                        |
| DB tier total (`TIER=pr-integration`)                                                  | **534 tests, 534 pass, 0 fail, 0 cancel, 0 skip**, exit 0              |
| `eslint --max-warnings 0` on every changed `.ts` · `prettier -c` · `pnpm format:check` | **0** · clean · clean                                                  |
| fitness #3 · #4 · #5 · #40                                                             | 0 · 0 · 0 · A 3 seams (floor 3) / **0**, B 14 sites (floor 10) / **0** |
