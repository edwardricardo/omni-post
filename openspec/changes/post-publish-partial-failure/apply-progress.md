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

| Id  | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Evidence                                                                                                                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1  | **Both `upsertPublications` calls REVERTED out of the full `save()`** (`doCreate` and `doUpdate`). The narrow `savePublication` is now the only production writer of the record. Nothing forced the calls: no domain event and no invariant needed them — they were an unrequested reading of "the target set travels with the post", which is REC-1 and belongs to T1c.6. They were also the worse shape twice over: untested (every upsert assertion sat in the narrow-save describe) and unchecked (the full save runs NEITHER of the narrow save's two refusals) | RED first, and it fails by WRITING: new case `writes NO publication row from the full save, even with targets declared` → **exit 1**, `Tests 1 failed \| 57 passed (58)`, `expected 0 … received 1` on `postChannelPublication.upsert.mock.calls.length`. GREEN after the revert: **58/58**                                                                |
| W2  | **`savePublication`'s JSDoc and body moved to `PostPublicationWrites.savePublicationRecord`**; the repository keeps one delegating expression. The transaction BINDING deliberately did NOT move — it is passed in as a `TenantBoundRunner`, so `withGucBoundTransaction(this.prisma, resolveGucScope(this.tenantProvider), statements)` stays in the class that holds the provider                                                                                                                                                                                  | The first shape moved the binding too and **fitness #40 part B caught it**: `1 seam call(s) bind a scope that is not getAmbientGucScope() or resolveGucScope(this.tenantProvider)`, naming `PostPublicationWrites.ts:281`, exit 1. Reshaped → **part A 0 / part B 0**. The gate was right: both isolation layers must be fed from the same provider object |
| S3  | Ledger line counts corrected to the committed measurement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `PostAggregate.ts` **900** at the gate (the ledger said 902) and `PostPublicationMethods.ts` **664** (said 667) — the ledger was written before the unused-import cleanup. Overrun at the gate **100**, not 102. After S4's JSDoc the root reads **912**, overrun **112**                                                                                  |
| S4  | `PostAggregate.startPublishing`'s "Start publishing process" replaced with the rationale for the surviving provider-keyed parameter: nothing inside the aggregate asks a caller for providers any more, and the parameter is held open only for the one caller outside it that runs over posts carrying no record                                                                                                                                                                                                                                                    | Fitness **#8 = 0** (no slice or phase reference in the new text); prettier + eslint clean                                                                                                                                                                                                                                                                  |

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
