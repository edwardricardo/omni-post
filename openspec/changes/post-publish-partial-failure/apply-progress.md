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

### RDD receipt — the committed range `8b86b1ca` → `bf44b48f`

Lineage `review-025d9990cf48f4bb`, **MEDIUM** tier, one reliability lens. The review reached
**approved**, the acknowledgement was executed exactly once and the authority is **burned**.
**4 advisory findings, 0 blocking** — one WARNING, three SUGGESTIONs. Claims are quoted from the
reviewer.

| Id                                                   | Lens        | Sev        | Where                              | Claim (quoted)                                                                                                                                                                                                                                                                                            | Disposition                                                        |
| ---------------------------------------------------- | ----------- | ---------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `R3-uow-getStore-outside-run-cross-transaction-hook` | reliability | WARNING    | `PrismaUnitOfWork.ts:180-195`      | "a caller that registered from a context which had left `txStorage.run` … will silently run the hook immediately as if there were no transaction … writing may have occurred on the transaction client but the hook … fires before the commit — i.e. the exact inversion the marker was moved to prevent" | **FIXED structurally** (A) — the mixed shape no longer exists      |
| `R3-bulk-listener-catch-missing-job`                 | reliability | SUGGESTION | `bulkScheduleWorker.ts:248-263`    | "the terminal-failure recording is skipped without a refusal counter increment, because the code never reaches the tenant-missing arm. The new counter therefore does not observe this class of unsettled batch. No test in this candidate exercises the `job === undefined` shape"                       | **FIXED** (B) — a third arm, and the listener is now a tested seam |
| `R3-schedule-events-readonly-copy`                   | reliability | SUGGESTION | `SchedulePostUseCase.ts:291-294`   | "the dispatch spreads it into a fresh array before dispatching. This is defensive but silent about intent: nothing in the candidate proves the dispatcher does not mutate its argument"                                                                                                                   | **PREMISE CORRECTED** (C) — the copy is required, and now says so  |
| `R3-integration-cleanup-uuid-account-columns`        | reliability | SUGGESTION | `schedulePostTargetSet…test.ts:69` | "yielding identifiers up to ~42 chars. This is fine for text primary keys but would fail loudly if a schema constraint limited any of these columns to a shorter width … Optional: cap the suffix (e.g. first 8 hex chars)"                                                                               | **REJECTED on measurement** (D) — there is no width to fit         |

#### A. The mixed two-read shape is gone, not guarded against

The WARNING names a real inversion, and its reasoning holds: `AsyncLocalStorage.getStore()` answers
for the context the CALLER is in, so a caller that reads the client in one ambient read and
registers the hook in a SECOND one can be handed a transaction by the first and `undefined` by the
second — after an `await` resumed through a non-propagating callback, an EventEmitter, or a
scheduled callback. The hook then runs INLINE, inside the transaction it exists to outlive, over
writes that can still roll back. That is precisely the state the mark was moved after the commit to
prevent, reintroduced through the door the API left open.

It was fixed by removing the door rather than by testing that nobody walks through it. There is no
ambient registration function any more. `PrismaUnitOfWork.activeTransaction()` is ONE read that
returns the whole transaction as a value — the client and, on the same object, `onCommitted` bound
to THAT transaction's hook list. A caller holds one handle and uses it for both, so "registered
against a different context than the one I wrote to" is not a sentence the types let you write.
`getTransactionClient()` stays for the callers that only need a client, and `savePublicationRecord`
no longer uses it: it takes the captured handle and reads `active.tx` and `active.onCommitted` off
the same value.

The no-transaction arm changed meaning with it, deliberately. The static used to run the hook
inline when there was no transaction, which was the honest answer for one caller and a hidden
decision for every other. `activeTransaction()` returns `undefined` and the CALLER decides — the
narrow save has already committed through its own runner by that point and marks directly, and
saying so at the call site is what makes the two paths readable as the two different situations
they are.

**The red, recorded.** A case that detaches for real rather than simulating it: the registering
callback is scheduled with `setTimeout` from the TEST's context BEFORE the transaction opens, so
when it runs the ambient store is genuinely empty — the case asserts that too — and it registers
against the captured handle. Against the old API the mark would have run inline; against the new
one there is nothing ambient to call.

```
× registers on the CAPTURED transaction even from a detached async context 4ms
  TypeError: PrismaUnitOfWork.activeTransaction is not a function
  Tests  1 failed | 6 skipped (7)
```

The reviewer's note that the previous suite "asserts the two isolated shapes … but does not pin the
mixed shape" was correct and is now closed: the seventh case IS the mixed shape.

#### B. The `failed` event that names no row is counted under its own arm

The reviewer read the `.catch`'s `job?.id` correctly as an admission that BullMQ can invoke the
listener with no job, and correctly that nothing observed it. One correction to the mechanism it
describes: `handleBulkScheduleRowFailure` did not throw a `TypeError` on that path — it opened with
`if (!job) return;`, so the failure was quieter than the finding supposed. The consequence the
finding names is the same and is the point: a row in a batch waiting on it, and no DLQ entry, no
manifest write, no log, no counter. The batch stops settling and nothing says why.

BullMQ emits it when it cannot load the job the event is about — a stalled job reclaimed after its
key expired, or a payload it cannot deserialize. Neither the DLQ nor the manifest can be reached for
it, because both need the payload the event does not carry. So the counter and the log ARE the
recovery path here, and they are what turn a silently unsettled batch into one someone can go and
look at. It gets its own arm, `MISSING_JOB`, declared beside the counter with the other two, because
the recovery differs: the other two name a row and can be chased to a batch; this one cannot be
chased to anything from inside the process.

The guard sits at the listener, which is where the only sink exists, and the listener is now a named
exported function (`onBulkScheduleJobFailed`) so it can be exercised without standing up a queue —
it could not be before, because `startBulkScheduleWorker` constructs its own consumer. With one
owner for the absent job, `handleBulkScheduleRowFailure` stops pretending it might be missing: its
parameter narrowed from `Job | undefined` to `Job` and its silent early return is deleted. The case
that asserted that silence is deleted with it.

```
× counts and logs a `failed` event that carries no job, instead of returning in silence 2ms
× does not let a failure inside the handler escape as an unhandled rejection 0ms
  TypeError: onBulkScheduleJobFailed is not a function
  Tests  2 failed | 9 passed (11)
```

The second case pins the property the previous pass added but never tested from the listener's own
surface: a rejection out of the handler is caught and logged, because a `failed` LISTENER is not
awaited by BullMQ and an escaping rejection takes the process down over a job that had already
failed.

#### C. The spread is required, and the line now says which

The reviewer asked whether the copy proves anything. Measured: `EventDispatcher.dispatchAll` is
declared `dispatchAll(events: DomainEvent[]): Promise<void>` (`packages/core/domain/src/events/DomainEvent.ts:76`)
— a MUTABLE array. `result.value.events` is `readonly DomainEvent[]`, which TypeScript will not
assign to it. The copy is not defensive and cannot be deleted; it is the conversion the signature
demands. One line at the site says exactly that, so the next reader does not re-open the question.
Widening `dispatchAll` to `readonly DomainEvent[]` is the real fix and is a change to a domain
interface with callers outside this unit — not this correction's scope.

#### D. Rejected: there is no column width to fit

Measured in `infra/prisma/schema.prisma` at write time. All four identifiers the cleanup builds are
unbounded:

| Model     | Column                             |
| --------- | ---------------------------------- |
| `Account` | `id  String  @id @default(uuid())` |
| `Project` | `id  String  @id @default(uuid())` |
| `Channel` | `id  String  @id @default(uuid())` |
| `Post`    | `id  String  @id @default(uuid())` |

`@db.VarChar` appears **0 times in the entire schema**, so every one of these is Postgres `text`,
which has no length limit. The finding's own condition — "would fail loudly if a schema constraint
limited any of these columns to a shorter width" — is not met, and there is nothing for a cap to
protect. Truncating to 8 hex characters would cost collision resistance (the exact property the
widening from `Date.now()` was made to buy, after a rerun inside the same millisecond was identified
as a real collision) in exchange for fitting a constraint that does not exist. The full
`randomUUID()` stays.

### Gates after the second bounded hardening

| Gate                                                             | Result                                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `@adapters/db-prisma` vitest                                     | **5 files, 77 passed** (was 76; the detached-context case is the new one)  |
| `@core/posts` vitest                                             | **6 files, 96 passed**                                                     |
| the four touched `apps/api` unit suites                          | **4 files, 130 passed** (was 129; +2 listener cases, −1 deleted)           |
| `tsc --noEmit` `@adapters/db-prisma` · `apps/api` (6144)         | **0 · 0**                                                                  |
| `integration:repositories`                                       | **157 · 157 · 0 · 0 · 0**, exit 0                                          |
| `integration:schedule-target-set`                                | **3 · 3 · 0 · 0 · 0**, exit 0                                              |
| `integration:saga-recovery`                                      | **33 · 33 · 0 · 0 · 0**, exit 0                                            |
| DB tier total (`TIER=pr-integration`)                            | **534 tests, 534 pass, 0 fail, 0 cancel, 0 skip**, exit 0                  |
| `eslint --max-warnings 0` on the 7 changed `.ts` · `prettier -c` | **0** · clean                                                              |
| fitness #3 · #4 · #5 · #13 · #40                                 | 0 · 0 · 0 · 0 · A 3 seams (floor 3) / **0**, B 14 sites (floor 10) / **0** |

`apps/api`'s typecheck needs `NODE_OPTIONS=--max-old-space-size=6144` on this box: at the default
ceiling it dies with `Ineffective mark-compacts near heap limit` rather than reporting an error, and
reading that as a failure of the change would be wrong.

### Budget — the second bounded hardening, measured from `git diff --numstat HEAD` at write time

| File                                                                     | Class    | Changed lines |
| ------------------------------------------------------------------------ | -------- | ------------: |
| `packages/adapters/db-prisma/src/unitofwork/PrismaUnitOfWork.ts`         | CODE     |       **147** |
| `apps/api/src/bulk-scheduling/bulkScheduleWorker.ts`                     | CODE     |        **68** |
| `apps/api/src/metrics/businessMetrics.ts`                                | CODE     |        **13** |
| `packages/adapters/db-prisma/src/post/PostPublicationWrites.ts`          | CODE     |        **13** |
| `packages/core/posts/src/SchedulePostUseCase.ts`                         | CODE     |         **2** |
| `packages/adapters/db-prisma/tests/prismaUnitOfWork.afterCommit.test.ts` | EVIDENCE |       **140** |
| `apps/api/tests/unit/bulk-scheduling/bulkScheduleWorker.test.ts`         | EVIDENCE |        **65** |
| **CODE total**                                                           |          |       **243** |
| **EVIDENCE total**                                                       |          |       **205** |
| **Total**                                                                |          |       **448** |

CODE **243** is inside the 400-line ceiling (the figures include W1, below). The CODE figure is larger than the behaviour change
because the WARNING was answered by construction rather than by a guard: most of `PrismaUnitOfWork`'s
147 lines are the new handle type and the JSDoc that states why one read is not two, and most of the
worker's 68 are the listener extracted into a named seam so it could be tested at all.

### Re-gate of the second hardening — PASS, one bounded item (W1)

The gate passed and named one minor, fail-closed today. It belongs beside the handle's design
rather than in a list of its own, because it is the residual that design CREATED.

**W1 — a handle held past its commit registered into a void.** The drain walked `afterCommit` in
place and left it populated, so an `ActiveTransaction` captured inside a transaction and used after
`executeInTransaction` resolved pushed onto an already-walked array. The hook never ran and nothing
said so. That is the mirror image of the hazard `#### A` removed — a hook that fires at the wrong
moment, versus a hook that never fires at all — and it is expressible only BECAUSE the handle became
capturable. The fix that closed one direction opened the other by one notch, and saying so is
cheaper than discovering it later.

**Unreachable today, and named rather than relied on.** The sole caller, `savePublicationRecord`,
registers synchronously in the same statement sequence as the write, so no handle survives its
transaction. Had one, the lost hook would be `markPublicationsPersisted`: the aggregate would stay
dirty and the next full save would REFUSE it (T1c.6c). So the state is fail-closed, and what was
missing was not safety but a voice — a refusal nobody can see is indistinguishable from the silence
it replaced.

**What changed.** The drain now takes the hooks OUT (`registry.hooks.splice(0)`) and marks the
registry settled BEFORE running any of them, so a hook registered by a hook is caught by the same
rule. `settled` is not a boolean beside a count; it is `{ hooksRun } | undefined`, one value, for
the same reason the client and the hook list became one value in `#### A` — a flag and a count can
disagree, a single value cannot. `onCommitted` on a settled transaction logs at ERROR with that
count and returns.

**Log, not throw, and the reason is the thread's own rule.** The refusal runs in the REGISTERING
caller's context, and that caller has by definition just reached a commit that succeeded. Throwing
would report a COMMITTED transaction to its caller as a failure — the false negative the drain's
isolation exists to prevent, and the one this entire thread has been closing in every direction. A
throw here would reintroduce it at the one remaining door. The state left behind already stops
rather than spreads, so ERROR is the loud half of a failure that is otherwise contained.

#### The red, measured rather than asserted

The correction was written before the case, so the red was taken by reconstructing the pre-fix shape
under the probe protocol: the fixed file was copied to the scratchpad, the in-place walk and the
unconditional push were restored, the case was run, and the file was restored and verified
byte-exact (`sha256` `e19f8fef…` → `OK`).

```
× logs at ERROR and drops a hook registered AFTER its transaction settled 2ms
  AssertionError: the drop is LOGGED at ERROR; a dropped hook must not be silent
  Tests  1 failed | 7 passed (8)
```

The shape of that failure is the finding itself: the assertion that the late hook did NOT run
**passed** against the old code — it was already dropped — and the only thing missing was anyone
being told. The case reads the seam's own ERROR log, because a refusal whose entire effect IS the
log cannot be told from silence by a case that cannot see it; the logger is mocked through
`importOriginal` so the rest of the import graph keeps its exports.

One canon point the typecheck forced, kept rather than worked past: the collected `msg` is declared
`string | undefined` — required and nullable — not optional. The logger's signature makes it
omissible, so a call really can arrive without one, and under `exactOptionalPropertyTypes` an
optional property may not be ASSIGNED `undefined`.

#### Gates after W1

| Gate                                             | Result                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| `@adapters/db-prisma` vitest                     | **5 files, 78 passed** (was 77; the settled-refusal case is new) |
| `tsc --noEmit` `@adapters/db-prisma`             | **0**                                                            |
| `eslint --max-warnings 0` · `prettier` (2 files) | **0** · clean                                                    |
| fitness #3 · #4 · #13                            | 0 · 0 · 0                                                        |
| also: fitness #9 · tripwire words                | 0 · none                                                         |

---

## PR 1c — grandchild `1c-1e` (T1c.7) — COMPLETE

Branch `workstream/ncor8-1c-1e`, child of `workstream/ncor8-1c-1d` @ `dfc5cae2` — **order 4 of
§9.4.1**, and the first unit of this chain that wires rather than writes. One task: the command the
saga's scheduling step will issue, the handler that routes it, and the container entries for the
four use cases `1c-1c` and `1c-1d` left unresolvable.

**Finish state**: `post.open-publication-episode` is a declared command with a strict schema, a
registered handler that delegates to `OpenPublicationEpisodeUseCase`, and four DI tokens through
which the publication writers can finally be resolved with the Unit of Work seam attached. Nothing
issues the command. **Rollback**: revert the six files; the four use cases go back to being
reachable only through the package barrel, exactly as they were at `dfc5cae2`.

### What each mechanism is, as built

| Mechanism                                | As built                                                                                                                                                                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST_COMMANDS.OPEN_PUBLICATION_EPISODE` | one more member of the existing const map, so the type union widens by construction rather than by a second declaration                                                                                                                             |
| `OpenPublicationEpisodeCommandSchema`    | `data` is `.strict()` like its siblings; `channelIds` is `z.array(z.string().uuid()).min(1).optional()`; `enterPublishing` is a REQUIRED boolean with no default. The post is named by `aggregateId`, not a second time inside `data`               |
| the three channel-set shapes             | ABSENT means "open every recorded channel", a NAMED set is the declared or matched target set, an EMPTY list is REFUSED. The `.min(1)` is what keeps the third from collapsing into the first, at the parser, before any load                       |
| `reasonCode` on the completion command   | one optional string per channel, beside `error`. It is DECLARED so it survives the parser; the handler's explicit per-key mapping does not forward it, which is what makes the addition observably inert at this tip                                |
| `CommandResult.code`                     | one optional field on the shared result. It exists so a caller can BRANCH on a refusal without matching a message; the bus returns the handler's object unchanged, so the value crosses verbatim                                                    |
| `OpenPublicationEpisodeCommandHandler`   | validate → map `aggregateId` onto `postId` → delegate → return the opened channels. It decides nothing about admissibility: the request travels to the use case as it arrived and the aggregate refuses what it must                                |
| the omitted `channelIds`                 | omitted rather than assigned `undefined` when the caller named none, for the `exactOptionalPropertyTypes` reason the promotion handler already documents for `expectedVersion`                                                                      |
| cache invalidation                       | unconditional on an ACCEPTED open, including one that answered `alreadyOpen` — see the design-silent decisions below                                                                                                                                |
| the four container entries               | each writer gets the post repository and the SHARED Unit of Work and nothing else. No `EventDispatcher`, for the promotion writer's reason: the aggregate's events are written to the outbox by the same transaction and delivered after it commits |

### The recorded reds

**1. The handler does not exist.** Written first, against a class with no declaration:

```text
 FAIL  tests/unit/PostCommandHandlers.open-publication-episode.test.ts >
   OpenPublicationEpisodeCommandHandler > answers the post.open-publication-episode command type
TypeError: OpenPublicationEpisodeCommandHandler is not a constructor
 ❯ tests/unit/PostCommandHandlers.open-publication-episode.test.ts:35:15
      Tests  17 failed (17)
```

**2. `reasonCode` is stripped in silence, not declared.** This is the red the additive half needed,
and finding a shape that could GO red took the measurement below: a command carrying `reasonCode`
was already ACCEPTED before the change, because the per-channel object is not `.strict()` and Zod
strips an undeclared key without a word. A case asserting acceptance would have been green on both
sides and proved nothing. The case therefore asserts that the value SURVIVES the parser:

```text
 FAIL  tests/unit/PostCommandHandlers.complete-publishing.test.ts > the additive reasonCode field >
   is declared by the contract and survives parsing instead of being stripped
AssertionError: expected undefined to be 'CONTENT_REJECTED'
```

**3. The four tokens do not exist.** `TOKENS.X` for an absent member is `undefined`, so the
container suite fails on the token before it can fail on the registration:

```text
 FAIL  tests/unit/infrastructure/container/setupPostUseCases.test.ts >
   registers the four publication writers without throwing
AssertionError: OpenPublicationEpisodeUseCase has no DI token: expected undefined to be defined
 …
      Tests  21 failed | 15 passed (36)
```

### The exhaustive command-registry suite the task named — MEASURED ABSENT

The task asked for the red to come from "the exhaustive command-registry/schema suite (find it)".
There is no such suite, and this is the measurement rather than an impression:

| Question                                                  | Measurement                                                                                                                   |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Does `packages/shared` have a test tier at all?           | **No.** No `test` script in `package.json`, no `vitest.config.*`, no `tests/` directory. The gate named for it does not exist |
| Any suite asserting over a `*CommandSchema`?              | **Zero** — `rg -l "CommandSchema" --glob '**/*.test.ts' apps packages` returns nothing                                        |
| Any exhaustiveness check over `POST_COMMANDS` in the api? | **No.** The five files naming `POST_COMMANDS` are the declaration and four handler suites, each pinning ONE member            |

So the schema half of this task had no gate to go red, and one was built: the new suite's first two
cases pin the member's literal value and its presence in what `createPostCommandHandlers` returns.
**Nothing was loosened** — there was no check to loosen.

**What that absence exposed, and why it is NOT closed here.** A genuinely exhaustive
"every `POST_COMMANDS` member has a handler" check FAILS today on two members this change did not
introduce: `SCHEDULE_POST` (`post.schedule`) and `CANCEL_SCHEDULED_POST` (`post.cancel-schedule`)
have no handler — and, measured tree-wide, no producer either. They are declared contract surface
nothing issues and nothing routes: a command a caller could legitimately build, dispatch, and
receive `No handler registered for command type` from at runtime. Writing the exhaustive check here
would land a knowingly-red gate; deleting the two members is a contract change outside this task.
**Backlog row, named for Edward below.**

### Design-silent decisions, taken here and named

1. **The post id is `aggregateId` only.** The task text sketched the schema as
   `{ postId, channelIds?, enterPublishing }`; `design.md` D9 says
   `post.open-publication-episode { channelIds?, enterPublishing }`. Both were followed by giving
   `data` exactly D9's two fields and naming the post through `aggregateId`, as every other Post
   command does. A `postId` inside `data` would be a SECOND carrier for a value the envelope
   already holds and the bus already routes on — two places to disagree, and no reader that needs
   the duplicate.
2. **`CommandResult` gained an optional `code`.** The task requires the use case's code to pass
   through unchanged, and `CommandResult` had nowhere to put it: `success`, `data`, `events`,
   `error`, `validationErrors`. The alternatives were to bury the code inside the `error` string —
   which is the message-matching the retraction work is explicitly moving AWAY from (T1c.11, "give
   the refusal a code a route can switch on instead of a string match") — or to leave the
   instruction unimplemented. One optional field is additive for every existing handler and is
   populated by the new one alone; no existing handler was retrofitted, because changing what the
   others report is not this unit's subject.
3. **Caches are invalidated on every accepted open, including `alreadyOpen`.** The use case writes
   when the target set was REPLACED even though the episode did not move (`replacedTargets`), and
   its output does not report that separately — so the handler genuinely cannot tell a true no-op
   from a rewritten record set. An extra `DEL` costs a round trip; a missed one serves a reader the
   channels the run just abandoned. The asymmetry decides it.
4. **No audit event.** The promotion handler emits a user-action event; this one emits `[]`. Its
   caller is the publishing saga rather than a person, so the event would record "system" acting on
   itself, and the record's own domain events are already written by the same transaction and
   delivered once by the outbox relay after it commits.
5. **The container suite asserts the Unit of Work, not just the registration.** All four use cases
   take `unitOfWork?` as an OPTIONAL last parameter — which is what lets their own unit tests
   construct them without one. That same optionality means a registration that forgot the seam
   would compile, pass every existing suite, and write outside a transaction in production. The
   suite therefore asserts the resolved token set, not merely that a token was registered.

### Unreachable by claim — RE-MEASURED at this tip, not inherited

§9.4.1's ordering audit row 4 claims the unit is unreachable. Measured after the code landed
(`rg` over `apps packages infra`, excluding `node_modules`, `dist` and `reports`):

| Claim                                                 | Measurement                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No dispatcher issues the new command                  | `OPEN_PUBLICATION_EPISODE` + the literal `post.open-publication-episode` appear in **9 places**: the const member, the schema's `z.literal`, the handler's own `commandType`, 5 test lines, and 1 comment. **Zero `executeCommand` call sites**                                                                              |
| `reasonCode` is additive and inert                    | **Zero producers**: the only `reasonCode` occurrences under `apps/api/src`, `apps/workers/src` and `packages/shared/src` are the field's declaration and its two doc lines. Nothing emits one                                                                                                                                |
| The old completion handler ignores it                 | Pinned by a case: the forwarded channel is `{ channelId, success }` exactly — asserted with `toStrictEqual`, which fails on an EXTRA key as well as a missing one. Green before and after, by design                                                                                                                         |
| The three retraction/attempt writers stay unreachable | Registered, never resolved: `rg` finds `TOKENS.RecordChannelPublicationAttemptUseCase` / `ConfirmManualRetractionUseCase` / `ExpireRetractionActionWindowUseCase` **only** in `types.ts`, `setupPostUseCases.ts` and the new container suite. Only the episode token is resolved, by `index.ts`, to build the handler config |

The tip is sound: a command nobody sends, a field nobody sets, and three tokens nobody resolves.

### Doubles added or updated — the mandatory `rg` over `**/tests/**`

This unit deletes and renames nothing, but it WIDENS a required config interface, which is the
other way a double goes stale. `rg -l "PostCommandHandlersConfig" apps packages` finds three
construction sites and all three were updated:

| Site                                                               | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/index.ts:723`                                        | resolves `TOKENS.OpenPublicationEpisodeUseCase` — the only production construction, and the only one `tsc` would have caught                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `apps/api/tests/unit/PostCommandHandlers.test-helpers.ts`          | NEW `MockOpenPublicationEpisodeUseCase` with settable `opened` / `alreadyOpen` / `status` / `failCode`, wired into `createTestConfig` and exposed on `TestContext`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `apps/api/tests/integration/helpers/publishNowPromotionHarness.ts` | constructs a REAL `OpenPublicationEpisodeUseCase` over the harness's tenant-bound repository. **Not compile-forced and that is the point**: `apps/api/tsconfig.json` includes `src` only, and the node:test tier runs through `tsx`, which strips types without checking — so an un-updated harness would have carried `undefined` in a required field in silence. Constructed WITHOUT the unit of work (the optional last parameter; no scenario drives this use case here), so the harness's instance differs from the container's in the one property `setupPostUseCases.test.ts` exists to pin — the day a promotion scenario reaches it, that difference is what bites (gate note W4) |

### The tsc probe over the touched tests — run, and it caught five errors

`1c-1c` recorded the throwaway-tsconfig probe as a habit for the next unit in the chain. Run here,
with the exit captured directly off `tsc` (no pipe) and the config living in the scratchpad rather
than the repo, so the working tree stayed clean:

- **First run: `PROBE_TSC_OWN_EXIT=2`, five errors.** One was mine —
  `Type '"VALIDATION_FAILED"' is not assignable to type '"CONFLICT"'`, because the mock's `failCode`
  inferred the literal type of its own initializer, which makes the field's entire purpose (plant a
  DIFFERENT code and watch it cross) a compile error. Annotated as the `string` a `UseCaseError`
  actually carries.
- **The other four were PRE-EXISTING** in `PostCommandHandlers.complete-publishing.test.ts`:
  `'result.data' is possibly 'undefined'` on four existing assertions, invisible to every gate this
  repo runs because no tsconfig opens `apps/api/tests`. Fixed in place with `?.` (four characters)
  under the zero-defect rule rather than deferred as "already there". The assertions do not weaken:
  `expect(undefined).toBeTruthy()` fails exactly as a thrown TypeError would.
- **Second run: `PROBE_TSC_OWN_EXIT=0`.**

This is the third distinct defect class the probe has caught across three units (a stub of a deleted
method, a wrong string literal, and now a narrowed literal type plus four latent nullability
errors). The permanent-config decision is still nobody's, and still worth taking.

### Gates

| Gate                                                        | Result                                                                                                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@shared/types` vitest                                      | **N/A — MEASURED ABSENT.** `packages/shared` has no test script, no vitest config and no tests directory; its contract is exercised from the `apps/api` tier |
| `apps/api` touched suites (7 files)                         | **85 passed**                                                                                                                                                |
| `apps/api` unit tier (`vitest run --maxWorkers=2`)          | **588 files, 9157 passed**, 0 failed                                                                                                                         |
| `integration:saga-recovery` (3 suites, concurrency 1)       | **33 tests, 33 pass, 0 fail, 0 cancelled, 0 skipped**, runner exit 0 — level with `1c-1d`                                                                    |
| `tsc --noEmit` `packages/shared`                            | **0**                                                                                                                                                        |
| `tsc --noEmit` `apps/api` (6144)                            | **0**                                                                                                                                                        |
| scratchpad tsc probe over the 5 touched test files          | **0** (after the five fixes above)                                                                                                                           |
| `pnpm check:circular`                                       | **0** — 1608 files, no circular dependency                                                                                                                   |
| `eslint --max-warnings 0` (10 changed `.ts`)                | **0** across four invocations                                                                                                                                |
| `prettier -c` (10 changed files + this ledger + `tasks.md`) | clean (two files needed `--write`, re-checked)                                                                                                               |
| fitness #3 · #4 · #5 · #6 · #8                              | 0 · 0 · 0 · 0 · 0                                                                                                                                            |
| fitness #9 · #10 · #21 · #22 · #32                          | 0 · 0 · 0 · 0 · 0                                                                                                                                            |
| fitness #40 A · B                                           | 0 · 0 (seam floor 3/3, Part B sites 14 ≥ 10)                                                                                                                 |

**One gate ran OOM before it ran clean, and it is recorded rather than hidden**: `eslint` over all
ten files at once died with `FATAL ERROR: Reached heap limit` under the default 2 GB heap. Re-run at
`--max-old-space-size=6144` in four batches, every batch exit 0 — and the gate then showed the
batching was a detour: at that heap ONE pass over all ten files exits 0. The flag is what to record,
not the batches. The number that matters is the exit code, and it was read off `eslint` directly,
never through a pipe.

### Budget — measured from `git diff --numstat HEAD` at write time

| Stream                                            | Forecast (§9.4.1 row 4) | Measured | Delta           |
| ------------------------------------------------- | ----------------------: | -------: | --------------- |
| CODE (`cqrs.ts`, handlers, container, `index.ts`) |                 **136** |  **253** | **+117 (+86%)** |
| EVIDENCE (the two new suites, helpers, harness)   |                   **0** |  **472** | **+472**        |

| File                                                                       | +   | −   | Stream   |
| -------------------------------------------------------------------------- | --- | --- | -------- |
| `apps/api/src/cqrs/handlers/PostCommandHandlers.ts`                        | 119 | 0   | CODE     |
| `packages/shared/src/cqrs.ts`                                              | 72  | 0   | CODE     |
| `apps/api/src/infrastructure/container/setupPostUseCases.ts`               | 50  | 0   | CODE     |
| `apps/api/src/infrastructure/container/types.ts`                           | 11  | 0   | CODE     |
| `apps/api/src/index.ts`                                                    | 1   | 0   | CODE     |
| `apps/api/tests/unit/PostCommandHandlers.open-publication-episode.test.ts` | 203 | 0   | EVIDENCE |
| `apps/api/tests/unit/infrastructure/container/setupPostUseCases.test.ts`   | 107 | 0   | EVIDENCE |
| `apps/api/tests/unit/PostCommandHandlers.test-helpers.ts`                  | 89  | 0   | EVIDENCE |
| `apps/api/tests/unit/PostCommandHandlers.complete-publishing.test.ts`      | 60  | 5   | EVIDENCE |
| `apps/api/tests/integration/helpers/publishNowPromotionHarness.ts`         | 8   | 0   | EVIDENCE |

**CODE 253 is UNDER the hard 400-line budget** — the first unit of this chain that is, and no
`size:exception` is needed for it.

**EVIDENCE 0 was never a possible number, and the forecast should be read as an error rather than as
a target this unit missed.** The row describes "CQRS command, handlers, container tokens" — a wired
command handler and four DI registrations. A handler with no suite cannot be shown to route, to map
its input, to carry a refusal code, or to invalidate anything; four registrations with no suite
cannot be shown to carry the Unit of Work that is the entire reason they exist rather than a
`new` at the call site. Under STRICT TDD the evidence is written BEFORE the code, so forecasting
zero of it forecasts that the code is never tested. The 472 lines break down as 310 in two new
suites (30 cases), 89 in the shared double, 65 in the additive-field cases (60 added, 5 replaced —
the four pre-existing `result.data?.` fixes), and 8 in the integration harness. **This is the fifth consecutive under-count** and the first whose under-counted stream was
forecast at literally zero.

### What is deliberately NOT in this unit

- **No dispatcher.** `SchedulePublishingJobsStep` issues the command at order 10 (T1c.9). Writing it
  here would put a caller in front of a wait step that cannot yet read attempts — the order-10 cycle
  §9.4.1 names.
- **No `CHANNEL_HAS_LIVE_FRAGMENTS` code on the refusal.** The use case still answers a generic
  `CONFLICT` whose only discriminator is the message prefix. That is carried work (T1c.11, order 5),
  and it now has a CARRIER waiting for it: `CommandResult.code` already transports whatever code the
  use case names, so closing T1c.11 needs no second change here.
- **No retrofit of the other five handlers onto `code`.** Additive means additive.
- **No exhaustive command-to-handler gate.** It would be red on two pre-existing members — see
  above.

### For Edward — two findings, neither actionable inside this task

1. **Two declared Post commands have no handler and no producer.** `POST_COMMANDS.SCHEDULE_POST`
   (`post.schedule`) and `POST_COMMANDS.CANCEL_SCHEDULED_POST` (`post.cancel-schedule`) are members
   of the command map that nothing issues and nothing routes; dispatching either returns
   `No handler registered for command type` at runtime. Measured tree-wide (the only other hits are
   an unrelated React Query mutation key in `apps/client`). They are the reason the exhaustive
   registry gate this task asked for cannot be written green today. Two exits: delete the two
   members, or write the handlers. **Backlog row either way** — deleting contract surface is a
   decision, not a cleanup.
2. **`apps/api/tests` is typechecked by nothing.** `apps/api/tsconfig.json` includes `src` only, and
   the node:test tier runs under `tsx`, which strips types without checking. Four latent type errors
   were sitting in a live suite and a widened required interface reached an integration harness with
   no compile error to announce it. The scratchpad probe catches this on demand and has now earned
   its keep in three consecutive units; making it a committed config is a decision nobody has taken
   and it belongs to someone other than this task.

### RDD receipt — the committed range `dfc5cae2` → `886ec0a5`

Lineage `review-cec1598841a2b767`, medium, one reliability lens. **Approved and burned**, with one
WARNING and two SUGGESTIONs. All three are FIXED below rather than accepted; one of them is fixed
**and its stated mechanism corrected**, because the fix was worth doing and the reason given for it
was not the true one.

#### WARNING `R3-harness-uow-missing` — FIXED, and the claim's mechanism corrected

> "The integration harness constructs a real OpenPublicationEpisodeUseCase without the Unit of Work
> seam. … the constructor accepts UoW as an optional last parameter, so the harness's instance will
> not surface the divergence at construction time — the moment a scenario reaches it, **the write
> escapes the tenant-bound transaction** the container's production wiring guarantees."
> — `publishNowPromotionHarness.ts:223-229`

**Disposition: FIXED.** The harness now builds ONE `PrismaUnitOfWork` into a local and hands it to
both writers it constructs, so the episode use case runs the wiring the container builds. Holding
it in a local is the part that outlasts this correction: a writer constructed without it now reads
as an omission beside a sibling that has it.

**The mechanism in the claim is wrong, and saying so is the point.** The write does NOT escape
tenant binding without the Unit of Work. Measured in
`packages/adapters/db-prisma/src/post/PostPublicationWrites.ts:303-318`: `savePublicationRecord`
reads `PrismaUnitOfWork.activeTransaction()` and, when there is none, calls the collaborator
`runInTenantBoundTransaction` — which `PrismaPostRepository.savePublication`
(`PrismaPostRepository.ts:160-164`) supplies as
`withGucBoundTransaction(this.prisma, resolveGucScope(this.tenantProvider), statements)`. So the
save opens its OWN tenant-bound transaction and binds the GUC either way; the repository's scope
refusal (`:146-155`, absent scope or the system sentinel) fires either way too. What the missing
seam actually costs is the USE CASE's transaction boundary — `executeResultInTransaction` around
load-admit-save, and the rollback of an `err` returned after a write. For a writer whose write is
one narrow save that is a real but narrow difference, not an isolation hole.

**No red was available, and this is the plain statement the correction asked for.** Nothing in this
harness dispatches `post.open-publication-episode`, and — given the fallback above — the two
wirings are not distinguishable from outside for a single-save use case: both bind the tenant, both
commit, and both leave the aggregate's publication debt discharged by the time `execute` resolves.
A one-line "is defined" assertion in the harness suite would pass with or without the seam, so it
was not written: a case that cannot go red is not evidence, and this repo already refuses that
shape everywhere else. The regression proof is the batch itself — `integration:saga-recovery`
**33/33**, unchanged across the fix.

#### SUGGESTION `R3-handler-catch-untested` — FIXED

> "The OpenPublicationEpisodeCommandHandler's catch branch … has no test … no case pins that a
> thrown error is neither swallowed silently nor re-thrown across the bus boundary."
> — `PostCommandHandlers.ts:698-704`

**Disposition: FIXED.** Four cases in a new `describe("a fault that escapes the Result
discipline")`: the shaped `success: false` result with the thrown message and no `data`; the ERROR
log, because a converted throw nobody records is a fault nobody can find; no cache invalidation,
because nothing was written to go stale; and **no `code`**, because an unclassified fault must not
read as a classified refusal — that last one is the case the finding did not ask for and the one
that matters most now that `CommandResult.code` exists. The double gained `shouldThrow`, kept
distinct from `shouldFail`: a refusal is a `Result` the use case RETURNS, a throw escapes the
Result discipline entirely, and only a double that can do both proves the handler converts the
second into the first.

**The red was taken by the probe protocol**, because the behaviour was already correct and a
characterization test cannot go red on its own. The catch's conversion was replaced with a bare
re-throw, the four cases were run, and the file was restored and verified byte-exact
(`sha256` `5dff4e1d…` → `OK`):

```text
 ❯ tests/unit/PostCommandHandlers.open-publication-episode.test.ts (21 tests | 4 failed | 17 skipped)
   × answers a shaped failure instead of letting the throw cross the bus boundary
   × logs the fault at ERROR — a converted throw that is never recorded is a fault nobody can find
   × invalidates no cache for a fault — nothing was written to go stale
   × carries no refusal code for a throw — an unclassified fault must not read as a classified one
Error: connection terminated unexpectedly
 ❯ OpenPublicationEpisodeCommandHandler.handle src/cqrs/handlers/PostCommandHandlers.ts:672:70
```

#### SUGGESTION `R3-reasoncode-declared-not-forwarded` — FIXED with a log, never a marker

> "a producer wired now that populates reasonCode expecting the completion path to persist it will
> see the value cross the parser and vanish at the handler seam **without any log line**. Recording
> an explicit warn-log or a schema-level TODO tag on the field would make the parked half
> discoverable." — `packages/shared/src/cqrs.ts:302-311`

**Disposition: FIXED — with the log. The `TODO` half of the suggestion is REFUSED on canon**: a
`TODO` marker in a comment is a tripwire in this repo (`CLAUDE.md` §Mandatory Pre-Action Triggers,
row 1b), and planting one to document a parked reader is exactly the deferral that rule exists to
stop. The suggestion offered two remedies and only one of them is admissible here.

`CompletePostPublishingCommandHandler` now counts the channels carrying a `reasonCode` and, when
that count is non-zero, logs ONCE per command at WARN with `{ postId, droppedReasonCodes }`, naming
that the reconciliation reader is not wired yet. Once per command, not once per channel: a
ten-channel outcome is one event, and a per-channel line would bury it. The schema field's JSDoc
now says in as many words that it is **parsed and not yet consumed**, that populating it is safe,
and that no behaviour may be built on the completion path persisting it. The `toStrictEqual` case
that guards against accidental forwarding is untouched and still passes.

**The red was genuine** — the handler logged nothing before:

```text
 FAIL  tests/unit/PostCommandHandlers.complete-publishing.test.ts > the additive reasonCode field >
   warns ONCE per command, naming how many codes it dropped and why
AssertionError: expected +0 to be 1
```

Three cases, not one: the warn with its count, a mixed outcome where only the channel that carried
a code is counted, and **silence when none did** — the third is what stops the log from degrading
into noise on every completion, and it passed against the pre-change code too, which is the proof
that the mock logger was wired and reading zero rather than reading nothing.

#### What the correction changed, measured from `git diff --numstat HEAD` at write time

| File                                                                       | +       | −      | Stream                 |
| -------------------------------------------------------------------------- | ------- | ------ | ---------------------- |
| `apps/api/tests/unit/PostCommandHandlers.complete-publishing.test.ts`      | 80      | 1      | EVIDENCE               |
| `apps/api/tests/unit/PostCommandHandlers.open-publication-episode.test.ts` | 84      | 3      | EVIDENCE               |
| `apps/api/src/cqrs/handlers/PostCommandHandlers.ts`                        | 16      | 0      | CODE                   |
| `apps/api/tests/integration/helpers/publishNowPromotionHarness.ts`         | 15      | 6      | EVIDENCE               |
| `apps/api/tests/unit/PostCommandHandlers.test-helpers.ts`                  | 11      | 0      | EVIDENCE               |
| `packages/shared/src/cqrs.ts`                                              | 8       | 0      | CODE                   |
| **Totals**                                                                 | **214** | **10** | CODE 24 / EVIDENCE 190 |

Unit CODE after the correction: **277** (253 + 24) — still under the 400 hard budget.

#### Gates after the correction

| Gate                                                 | Result                                                            |
| ---------------------------------------------------- | ----------------------------------------------------------------- |
| touched `apps/api` suites (7 files)                  | **92 passed** (was 85; +7 cases — 4 fault, 3 reasonCode)          |
| `integration:saga-recovery`                          | **33 tests / 33 pass / 0 fail / 0 cancelled / 0 skipped**, exit 0 |
| `tsc --noEmit` `packages/shared` · `apps/api` (6144) | **0** · **0**                                                     |
| scratchpad tsc probe over the touched test files     | **0**                                                             |
| `eslint --max-warnings 0`, 6 files, ONE pass at 6144 | **0**                                                             |
| `prettier -c`, 6 files + this ledger                 | clean                                                             |
| fitness #3 · #4 · #5 · #6 · #8 · #9 · #10 · #32      | 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0                                     |
| tripwire words in the six changed files              | none (the refused `TODO` above is why this line is here)          |

#### One thing the correction leaves behind, named rather than carried silently

The logger mock now appears in TWO suites of this family, copied rather than shared, because
`vi.mock` is hoisted per file and a shared factory would have to be imported before the hoist. It is
~25 lines duplicated. The right home is a helper the family imports, and the reason it is not
written here is that `PostCommandHandlers.test-helpers.ts` is imported for its VALUES by five
suites — moving a hoisted mock into it would apply the mock to all five at once, which is a
behaviour change to three suites this correction has no business touching. **Backlog-sized, not
bounded-correction-sized.**

---

## PR 1c — grandchild `1c-2b` (T1c.10 + T1c.11) — COMPLETE

Branch `workstream/ncor8-1c-2b`, child of `workstream/ncor8-1c-1e` @ `04299039` — **order 5 of
§9.4.1**, and the first unit of this chain whose change is REACHABLE from production on the day it
lands. `/start` is a live customer route; everything before this unit was a writer nobody called or
a command nobody sent.

**Finish state**: `SemanticLockPort` can be asked who holds a key without taking it; the publish
admission is a module of its own that reads the post's publication record, answers per mode, and
names its refusals with codes a client can branch on; `/start` calls it. **Rollback**: revert
`SagaIntegration.ts` and delete `publishAdmission.ts` — the admission seam comes out on its own and
`/start` returns to the status comparison. The port member, the Redis read and the doubles are
additive and can stay or go independently; the `RETRACTION_REFUSALS` member is consumed by
`OpenPublicationEpisodeUseCase`, so reverting it means reverting that raise too.

### What each mechanism is, as built

| Mechanism                                                         | As built                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SemanticLockPort.holder(key)`                                    | `Promise<Result<string \| null, SemanticLockError>>`, the shape design.md:460 names and the shape every sibling method already has. A failed read stays a failure IN THE PORT — collapsing it to `null` there would make "the store is unreachable" and "the key is free" the same answer for every caller |
| `RedisSemanticLockStore.holder`                                   | one `GET` on the namespaced key. Not `EXISTS` plus a fetch: the caller needs the holding saga's id, and two round trips can straddle a release                                                                                                                                                             |
| `InMemorySemanticLockStore` (new double)                          | Map-backed, all four members, TTL honoured on READ rather than by a timer (a timer would keep the process alive), holder-gated release exactly as the Lua script does, plus `plantHolder` so a case can start from "another saga is already publishing this"                                               |
| `publishAdmission.ts` (new)                                       | `admitPublishStart` is a PURE function over values — mode, status word, record view, channels named, lock holder — returning `Result<void, PublishAdmissionRefusal>`. `admitExistingPostStart` is the thin async gatherer around it; `refusalToAppError` is the one translation to HTTP                    |
| the record view                                                   | `AdmissionChannelRecord` carries exactly three facts plus the fragments. A narrow view rather than the entity, so the decision cannot reach for a field it never declared it reads                                                                                                                         |
| the refusal carrier                                               | `PublishAdmissionRefusal { statusCode, code: ErrorCode, message, details? }`. The discriminator rides in `code` because that is the field the single global error handler puts on the wire in EVERY environment — see the finding below                                                                    |
| `ErrorCode.PUBLICATION_IN_FLIGHT` / `…CHANNEL_HAS_LIVE_FRAGMENTS` | two additive members of the shared client-facing error vocabulary, the same reason `AUTH_MFA_REQUIRED` is in it: a refusal a client must branch on                                                                                                                                                         |
| `RETRACTION_REFUSALS.CHANNEL_HAS_LIVE_FRAGMENTS`                  | EXTENDS the existing set, as `1c-1d` W7 required. `refusalOf` is derived from the set with a `Set`, so the new member is recognised without touching the reader — and `confirmManualRetraction.test.ts`'s `Object.values(...)` loop picked it up with no edit                                              |
| `RetractionRefusalError.fragments`                                | the live fragments travel ON the refusal. The refusal already had the record open; a second read to answer "which fragments" can disagree with the one that decided the refusal                                                                                                                            |
| the use-case raise                                                | `OpenPublicationEpisodeUseCase` decides the stranded-channel refusal itself, from the record it has already loaded, so it can answer TYPED. The aggregate keeps refusing it too — that is the invariant every caller is owed                                                                               |

### The design correction this unit had to make — D9's admission, as written, breaks R7

**D9's admission sentence is internally inconsistent, and the inconsistency is load-bearing.** It
says publish-now "admits a post with no record or with at least one `redrivable()` channel and
refuses 400 otherwise (R7 preserved)". Those two halves disagree for one post: a post with NO record
and a terminal word. `post-publish-status-promotion` R7 requires a second start on a published post
to be REJECTED as a client error with no new job enqueued, and "no record" is not evidence of "never
published" — it is the state of every post published before this change, and of every post published
at every tip of this chain, because nothing writes a publication record on the publish-now path
until order 10.

**Measured, not argued.** `sagaPublishNowPromotion.test.ts` drives publish-now to `COMPLETED`, then
starts again, and asserts a 4xx whose body matches `/PUBLISHED/` plus an unchanged job count. At
this tip that post has no record. D9's literal rule returns 200 and enqueues.

The design's own verification map settles it: §"1c verification map", REC-12 row — "NEW (15) every
channel published → `/start` 400, zero jobs (**today's R7 in `sagaPublishNowPromotion.test.ts` stays
green as the regression gate**)". A rule that takes that suite red cannot be the rule the design
intends.

**What was built instead**: the record decides when there is one; the word decides when there is
not. With a record, admission is D9 exactly — ≥1 `redrivable()` channel admits, none refuses 400,
and a named channel pending retraction refuses 409 first. With no record, the rule `/start` has
always applied still applies: publish-now admits `DRAFT` only. The fallback is strictly NARROWER
than D9's text (it refuses a subset D9 would admit), it converges to D9 the moment every post
carries a record, and it is inert after PR 1e's reconstruction. `integration:saga-recovery` holds at
33/33 because of it.

**The ordering audit's row 5 is wrong in the same place and should be amended.** It reads "ADMITS a
post with NO record … fail-OPEN by absence, deliberately" and marks the unit sound. The audit's
criterion only examined readers that REFUSE on an absent record; a reader that ADMITS on absence is
the opposite defect and creates a duplicate-send window at every tip until the writer lands. The
audit asks the right question of the wrong direction.

### What a customer sees differently after this unit

| Request                                                              | Before                                                 | After                                                                  |
| -------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------- |
| `schedule` on a post already `SCHEDULED`                             | 400 "only DRAFT posts can be scheduled or published"   | **200** — rescheduling is admitted (D9 lifecycle family)               |
| `schedule` on a `FAILED` / `PARTIALLY_PUBLISHED` post                | 400                                                    | 400, unchanged — a delayed re-drive stays refused (Q14)                |
| `publish-now` on a post whose record still owes a channel an attempt | 400 (any non-`DRAFT` word)                             | **200** — the re-drive REC-12 requires                                 |
| `publish-now` on a post whose record has nothing re-drivable         | 400                                                    | 400, and the message now names the record as well as the word          |
| `publish-now` naming a channel with live fragments                   | 400, or admitted and refused later by the saga         | **409 `{ code: "CHANNEL_HAS_LIVE_FRAGMENTS" }`**, refused by name      |
| a second start while a saga still holds the post                     | 200, then a saga that fails on the lock a minute later | **409 `{ code: "PUBLICATION_IN_FLIGHT" }`** naming the running saga    |
| `publish-now` on a post with no record and a terminal word           | 400                                                    | 400, unchanged — the correction above is what keeps this row unchanged |
| a channel outside the caller's project                               | 404                                                    | 404, unchanged, and still decided BEFORE any record read               |

Rows 1, 3, 5 and 6 are the behaviour changes. Rows 2, 4, 7 and 8 are stated because a reader should
not have to infer which ones did not move.

### The recorded reds

**1. The port has no holder read.** The suite was written against a member that did not exist:

```text
 FAIL  tests/unit/semanticLockHolder.test.ts > RedisSemanticLockStore.holder >
   answers the saga id the lock key holds
TypeError: store.holder is not a function
      Tests  3 failed | 6 passed (9)
```

(The first run before that was `Cannot find module './doubles/InMemorySemanticLockStore.js'` — the
double did not exist either.)

**2. The admission seam does not exist.**

```text
 FAIL  tests/unit/publishAdmission.test.ts [ tests/unit/publishAdmission.test.ts ]
Error: Cannot find module '../../src/saga/publishAdmission.js'
```

**3. The refusal carries no discriminator.** Recorded with its own gotcha, because the obvious
assertion was VACUOUS:

```text
 FAIL  tests/unit/openPublicationEpisode.test.ts > … >
   carries the refusal as a DISCRIMINATOR a route can switch on, not as a message prefix
AssertionError: and the fragments travel with it, so the answer needs no second read
+ undefined
- [ { index: 1, externalId: 'frag-1' }, … ]
```

`assert.strictEqual(refusalOf(error), RETRACTION_REFUSALS.CHANNEL_HAS_LIVE_FRAGMENTS)` PASSED in that
red run — both sides were `undefined`, because the member did not exist yet. Only the `fragments`
assertion went red. The case now pins the member against its literal FIRST, so it cannot pass
vacuously again. **This is a general trap for every discriminator this change adds**: a test written
against a not-yet-declared const member is green before and after.

**4. The route decides on the word, not the record.** Four branches at once:

```text
 FAIL  tests/unit/sagaStartAdmission.test.ts > … > admits a publish-now while the record still owes
   a channel an attempt
Error: Post is in PUBLISHING status; only DRAFT posts can be scheduled or published via this saga
 FAIL  … > refuses 409 CHANNEL_HAS_LIVE_FRAGMENTS naming the channel and the fragments
AssertionError: expected 400 to be 409
 FAIL  … > refuses 409 PUBLICATION_IN_FLIGHT naming the saga that holds the post
Error: the start was admitted, but this case expects a refusal
 FAIL  … > admits a schedule for a post already SCHEDULED
Error: Post is in SCHEDULED status; only DRAFT posts can be scheduled or published via this saga
      Tests  4 failed | 6 passed (10)
```

### The split seam, measured — and why the forecast's arithmetic could not hold

§9.8 forecast `SagaIntegration.ts` at **895 → ~840 + a new ~150**, i.e. the split REMOVES ~55 lines.
Measured: the admission logic that existed to move was **five lines** (`if (post.status.value !==
"DRAFT") throw …`). Everything else in `publishAdmission.ts` is NEW decision logic — the record
read, the per-mode branching, the two typed refusals — that had no previous home.

First pass put the lock read and the HTTP translation on the route and landed the file at **955**,
above where it started. Corrected before the gates by moving both into the seam: the route now holds
one call and one throw. **Final: 895 → 904 (+9)**, `publishAdmission.ts` **260**. The file is still
over its band, pre-existing, exactly as §9.8 says.

### Doubles updated — the mandatory `rg` over `**/tests/**`

The unit deletes and renames nothing, but it WIDENS a port, which is the other way a double goes
stale. `rg -n "SemanticLockPort" apps packages infra --glob '**/tests/**'` finds four implementors:

| Site                                                         | Change                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/infrastructure/saga/RedisSemanticLockStore.ts` | the real one — compile-forced, implemented                                                                                                                                                                                                                                                |
| `apps/api/tests/integration/sagaTenantIsolation.test.ts:126` | `RecordingLockStore implements SemanticLockPort` — compile-forced, gained `holder()` answering `null` (that suite never contends)                                                                                                                                                         |
| `apps/api/tests/unit/doubles/InMemorySemanticLockStore.ts`   | NEW, the S-new-2 double                                                                                                                                                                                                                                                                   |
| `apps/api/tests/unit/saga/sagaTenant.test.ts:144`            | an object literal behind `as unknown as SagaSystemTerminationConfig` — **cast-erased, so NOT compile-forced**. Left unchanged deliberately: it carries `releaseAllForSaga` only and the terminal path it drives never asks for a holder. Named here so it is a decision, not an oversight |

Also widened, and caught the same way: `buildIntegration`'s post repository returned a DUCK TYPE
(`{ projectId, status }`) that would have answered `undefined` for `post.publications` — a crash, not
"no record". It now returns a REAL `PostAggregate`, with three fixtures (`makeExistingPost`,
`makeFullyPublishedPost`, `makeStrandedPost`) built through the aggregate's own methods.

### The scratchpad tsc probe — run, and it caught three pre-existing defects

No tsconfig opens a `.test.ts` in this repo, so the habit from the last three units was repeated. It
found **12 errors, none of them in the new files**:

- `sagaTenantIsolation.test.ts` ×3 — two `SagaExecutionEnginePort` stubs missing `isAdvancerInFlight`.
  A port member added at some point that the doubles never got; both fixed by delegating to the real
  engine.
- `sagaExistingPost.test.ts` ×5 — `handler` possibly `undefined` at every call site, because
  `expect(handler).toBeTruthy()` asserts at runtime and narrows nothing. Replaced with one narrowing
  helper.
- `sagaIntegration.helpers.ts` ×1 — `createMockQueue` was missing `enqueueBulk` AND **`getJobStates`**,
  which the saga's own fallback poll calls. A test that reached the poll would have failed on a
  missing method rather than on the state it was asserting. Both implemented.

Second run: `PROBE_TSC_OWN_EXIT=0`. **Fourth distinct defect class the probe has caught in four
units.** The permanent-config decision is still nobody's and is now four for four.

### Design-silent decisions, taken here and named

1. **The discriminator rides in `ErrorCode`, not in `details`.** `errorHandler.ts:93-99` puts
   `details` on the wire **only when `NODE_ENV === "development"`**, while `error.code` ships always.
   A discriminator the customer never receives is not one they can switch on, so the two refusals
   became `ErrorCode` members — the repo's own precedent (`AUTH_MFA_REQUIRED`). Rejected: widening
   the handler to ship `details` for every operational error, which changes EVERY error response in
   the product and is not this unit's subject. **Consequence, stated: `sagaId` and `fragments` do
   NOT reach a production client today.** See the note for Edward below.
2. **`CHANNEL_HAS_LIVE_FRAGMENTS` is declared twice and pinned by a test.** `RETRACTION_REFUSALS`
   owns the application vocabulary, `ErrorCode` owns the wire vocabulary, and `@shared/types` must
   not import `@core/posts` (wrong direction), so a single declaration is not available. `ErrorCode`
   is a TypeScript string enum, which is NOMINAL — no `satisfies`, type annotation or template
   assertion can bind a const-object literal to an enum member. The binding is therefore a CASE in
   `publishAdmission.test.ts` that compares the two strings and goes red the moment either is
   renamed.
3. **The lock is read before the status.** A running publish is the more actionable fact: the saga
   holding the post is still changing the record the other branches would read, so telling the
   customer to wait beats telling them what the record said a moment ago.
4. **An UNREADABLE lock ADMITS.** The port keeps the failure a failure; this caller then chooses
   availability, with a logged warning. Refusing every publish while Redis is unreachable trades a
   rare duplicate for a total outage, and the guarantee does not rest here — the saga's own step
   acquires the lock and fails closed on contention, the episode opening is idempotent, and the job
   ids dedupe. It is the same reasoning design.md uses for a deployment with no lock store at all
   (`saga.ts:750`). Pinned by a case.
5. **`/start` applies no set-equality rule.** D9's equality rule lives in
   `OpenPublicationEpisodeUseCase` and §9.9 item 8 is an OPEN question about it. The admission was
   not bent toward either candidate answer: it refuses a named stranded channel and otherwise says
   nothing about whether the request must equal the recorded set.
6. **The stranded-channel refusal is decided in the use case, not read off the aggregate's error.**
   The aggregate answers an `InvariantViolationError` whose only discriminator is a message prefix,
   and `publicationRefusal` flattens it to `CONFLICT`. Detecting it after the fact would BE the
   string match the note exists to remove, so the use case decides it from the record it has already
   loaded. The aggregate's refusal stays: it is the invariant, and every other caller is owed it.
7. **`existingPost` replaced `providedPostId`.** The admission needs the mode and the channel set
   alongside the id, and TypeScript does not narrow `body.mode` from a ternary that produced only
   the id. Deriving all three in one const is the narrowing carrier; the alternative was a
   `&& body.mode !== "draft"` that is a tautology at runtime.

### Gates

| Gate                                                                    | Result                                                                                        |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `@core/posts` vitest                                                    | **6 files, 98 passed**, 0 failed                                                              |
| touched `apps/api` suites (4 files)                                     | **49 passed**                                                                                 |
| `apps/api` unit tier (`vitest run --maxWorkers=2`)                      | **591 files, 9206 passed**, 0 failed (was 591 / 9200 mid-unit, 588 / 9157 at `1c-1e`)         |
| `integration:saga-recovery` (3 suites, concurrency 1, timeout 120000)   | **33 tests / 33 pass / 0 fail / 0 cancelled / 0 skipped**, runner exit 0 — level with `1c-1e` |
| `integration:tenant-isolation` (23 suites, concurrency 1)               | **247 tests / 247 pass / 0 fail / 0 cancelled / 0 skipped**, runner exit 0                    |
| `tsc --noEmit` `packages/ports` · `packages/shared` · `@core/posts`     | **0** · **0** · **0**                                                                         |
| `tsc --noEmit` `apps/api` (6144)                                        | **0**                                                                                         |
| scratchpad tsc probes over the touched test files (api + `@core/posts`) | **0** (after the three fixes above)                                                           |
| `pnpm check:circular`                                                   | **0** — 1609 files, no circular dependency                                                    |
| `eslint --max-warnings 0`, 15 changed files, ONE pass at 6144           | **0**                                                                                         |
| `prettier -c` on all 15 changed files · `pnpm format:check`             | clean (4 needed `--write`, re-checked) · clean                                                |
| fitness #3 #4 #5 #6 #8 #9 #10 #21 #23 #32                               | 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0                                                         |
| fitness #40 Part A (seam floor 3) · Part B (site floor 10)              | 3 seams / **0** violations · 14 sites / **0** violations — `sagaTenant.ts` untouched          |

**Services**: Postgres and Redis reachable on `omnipost-infra` (5432 / 6379), verified before the
integration runs. One false alarm worth recording: the tenant batch first read 174 pass / 2 fail /
54 cancelled because the invocation lacked the `DATABASE_URL` that `run-tests.sh` exports by
sourcing the root `.env` — every failure was `seed channel is not configured`. With the batch's own
env it is 247/247. The suite this unit touches (`Saga engine — two-tenant isolation`) passed in BOTH
runs.

### Budget — measured from `git diff --numstat HEAD` at write time

| Stream       | Forecast (§9.4.1 row 5) | Measured | Delta |
| ------------ | ----------------------: | -------: | ----- |
| **CODE**     |                 **210** |  **396** | +89%  |
| **EVIDENCE** |                 **110** | **1152** | 10.5× |
| DOC          |                       — |  **330** | —     |

DOC is **330**, not the 326 this section first carried: `tasks.md` is +27/−4 = 31 changed lines and
the first figure counted only its additions. CODE and EVIDENCE reconcile exactly against the
orchestrator's numstat.

CODE is **under the 400 hard budget by four lines**, so no CODE `size:exception` is owed. The
breakdown: `publishAdmission.ts` 260 · `SagaIntegration.ts` 21/-12 · `OpenPublicationEpisodeUseCase.ts`
41 · `retractionRefusals.ts` 22/-1 · `SemanticLockPort.ts` 17 · `RedisSemanticLockStore.ts` 13 ·
`errors.ts` 9.

**Was the 210 forecast possible? No — and the reason is structural, not estimation slack.** The
forecast counted a MOVE (the admission block leaving the route) plus a port member. There was no
block to move: five lines. The 260 in `publishAdmission.ts` are the decision the design asks for and
that did not exist anywhere — a record read, three mode branches, two typed refusals with their
payloads, a lock gatherer and an HTTP translation, each carrying the mandatory JSDoc. A 210-line
version of this exists only without the documentation the canon requires.

**EVIDENCE at 10.5× is the larger miss, and it is the same shape as `1c-1e`'s.** The forecast of 110
counted the two lock doubles alone. It did not count: the seam's own suite (384), which is the
entire purpose of splitting the decision out; the route-wiring suite (227), which the split makes
NECESSARY because a pure-function suite cannot prove the route reads the real record; or the helper
rebuild (189), forced because a duck-typed post repo crashes the moment the route reads
`post.publications`. Under the two-tier budget this is pre-approved evidence, but the estimator is
now three-for-three at under-counting the evidence a strict-TDD unit needs, and always for the same
reason: it counts the doubles a task NAMES and not the suites the behaviour requires.

### For Edward — two findings, one of them a live gap

1. **The typed 409s reach a production client as a CODE but not as a PAYLOAD.**
   `apps/api/src/lib/errors/errorHandler.ts:93-99` attaches `AppError.details` to the response only
   when `NODE_ENV === "development"`. So `{ code: "PUBLICATION_IN_FLIGHT" }` and
   `{ code: "CHANNEL_HAS_LIVE_FRAGMENTS" }` ship everywhere, but the `sagaId` and the `fragments`
   that D9 names in the same breath do not. Three ways out, none of them this unit's to pick:
   (a) widen the handler to ship `details` for operational errors — one small change with a blast
   radius across every error response in the product, and a privacy question on what existing
   `details` payloads hold; (b) let these two routes answer outside the global handler, which
   breaks the canon's single-handler rule and drops `correlationId`/`timestamp` from the body;
   (c) leave it, and have the 2b panel read the fragments from the read model (D13 already gives it
   `channelPublications`), treating the error body as a code-only signal. **(c) is the cheapest and
   is probably right for the fragments; the `sagaId` has no read-model home.** Decision due before
   Slice 2's retry route, which answers the same 409.
2. **The ordering audit's row 5 asks the right question in the wrong direction** (detailed above).
   Every row in that audit tests whether a reader REFUSES on an absent record; none tests whether one
   ADMITS on absence. `1c-2b` is the row where that mattered. Worth a sweep of the remaining rows
   before order 10 — row 6's confirm route and row 7's sweep are both "no-op on absence", which is
   the benign half of the same question, but row 9's recorder and row 10's worker are writes.

**The D9-vs-channel-scoped-retry question (§9.9 item 8) is NOT answered here and was not bent
toward.** `/start` applies no set-equality rule; it refuses a named stranded channel and is silent
on the rest. The question is still due before Slice 2's retry ROUTE.

### Gate corrections applied by the executor — `1c-2b`

> One row per gate finding the executor fixed, appended here so the orchestrator's own
> gate-corrections table for `1c-2b` can absorb it. W1 is the only code item this round.

**The other four, closed by the orchestrator, for the record.** **W5 (the one that mattered)** —
`design.md` now carries the as-built **rev 3.7** paragraph BESIDE D9's admission sentence, leaving
the original standing and correcting it in place: the two halves contradict each other for "no
record + terminal word", the design's own REC-12 verification row is the tiebreaker, the built rule
is strictly narrower and converges, and §9.4.1's ordering-audit row 5 is corrected with the
generalisation it owes — the audit's criterion only ever asked whether a reader REFUSES on an absent
record, never whether one ADMITS or WRITES on absence, so rows 9 and 10 owe that question before
order 10. **W4** — DOC re-measured to **330** (the first figure counted only `tasks.md`'s additions
and not its four deletions); the correction and its reason sit in the budget table above. **W3** —
**the gate's own count was wrong and is corrected here rather than repeated**: it reported four new
`as any` in `sagaIntegration.helpers.ts` at lines 826, 1008, 1017 and 1047, and that file is 608
lines long — those lines do not exist. Measured from the staged diff there are **two** new casts
(the `findById` double's `ok(post)` and the `postRepository` coercion in the config builder); both
now carry `// canon-exception: test-fixture` with the reason. **W2** — the `sagaTenant.test.ts`
double behind `as unknown as` is left unchanged, as the unit argued and the gate accepted: nothing
on the terminal path reads a holder, and a no-op `holder()` would assert nothing. The gate's
sharper point stands and is recorded rather than actioned — the omission compiles because of the
double assertion, not because it is sound, so a typed partial naming the members the double must
cover would let the compiler state the invariant the comment currently holds alone.

| Finding                                                                                                                                                                                                                             | Verdict                                                                                            | What changed                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **W1** — the unreadable-lock fail-open had a WARN log and no counter, so a degraded safety check was undiscoverable after the fact; and `publicationLockHolder` collapsed TWO states (read FAILED, no store configured) into `null` | **FIXED, single-state counter — the second state is measured UNREACHABLE in a serving deployment** | new `omnipost_publish_admission_lock_unreadable_total` through the existing `businessMetrics.ts` surface (`getOrCreateCounter` + exported typed `incrementPublishAdmissionLockUnreadable()`), incremented beside the WARN; the no-store branch carries the measurement instead of a dead label |

**Why no `reason` label**, measured rather than assumed. The coordinator's instruction allowed
either a two-state label or a single-state counter "if the no-store case never reaches this
function". The precise finding is a third thing and is stated as such: **the no-store branch IS the
first line of `publicationLockHolder`, so it is reached — but only in tests.**
`apps/api/src/index.ts:686,730-733` constructs `RedisSemanticLockStore` **unconditionally** whenever
`!env.SCHEMA_ONLY`, and `SCHEMA_ONLY` registers routes for an OpenAPI dump and serves no request.
`SagaIntegration`'s own config documents `lockStore?` as "omit in tests that do not exercise the
concurrency check" (`:90-93`), which is where every `undefined` in this repo comes from. A
`reason: "not-configured"` arm would therefore have exactly one producer — the unit suite — and a
label whose only producer is a test reads as coverage of a condition that cannot occur (the
"TRAMPA / SOLO GORDO" classes). The decision is pinned by a case that asserts the no-store path
increments **nothing**, and both the counter's JSDoc and the branch comment say what has to change
if the backend ever becomes conditional.

**Why the log stays.** They answer different questions and only one of them can be alerted on: the
WARN names WHICH request lost the check and dies with the retention window; the counter is the only
thing that can answer "how long did this deployment run without the in-flight check". Keeping only
the log is the state the finding objected to; replacing the log with the counter would lose the
post id.

**The red, recorded**:

```text
 FAIL  tests/unit/publishAdmission.test.ts > admitExistingPostStart — gathering what the decision
   reads > counts the degradation when it admits on an UNREADABLE lock
Error: omnipost_publish_admission_lock_unreadable_total is not registered: the admission
       degradation is counted nowhere
 ❯ readLockUnreadableCounter tests/unit/publishAdmission.test.ts:281:11
      Tests  3 failed | 23 passed (26)
```

Three cases, all red first: the failing `holder()` admits AND increments; a readable holder
increments nothing; an absent backend increments nothing. The scrape goes through
`client.register.getMetricsAsJSON()` — the `deletionRecordDegradation.test.ts:77-87` precedent — so
a case reads what the endpoint publishes rather than a reference someone held.

#### Gates after W1

| Gate                                                                            | Result                                                                                                                                            |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| touched `apps/api` suites (4 files)                                             | **52 passed** (was 49; +3 counter cases)                                                                                                          |
| registry-reading suites (`metricsMiddleware`, `sagaBootResume`, `architecture`) | **81 passed** — a new registered metric breaks no snapshot                                                                                        |
| `tsc --noEmit` `apps/api` (6144)                                                | **0**                                                                                                                                             |
| scratchpad tsc probe over the touched test files                                | **0**                                                                                                                                             |
| `eslint --max-warnings 0` (3 changed files, one 6144 pass)                      | **0**                                                                                                                                             |
| `prettier -c` (3 changed files)                                                 | clean                                                                                                                                             |
| fitness #3 · #4 · #5 · #13                                                      | 0 · 0 · 0 · 0                                                                                                                                     |
| `pnpm check:circular`                                                           | **0** — run because W1 adds a new import edge (`publishAdmission.ts` → `businessMetrics.ts`), and `businessMetrics.ts` imports only `prom-client` |

Not re-run, and stated so the absence is a decision: the `apps/api` unit tier and both integration
batches. Nothing W1 touches reaches them — `businessMetrics.ts` gains one counter and one export,
and `publishAdmission.ts` gains one call on a branch no integration suite drives (it needs a lock
store whose `holder` fails, which only the unit doubles produce).

#### Budget after W1 — re-measured from `git diff --numstat HEAD` at write time

W1 itself: **CODE +45** (`businessMetrics.ts` +35, `publishAdmission.ts` 260 → 270) and
**EVIDENCE +71** (`publishAdmission.test.ts` 384 → 455).

**The unit's CODE total is now 441, which is OVER the hard 400 budget by 41.** It was 396 before W1
— four lines under — so the counter is what crossed it. Stated plainly rather than absorbed: this
is a `size:exception` decision, and it is Edward's, not the executor's. The three shapes, for
whoever takes it: accept the 41-line overrun on a unit whose CODE is 61% one new file; split
`publishAdmission.ts`'s gatherer (`admitExistingPostStart` + `publicationLockHolder` +
`refusalToAppError`, ~90 lines) into its own module, which lowers no total and only moves lines;
or drop the counter and re-open W1. **The first is the honest one** — the overrun is documentation
and a counter the gate itself asked for, not undisciplined growth.

Line range of this correction in the canonical ledger: from `### Gate corrections applied by the
executor — 1c-2b` to the RDD receipt below.

### RDD receipt — the committed range 04299039 → de4b09f1

Lineage `review-fa3de7f6cdd9d2d5`, approved and burned. Four advisory findings, **all test-only** —
no production behaviour was in question and none changed. All four are FIXED. The narratives are
quoted verbatim so a later reader is not taking the disposition's word for what was claimed.

|   # | Finding                                          | Severity   | Disposition                                                                       |
| --: | ------------------------------------------------ | ---------- | --------------------------------------------------------------------------------- |
|   1 | `R3-counter-shared-registry`                     | WARNING    | **FIXED** — per-metric reset + absolute assertions                                |
|   2 | `R3-stranded-channel-order-dependent`            | SUGGESTION | **FIXED** — one case; the order is what the code claims, no production change     |
|   3 | `R3-lock-unreadable-fail-open-untested-at-route` | SUGGESTION | **FIXED** — one route-level case asserting the response, the WARN and the counter |
|   4 | `R3-inmemory-lock-no-fake-clock`                 | SUGGESTION | **FIXED** — one case with a fake clock, both sides of the lapse                   |

#### 1 — `R3-counter-shared-registry` (WARNING, reliability)

> "The lock-unreadable counter cases read a globally-shared prom-client registry and use
> before/after deltas rather than resetting, so if the test file is ever run in parallel with any
> other suite that also increments omnipost_publish_admission_lock_unreadable_total (or if these
> three cases were reordered/parallelized within the file), the +1 assertion could observe
> interleaved increments and become flaky. The mitigation relies on file-scoped serial ordering that
> is not asserted anywhere in the file."

**Reproduced, and deterministically.** The suggested probe was run: the three counter cases marked
`.concurrent`, three runs, the same two failures each time.

```text
 FAIL  tests/unit/publishAdmission.test.ts > admitExistingPostStart — gathering what the decision
   reads > counts nothing when the holder is readable
AssertionError: expected 1 to be +0 // Object.is equality
      Tests  2 failed | 24 passed (26)     (runs 1, 2 and 3 — identical)
```

Restored byte-exact: `sha256 2e7325f5b27811005a0284c5340bb986b35d5642769e485277a313d3627aa6cb`,
`sha256sum -c` → OK before the fix was written.

**FIXED with a per-metric reset, not a registry clear, and the choice is measured.** The repo has
both precedents. `client.register.clear()` appears in seven package suites
(`cache-redis`, `storage-s3`, `storage-cloudinary`, `external-apis`, and
`PlatformContentAdapter.media-errors.test.ts`) — all of which own their registry. It is the WRONG
tool here: `businessMetrics.ts` registers its counters at import time and holds module-level
references to them, so clearing would leave those references pointing at unregistered counters for
the rest of the process and the scrape would stop finding this one at all. The single-metric
precedent is `apps/workers/tests/mentionIngestWorker.tenantScope.test.ts:85`
(`beforeEach` + `mentionChannelUnresolved.reset()`), and that is what was followed — fetched by name
through `getSingleMetric` rather than by adding a production export the suite is the only consumer
of. **The three assertions are now absolute (`toBe(1)` / `toBe(0)`) rather than deltas**, so none of
them reads the registry twice and none depends on what ran before it.

**Stated rather than over-claimed**: the reset removes the ORDER dependency and the double read. It
does not make the file safe under intra-file concurrency — a concurrent sibling could reset mid-case
— and no per-metric approach can. These cases are serial by vitest's default and the file does not
opt out; the comment above the `beforeEach` says so, with the measurement that produced it.

#### 2 — `R3-stranded-channel-order-dependent` (SUGGESTION, reliability)

> "`strandedChannel` returns the FIRST stranded channel in requested order, but no test asserts that
> behaviour when MULTIPLE requested channels are pending retraction; the added case exercises only
> one stranded channel plus one clean channel. If iteration order ever changed (e.g. requested set
> becomes a Set with insertion-order divergence), the refusal's `fragments` payload could point at a
> different channel than a caller expected, and no test would notice."

**FIXED, and the behaviour is what the code claims — no production change.** One case in
`openPublicationEpisode.test.ts`: three declared channels, B and C both stranded, A clean, and the
request naming `[C, B, A]`. It asserts the refusal names **C**, does **not** name B, and carries C's
fragments — so both the choice and its exclusivity are pinned, not just the choice.

Green on authoring, as a characterization case must be, so the red was taken by probe: the loop
inverted to `[...requested].reverse()`.

```text
 FAIL  tests/unit/openPublicationEpisode.test.ts > … > names the FIRST stranded channel in
   requested order when several are stranded
AssertionError: the refusal names C, not B
- Expected: /aa000000-0000-4000-8000-00000000000c/
+ Received: "CHANNEL_HAS_LIVE_FRAGMENTS: channel aa000000-0000-4000-8000-00000000000b still has
             live fragments (frag-1) …"
      Tests  1 failed | 21 passed (22)
```

Restored byte-exact: `sha256 d9097dfa0704f3f65c7f6c13875b74e4ad62ac4e7a196d24be43fa9487179106`,
`sha256sum -c` → OK.

#### 3 — `R3-lock-unreadable-fail-open-untested-at-route` (SUGGESTION, reliability)

> "The route-wiring suite exercises the lock-held (409 PUBLICATION_IN_FLIGHT) and lock-free (admit)
> branches through the InMemorySemanticLockStore, but it does not exercise the unreadable-lock arm at
> the wiring level — the deliberate fail-open on `CONNECTION_ERROR` is only proved against the pure
> gatherer in publishAdmission.test.ts. There is no route-level assertion that a lock store whose
> `holder` returns err('CONNECTION_ERROR') still yields a successful start plus the warn+counter
> side-effects, leaving the wired degraded path unproved end-to-end."

**FIXED.** One case in `sagaStartAdmission.test.ts` drives the route with a lock store whose
`holder` answers `err("CONNECTION_ERROR")` and whose three mutating members throw if touched, and
asserts all three observable consequences: the start SUCCEEDS, the counter reads exactly 1, and the
WARN message was emitted. The log is captured with `vi.spyOn(logger, "warn")` rather than a module
mock, because `vi.mock` is hoisted per file and would apply to every importer of the logger in that
graph — a bigger change than one assertion needs. The spy is restored in a `finally`.

Green on authoring, so the red was taken by probe: the route's wiring changed to
`lockStore: undefined`, which takes the no-store path and produces neither side effect.

```text
 FAIL  tests/unit/sagaStartAdmission.test.ts > … > admits WIRED when the lock store cannot be read,
   and counts the degradation
AssertionError: expected +0 to be 1 // Object.is equality
      Tests  2 failed | 9 passed (11)
```

The second failure in that probe run is the existing `PUBLICATION_IN_FLIGHT` case, which is the
right company to keep: both cases exist to prove the lock store reaches the admission. Restored
byte-exact: `sha256 c4d9927536927435da0bb91b602339c1f34c36c3839f82b86d1cd9d1a508126e`,
`sha256sum -c` → OK.

#### 4 — `R3-inmemory-lock-no-fake-clock` (SUGGESTION, reliability)

> "The in-memory lock double claims the TTL lapse behaviour is exercised the same way production
> experiences it (`a test that advances the clock must see the same lapse production sees`), but no
> test in this candidate advances Date.now() to prove the lapse path: `plantHolder` is used only with
> the default 30-minute TTL and every `acquire`/`holder` case in semanticLockHolder.test.ts uses a
> 60s TTL with immediate reads. The lapse branch at :117-121 is thus unproved by any assertion in
> this candidate."

**FIXED.** One case with `vi.useFakeTimers()` that walks BOTH sides of the boundary rather than only
the far side: held at one millisecond short of the 30-minute default, absent at exactly the
boundary, and then — the part that matters for a deadlock guard — `acquire` succeeds for a different
saga and that saga becomes the holder. Real timers are restored in a `finally`.

Green on authoring, so the red was taken by probe: the lapse branch deleted from `live()`.

```text
 FAIL  tests/unit/semanticLockHolder.test.ts > InMemorySemanticLockStore > lets a hold LAPSE at its
   TTL, so the key frees itself as the Redis one does
AssertionError: expected 'saga-already-running' to be null
      Tests  1 failed | 9 passed (10)
```

Restored byte-exact: `sha256 c6619a3f2409635cac5566c66f72f5ee83cbf7a785550bfddb0111d7e68095cb`,
`sha256sum -c` → OK.

#### Gates after the RDD corrections

| Gate                                                                    | Result                                   |
| ----------------------------------------------------------------------- | ---------------------------------------- |
| touched `apps/api` unit suites (4 files)                                | **54 passed** (was 52; +2 cases)         |
| `@core/posts` vitest                                                    | **6 files, 99 passed** (was 98; +1 case) |
| `tsc --noEmit` `apps/api` (6144) · `@core/posts`                        | **0** · **0**                            |
| scratchpad tsc probes over the touched test files (api · `@core/posts`) | **0** · **0**                            |
| `eslint --max-warnings 0` (4 changed files, one 6144 pass)              | **0**                                    |
| `prettier -c` (4 changed files + this ledger)                           | clean                                    |
| fitness #3 · #4 · #5 · #32                                              | 0 · 0 · 0 · 0                            |
| tripwire words in the four changed files                                | none                                     |

Not re-run, and stated so the absence is a decision rather than an omission: the `apps/api` unit
tier and both integration batches. **The delta is four test files and nothing else** — every probe
that touched production source was restored byte-exact and verified with `sha256sum -c`, so no
production byte differs from `de4b09f1`. Nothing here can reach a suite that was not run.

Line range of this receipt in the canonical ledger: from `### RDD receipt — the committed range
04299039 → de4b09f1` to the next receipt heading.

### RDD receipt — the committed range `de4b09f1` → `a9b33bbb`

Lineage `review-d7306d69240f9f31`, MEDIUM tier, ONE reliability lens: **approved**, acknowledged
once, authority **burned**, **zero advisory findings**. The candidate was the four-findings commit
above — four test files and this ledger, no production byte moved.

**A provider defect occurred inside this review and is recorded rather than smoothed over**, because
a reviewer that fails twice and then succeeds is indistinguishable from a flaky gate unless someone
writes down which it was. The in-process reviewer's own output was refused by its own admission on
both attempts: attempt 1 `decode reviewer result: json: unknown field "paths_note"`, and the
automatic corrective attempt 2 `reviewer payload contains no complete JSON object: 2 objects opened,
1 closed; 3 arrays opened, 3 closed; scan ended at byte 2602`. Recovered by the contract's own path
and nothing else — a bound STATUS re-query with the same lineage reoffered the identical slot, and
the relaunch was admitted on the first try. Both payloads are preserved under
`.git/gentle-ai/rejected-results/review-d7306d69240f9f31/`; measured, the first one's `raw` parses
cleanly and carries the offending field at `inspection.paths_note` beside `inspection.paths` and
`inspection.status` (a well-formed object holding a field its own decoder refuses), and the second's
`raw` is 2604 bytes ending mid-string, which is a truncated generation rather than a schema
mismatch. **Reported with Edward's explicit consent** as one occurrence comment on the canonical
tracker `Gentleman-Programming/gentle-ai#3942` — the equivalent by operation, producer and cause,
whose fix (#3945) is contained in the installed `2.6.0` stable build, so this is a possible
regression rather than an "install the fix" case. No labels touched, nothing reopened; the comment
is privacy-scrubbed (no repository name, path, user, host, branch, diff or source symbol). What this
occurrence adds to the three already on that issue: the relaunch was **admitted**, on the same
build, OS and lens as the occurrence that reports it refused identically — so on 2.6.0 the refusal
is not deterministic per slot.

### RDD receipt — the committed range `a9b33bbb` → `19038d40`

Lineage `review-521a8dcfa5b6dbc8`, MEDIUM tier, ONE reliability lens: **approved**, acknowledged
once, authority **burned**. Two WARNINGs, **both REJECTED WITH PROOF** — quoted before the burn:

| Finding                                | Claim (quoted)                                                                                                                                                                                                                                                                                                                                 | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `R3-export-removed-admissionrecordsof` | "External importers (including tests that assert its externally observable per-channel record projection) would fail to resolve the symbol. No test or call-site change accompanies this de-export within the candidate scope, so the behavioral contract that previously supported outside observation of admission records is now unproved." | **REJECTED.** There are no external importers, and the claim's own parenthesis is hypothetical rather than measured: `rg -n "admissionRecordsOf" --glob '!*.md' apps packages` finds the declaration and its ONE caller, the line below it, and nothing else — tests included. `tsc --noEmit` on `apps/api` is 0 and the two suites that drive the admission are 37/37. No call-site change accompanies the de-export because there is no call site outside the module to change.                                                                                   |
| `R3-export-removed-publishstartmode`   | "If any other module in the codebase imports `PublishStartMode` from this file, the build will break; reliability of the change depends on there being no external consumers, **which cannot be verified from within this candidate's single-file scope.**"                                                                                    | **REJECTED, and the finding names its own limit.** It is correct that a single-file candidate cannot verify the absence of consumers; it is not correct that the change is therefore unproved. The absence was verified outside that scope, three ways — the tree-wide `rg` above, `tsc` at 0, and above all **the dead-code gate itself**, which is the tool that PROVED nobody imports these two symbols and is the entire reason the finding existed. The alias names a field of two interfaces in the same file; the tree-wide search finds no other reference. |

**The class, stated so the next reader does not re-litigate it**: when a review finding asks for
exactly what another gate already measured, the disposition is a rejection citing that measurement,
not a defensive change. An export nobody imports is a promise the module did not mean to make;
restoring the `export` to satisfy a hypothetical importer would restore the finding the dead-code
gate raised in the first place, and the two gates would then contradict each other permanently.

**Why the commit existed at all.** `Code Quality (knip + jscpd + madge)` went red on PR #280.
Reproduced locally: `pnpm check:dead-code` → `✖ 2 NEW dead-code finding(s) (not in baseline)`,
naming `exports::apps/api/src/saga/publishAdmission.ts::admissionRecordsOf` and
`types::…::PublishStartMode`. jscpd (751 clones, 4.49 %, unchanged) and madge (no circular
dependency) were both green — the job failed on knip alone. Both symbols lost the `export` keyword
and nothing else moved. After: knip `0 regressions` against its 321-finding baseline, `tsc` 0,
eslint and prettier 0, `publishAdmission.test.ts` + `sagaStartAdmission.test.ts` **37/37**.

## PR 1c — grandchild `1c-3a` (T1c.15 + T1c.17) — COMPLETE

Branch `workstream/ncor8-1c-3a`, child of `workstream/ncor8-1c-2b` @ `e1766780` — **order 6 of
§9.4.1**, and the unit D15.5 exists for: the two EXITS from a stranded channel land before anything
can strand one. Subject: the customer's confirm-removed route (T1c.15) and the C3 guards on the two
admin direct writers of the status word (T1c.17).

**Finish state**: a customer who has removed live fragments by hand has a route to say so, and its
refusals are values a client branches on rather than sentences it parses; and the two admin writers
that move a post's word can no longer move it over a post whose content a provider already holds, or
over a word the publishing path changed while they were deciding. **Rollback**: delete
`apps/api/src/posts/postChannelRoutes.ts` and its registration line, revert the `ErrorCode` member,
and revert `SchedulingPostHandlers.ts`. The three are independent of each other; nothing outside this
unit references any of them.

### What each mechanism is, as built

| Mechanism                               | As built                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `postChannelRoutes.ts` (new, 148 lines) | Its own plugin, registered from `postRoutes.ts`. It holds no repository and no Prisma client: one `container.resolve`, one `execute`, one translation. Addressed by `postId` AND `channelId`, which is why it is a file and not four more lines in a 702-line one                                                                                                                                                                                                                  |
| the route's tenant scope                | `requireClientAuth` alone, exactly as `1c-1d` designed the use case. `PrismaPostRepository.findById` REFUSES an unscoped load before issuing a statement (`:72-74`) and the guard injects `where.accountId`, so a post of another account is a 404 and never a leak. No `callerAccountId` parameter exists to pass                                                                                                                                                                 |
| `toAppError`                            | reads the refusal by VALUE through `refusalOf(error)`, never by message, and maps everything else off `error.code`. One function, so the route body holds no branching at all. The refusal half is a TOTAL `Record<RetractionRefusal, ErrorCode>` after the correction pass: it first mapped only `NOTHING_PENDING` and the other declared refusal fell through to a flat 409, with nothing — compiler or case — to notice                                                         |
| `ErrorCode.NOTHING_PENDING`             | the wire half of `RETRACTION_REFUSALS.NOTHING_PENDING`, added for the reason `1c-2b` added its two: `errorHandler.ts:93-99` ships `details` only in development, so a discriminator in `details` is one the customer never receives                                                                                                                                                                                                                                                |
| the route's error ENVELOPE              | `AppError` thrown into the global handler (`{ ok:false, error: { code, message, requestId, timestamp } }`), which is `/start`'s envelope and NOT `postRoutes.ts`'s `sendError` one. Deliberate — see decision 1                                                                                                                                                                                                                                                                    |
| `DIRECT_WRITABLE_STATUSES`              | `["SCHEDULED","DRAFT","FAILED"]` as an ALLOWLIST, the #28/#40 form. A denylist admits by default and the set that must never be clobbered is open-ended: every word the publishing path owns, plus whatever a later revision of the enum adds                                                                                                                                                                                                                                      |
| `liveChannelsOf`                        | the row-level mirror of `ChannelPublication.hasLiveContent()` — `outcome === "PUBLISHED" \|\| pendingRetraction`. A SECOND declaration, named as one, BOUND by a case that walks all six `(outcome, pendingRetraction)` combinations and, for each, hydrates a real `ChannelPublication` and asks IT — the correction pass replaced a hand-written table of expectations, which was a THIRD declaration and would have stayed green while the other two diverged (proven: probe E) |
| `readLiveChannels`                      | the deciding read, issued on `tx` INSIDE the caller's `withGucBoundTransaction`, so it rolls back with the write it guards. `null` (the post vanished between the two reads) is a 404, not an `undefined` deref                                                                                                                                                                                                                                                                    |
| the compare-and-swap                    | `where: { id, status: { in: [...DIRECT_WRITABLE_STATUSES] } }` — the extended-unique form `PrismaPostRepository.applyOccUpdate` (`:626`) already proves compiles. A lost swap is Prisma `P2025`, caught by `isLostStatusSwap` and answered **409**, not the 500 the outer catch would have produced                                                                                                                                                                                |
| the guards' refusal payload             | `sendError(ctx, 409, msg, { code: CHANNEL_HAS_LIVE_FRAGMENTS, channelIds })`. `BaseRouteHandler.sendError` ships `details` in EVERY environment (`:281-285`), unlike the global handler — so on this surface the discriminator can travel there, and the operator gets the channels to have cleared                                                                                                                                                                                |

### The recorded reds

**1. T1c.15 — the route module does not exist.** Written against a file that had no declaration:

```text
 FAIL  tests/unit/postChannelRoutes.confirm.test.ts [ … ]
Error: Cannot find module '/src/posts/postChannelRoutes.js' imported from
       /root/omni-post/apps/api/tests/unit/postChannelRoutes.confirm.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

**2. T1c.17 — all ten cases red, and the first two are the MEASUREMENT of today's behaviour.**
"expected 200 to be 409" is not a missing feature report: it is the statement that an admin can,
right now, cancel or reschedule a post whose content is live on a provider.

```text
 × refuses 409 and writes nothing when a channel of the post has published content
   AssertionError: expected 200 to be 409
 × refuses 409 for a channel that is EXCLUDED but still holds fragments pending retraction
   AssertionError: expected 200 to be 409
 × takes its deciding read INSIDE the transaction, with the publication record
   AssertionError: expected [] to have a length of 1 but got +0
 × hands the update a compare-and-swap where, so a word that moved loses the write
   AssertionError: expected undefined to deeply equal { in: [ 'SCHEDULED', 'DRAFT', …(1) ] }
 × answers 409 rather than 500 when the compare-and-swap finds no row
   AssertionError: expected 500 to be 409
   (and the same five on reschedulePost)
      Tests  10 failed (10)
```

**3. A pre-existing crash the guard's read UNCOVERED, red before it was fixed.** Adding
`channelPublications` to the in-transaction read took `schedulingRoutes.test.ts` from 29/29 to
**2 failed | 27 passed**: its post double answered `undefined` for the new relation. The fix is the
DOUBLE, not the guard — a guard that read `undefined` as "nothing is live" would be fail-open by
absence, the exact converse defect `1c-2b` corrected at the admission. Diagnosis confirmed by the
repair: with `channelPublications: []` in `postDefaults` the suite is 29/29 again.

**Three cases passed on their first run, so each was probed rather than trusted.**

**Probe A — the registration line.** `await fastify.register(postChannelRoutes)` replaced by
`void postChannelRoutes;` (the route file still imported, so a green `tsc` would not have noticed):

```text
 × is reachable through the post routes plugin, which is what registers it
   AssertionError: expected 200 to be 404   ← the ROUTER's 404, not the route's
      Tests  1 failed | 7 passed (8)
```

Restored and verified: `apps/api/src/posts/postRoutes.ts`
`ff5cee8c4622d1362734c448f706efea7ddfd13a54384225e5a09ea67e97a57a`, `sha256sum -c` → `OK`.

**Probe B — the refusal discriminator.** `RETRACTION_REFUSALS.NOTHING_PENDING` swapped for
`CHANNEL_HAS_LIVE_FRAGMENTS` in `toAppError`, i.e. the route stops recognising the refusal it is
about and falls through to the flat conflict:

```text
 × answers NOTHING_PENDING as a 409 the customer branches on by CODE, not by message
   AssertionError: expected 'RESOURCE_CONFLICT' to be 'NOTHING_PENDING'
      Tests  1 failed | 7 passed (8)
```

The case asserts the LITERAL `"NOTHING_PENDING"` before it asserts `ErrorCode.NOTHING_PENDING`,
because `1c-2b` recorded that a comparison between two not-yet-declared members passes vacuously.
Restored and verified: `apps/api/src/posts/postChannelRoutes.ts`
`350a25971d1528b66bd210d6658147b4e3aa822525b1ece0ad89dca76a8472f5`, `sha256sum -c` → `OK`.

> **RECEIPT SUPERSEDED — corrected in the bounded correction pass, not deleted.** The hash above
> describes the file as it stood at the moment of the restore, and the file was legitimately
> EDITED AFTER that probe, so the line was left standing as if it described the shipped tree when
> it no longer did. The fresh-context gate re-took the probe's RED against the shipped bytes and
> reproduced it, so the PROBE stands; only the receipt was stale. Re-taken against the shipped
> bytes: **`ee9872fe00e61753cc24dc6aa15400e052aeb3fc4fef133506c6c16af7293626`** at the moment the
> gate measured it, and
> **`7e12513980cfc91ce91d7916ae1704e0a9013f8b00134235e0ffeed8f1f34f44`** as finally shipped — the
> correction pass's NOTE A edited the file again (the exhaustive refusal mapping), which is why
> there are two and why a restore receipt must name the tree it describes.

**Probe C — the liveness predicate's second term.** `|| row.pendingRetraction` deleted from
`liveChannelsOf`, which is the mistake a reader who thinks "live means published" would make:

```text
 × cancelScheduledPost > refuses 409 for a channel that is EXCLUDED but still holds fragments
   AssertionError: expected 200 to be 409
 × cancelScheduledPost > mirrors the domain's live-content rule over every outcome the record
   can carry
   -     "refused": true,      (UNRESOLVED/true)
   +     "refused": false,
   -     "refused": true,      (EXCLUDED/true)
   +     "refused": false,
 × reschedulePost > refuses 409 for a channel that is EXCLUDED but still holds fragments
      Tests  3 failed | 10 passed (13)
```

Restored and verified: `apps/api/src/admin/SchedulingPostHandlers.ts`
`51bbf9af610823d57937ad26703340414bdfb29cc65ce5efa466913bd96a6cd4`, `sha256sum -c` → `OK`, suite
back to 13/13. (**RECEIPT SUPERSEDED — corrected, not deleted.** That hash describes the file at
the moment of THIS restore; the file was legitimately edited afterwards for W1's JSDoc, so the
SHIPPED hash is `c1f33b82ab36799b4f2f93e1259c2c39d93af5c359c071f484f6158cdf9ffb36` — verified
against the tree. The PROBE stands; only the receipt was stale. The same treatment was applied to
probe B and probe F one pass earlier and this receipt was missed, which is why it is stated here
in the same words: a restore receipt must name the tree it describes.)

### What a caller sees differently after this unit

Both tasks are REACHABLE from production the day they land — unlike orders 2 to 4 — so the table is
the whole behaviour delta, including the rows that did NOT move.

| Request                                                             | Before                                     | After                                                                      |
| ------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| `POST …/retraction/confirm-removed` on a channel pending retraction | 404 — no such route                        | **200** `{ applied: true, hasLiveContent }`                                |
| the same submit a second time                                       | 404                                        | **200** `{ applied: false }` — idempotent against the customer's own act   |
| the same route naming a channel the post never declared             | 404                                        | 404, now for the right reason                                              |
| the same route on a channel holding nothing                         | 404                                        | **409 `{ code: "NOTHING_PENDING" }`**                                      |
| the same route with a malformed id                                  | 404                                        | **400**, and the use case is never reached                                 |
| `POST /admin/posts/:id/cancel` on a post with a PUBLISHED channel   | **200, word clobbered to DRAFT**           | **409 `{ details.code: "CHANNEL_HAS_LIVE_FRAGMENTS", channelIds }`**       |
| `POST /admin/posts/:id/cancel` on a channel pending retraction      | **200, word clobbered**                    | **409**, same shape                                                        |
| `POST /admin/posts/:id/reschedule` on a PUBLISHED post              | **200 — the word is dragged to SCHEDULED** | **409**. Reschedule has no status pre-check at all; the guard is its first |
| either admin route while the publishing path moves the word         | **200, last writer wins, promotion lost**  | **409** — the swap matched no row (`P2025`), answered as a conflict        |
| either admin route on a post soft-deleted between the two reads     | 200 over a deleted row, or a `P2025` 500   | **404**                                                                    |
| either admin route on a post with no live channel                   | 200                                        | 200, unchanged — one extra read inside the transaction                     |

Rows 1-5, 6-10 are the changes. Row 11 is stated because a reader should not have to infer that the
ordinary path is untouched.

### Design-silent decisions, taken here and named

1. **The confirm route answers through the GLOBAL error handler, not through `sendError`.** Its
   `/posts` neighbours all use `BaseRouteHandler.sendError`, whose body is
   `{ ok:false, error: "<sentence>" }` with NO `code` field — so a customer could only tell
   `NOTHING_PENDING` from any other 409 by parsing the sentence, which is the defect the whole
   discriminator chain exists to remove. Throwing `AppError` gives this route the SAME envelope
   `/start` already answers for the sibling conflict (`CHANNEL_HAS_LIVE_FRAGMENTS`), so a client
   branches on `error.code` identically on both. **Rejected**: widening `sendError` to carry a code,
   which changes every error response in the product and is not this unit's subject.
2. **The admin guards do the OPPOSITE, and for a reason that is measured, not stylistic.**
   `sendError` attaches `details` in every environment (`BaseRouteHandler.ts:281-285`) while the
   global handler attaches them only under `NODE_ENV === "development"` (`errorHandler.ts:93-99`).
   On the admin surface the operator needs the CHANNEL LIST, not just a code, and `sendError` is the
   only one of the two serializers that delivers it — so the discriminator rides in `details`
   alongside the channels. Converting this file to `AppError` would also reshape every other error
   it emits. **Rejected**: two different discriminator homes with no stated reason, which is how a
   client ends up with two parsers.
3. **The liveness predicate is duplicated, deliberately, and the duplicate is pinned.** One
   declaration is not available: the domain's `hasLiveContent()` reads HYDRATED facts
   (`_published !== undefined`) and these handlers hold a raw client and read COLUMNS
   (`outcome === "PUBLISHED"`). The binding is a case over all six `(outcome, pendingRetraction)`
   combinations, and probe C proves it bites. **Rejected**: resolving `PostRepository` in the handler
   to get `post.publications.hasLiveContent()` free — it reads on the OUTER client, so the deciding
   read would leave the transaction it guards, which is the one property D15.5's guard is about.
   The single-declaration home (a row-level predicate in `packages/adapters/db-prisma`, beside the
   `OUTCOME_KIND` mapping that already exists there) is named for the backlog rather than built
   here.
4. **The allowlist is the same three words for BOTH handlers, although cancel's pre-check is
   narrower.** `cancelScheduledPost` already refuses anything but `SCHEDULED` before the
   transaction, so its swap is wider than its own pre-check. That is intentional: the swap's job is
   to refuse the word FAMILY a direct writer must not clobber, not to re-run the pre-check, and two
   different sets would be two things to keep in step. **Rejected**: `status: "SCHEDULED"` on cancel
   — strictly stronger, and strictly more drift.
5. **A lost swap is caught OUTSIDE the transaction, not inside it.** Catching `P2025` inside the
   callback would leave Prisma to COMMIT a transaction whose statement had already aborted at the
   PostgreSQL level; letting the promise reject makes the rollback the database's own. **Rejected**:
   the inner catch, which is shorter and depends on abort semantics a reader has to know.
6. **Two suites in one file (`SchedulingPostHandlers.c3.test.ts`).** The task names
   `SchedulingPostHandlers.*.test.ts`; two `describe` blocks in one file satisfy that glob and share
   ONE prisma double, which is what keeps the two guards from being proved against two subtly
   different contracts. **Rejected**: a file each plus a shared helper — a third file, same drift
   surface, more imports.
7. **`postChannelRoutes` is registered from `postRoutes.ts`, not from `index.ts`.** Every `/posts`
   route then has one registration site. The cost is that a `postRoutes` consumer silently gains the
   child plugin, which is why the wiring has its own case and probe A exists.

### Doubles updated — the mandatory `rg` over `**/tests/**`

This unit deletes and renames nothing. It WIDENS a read, which is the other way a double goes stale
(`1c-2b`'s port-widening precedent).

| Search                                                                                      | Result                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rg -n "SchedulingPostRouteHandler\|schedulingRoutes" apps packages infra -g '**/tests/**'` | TWO consumers: the NEW `SchedulingPostHandlers.c3.test.ts` (constructs it directly) and `schedulingRoutes.test.ts` (through the plugin). The second's post double gained `channelPublications: []` — the red above is what found it |
| `rg -ln "channelPublications" apps/api/tests`                                               | FIVE files. `schedulingRoutes.test.ts` + the new suite are this unit's; the other three (`PrismaPostRepository.test.ts` ×2, `approvals/approvalRoutes.test.ts`) model it for the repository path, which this unit does not touch    |
| `rg -n "NOTHING_PENDING" apps packages infra -g '**/tests/**'`                              | `@core/posts`' own `confirmManualRetraction.test.ts` (8 hits, all through `refusalOf` by VALUE) and the new route suite. No double holds the literal in a way that could drift                                                      |
| `rg -n "ConfirmManualRetraction" apps packages infra -g '**/tests/**'`                      | `@core/posts` only. The route's double is local to the new suite                                                                                                                                                                    |
| `rg -ln "Object.values(ErrorCode)\|Object.keys(ErrorCode)" apps packages`                   | **EMPTY, and an empty result is a result**: nothing enumerates the enum, so the new member breaks no snapshot and no exhaustive switch                                                                                              |

### The scratchpad tsc probe — run, and it caught a fourth defect class

No tsconfig opens a `.test.ts`, so the habit from the last four units was repeated over the touched
test files plus `helpers/mockPrisma.ts`. It found **4 errors, none of them in the two new files**:

- `helpers/mockPrisma.ts` ×3 — `TS2352` on three `as T` casts that build a row from defaults plus a
  partial. **FIXED**: `as unknown as T` with a `// canon-exception: test-fixture` marker on each,
  which is what the compiler had already refused to accept as an overlap.
- `schedulingRoutes.test.ts:108` — `TS2345`: `setupContainer({ prisma })` is missing the REQUIRED
  `apiMetrics`. **NOT fixed here, because it is a CLASS and fixing one member would hide it**:
  measured, **23 of 23** `setupContainer({…})` call sites in `apps/api/tests` omit it and **zero**
  supply it. Repairing one of twenty-three turns a systemic gap into a "1 error" report. Backlog row
  below.

Second run after the three fixes: one remaining error, the measured class. **Fifth distinct defect
class the probe has caught in five units**, and the permanent-config decision is now five for five.

### Gates

> This table is the reading at the tip the fresh-context gate reviewed. It is kept unchanged as a
> record; the post-correction readings are in §"Bounded correction pass" below, and the two differ
> only where a correction moved a number (the unit tier by +3 cases).

| Gate                                                                  | Result                                                                                                            |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `@core/posts` vitest (untouched; run because `@shared/types` moved)   | **6 files, 99 passed**, 0 failed                                                                                  |
| touched `apps/api` suites (4 files)                                   | **55 passed**, 0 failed                                                                                           |
| `apps/api` unit tier (`vitest run --maxWorkers=2`)                    | **593 files, 9232 passed**, 0 failed, 0 skipped                                                                   |
| `integration:saga-recovery` (3 suites, concurrency 1, timeout 120000) | **33 tests / 33 pass / 0 fail / 0 cancelled / 0 skipped**, runner exit 0 — level with `1c-2b`                     |
| admin-scheduling integration batch                                    | **none exists** — measured: `rg "admin/posts" apps/api/tests` finds only the unit suite. See below                |
| `tsc --noEmit` `packages/shared` · `apps/api` (6144)                  | **0** · **0**                                                                                                     |
| scratchpad tsc probe over the touched test files                      | **1** — the measured 23/23 `apiMetrics` class, above; **0** in the two new files                                  |
| `pnpm check:circular`                                                 | **0** — 1610 files, no circular dependency                                                                        |
| `pnpm check:dead-code` (knip ratchet)                                 | **0 regressions** against the 321-finding baseline                                                                |
| `eslint --max-warnings 0`, 8 changed files, ONE pass at 6144          | **0**                                                                                                             |
| `prettier -c` on all 8 changed files · `pnpm format:check`            | clean (3 needed `--write`, re-checked) · clean                                                                    |
| fitness #1 #3 #4 #5 #6 #8 #9 #10 #21 #23 #32                          | 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0                                                                         |
| fitness #40 Part A (seam floor 3) · Part B (site floor 10)            | 3 seams / **0** violations · 14 sites / **0** violations — unchanged; the guard's read is INSIDE an existing seam |
| fitness **#41**                                                       | **8 marker sites (floor 8), 1 exception hit, 0 violations — UNCHANGED by this unit.** See below                   |

**Normalization ordering, honoured rather than assumed.** `prettier --write` rewrote three files
AFTER the first pass of `tsc`, the unit tier, `integration:saga-recovery`, `check:circular` and
`eslint`. Whitespace cannot change a type or a test, but a gate reported over bytes that were then
edited is a receipt for a tree nobody delivered — so all five were RE-RUN on the final bytes and the
table above is the second reading. Both readings agree.

**Services**: Postgres and Redis reachable on `omnipost-infra` (5432 / 6379), verified before the
integration run; the batch was invoked with `run-tests.sh`'s own env (`set -a; source .env`) so the
`DATABASE_URL` false alarm `1c-2b` recorded could not recur.

**Unit-tier arithmetic — re-derived in the bounded correction pass; the delta is exactly 21 and
the "residual 2" this paragraph first flagged is ZERO.** 9232 is an absolute reading on this tree.
Every test-bearing file this unit adds or changes is accounted for: the two new suites contribute
exactly **21** (8 + 13, measured in isolation — `vitest run` on the two files alone);
`schedulingRoutes.test.ts` holds **29 cases in BOTH states** (measured at `HEAD` via `git show` and
in the working tree — its diff is four comment lines plus `channelPublications: []`, zero cases);
and `mockPrisma.ts` is a helper with **0** cases. So the tier on this tree without this unit is
**9232 − 21 = 9211**, and 9211 + 21 = 9232. Independently corroborated by the FILE count:
**593 − 2 = 591**, exactly the two new suites and nothing else.

The "residual 2" was a SLIP: it compared 9211 — a figure derived for THIS tree — against `1c-2b`'s
recorded 9206, which was measured on a DIFFERENT tree state and is not a comparable baseline.
Measured: that reading was taken BEFORE `a9b33bbb` (the `1c-2b` W1 correction), whose own gate
table records that **the unit tier was deliberately NOT re-run** — so the cases W1 added were never
counted on that tip. Counted directly, `a9b33bbb` added **+2** `apps/api` unit cases
(`sagaStartAdmission.test.ts` +1, `semanticLockHolder.test.ts` +1; `publishAdmission.test.ts` +0 —
its +42/−14 strengthens assertions inside existing cases) and **+1** `@core/posts` case
(`openPublicationEpisode.test.ts`), which closes the `@core/posts` figure EXACTLY: 98 + 1 = 99.
Whatever remains between 9206 and 9211 is a property of the `1c-2b` reading, not of this tree, and
the derivation above does not depend on it. Nothing here is left for the next reader to hunt.

### Fitness #41 does NOT see this guard, and saying so is the point

T1c.17 asks for "the fitness **#41** compare-and-swap shape", and the gate list for PR 1c names #41.
Measured: #41's `MARKERS` are five SINGLE-USE CREDENTIAL consumption columns —
`passwordResetToken`, `resetToken`, `mfaBackupUsedAt`, `mfaLastUsedTotpStep`, `refreshTokenHash`.
A post's `status` is not one of them, so the check never inspects a `post.update`. Run before and
after this unit it reads the same three numbers: **8 marker sites against a floor of 8, one
exception hit, zero violations.**

So the guard **adopts #41's shape and cannot satisfy #41**, because #41's subject is a credential
that may be spent once and a status word is not that. The task's instruction to "satisfy it rather
than merely resemble it" has no available reading in which it is true, and bending the guard toward
one — adding a fake marker, or widening `MARKERS` with `status` — would be worse than the gap:
`status` appears in `data` at every legitimate status write in the repo, so the marker list is the
wrong home for this class.

**The right home, costed rather than asserted — and RE-MEASURED in the bounded correction pass,
because the first costing was wrong twice.** A separate class gate — "every `post.update` whose
`data` moves the status word names the prior word in the same call's `where`" — is a real and
useful check. This paragraph first put its baseline at **5** (the webhook `PUBLISHED` writes) and
said N-COR-9 would take it to **zero**. Both are false, and the measurement is the #41 slicer
itself, re-pointed at the `post` accessor:

| Site                                      | `where`                                    | Verdict                                          |
| ----------------------------------------- | ------------------------------------------ | ------------------------------------------------ |
| `facebookWebhookProcessor.ts:421`         | `{ id: postId }`                           | violation — N-COR-9's scope                      |
| `instagramWebhookProcessor.ts:341`        | `{ id: postId }`                           | violation — N-COR-9's scope                      |
| `tiktokWebhookProcessor.ts:361`           | `{ id: postId }`                           | violation — N-COR-9's scope                      |
| `xWebhookProcessor.ts:442`                | `{ id: postId }`                           | violation — N-COR-9's scope                      |
| `youtubeWebhookProcessor.ts:398`          | `{ id: postId }`                           | violation — N-COR-9's scope                      |
| **`tiktokWebhookProcessor.ts:428`**       | `{ id: postId }`                           | **violation — `status: "FAILED"`, NOT in scope** |
| **`PostPublicationWrites.ts:212`**        | `{ id: postId, version: expectedVersion }` | **violation — legitimate OCC, needs allowlist**  |
| `PrismaPostRepository.ts:346` (shorthand) | `{ id: { in: … }, deletedAt: null }`       | 8th, only if the marker is shorthand-aware       |
| `SchedulingPostHandlers.ts:370` / `:503`  | `{ id, status: { in: […] } }`              | the two this unit added — already compliant      |

So the baseline is **7** (8 shorthand-aware), not 5. And **N-COR-9 does NOT take it to zero**:
`proposal.md:59` scopes N-COR-9 to exactly the five `PUBLISHED` writes it names, so
`tiktokWebhookProcessor.ts:428` survives it untouched. The gate therefore needs its OWN allowlist
design — OCC-by-version and bulk-by-id-set are legitimate shapes — INDEPENDENT of N-COR-9 ordering.
Also measured, for whoever designs it: widening #41's own `MARKERS` with `status` is not the
alternative, because #41's call regex is model-agnostic and that would fire **37** times across all
models. Backlog row **SMELL-153**, written with those numbers rather than the first guess.

### Budget — measured from `git diff --numstat HEAD` plus `wc -l` on the three untracked files

| Stream       | Forecast (§9.4.1 row 6) | Measured | Delta |
| ------------ | ----------------------: | -------: | ----- |
| **CODE**     |                 **200** |  **337** | +69%  |
| **EVIDENCE** |                 **260** |  **644** | 2.5×  |
| DOC          |                       — |  **379** | —     |

CODE breakdown: `SchedulingPostHandlers.ts` 179/−12 · `postChannelRoutes.ts` 128 ·
`postRoutes.ts` 10 · `errors.ts` 8. EVIDENCE: `SchedulingPostHandlers.c3.test.ts` 412 ·
`postChannelRoutes.confirm.test.ts` 216 · `mockPrisma.ts` 8/−3 · `schedulingRoutes.test.ts` 5.
DOC: this section 351 · `tasks.md` 24/−4. **CODE is under the 400 hard budget by 63 lines, so no
CODE `size:exception` is owed** — the third unit in a row to land under it without shrinking
anything.

> Superseded by §"Budget after the correction pass" below (CODE 348, EVIDENCE 888, still under the
> 400 CODE budget). The filename above is the one the suite carried when this was measured; the
> suite ships as `tests/unit/postChannelRoutes.test.ts`.

**Was the 200 forecast possible? For T1c.15 nearly; for T1c.17 no, and the reason is a branch the
forecast did not contain.** The route is 128 against an implied ~90, which is ordinary estimation
slack. The handlers are 191 against an implied ~110, and the gap is not padding: the forecast
described "a re-read and a `where` clause", which is four lines twice. What the guard actually needs
is a re-read that can answer THREE outcomes (live / vanished / clear), a swap that can LOSE — and a
lost swap raises `P2025` into an outer catch that answers 500, so the refusal path had to be built
or the guard would have converted a race into a server error. That branch, its helper, the allowlist
and the JSDoc the canon requires are the difference. A 110-line version exists only without the
`P2025` answer, and that version is worse than no guard on the reschedule path.

**EVIDENCE at 2.5× is the same shape the last three units recorded, for the same reason.** The
forecast counted 70 lines per handler suite. It did not count the prisma double the two guards
SHARE (136 lines: an interactive `$transaction` that can tell an in-transaction read from a client
one, a `P2025`-raising update, and a post that can vanish mid-transaction), which is what makes
"the read is inside the transaction" a provable claim rather than a comment. The estimator is now
four-for-four at under-counting the machinery a behavioural claim needs, and always by counting the
cases and not the fixture.

### For Edward — one live gap, one class, one proposal

1. **THE THREE ADMIN SCHEDULING ROUTES RETURN 500 IN PRODUCTION TODAY, and the C3 guards this unit
   adds are therefore unreachable until that is decided.** This is pre-existing and independent of
   this change, and it is measured, not inferred:
   - `Post` is tenant-guard enrolled (`infra/prisma/src/extensions/tenantGuard.ts:129-130` —
     `post` and `postChannelPublication`).
   - `TOKENS.PrismaClient` resolves to the GUARDED client
     (`infrastructure/container/setup.ts:75-77`), which is what `schedulingRoutes.ts:20` injects.
   - The guard's own decision function, run directly:
     `Post.findFirst with NO context -> TenantContextMissingError: No TenantContext or
SystemContext bound for Post.findFirst`, and the identical answer for `update`.
   - Nothing on the admin path binds a context: `rg "enterTenantContext|withTenantContext|
enterSystemContext|withSystemContext"` over `adminAuthMiddleware.ts`, `rbacMiddleware.ts`,
     `schedulingRoutes.ts` and `SchedulingPostHandlers.ts` returns **no hits**, and the three
     global `onRequest`/`preHandler` hooks in `index.ts` bind none either.
   - `postRoutes.ts:493-500` documents the SAME discovery for `DELETE /posts/batch` and calls it
     "measured on this route as a 500 raised by the ownership filter's own `Post.findMany`".
   - Nothing caught it because the only suite that drives these routes mocks Prisma wholesale, and
     **no integration batch names them** (`rg "admin/posts" apps/api/tests` → the unit suite only).

   The fix is a decision, not a line: either these routes run under `withSystemContext` like their
   three `ACCOUNT_MANAGE` siblings do, or they stop being admin-authenticated. Both are cross-tenant
   authorization choices, which SECURITY_CANON does not let an executor invent. **The guards are
   still correct and still worth landing now** — they are what D15.5 requires at this tip, and they
   go live the moment the route does — but this unit's behaviour table is about what the code says,
   not about traffic that currently reaches it.

2. **`setupContainer({ prisma })` is missing its REQUIRED `apiMetrics` at 23 of 23 test call
   sites** (zero supply it). Invisible to every wired gate, because no tsconfig opens a `.test.ts`.
   It is the permanent-config question again — five units, five finds — and it now has a number.

3. **The `details`-vs-`code` split is now two-sided, which is a decision Edward may want to
   collapse.** `1c-2b`'s finding 1 said the typed 409s reach a client as a CODE but not as a
   PAYLOAD, and listed (a) widen the handler, (b) leave the global handler, (c) read the payload
   from the read model. This unit adds the observation that the repo ALREADY has a second
   serializer — `BaseRouteHandler.sendError` — which ships `details` unconditionally, so the
   product currently answers the same class of conflict two different ways depending on which
   route answered. Option (a) would make them one. Still not this unit's to pick, and now the
   choice has a second consumer.

### Bounded correction pass — the fresh-context gate's PASA CON CORRECCIONES, worked

Seven items, no more: two of the gate's three Criticals were FALSE CLAIMS in the artefacts rather
than defects in the code, and they are corrected IN PLACE (a sentence deleted teaches nobody why it
was wrong). Nothing outside the list was refactored, and the design was not re-litigated.

| #   | Item                                                                         | Kind            | Outcome                                                                                              |
| --- | ---------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------- |
| C1  | a restore receipt in this ledger names a hash the shipped file does not have | doc             | corrected in place, BOTH superseding hashes recorded                                                 |
| C2  | "the fitness #41 compare-and-swap shape" is false, in four places            | doc             | corrected in place in `tasks.md` ×2, `design.md` ×2; the two TRUE "#41 at 0" lines verified and LEFT |
| C3  | the ledger declares a test-count "residual 2" that is arithmetically zero    | doc             | re-derived; delta is exactly 21, residual 0                                                          |
| W1  | production JSDoc calls a test "the binding" and that test binds nothing      | code + evidence | the case now hydrates a real `ChannelPublication` and asks IT; proven by probe                       |
| W2  | nothing pins that a non-`P2025` write failure still returns 500              | evidence        | one case per handler, two failure shapes each; proven by probe                                       |
| C6  | the backlog row for the status class gate states a baseline that is wrong    | doc             | re-measured 7 (8 shorthand-aware), N-COR-9 does NOT close it — SMELL-153                             |
| NA  | `toAppError` handles 1 of the 2 declared refusals                            | code + evidence | mapping made TOTAL; a new member now fails to compile AND fails a case                               |
| NB  | 10 bare `any` in one file, 3 `canon-exception` markers in another, same diff | evidence        | one rule: type the shape, mark only the cast that defeats the compiler                               |
| +7  | the confirm suite sits at a flat aspect-suffixed path                        | evidence        | suffix dropped → `tests/unit/postChannelRoutes.test.ts`; the mirroring half was REVERTED (see below) |

#### C2 — the two lines I was told to verify rather than change, verified

`tasks.md`, `"#40 Part A+B/#41 at 0; #30 and #38's db-prisma ratchet not risen"` (line 866 at the
time of writing) and `design.md`, `"#32/#41 at 0, #30 and #38 ratchets not risen"` (line 519). Both
assert the gate's COUNT, which is a true no-regression check and is exactly what this unit measured
(0, unchanged). Neither claims #41 as COVERAGE of this slice. **Left untouched**, as instructed.
`tasks.md`, the row anchored on `"#41"` in the 1c gate column (line 1652), DID claim coverage
(`**#41** (the C3 compare-and-swap shape)`) and was corrected.

> **Citation form, corrected in the final pass.** These four references were first written as bare
> `file:NNN` coordinates, and three of the four had already ROTTED inside the same pass that wrote
> them (`tasks.md:843` → 866, `tasks.md:1629` → 1652, and in the table below `tasks.md:753` → 754
> and `tasks.md:1284` → 1294) because the pass kept editing the files it was citing. A line number
> is not an identifier; the QUOTED TEXT is. Every citation in these `1c-3a` sections now leads with
> a short quoted anchor and carries the number only beside it, as navigation that may age rather
> than as the claim itself.

#### The recorded reds of the correction pass

**RED 1 (NOTE A) — the second declared refusal reaches the wire as a flat conflict.** A case driven
from `Object.values(RETRACTION_REFUSALS)` rather than from a list written in the test, so a refusal
added tomorrow is covered without anyone remembering to add a case:

```text
 FAIL  tests/unit/postChannelRoutes.confirm.test.ts > … > publishes EVERY declared retraction
       refusal as its own wire code, not a flat conflict
AssertionError: expected 'RESOURCE_CONFLICT' to be 'CHANNEL_HAS_LIVE_FRAGMENTS'
      Tests  1 failed | 8 passed (9)
```

GREEN by replacing the single `if (refusal === NOTHING_PENDING)` with a TOTAL
`Record<RetractionRefusal, ErrorCode>`. `CHANNEL_HAS_LIVE_FRAGMENTS` is unreachable from
`ConfirmManualRetractionUseCase` today (`:191-193` emits only `NOTHING_PENDING`) — stated, not
hidden: the subject is the ROUTE's translation, which must not depend on which use case calls it.
It stays a `Result`-shaped refusal; nothing new throws across a layer boundary.

**PROBE D — the compiler half of the same claim.** A `Record` is only a binding if a new member
breaks the build, so a third member was planted in `RETRACTION_REFUSALS`:

```text
apps/api/src/posts/postChannelRoutes.ts(49,7): error TS2741: Property 'PROBE_ONLY_THIRD_REFUSAL'
  is missing in type '{ NOTHING_PENDING: …; CHANNEL_HAS_LIVE_FRAGMENTS: …; }'
  but required in type 'Record<RetractionRefusal, ErrorCode>'.
```

Restored and verified: `packages/core/posts/src/retractionRefusals.ts`
`2d36c278bc18972922fe539df125c73ca06601db5b476d5f0bcb0757d8287512`, `sha256sum -c` → `OK`.

**PROBE E (W1) — the defect and the fix, both measured, in that order.** The claim under test is
not "the predicates agree" (they do, and the gate showed why: the domain is
`_published !== undefined || _pendingRetraction` at `ChannelPublication.ts:491`, `outcomeKind` is
derived and never stored `:351-358`, and there is exactly ONE writer of the column,
`PostPublicationWrites.ts:137`, with a total mapping). The claim is that the test NOTICES when they
stop agreeing. So `hasLiveContent()` had its `|| this._pendingRetraction` term deleted — the exact
divergence a reader who thinks "live means published" would introduce — and the suite was run
TWICE over that broken domain:

```text
step 1 — the ORIGINAL hand-written table, against the flipped domain
      Tests  13 passed (13)        ← GREEN. The "binding" did not bind. This is the defect.

step 2 — the CORRECTED case, against the same flipped domain
 × mirrors the domain's live-content rule over every outcome the record can carry
   -     "refused": true,      (UNRESOLVED/true)
   +     "refused": false,
   -     "refused": true,      (EXCLUDED/true)
   +     "refused": false,
      Tests  1 failed | 12 passed (13)   ← RED. The binding bites.
```

Restored and verified: `packages/core/domain/src/entities/ChannelPublication.ts`
`7edbff7a525ec20c9eeb5c4e8109e915e0ca73c908c125066e72764b6dcca7ab`, `sha256sum -c` → `OK`; suite
back to green and `@core/domain` 10 files / 191 passed.

The corrected case hydrates a real `ChannelPublication` per combination through the entity's own
`reconstitute` — the path the repository uses — derives BOTH columns from that record the way
`publicationRowData` derives them, and takes the expected boolean from `record.hasLiveContent()`.
Two totality guards ride with it: the kind→column map is a `Record<PublicationOutcomeKind, …>`, so
a new outcome kind stops the file compiling, and the case pins 4-of-6 refusals so a rule that
answered the same for every row could not satisfy it vacuously. The production JSDoc at
`SchedulingPostHandlers.ts` now says WHY it is a binding instead of asserting that it is — the word
"binding" was NOT deleted, which was the cheap exit on offer.

**PROBE F (W2) — the exactness of `code === "P2025"` is load-bearing.** The two new cases (one per
handler, each driving a `P2002` Prisma error AND a bare `Error` with no code) passed on their first
run, because the behaviour already worked. So the red was taken by reconstructing the pre-fix
shape: `isLostStatusSwap` loosened to `"code" in error` — the mistake a reader would make.

```text
 FAIL  … C3 guard on cancelScheduledPost > keeps a write failure that is NOT a lost swap a 500 …
AssertionError: a Prisma error with a DIFFERENT code: expected 409 to be 500
 FAIL  … C3 guard on reschedulePost > keeps a write failure that is NOT a lost swap a 500 …
AssertionError: a Prisma error with a DIFFERENT code: expected 409 to be 500
      Tests  2 failed | 13 passed (15)
```

Restored and verified: `apps/api/src/admin/SchedulingPostHandlers.ts`
`51bbf9af610823d57937ad26703340414bdfb29cc65ce5efa466913bd96a6cd4`, `sha256sum -c` → `OK`. (That
file was edited again afterwards for W1's JSDoc, so the SHIPPED hash is
`c1f33b82ab36799b4f2f93e1259c2c39d93af5c359c071f484f6158cdf9ffb36` — the C1 lesson, applied to this
pass's own receipts.) Each case also asserts the write was attempted EXACTLY once, so a retry
smuggled into the refusal path is caught too.

#### NOTE B — the rule the diff now follows, stated instead of implied

The diff disagreed with itself: `SchedulingPostHandlers.c3.test.ts` held 10 bare `any` with no
marker while `mockPrisma.ts` gained 3 `// canon-exception: test-fixture` markers for a weaker
coercion. Measured across `apps/api/tests`: **864 `any` occurrences in 108 files against 10
`canon-exception` markers in 5 files**, only 2 of which overlap — so "mark every `any`" is not the
repo convention and never was. The rule taken, and the reason:

- **A double's SHAPE is knowable — give it a type.** The c3 doubles now carry named interfaces
  (`FindFirstArgs`, `UpdateArgs`, `UpdateManyArgs`, `SentBody`) and the file holds **zero** bare
  `any`.
- **A cast that DEFEATS the compiler gets a marker.** The only such casts are the three handoffs to
  production signatures (`as unknown as PrismaClient`, `… as FastifyReply`, `… as FastifyRequest`)
  plus the serializer body — 4 markers, the identical construct `mockPrisma.ts` marks. So both
  files now follow ONE rule and the markers in `mockPrisma.ts` are warranted rather than
  inconsistent.

Fitness #3 excludes `/tests/`, so no gate would have caught either state. The scratchpad `tsc`
probe caught the stricter typing's one real consequence (`exactOptionalPropertyTypes` refuses
`head: … ? … : undefined`), which is why the settled facts are ADDED per branch in
`settledStateOf` rather than set to `undefined` on a shared object — the canon's own
conditional-construction pattern.

#### Item 7 — the confirm suite drops its aspect suffix and STAYS FLAT

`apps/api/tests/unit/postChannelRoutes.confirm.test.ts` →
**`apps/api/tests/unit/postChannelRoutes.test.ts`** (5 relative `../../src/` specifiers, unchanged
in the end; the `@file` header is basename-only, so it carries the new name without an edit).

**This landed in two steps, and the second REVERSED the first.** An intermediate pass moved the
suite to a mirrored `tests/unit/posts/postChannelRoutes.test.ts`; the final pass moved it back to
flat and deleted the now-empty `tests/unit/posts/`. Both halves are recorded because the reason the
move was undone is the same reason it should not be re-attempted:

- **Flat is the MAJORITY convention, not the exception.** Measured on the shipped tree: **29** of
  `apps/api/src`'s directories have a mirrored `tests/unit/` subdirectory and **35** do not. The
  intermediate pass had already corrected the premise it was handed ("`posts/` is one of the few
  without one" — false), but it still moved the file; the arithmetic says the move was toward the
  minority.
- **It split one source folder across two conventions.** `src/posts/` holds four modules, and
  `postRoutes.test.ts`, `postsService.test.ts` and `optimizedPostsRoutes.test.ts` are all FLAT.
  Mirroring the fourth alone was the ONLY thing making `src/posts` disagree with itself; before the
  move it agreed, and after the revert it agrees again.
- **The revert costs nothing.** `git log --all` on BOTH paths is empty — the suite was never
  committed under either name, so no history is rewritten and no reference outside this change set
  existed to update.
- **The suffix drop is the real gain, and it is KEPT.** Of 164 aspect-suffixed suites, **136**
  share a stem with a sibling, so the suffix means "this surface is split" — and this suite has no
  sibling, so `.confirm.` advertised a split that does not exist. **28 stand alone** anyway,
  including this unit's OWN `SchedulingPostHandlers.c3.test.ts`, deliberately NOT renamed: T1c.17
  pins the glob `SchedulingPostHandlers.*.test.ts`, so there the split is designed and named.

Verified after the revert, each as a measurement and not an assumption:

| Claim                             | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the suite runs from the flat path | `vitest run tests/unit/postChannelRoutes.test.ts` → **1 file, 9 passed**                                                                                                                                                                                                                                                                                                                                                                                             |
| the move is FILE-count neutral    | tier **593 files**, the same count the mirrored path produced — 592 would have meant the flat path is not collected, which is the silent-green shape this check exists to catch                                                                                                                                                                                                                                                                                      |
| the move is TEST-count neutral    | tier **9235**, unchanged. The unit's own +3 over the 9232 baseline stays fully attributed to NOTE A's 1 case + W2's 2 cases; neither the move nor its revert contributes any                                                                                                                                                                                                                                                                                         |
| **fitness #30 is unaffected**     | not assumed: its own loop excludes `-not -path "*/tests/unit/*"`, and `apps/api/vitest.config.ts`, `include: ["tests/unit/**/*.test.ts", …]`, collects flat and nested alike BY CONSTRUCTION. Measured after the revert: **20 unreached, baseline 21**                                                                                                                                                                                                               |
| nothing references either old     | `rg "postChannelRoutes.confirm"` and `rg "tests/unit/posts/postChannelRoutes"` over the repo → **zero code hits each**. **Seven** artefact hits remain for the suffixed name (the earlier "six" undercounted, missing the claim row that is itself a hit) — every one HISTORICAL: red captures, one budget line, this section's own "from" side, and one `tasks.md` clause that says what the line first named. No FORWARD reference to either old spelling survives |

The repo stop-hook that flags a missing test at the MIRRORED path now fires on this route file
again, and that is accepted rather than accommodated. It is a false positive by construction —
measured: it derives one mirrored path and tests only that exact path with `exists()`, so it fires
on `postRoutes.ts` and `SchedulingPostHandlers.ts` too, both of which have had tests for a long
time. Its rule needs a glob. The hook was NOT edited (`.claude/` is off limits to this pass) and no
stub was planted at the mirrored path to quiet it: moving correct code to satisfy a mis-specified
checker is the vice this repo forbids, and the intermediate move's quieting of the hook was a side
effect that must not be mistaken for a reason.

#### Gates after the correction pass

Normalization ordering is not a problem this time and the reason is measured, not asserted:
`prettier --write` over all 8 code files reported **8× "(unchanged)"**, so every gate below ran on
bytes prettier had already normalized. Only the `.md` artefacts were written afterwards, and no
`.md` can move a type, a test or a fitness count.

| Gate                                                                  | Result                                                                                                                                                |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsc --noEmit packages/shared` (6144)                                 | **0**                                                                                                                                                 |
| `tsc -b apps/api` (6144)                                              | **0**                                                                                                                                                 |
| `eslint --max-warnings 0`, all 8 touched files, ONE pass at 6144      | **0**, exit 0 (the `[boundaries][warning]` line is the plugin's own config notice — it prints identically for an untouched file, verified)            |
| `prettier -c` on the 8 code files                                     | clean — all 8 already normalized                                                                                                                      |
| scratchpad `tsc` probe over the touched test files                    | **1** — the pre-existing, measured 23/23 `apiMetrics` class; **0** in the three files this pass touched                                               |
| `apps/api` unit tier (`vitest run --maxWorkers=2`)                    | **593 files, 9235 passed**, 0 failed, 0 skipped                                                                                                       |
| `integration:saga-recovery` (3 suites, concurrency 1, timeout 120000) | **33 tests / 33 pass / 0 fail / 0 cancelled / 0 skipped**, runner exit 0                                                                              |
| `@core/posts` vitest · `@core/domain` vitest                          | **6 files / 99 passed** · **10 files / 191 passed** (the latter run because PROBE E touched it)                                                       |
| `pnpm check:circular`                                                 | **0** — 1610 files                                                                                                                                    |
| `pnpm check:dead-code` (knip ratchet)                                 | **0 regressions** against the 321-finding baseline                                                                                                    |
| fitness #1 · #3 · #4 · #5 · #6 · #8 · #9 · #10 · #21 · #23 · #32      | 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0                                                                                                             |
| fitness #30 (ratchet)                                                 | **20** against baseline 21 — below, unaffected by the move                                                                                            |
| fitness #38                                                           | swept tree **0**; `db-prisma` ratchet **11** at baseline 11                                                                                           |
| fitness #40 Part A · Part B                                           | 3 seams (floor 3) / **0** · 14 sites (floor 10) / **0**                                                                                               |
| fitness **#41**                                                       | **8 marker sites (floor 8), 1 exception hit, 0 violations — IDENTICAL before and after, which is the measurement that refutes the "#41 shape" claim** |

**Services**: Postgres and Redis reachable on `omnipost-infra` (5432 / 6379), verified by socket
before the integration run; the batch was invoked with `run-tests.sh`'s own env
(`NODE_ENV=test`, `set -a; source .env`) and its own runner flags
(`--conditions development --import tsx --test --test-force-exit --test-concurrency=1
--test-timeout=120000`).

Every fitness block was extracted TEXTUALLY from `.github/workflows/fitness.yml` and executed
verbatim — not paraphrased from `CLAUDE.md` — and the workflow was never edited.

#### Budget after the correction pass

| Stream       | Forecast (§9.4.1 row 6) | Before the pass |   After | Delta |
| ------------ | ----------------------: | --------------: | ------: | ----- |
| **CODE**     |                 **200** |             337 | **348** | +11   |
| **EVIDENCE** |                 **260** |             644 | **888** | +244  |

CODE: `SchedulingPostHandlers.ts` 182/−12 · `postChannelRoutes.ts` 148 · `postRoutes.ts` 10 ·
`errors.ts` 8. **CODE remains under the 400 hard budget, by 52 lines** — the correction pass added
11 CODE lines (the total refusal map and two JSDoc paragraphs) and owes no `size:exception`.
EVIDENCE: `SchedulingPostHandlers.c3.test.ts` 636 · `postChannelRoutes.test.ts` 239 ·
`mockPrisma.ts` 8/−3 · `schedulingRoutes.test.ts` 5. The EVIDENCE jump is where the corrections
live: hydrating a real record per combination, the typed doubles NOTE B asked for, and the two
`NOT_A_LOST_SWAP` fixtures. That is the two-tier budget working as designed — the CODE side did not
move to buy it.

#### Out of scope — recorded, deliberately NOT fixed

1. **The admin scheduling routes return 500 in production today, and the 500 fires at the
   PRE-EXISTING read, not at the new guard.** Both handlers take their first look with
   `this.prisma.post.findFirst` OUTSIDE the transaction (`cancelScheduledPost` `:326-336`,
   `reschedulePost` `:455-465`), inside the outer `try`. `Post` is tenant-guard enrolled and the
   guard throws `TenantContextMissingError` on the FIRST guarded operation
   (`tenantGuard.ts:209-211`), so the request dies there and the outer `catch` answers 500 — the
   C3 guard's in-transaction read is never reached. **The fix is a cross-tenant authorization
   decision and belongs to Edward**: `withSystemContext` was NOT applied and no tenant scope was
   derived, per SECURITY_CANON.
2. **The envelope asymmetry** — the client route publishes the discriminator in `error.code`, the
   two admin ones in `details.code` — is the decision already pending with Edward (finding 3
   above). Untouched.
3. **`cancelledPublishLogs` reports the count from the read BEFORE the transaction** while
   `updateMany`'s real `count` is discarded, in BOTH handlers (`reschedulePost` answers
   `updatedPublishLogs` the same way). Pre-existing, and ironic given this unit's subject. Not
   fixed — it changes an operator-visible number on a route that currently cannot be reached.
   **Backlog row SMELL-154**, written with the precise mechanism.

New backlog rows from this pass: **SMELL-153** (the status-word class gate, with the re-measured
baseline of 7 and the N-COR-9 correction) and **SMELL-154** (the discarded `updateMany` count).

#### The FINAL bounded correction — four items, one of which reverses an earlier one

A second re-gate returned four items. All four are recorded here, including the one whose premise I
had to contradict.

| #   | Item                                                        | Class    | Resolution                                                                             |
| --- | ----------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| 1   | the confirm suite sits under a mirrored `tests/unit/posts/` | evidence | REVERTED to flat `tests/unit/postChannelRoutes.test.ts`; suffix drop kept — see Item 7 |
| 2   | a probe comment asserts a measurement that is wrong         | evidence | re-taken by me: **two** rows, not three; comment now names both rows                   |
| 3   | probe C's restore receipt still names a superseded hash     | doc      | marked superseded, shipped hash named and verified; all 9 receipts swept               |
| 4   | bare `file:NNN` citations rotted twice inside one pass      | doc      | replaced with quoted text anchors, line numbers demoted to navigation                  |

**Item 1 — the revert, and why the earlier move was wrong.** Measured independently before acting,
because the item reversed a prior instruction: **29** `apps/api/src` directories have a mirrored
`tests/unit/` subdirectory and **35** do not, so flat is the MAJORITY; `src/posts` holds four
modules and three of them (`postRoutes`, `postsService`, `optimizedPostsRoutes`) were already tested
flat, so mirroring the fourth was the only thing splitting that folder across two conventions; and
`git log --all` is empty on BOTH paths, so the revert rewrites no history. The `.confirm.` suffix
stays dropped — that was the move's real gain and it survives the revert. The `@file` header needed
no edit either way: it is basename-only, and the basename did not change.

**Item 2 — the probe, re-taken rather than trusted.** `hasLiveContent()`'s `|| this._pendingRetraction`
term deleted from `ChannelPublication.ts`, c3 suite run, flipped rows counted from the assertion
diff: `UNRESOLVED/true` and `EXCLUDED/true` — **two**, and `PUBLISHED/true` does not flip because
`_published` alone already makes it live. Restored byte-exact to
`7edbff7a525ec20c9eeb5c4e8109e915e0ca73c908c125066e72764b6dcca7ab`, `sha256sum -c` → `OK`. The
comment claimed three. An asserted measurement that does not match reality, written inside the
comment documenting a probe, by the pass whose purpose was removing exactly that.

**Item 3 — the receipt sweep, widened.** All **9** sha256 occurrences in the `1c-3a` sections were
checked against the shipped tree, not just the one named: `postRoutes.ts ff5cee8c`,
`retractionRefusals.ts 2d36c278`, `ChannelPublication.ts 7edbff7a`, `postChannelRoutes.ts 7e125139`
and `SchedulingPostHandlers.ts c1f33b82` all MATCH; two are already-marked historical captures
(`350a2597`, `ee9872fe`); probe F's `51bbf9af` already carried its superseded note. Exactly ONE was
bare — probe C's `51bbf9af` — confirming the re-gate's finding and extending its sweep rather than
merely reproducing it.

**Item 4 — and the one premise that did not survive measurement.** Three of the four cited
divergences reproduce: `tasks.md:843` → 866, `tasks.md:1629` → 1652, `tasks.md:753` → 754,
`tasks.md:1284` → 1294, and "six artefact hits" → **seven**. Two cited coordinates were already
CORRECT and were left alone (`design.md:519`, `design.md:533`). **The fourth, `tasks.md:778`, is not
in THIS file** — `rg ':778'` over `tasks.md`, `design.md` and this ledger returns nothing but the
string `1,778 lines` — **it is in the ENGRAM half of the ledger**, the
`sdd/post-publish-partial-failure/apply-progress` observation, whose learning 1 cites
`tasks.md:778`/`:1629`/`design.md:214`/`:528` for the four `#41` corrections. Two of those four are
right (`design.md:214`, `:528`); the two `tasks.md` ones had rotted, and are anchored on quoted text
in the merged observation. Recorded here because the two halves of this ledger rot together and a
reader who greps only the file would conclude the citation was invented. **And the "29 mirrored dirs →
30" correction was NOT applied, deliberately:** 30 was the count only while the mirrored directory
existed, and item 1 deletes it. Post-revert the measured count is 29 again, so writing 30 would have
introduced the very error the item set out to remove — the two items interact, and the number
describes the tree rather than the document.

**Gates after the final pass** — every one re-measured on this tree, one process at a time:

| Gate                                | Result                                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsc --noEmit -p packages/shared`   | exit **0**                                                                                                                                  |
| `tsc -b apps/api`                   | exit **0**                                                                                                                                  |
| `eslint --max-warnings 0` (2 files) | exit **0**, one pass                                                                                                                        |
| `prettier -c` (5 touched files)     | **all matched files use Prettier code style**                                                                                               |
| `apps/api` unit tier                | **593 files / 9235 passed / 0 failed / 0 skipped** — the move is file- AND test-count neutral, so the flat path IS collected                |
| `@core/domain`                      | **10 files / 191 passed** — the item-2 probe's home package, after restore                                                                  |
| fitness **#9** / **#10**            | **0** / **0**                                                                                                                               |
| fitness **#30**                     | **20**, ratchet baseline 21                                                                                                                 |
| fitness **#32**                     | **0**                                                                                                                                       |
| fitness **#36**                     | exit **0** — run although not requested, because item 1 moves a file inside the tree whose collection globs this gate asserts are non-empty |
| `pnpm check:circular`               | **No circular dependency found**                                                                                                            |

Budget impact of this pass: **CODE 0**, EVIDENCE ~0 net — item 1 is a move (net 0), item 2 edits one
comment (+2), items 3 and 4 are ledger prose. The unit's shipped totals (CODE 348, EVIDENCE 888) are
unchanged on the CODE side and stay under the 400 hard budget.

---

### RDD receipt — the committed unit `1c-3a` (`e1766780` → `181ce363`)

Lineage `review-6816e57e734ea5ec`, ONE lens (`review-reliability`), risk **medium**, scope **12
files / 2109 lines**. **Approved with ZERO blockers**, `authority: burned`. Consent `granted` under
Edward's standing rule for review envelopes (RDD consent/v3 on `review start` only; every other
consent stays manual). Four advisory findings: two WARNING, two SUGGESTION, all `inferential` /
`introduced`.

**The narratives below are quoted VERBATIM, and that is not decoration.** The capture envelope
retains only id, lens, location, severity and disposition; the claim itself lives in the review
transaction, and that transaction's authority is burned. A previous unit in this change lost four
narratives exactly that way. A later reader must be able to judge the claim, not take this
document's word for it.

Citations below are **quoted text anchors**, not `file:NNN` — this change already measured that line
citations rot across a correction pass.

|   # | Finding                              | Lens               | Severity   | Class                    | Disposition                                                                                                                        |
| --: | ------------------------------------ | ------------------ | ---------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
|   1 | `R3-toAppError-instanceof-narrowing` | review-reliability | WARNING    | inferential / introduced | **FIXED** — the declared type was the wrong side; it now says `UseCaseError` and the read is unconditional                         |
|   2 | `R3-cas-lost-swap-outer-catch`       | review-reliability | WARNING    | inferential / introduced | **FIXED** — the lost swap is converted AT the swap, so the discriminator no longer depends on a neighbouring statement             |
|   3 | `R3-refusal-mapping-total-record`    | review-reliability | SUGGESTION | inferential / introduced | **FIXED** — the binding now asserts the code that travelled is a member of the wire vocabulary, and is driven from the refusal set |
|   4 | `R3-c3-test-file-oversized`          | review-reliability | SUGGESTION | inferential / introduced | **REJECTED**, with reasoning — one coherent subject; the split it proposes is the sibling pattern this unit just removed           |

#### 1 — `R3-toAppError-instanceof-narrowing` (WARNING, reliability)

**Location**: `apps/api/src/posts/postChannelRoutes.ts`, the `toAppError` translation — anchored on
`"function toAppError("` and its first statement.

> "toAppError declares its `error` parameter as `{ code: string; message: string }` (a non-Error
> shape) but then tests `error instanceof Error` to decide whether to call `refusalOf`. If the use
> case returns a plain object (matching the declared type) rather than an Error instance,
> `instanceof Error` is false, `refusalOf` is skipped, and a RetractionRefusalError-shaped failure
> would fall through to the `switch` on `error.code` and land in the `default` branch producing a
> generic 500 instead of a mapped 409 with the discriminator. The tests always feed real Error
> subclasses so this branch is never exercised at odds with the declared parameter type; the type
> declaration and the runtime narrowing disagree about what `error` can be."

**Which side is true was decided by reading the producer, not by preference.** Every `err` arm of
`ConfirmManualRetractionUseCase` returns a `UseCaseError`: the three `new UseCaseError(...)` in
`execute`/`confirm`, the `new RetractionRefusalError(...)` (which `extends UseCaseError`), and both
`publicationRefusal` / `publicationSaveFailure`, whose signatures are `(error: Error): UseCaseError`.
The outer `catch` returns one too. So **the DECLARED TYPE was the wrong side**, and it is the side
that changed: the parameter now reads `UseCaseError`, the call site's `result.error` already carries
that type, and the compiler now holds the guarantee the `instanceof` was re-checking by hand.

**The narrative's stated consequence is one notch off, and the real one is worse.** A refusal
arriving as the declared plain shape would NOT have produced a 500: `RetractionRefusalError` carries
`code: USE_CASE_ERRORS.CONFLICT`, so it lands on the `switch`'s `CONFLICT` arm and answers
`AppError.conflict` — a **409 with `RESOURCE_CONFLICT`**. The status code is identical and only the
field a caller branches on silently disappears. A 500 would have been loud; this is the quiet
version, which is exactly the defect the discriminator exists to remove.

**The red, taken first, at the route.** A new permanent case feeds the double a refusal in the shape
the OLD signature declared and asserts the discriminator survives:

```text
 FAIL  tests/unit/postChannelRoutes.test.ts > … > keeps the discriminator on a refusal that is not
   this realm's Error, because the read is by VALUE
AssertionError: expected 'RESOURCE_CONFLICT' to be 'NOTHING_PENDING' // Object.is equality
      Tests  1 failed | 9 passed (10)
```

That is the measurement behind the correction above, and it is why the case stayed rather than being
deleted once the type was narrowed. **`refusalOf` reads a STRING on purpose** — its own doc says so:
"a caller in another package compares a string rather than a constructor, so a duplicate module
instance … cannot silently turn a known refusal into an unknown one." The `instanceof Error` gate
was quietly cancelling that guarantee one level up. The case pins the property for a refusal that
crossed a realm or came from a duplicated module, which is precisely what a constructor check cannot
survive.

**Not done, and named**: the parameter was NOT widened to `unknown` with the same branch kept. That
would have preserved the disagreement under a type that admits everything, which is the shape the
brief refused and the right refusal.

#### 2 — `R3-cas-lost-swap-outer-catch` (WARNING, reliability)

**Location**: `apps/api/src/admin/SchedulingPostHandlers.ts`, BOTH writers — anchored on the two
occurrences of `".catch((error: unknown) => {"` that follow `"withGucBoundTransaction("`, in
`cancelScheduledPost` and `reschedulePost`, plus the former `isLostStatusSwap` helper.

> "The `withGucBoundTransaction(...).catch(...)` chain catches P2025 only. If Prisma raises a P2025
> for a DIFFERENT operation than the compare-and-swap update inside the same transaction (for
> example, if the `publishLog.updateMany` were later changed to a `publishLog.update` on an id that
> could vanish), the catch would misinterpret it as a lost status swap and answer 409, masking a
> distinct fault as a race. The current code only issues `updateMany` for logs (which does not throw
> P2025), so no such collision exists today, but the discriminator relies solely on the error code,
> not on which statement raised it. Consider narrowing (for example, by rethrowing unless the swap
> itself failed, e.g., using a sentinel around the CAS update)."

**The claim is correct, and the trap was live — measured, not reasoned about.** The double gained a
`logUpdateRejectsWith` option so `publishLog.updateMany` can raise `P2025`, and two cases (one per
writer) assert that fault stays a 500. On the pre-fix code, both answered 409:

```text
 FAIL  … C3 guard on cancelScheduledPost > keeps a P2025 raised by a statement OTHER than the swap
   a 500, not a lost race
AssertionError: expected 409 to be 500 // Object.is equality
 FAIL  … C3 guard on reschedulePost > keeps a P2025 raised by a statement OTHER than the swap a
   500, not a lost race
AssertionError: expected 409 to be 500 // Object.is equality
      Tests  2 failed | 15 passed (17)
```

So this was **not** a probe of already-correct behaviour. The inertness the finding describes is the
inertness of a trap: the answer was right only because the neighbouring statement happens to be an
`updateMany`, which reports a miss as a count. Make the log write single-row and a genuinely
different fault reaches the operator as "the post moved on" — the worst kind of wrong answer,
because it is plausible.

**FIXED by converting at the statement that lost, which is the narrowest shape that makes the
property local.** `isLostStatusSwap` is gone; in its place a `swapStatus` method on the handler
issues the compare-and-swap, catches ONLY its own rejection, and rethrows it as a module-private
`LostStatusSwapError`. Both `.catch` arms now test `error instanceof LostStatusSwapError`. Three
choices inside that, each deliberate:

- **Raising rather than returning `{ kind: "raced" }` from inside the transaction.** An early return
  COMMITS. Today nothing is written before the swap, so the two are indistinguishable — and that is
  the same "true because of a neighbouring fact" the finding is about, one axis over. Raising keeps
  the rollback the abort already had, so a write added BEFORE the swap cannot commit on this path
  either.
- **`instanceof` on a module-private class, not a value read.** The canon's value-read rule
  (`domainCode`, `refusalOf`) exists for types that cross a DUAL CONDITIONAL EXPORT, where two copies
  of one class can coexist. `LostStatusSwapError` is declared and constructed in this one
  non-exported file in `apps/api`, so there is exactly one constructor and no duplicate to survive.
- **Extracting the swap rather than wrapping it twice.** The two writers issued the identical
  `where` and the identical allowlist spread; one helper is what keeps the conversion from drifting
  between them, which is the same reason `DIRECT_WRITABLE_STATUSES` is named once.

The original Prisma rejection is carried as `cause`, so nothing about the underlying failure is
thrown away.

#### 3 — `R3-refusal-mapping-total-record` (SUGGESTION, reliability)

**Location**: `apps/api/src/posts/postChannelRoutes.ts`, the `REFUSAL_WIRE_CODES` mapping, and its
driving case in `apps/api/tests/unit/postChannelRoutes.test.ts` — anchored on
`"const REFUSAL_WIRE_CODES: Record<RetractionRefusal, ErrorCode>"` and on the case
`"publishes EVERY declared retraction refusal as its own wire code, not a flat conflict"`.

> "The Record<RetractionRefusal, ErrorCode> is intentionally total, and the test suite drives
> Object.values(RETRACTION_REFUSALS) to prove exhaustiveness. However, adding a new refusal value
> that has no corresponding ErrorCode enum member would fail to compile, but the test that iterates
> refusals would then fail at runtime with a mapping to a code that has no ErrorCode member; the
> case would still assert `res.error.code === refusal` (a string), which is a soft binding rather
> than a compile binding. Consider augmenting the binding case to also assert `refusal in ErrorCode`
> so a missing wire code is caught at test time, not only at compile time."

**The hole is precise, and naming it precisely is what made the probe possible.** A new refusal
mapped to some EXISTING `ErrorCode` already fails today — the response code would not equal the
refusal. What slips through is the mapping written as a CAST: `"FOO" as ErrorCode` type-checks,
satisfies `toBe(refusal)` because two identical strings compare equal, and publishes a code no
client can find in the enum.

**FIXED on both halves.** The exhaustiveness loop keeps `toBe(refusal)` and adds
`expect(WIRE_CODES, refusal).toContain(...)` over the code that actually travelled, where
`WIRE_CODES` is `Object.values(ErrorCode)` read once. And the "spelled the same" case — which named
`NOTHING_PENDING` by hand and therefore never covered `CHANNEL_HAS_LIVE_FRAGMENTS` at all — is now
driven from `Object.values(RETRACTION_REFUSALS)`.

**The red, taken by probe, because the behaviour is already correct.** Two production files were
mutated to reconstruct the pre-fix hole: `RETRACTION_REFUSALS.CHANNEL_HAS_LIVE_FRAGMENTS`'s VALUE
became `"CHANNEL_FRAGMENTS_LIVE"` and the mapping became
`"CHANNEL_FRAGMENTS_LIVE" as unknown as ErrorCode`.

```text
 FAIL  … > publishes EVERY declared retraction refusal as its own wire code, not a flat conflict
AssertionError: CHANNEL_FRAGMENTS_LIVE: expected [ 'AUTH_INVALID_CREDENTIALS', …(25) ] to include
  'CHANNEL_FRAGMENTS_LIVE'
 ❯ tests/unit/postChannelRoutes.test.ts:230
 FAIL  … > keeps the wire code and the application discriminator spelled the same
AssertionError: CHANNEL_FRAGMENTS_LIVE: expected [ 'AUTH_INVALID_CREDENTIALS', …(25) ] to include
  'CHANNEL_FRAGMENTS_LIVE'
      Tests  2 failed | 8 passed (10)
```

**That the failure is on the SECOND assertion is the whole proof.** Vitest stops a case at its first
failing expectation, so reaching the `toContain` line means the pre-existing `toBe(refusal)` line
PASSED for a wire code `ErrorCode` never declared — which is the soft binding the finding named,
demonstrated rather than asserted.

Restored byte-exact and proved: `sha256sum -c` → `packages/core/posts/src/retractionRefusals.ts:
OK`, `packages/shared/src/errors.ts: OK`; `rg CHANNEL_FRAGMENTS_LIVE packages/core apps/api` → no
matches; `@core/posts` back at **6 files / 99 passed**, its untouched baseline.

#### 4 — `R3-c3-test-file-oversized` (SUGGESTION, reliability) — **REJECTED**

**Location**: `apps/api/tests/unit/SchedulingPostHandlers.c3.test.ts`, whole file.

> "The new C3 test file is 638 lines, which is a large single suite. While the two describe blocks
> share one prisma double (the stated rationale), the file contains near-duplicate case bodies
> between the two `describe` blocks (identical setups for cancel vs reschedule). A helper that
> parameterizes the operation would reduce drift risk between the two handler suites without adding
> a third file. Not a correctness defect; noted for maintainability of the reliability harness."

**Rejected, and the reasoning is the record.** The file covers ONE coherent subject — the C3 guards
on the two admin status writers — and its own header says why the two suites share a file: "the
guards are the same mechanism twice, and a single double is what keeps them from drifting apart."
Splitting it would reintroduce the aspect-suffix sibling pattern that this unit's correction pass
spent item 7 REMOVING (see §"Item 7 — the confirm suite drops its aspect suffix and STAYS FLAT").
**Size alone is not a defect when the subject is single.**

**Read before rejecting, and the finding's own alternative was weighed on its merits rather than
dismissed with the split.** The finding offers two remedies and they are not equivalent: a third
file (refused above) and a parameterizing helper. The helper is refused for a different reason. The
near-duplicate setups are not duplication to be factored — they are what makes each case READABLE at
the point of failure: a parameterized harness answers "which operation" with a loop variable, and
the two handlers genuinely differ (the cancellation takes no body and has a status pre-check;
the reschedule takes `scheduledAt`/`updateChannels` and has none). A helper would have to carry both
shapes, and the reader would then be reconstructing the case from the helper rather than reading it.
The drift risk the finding names is already closed by the SHARED DOUBLE, which is the thing both
suites actually depend on.

**The file grew to 694 lines in this pass** (the two new `P2025`-not-a-swap cases and the
`recordNotFound` helper, which removes an inline duplicate of the same construction). The rejection
is re-affirmed at the larger size, for the same reason: the subject did not change.

#### Gates after this review recording — every one re-measured on this tree, one process at a time

| Gate                                                 | Result                                                                                        |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `tsc --noEmit -p packages/shared`                    | exit **0**                                                                                    |
| `tsc -b apps/api`                                    | exit **0**                                                                                    |
| `tsc --noEmit` over the two touched suites           | exit **0** — `apps/api/tsconfig.json` does NOT include `tests/`, so the suites need this pass |
| `eslint --max-warnings 0` (4 touched files)          | exit **0**, ONE pass                                                                          |
| `prettier -c` (4 touched files + this ledger)        | **all matched files use Prettier code style**                                                 |
| `apps/api` unit tier                                 | **593 files / 9238 passed / 0 failed / 0 skipped** (baseline 9235 → **+3**)                   |
| `@core/posts`                                        | **6 files / 99 passed** — unchanged, which is also the probe-restore proof                    |
| fitness **#1 #3 #4 #5 #6 #8 #9 #10 #21 #23 #32 #41** | every one exit **0**, run from the blocks extracted textually from `fitness.yml`              |
| fitness **#38**                                      | swept tree **0**; db-prisma ratchet **11** at baseline 11 — run because a scoped file changed |
| fitness **#40**                                      | part A **0**, part B **0** — run because a file inside the seam scope changed                 |
| `pnpm check:circular`                                | **No circular dependency found**                                                              |
| `pnpm check:dead-code`                               | **0 regressions** (321 tracked baseline findings)                                             |

The three added tests, attributed: **+1** `postChannelRoutes.test.ts` ("keeps the discriminator on a
refusal that is not this realm's Error…", finding 1); **+2**
`SchedulingPostHandlers.c3.test.ts` (the "keeps a P2025 raised by a statement OTHER than the swap a
500" pair, finding 2, one per writer). Finding 3 strengthened EXISTING cases in place, so it adds a
case count of zero — which is why the file count is unchanged at 593.

#### Budget after this review recording — measured from `git diff --numstat 181ce363~1`

| Tier         | Unit as shipped | After this pass | Delta |
| ------------ | --------------- | --------------- | ----- |
| **CODE**     | 348             | **400**         | +52   |
| **EVIDENCE** | 888             | **997**         | +109  |

CODE: `SchedulingPostHandlers.ts` 224/−23 · `postChannelRoutes.ts` 158 · `postRoutes.ts` 10 ·
`errors.ts` 8. EVIDENCE: `SchedulingPostHandlers.c3.test.ts` 694 · `postChannelRoutes.test.ts` 290 ·
`mockPrisma.ts` 8/−3 · `schedulingRoutes.test.ts` 5.

**CODE lands at EXACTLY 400 against the hard 400 — at the budget, not over it, and with ZERO
headroom left.** No `size:exception` is owed, and none was avoided by shrinking a fix: the two
production diffs are +60/−29 and +13/−3 against `181ce363`, and every added line is either the
sentinel and its helper (finding 2, which also DELETES two six-line inline compare-and-swaps) or the
JSDoc stating why each side is the true one. Saying it loudly because the next person to touch this
unit's production files has no room: the next CODE line owes an exception, or a split.

---

## PR 1c — grandchild `1c-3b` (T1c.16) — COMPLETE

Branch `workstream/ncor8-1c-3b`, child of `workstream/ncor8-1c-3a` @ `7117bcab` — **order 7 of 13**.
Subject: D18's customer action window — the parameter, the discovery port and its Prisma read, the
sweep that closes an elapsed window, its two counters, and the bootstrap tick that drives it.

**Finish state**: an alert that asks a customer to remove stranded content by hand now has an END.
Once `RETRACTION_ACTION_WINDOW_HOURS` (default 72) has elapsed, a 15-minute tick finalizes that
channel as `ACTION_WINDOW_EXPIRED` and the standing alert resolves — while the live fragment
references, `hasLiveContent()`, the content lock and the confirm act all survive, because elapsed
time is not evidence that anything came down. **Rollback**: delete
`apps/api/src/infrastructure/retention/RetractionActionWindowSweep.ts`,
`apps/api/src/metrics/retractionWindowMetrics.ts`,
`packages/adapters/db-prisma/src/PendingRetractionSweepReads.ts` and
`packages/core/domain/src/repositories/PendingRetractionSweepReader.ts`; revert the four-line export
in `db-prisma/src/index.ts`, the registration block in `index.ts` and the schema entry in
`config/env.ts`. Nothing outside this unit references any of them — `ExpireRetractionActionWindowUseCase`
had ZERO production callers before it and has exactly one after.

### What each mechanism is, as built

| Mechanism                                       | As built                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RETRACTION_ACTION_WINDOW_HOURS`                | `z.coerce.number().int().min(1).max(720).default(72)` in the `server` block, the `SAGA_WAIT_POLL_MS` shape. Bounds refuse the degenerate ends rather than clamping: `0` would expire every open window at the very next tick                                                                                                                                   |
| `PendingRetractionSweepReader` (port, 61 lines) | A read port of its own, not a method on `PostRepository`: it reads ACROSS accounts to find which tenants have work, while every other method on that type is tenant-scoped. Returns the three IDENTIFIERS and nothing else, because the sweep re-reads each row under its own tenant before touching it                                                        |
| `PendingRetractionSweepReads` (adapter, 58)     | ONE `findMany`, no transaction, no write. Four clauses (`pendingRetraction`, `retractionBlockedCause not null`, `actionWindowExpiredAt null`, `actionWindowStartedAt lte`), `orderBy [actionWindowStartedAt asc, id asc]`, `take: limit`, `select` of the three ids. Mirrors the partial index the schema already carries                                      |
| `RetractionActionWindowSweep` (213, 94 exec.)   | Two phases, SEQUENTIAL. `now` is read ONCE and both `olderThan = now − window` and the use case's `now` come from it, so the cutoff discovery selected by is the cutoff the record re-asserts. A refused row is counted, named at ERROR, and left in the predicate; the loop continues                                                                         |
| the system scope                                | a PARAMETER, supplied by the registration site. See correction 1 — wrapping the whole tick in it is the SMELL-149 shape                                                                                                                                                                                                                                        |
| the tenant binding                              | `withTenantContext({ accountId: row.accountId })` per row, OUTSIDE the discovery scope                                                                                                                                                                                                                                                                         |
| `retractionWindowMetrics.ts` (64)               | A second metrics module rather than two counters in `retractionAlertMetrics.ts`: that file answers "was the customer REACHED", these answer "is the deadline being enforced", and the two fail independently. Both counters are incremented by the sweep on its own production paths                                                                           |
| the bootstrap tick                              | `scheduler.register("retraction-action-window-sweep", …, RETRACTION_ACTION_WINDOW_SWEEP_INTERVAL_MS, { onError })` beside the deletion-record degrader. The promise is AWAITED; the sweep logs its own four counts                                                                                                                                             |
| the wiring                                      | both new objects are CONSTRUCTED at the bootstrap (`new PendingRetractionSweepReads(resolve(TOKENS.PrismaClient))`, `new RetractionActionWindowSweep(...)`), so no new container token exists that could resolve to `undefined` in silence. The one token read, `TOKENS.ExpireRetractionActionWindowUseCase`, is already pinned by `setupPostUseCases.test.ts` |

### The recorded reds

**1. T1c.16 — the sweep module does not exist.** The suite was written first, against nothing:

```text
 FAIL  tests/unit/retention/RetractionActionWindowSweep.test.ts
Error: Cannot find module '../../../src/infrastructure/retention/RetractionActionWindowSweep.js'
 Test Files  1 failed (1)
      Tests  no tests
```

GREEN after the module + the port + the metrics: **6 passed (6)**.

**2. The discovery adapter does not exist.** Written against an absent export:

```text
 FAIL  tests/unit/infrastructure/PendingRetractionSweepReads.test.ts > … > carries the three identifiers and nothing else out of the read
TypeError: PendingRetractionSweepReads is not a constructor
 Test Files  1 failed (1)
      Tests  4 failed (4)
```

GREEN after the adapter and its export: **4 passed (4)**.

**3. The env parameter does not exist.** Five cases over the `DELETION_RECORD_RETENTION_YEARS`
shape, all red at once — and the two halves fail DIFFERENTLY, which is the point of writing both:

```text
 FAIL  … > applies the 72-hour default when unset
AssertionError: expected undefined to be 72 // Object.is equality
 FAIL  … > rejects boot on a window of zero, which would expire every row at once
AssertionError: promise resolved "{ NODE_ENV: 'test', PORT: 3001, …(35) }" instead of rejecting
 FAIL  … > rejects boot above the 30-day ceiling
AssertionError: promise resolved "{ NODE_ENV: 'test', PORT: 3001, …(35) }" instead of rejecting
 FAIL  … > rejects boot on a non-integer window
AssertionError: promise resolved "{ NODE_ENV: 'test', PORT: 3001, …(35) }" instead of rejecting
 Test Files  1 failed (1)
      Tests  5 failed | 32 passed (37)
```

An absent key reads as `undefined` and an out-of-range value is ACCEPTED — the same absence,
producing a wrong answer and a missing refusal. GREEN after the schema entry: **37 passed (37)**.

**4. The sweep exists but nothing ticks it.** Three cases added to the bootstrap source scan:

```text
 FAIL  … > registers the sweep under its own task id
AssertionError: expected undefined to be defined
 FAIL  … > ticks it on the cadence the module declares, not on a literal pasted here
AssertionError: the given combination of arguments (undefined and string) is invalid …
 FAIL  … > declares the cross-account scope for DISCOVERY and passes it in
AssertionError: the given combination of arguments (undefined and string) is invalid …
 Test Files  1 failed (1)
      Tests  3 failed | 4 passed (7)
```

This is the red that matters most in this unit: without it the class compiles, its own six cases
pass, and no metric moves — because none is produced.

**4b. A second, unplanned red inside the same file, and it found a real constraint.** The first
registration passed the task id as an imported CONSTANT. The scan's `collectTicks` reads the id with
`/^\s*"([^"]+)"/` — a STRING LITERAL — so the tick was attributed to `""`, and the file's own
pre-existing case went red alongside mine:

```text
 Test Files  1 failed (1)
      Tests  4 failed | 3 passed (7)
```

The registration now passes the literal, like all ten neighbours, and the exported `…_TASK_ID`
constant was deleted rather than left as an unused export for knip to find.

### The three corrections this task line needed

**1. The registration shape written in `tasks.md` and `design.md` re-creates SMELL-149.** Both say
`scheduler.register("retraction-action-window-sweep", () => withSystemContext("system:…", …), 15 * 60 * 1000)`,
which puts the WHOLE tick inside the system scope. The per-row `withTenantContext` would then nest
inside it, and `resolveGucScope` answers `SYSTEM_TENANT_SCOPE` whenever a system context is present
(`tenantGuc.ts:119-124`) because the two stores are independent `AsyncLocalStorage` instances: every
write would bind `__system__`, layer 1's guard would step aside, and the row's account would be read
by nobody. The nesting compiles, reads correctly, and is silent — which is exactly why SMELL-149 is
a backlog row and not a bug report.

The shape built instead: the scope is a PARAMETER of `sweep()`, supplied at the registration site as
`(run) => withSystemContext("system:retraction-action-window-sweep", run)`, and it covers DISCOVERY
only. The loop runs after it. This is `RecurrenceScheduler`'s sequential shape, which is the one
precedent in the tree for a tick that discovers cross-account and writes per tenant.

The asymmetry (system scope injected, tenant binding imported) is deliberate and stated in the file:
the system scope is a property of the TICK — declared and NAMED at the registration site, which is
where `schedulerTickTenantScope.test.ts` reads it — while the tenant binding has no name to declare
there, because it is derived per row from the row just read.

**The pin is two-sided.** Every double records BOTH `getTenantContext()?.accountId` and
`getSystemContext()?.reason` at the moment it is entered, and the case asserts both:

```ts
expect(calls.map((c) => c.scope.tenantAccountId)).toEqual(["account-a", "account-b"]);
expect(calls.map((c) => c.scope.systemReason)).toEqual([undefined, undefined]);
```

Asserting the account alone PASSES on the nested version — the tenant store really is populated
there, it just is not what the GUC reads. That is the same observation that found SMELL-149.

**2. The suite path.** The task line says `apps/api/tests/unit/RetractionActionWindowSweep.test.ts`
(flat). It ships at `apps/api/tests/unit/retention/RetractionActionWindowSweep.test.ts`, because the
ONLY other module in `apps/api/src/infrastructure/retention/` is tested at
`apps/api/tests/unit/retention/DeletionRecordDegrader.test.ts`. This is the `1c-3a` reasoning
applied where it points the other way: that unit moved a suite from a mirrored path to a flat one so
that one source folder would not be split across two conventions, and here the flat path is what
would do the splitting. The adapter suite is at
`apps/api/tests/unit/infrastructure/PendingRetractionSweepReads.test.ts`, beside
`PrismaPostRepository.test.ts` — the same home this change already uses for a db-prisma post
adapter, and the tier that actually runs in this gate.

**3. The sweep depends on the use case's CONTRACT, not on the concrete class — and a `tsc` probe is
the only thing that could have said so.** The first version typed the dependency as
`ExpireRetractionActionWindowUseCase`. Vitest was green. The scratchpad `tsc` was not:

```text
error TS2345: Argument of type '{ execute: … }' is not assignable to parameter of type
'ExpireRetractionActionWindowUseCase'. Type '{ execute: … }' is missing the following properties
… : postRepository, expire, classifyRefusal
```

Six occurrences, one per construction in the suite. A class-typed dependency drags its PRIVATE
fields into the contract, so no double can satisfy it and no second implementation could either. The
sweep now names `UseCase<ExpireRetractionActionWindowInput, ExpireRetractionActionWindowOutput,
UseCaseError>`.

**This is a CLASS, and it was probed rather than asserted.** Measured in `apps/api/src` — and the
number below is CORRECTED from the 109 first recorded here, which no definition reproduces.
Re-measured by parsing every `constructor(` parameter list in the 562 non-test `.ts` files under
`apps/api/src` (balanced paren spans, string- and comment-aware, split on top-level commas) and
classifying each parameter's type annotation: **136** are a bare concrete `*UseCase` class name,
**0** spell the `UseCase<>` contract inline, and **0** use an `InstanceType<typeof *UseCase>` form.
Exactly ONE site in the tree names the contract at all, through an exported alias, and it is the one
this unit added (`ExpireRetractionActionWindow` in the sweep) — so the ratio is 136 to 1, and the
"0 by contract" half of the original claim is the half that reproduces exactly. The cost of that convention is visible one file away — `RecurrenceScheduler.test.ts`
constructs every one of its doubles as `as never` (`:66-69`, `:82-83`), which means none of them is
type-checked and a double returning the wrong shape would compile. This unit is the first site to
diverge; it is 1 of 137 and is named here rather than spread. Backlog candidate below.

### Design-silent decisions, taken here and named

1. **The failures counter is UNLABELLED.** A `stage: "row" | "discovery"` split was considered and
   rejected: every arm would carry the same remedy — the row's own cause, named in the ERROR log
   beside the counter — and D18's poison-row signal is a FLAT non-zero reading across ticks, which a
   label would only make harder to read. A discovery failure is a different event and takes a
   different exit: it rejects the tick's promise, the scheduler's `runCallbackSafely` catches it, and
   the registration's `onError` logs it at ERROR. **Residual, named**: a permanently failing
   discovery read is therefore visible as an ERROR log and an ABSENT summary log, not as a counter.
   The alert rule T1c.18 owes is over the failures counter, so it would not fire for that case.
2. **The sweep takes `windowHours` by constructor; the bootstrap reads `env`.** D18 says "the sweep
   reads it". It is read at the composition root instead — the exact `DeletionRecordDegrader`
   precedent, where `setupCrisisUseCases.ts` reads `env.DELETION_NAME_DIGEST_ACTIVE_VERSION` and
   hands the degrader a number. Fitness #16 is satisfied either way; what constructor injection buys
   is a sweep whose window can be varied by a test without stubbing a module.
3. **Neither new object is container-registered.** Both are constructed at the bootstrap, which the
   canon names as a composition root and which already calls `createPrismaRepoAdapter` directly. The
   reason is the failure mode: `Container.resolve` on a token that was never registered returns
   `undefined` without throwing, so a mistyped token would produce a tick that fails on its first
   call and is swallowed by `onError`. Constructor injection has no such silent arm.
4. **`orderBy` breaks the tie on `id`.** D18 says "oldest first". The page is bounded at 100, so two
   rows sharing a window instant could otherwise swap places between ticks and leave one of them
   permanently on the far side of the page.
5. **The adapter's test fake INTERPRETS the `where` and THROWS on a clause it does not recognise.**
   A mock returning a canned array cannot fail "a window that is still open is not selected", which
   is the only interesting claim about a predicate.

### What a customer sees differently after this unit

| Before                                                                                             | After                                                                                                                   |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| A channel stranded pending retraction stays pending forever; the alert never resolves              | After `RETRACTION_ACTION_WINDOW_HOURS` the channel is `EXCLUDED` / `ACTION_WINDOW_EXPIRED` and the alert resolves, once |
| `actionWindowStartedAt` was written by the record and read by nothing                              | It is the sweep's predicate, and `actionWindowExpiredAt` is the mark the customer's panel reads                         |
| `ExpireRetractionActionWindowUseCase` had ZERO production callers (measured in the `1c-2b` ledger) | It has exactly one: this tick                                                                                           |
| Nothing is live: the fragments, `hasLiveContent()`, the content lock, the confirm act              | Unchanged by expiry — all four survive it, by construction and by the aggregate's own method (`1c-1d`)                  |

### Doubles updated — the mandatory `rg` over `**/tests/**`

Zero. The two new interfaces (`PendingRetractionSweepReader`, `RetractionActionWindowSweepLogger`)
had no prior implementors, and no existing double changed shape — verified by an `rg` for both names
across `apps/**/tests` and `packages/**/tests`, which returns only the two suites added here.

### The scratchpad tsc probe — run, and it caught the unit's one real defect

No tsconfig opens a `.test.ts`, so the habit from the last five units was repeated over the five
touched test files. It found **6 errors, all one defect**: the concrete-class dependency of
correction 3. Second run after the fix: **exit 0, zero errors** — in the touched tests and in
`apps/api/src` + every `packages/*/src` the config pulls in. **Sixth distinct defect class the probe
has caught in six units**, and the permanent-config decision is now six for six.

### Gates

| Gate                                                         | Result                                                                                                                                  |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `tsc --noEmit -p packages/shared`                            | exit **0**                                                                                                                              |
| `tsc -b apps/api`                                            | exit **0**                                                                                                                              |
| scratchpad `tsc` over the 4 touched test files               | **6 errors → fixed → exit 0** (see above)                                                                                               |
| `eslint --max-warnings 0`, 11 files, ONE pass                | exit **0** (the `[boundaries]` plugin advisories are pre-existing — reproduced on an untouched file)                                    |
| `prettier -c`, 12 files                                      | 2 reflows applied, then **All matched files use Prettier code style**                                                                   |
| the new suites (THREE, not two)                              | `RetractionActionWindowSweep.test.ts` **6/6**, `PendingRetractionSweepReads.test.ts` **4/4**, `retractionWindowMetrics.test.ts` **5/5** |
| `apps/api` unit tier (`vitest run --maxWorkers=2`)           | **596 files / 9261 passed / 0 failed / 0 skipped**, exit 0 (baseline 593 / 9238) — CORRECTED from 595 / 9256                            |
| `integration:saga-recovery` (3 suites, conc. 1)              | **33 tests, 33 pass, 0 fail, 0 cancelled, 0 skipped**, runner exit **0** — Postgres and Redis on `omnipost-infra` verified UP first     |
| fitness **#1 #3 #4 #5 #6 #8 #9 #10 #11 #16 #21 #23 #32 #40** | every one exit **0**, run from the blocks extracted textually from `fitness.yml`                                                        |
| fitness **#11** and **#16** red path                         | PROVEN — see below                                                                                                                      |
| `pnpm check:circular`                                        | **No circular dependency found** (1614 files)                                                                                           |
| `pnpm check:dead-code`                                       | **0 regressions** (321 tracked baseline findings)                                                                                       |

**The unit tier delta, fully attributed — CORRECTED. 593 → 596 files, 9238 → 9261 tests: +3 and
+23.** The figures first recorded here (+2 / +18, "nothing unexplained") were measured before the
third suite existed and then never re-measured, so the completeness claim was carried over a file
the table did not know about. `RetractionActionWindowSweep.test.ts` +1 file / +6 ·
`PendingRetractionSweepReads.test.ts` +1 / +4 · `retractionWindowMetrics.test.ts` +1 / +5 ·
`schedulerTickTenantScope.test.ts` +3 (same file) · `env.test.ts` +5 (same file). 6+4+5+3+5 = 23,
exactly. The missing suite was present in the commit and passing; only the accounting was wrong,
which is the kind of error a completeness claim makes worse rather than better.

**#11 and #16 red path, demonstrated rather than assumed.** Both are the gates this task names, and
a gate that has never gone red over THIS file proves nothing about it. A `setInterval(` call and a
`process.env.RETRACTION_ACTION_WINDOW_HOURS` read were planted at the end of the sweep:

```text
::error title=Fitness #11 violation::1 raw setInterval calls in backend
fitness #11: FAIL (exit 1)
::error title=Fitness #16 violation::1 direct process.env.* in apps/api/src
fitness #16: FAIL (exit 1)
```

Restored from a byte copy and verified:
`sha256sum -c` → `apps/api/src/infrastructure/retention/RetractionActionWindowSweep.ts: OK`
(`adf77560f830e22f292bb0dd95442cd6d5a22261f84f151fe5b970873d785271`), then all 14 checks pass again.

### Budget — measured from `git diff --numstat` over the commit (SEVEN new files, not six)

| Stream       | Forecast (order table row 7) | Measured (commit) | Delta | First recorded |
| ------------ | ---------------------------: | ----------------: | ----- | -------------- |
| **CODE**     |                      **301** |           **455** | +51%  | 455 — correct  |
| **EVIDENCE** |                      **305** |           **621** | +104% | 516 — WRONG    |
| DOC          |                            — |           **399** | —     | 394 — WRONG    |

Additions plus deletions, from `git diff --numstat HEAD~1 HEAD`. CODE:
`RetractionActionWindowSweep.ts` 213 · `retractionWindowMetrics.ts` 64 ·
`PendingRetractionSweepReader.ts` 61 · `PendingRetractionSweepReads.ts` 58 · `index.ts` 39/−1 ·
`config/env.ts` 15 · `db-prisma/src/index.ts` 4 = **455**. EVIDENCE:
`RetractionActionWindowSweep.test.ts` 255 · `PendingRetractionSweepReads.test.ts` 190 ·
**`retractionWindowMetrics.test.ts` 105** · `env.test.ts` 38 ·
`schedulerTickTenantScope.test.ts` 33 = **621**. DOC: this section 341 ·
`ENVIRONMENT_VARIABLES.md` 25 · `tasks.md` 27/−2 · `design.md` 3/−1 = **399**.

**The EVIDENCE figure omitted an entire file** — the same omission as the attribution table above,
from the same cause: both were written before `retractionWindowMetrics.test.ts` existed and neither
was re-derived from `numstat` afterwards. 516 + 105 = 621. DOC missed `design.md` and was one line
short on this section.

**CODE lands at 455 against the hard 400: a `size:exception` of 55 lines is OWED, and nothing was
shrunk to try to avoid it.** The claim is measured, not asserted. Executable lines (comments and
blank lines removed) against the two nearest siblings in the tree:

| File                                  |   total | executable |
| ------------------------------------- | ------: | ---------: |
| `DeletionRecordDegrader.ts`           |     176 |         98 |
| `RecurrenceScheduler.ts`              |     148 |         88 |
| **`RetractionActionWindowSweep.ts`**  | **213** |     **94** |
| `retractionAlertMetrics.ts`           |     119 |         66 |
| **`retractionWindowMetrics.ts`**      |  **64** |     **27** |
| `RetractionAlertDeliveryLedger.ts`    |      96 |         24 |
| **`PendingRetractionSweepReader.ts`** |  **61** |     **12** |

The sweep has FEWER executable lines than both of its siblings; the metrics module and the port are
each smaller than their nearest precedent in both dimensions. The overage is documentation, and the
two paragraphs that carry it are the two-scope sequencing and the contract-type rationale — i.e.
the SMELL-149 trap and the defect the `tsc` probe caught. Deleting either is deleting the reason the
next editor would not re-introduce them.

**A SPLIT does exist, and the reason to decline it is a cost, not an impossibility — CORRECTED.**
The sentence first written here said there was "no honest split", on the argument that "the
registration without the metrics produces a tick nobody can watch". That argument does not hold:
the tick logs its `{ scanned, expired, skipped, failed }` summary at INFO on every pass, and the
registration carries an `onError`, so a metrics-less tick is watchable by log. And the cut is
arithmetic, not hypothetical — lifting `retractionWindowMetrics.ts` (64) plus the sweep's import
block (4) and its two call sites (2) leaves CODE at **385**, under the hard 400, with the metrics
module and its own suite as the next unit.

The exception is still the right call, and here is the true reason for it. That split ships a first
PR whose only observability is a log line, so an operator has nothing to alert on until the second
lands; it reopens `RetractionActionWindowSweep.ts` in the very next PR to add three lines back,
which puts the file through two reviews for one intent; and it pays a whole PR boundary — branch,
diff, review, merge — for 70 lines. That is a real judgement, and it belongs to whoever signs the
exception. **What was owed here was the true reason, not an impossibility claim**: an exception
signed on "there is no alternative" is not the same decision as one signed on "the alternative costs
more than the overage", and only the second is what was actually being asked.

The other cuts genuinely are dead halves — the parameter without the sweep configures nothing, the
sweep without the port cannot discover, the port without the registration never runs — so the
metrics cut is the ONLY split on offer, which is why it is named specifically rather than denied
generally.

### For Edward — two findings and one paste-ready block

1. **The bootstrap tick scan could be satisfied by a COMMENT — FIXED in the bounded correction
   below, not deferred.** It was recorded here as a backlog candidate on the reasoning that "it is a
   change to a gate, and this unit's own registration passes on real executed code either way". That
   reasoning is wrong twice over. The file was MODIFIED by this unit (it gained the three sweep
   cases), so a demonstrated red path is owed for it by the four-step rule for extending the suite,
   and it was never taken for these assertions. And the gate certified green over exactly the defect
   it exists to catch, which is a worse state than not having it. Measured, fixed, and proven in
   both directions in the correction section at the end of this entry.
2. **136 of 137 use-case dependencies in `apps/api/src` are typed as the concrete class.** Measured
   above, by parsing the constructor parameter lists rather than by grep. The consequence is not theoretical: `RecurrenceScheduler.test.ts` casts all four of its
   doubles `as never`, so the suite that guards the ONLY other two-scope tick in the tree has no
   type checking on any of them. Converting the 109 is a mechanical but wide change with its own
   regressions; this unit diverged on one site because the alternative was to write the same
   unchecked cast. **Backlog candidate.**
3. **The two `.env` files this task names were not touched — they are off limits to the executor.**
   The entries below are derived from the Zod schema, not from those files. Both belong in the same
   neighbourhood as the other optional API tuning variables (beside `SAGA_WAIT_POLL_MS` if it is
   present there; otherwise at the end of the server/API block).

   `.env.example`:

   ```bash
   # Hours a customer has to manually remove content a failed thread left live on a
   # provider before the channel's outcome is finalized and its alert resolved.
   # Optional, 1..720 (30 days), default 72. Bounds an ALERT CYCLE, never a fragment:
   # expiry removes nothing and never releases the post's content lock.
   RETRACTION_ACTION_WINDOW_HOURS=72
   ```

   `.env.test.example`:

   ```bash
   # Same window as production. Optional with a default, so a test tree without it is
   # valid; it is listed for parity, and because the value is only read at boot — the
   # unit suites inject the window directly rather than reading env.
   RETRACTION_ACTION_WINDOW_HOURS=72
   ```

---

## PR 1c — grandchild `1c-3b` BOUNDED CORRECTION (2026-09-23) — follow-up commit

A fresh-context gate over the committed unit returned **PASA CON CORRECCIONES**: two CRITICAL and
four WARNING. Everything below is in ONE follow-up commit on `workstream/ncor8-1c-3b`, on top of
`417bdc35`. Nothing in it changes what the sweep DOES on a healthy row; it changes what the gate
around it can see, what the tick does when its dependency breaks its contract, and six numbers that
were recorded wrong.

### CRITICAL 1 — the bootstrap scan certified green over exactly the defect it exists to catch

`schedulerTickTenantScope.test.ts` balanced the `scheduler.register(...)` span over its SANITIZED
copy (comments and string interiors blanked) and then sliced the body out of the ORIGINAL bytes.
Every scope verdict — the wrap case, the reason case, and the sweep's own DISCOVERY case — then ran
`tick.body.includes(...)` over those original bytes. A MENTION was therefore enough and an executed
call was never required.

**Measured, in both directions, before and after the fix.** Two shapes were planted in
`src/index.ts`, one per assertion the file owns:

| planted shape                                                                                                           | what it really does                          | BEFORE the fix   | AFTER the fix                                         |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------- | ----------------------------------------------------- |
| `async () => { // …withSystemContext("system:retraction-action-window-sweep", run).\n await sweep((run) => run()); }`   | cross-account discovery with NO scope at all | **7 passed (7)** | **2 failed** — the wrap case and the DISCOVERY case   |
| `// The reason is "system:retraction-action-window-sweep".\n withSystemContext("system:deletion-record-degrader", run)` | the sweep runs under the DEGRADER's reason   | **7 passed (7)** | **2 failed** — the reason case and the DISCOVERY case |

The second shape is the sharper of the two: the case it defeats is literally named "names each tick
in its own scope reason instead of inheriting a neighbour's", and it passed while the tick inherited
a neighbour's reason verbatim. On real code the fixed file is **7 passed (7)**, unchanged.

**The fix is the discipline the file's own header already declared, applied where the verdict is
decided.** `collectTicks` now returns `sanitizedBody` alongside `body` — the same span of the
sanitized copy, index-for-index — and every "is this call here" verdict reads it. The reason cannot
be read there (sanitizing blanks the literal it lives in), so `declaredScopeReasons(tick)` locates
each `withSystemContext(` in the SANITIZED span and reads its first argument out of the ORIGINAL at
that same offset. A call whose first argument is not a string literal yields nothing and is reported,
which is the fail-closed answer. The failure message now prints what the tick REALLY declares.

**This was already known and had been filed as a backlog candidate in the entry above, which was the
wrong call and is corrected there too.** The file was MODIFIED by this unit (it gained the three
sweep cases), so a demonstrated red path was owed for it by the four-step rule for extending the
suite, and it was never taken for these assertions. "This unit's own registration passes either way"
is not an argument for leaving a gate that certifies its own subject.

### WARNING 1 — S-a-4 was guaranteed by the collaborator, not by the sweep

The per-row body had no `try`/`catch`, and the sweep names its dependency by the CONTRACT
`UseCase<In, Out, Err>`, which promises a `Result` and says nothing about not rejecting. "It does not
throw" was therefore a property of `ExpireRetractionActionWindowUseCase` — the class the composition
root happens to pass — and not of the sweep. Not live today; live the moment a second implementation,
a decorator or a driver-level rejection appears.

**RED first**, with a rejecting double between two healthy rows:

```text
 FAIL  tests/unit/retention/RetractionActionWindowSweep.test.ts > … > S-a-4: counts a REJECTING row the same as a refusing one, and keeps sweeping
TypeError: the use case rejected instead of returning a Result
 ❯ src/infrastructure/retention/RetractionActionWindowSweep.ts:154:27
 FAIL  … > names a rejection that is not an Error at all rather than reading a field off it
{ code: 'P2028', stacks: [] }
 Test Files  1 failed (1)
      Tests  2 failed | 6 passed (8)
```

The rejection took the whole tick with it: `post-c` never attempted, no summary log, the failures
counter unmoved — the exact outcome the file header's poison-row paragraph exists to prevent, while
the header claimed the opposite. GREEN after the guard: **8 passed (8)**.

**As built.** Only the call that can reject is inside the `try` — a counter or a log that threw could
never be counted as this row refusing. The catch lands in the SAME `failed` arm, moves the SAME
counter and writes the SAME message, so an operator alerting on it matches one payload shape. The two
refusals are told apart by `code`: an `err` carries the use case's own, a rejection carries the new
`RETRACTION_ACTION_WINDOW_SWEEP_REJECTED_CODE` (`"USE_CASE_REJECTED"`) — deliberately NOT a
`USE_CASE_ERRORS` member, because `INTERNAL_ERROR` in that field would read as a refusal that never
happened. `reportFailure` now takes the two derived strings rather than a `UseCaseError`, so there is
one entry shape and no `instanceof` across a realm boundary. **Two** cases were added, not one: the
non-`Error` rejection is its own branch (`errorType: "unknown"`, the `DeletionRecordDegrader`
convention), and an untested branch is what this whole correction is about.

### The five recorded corrections, and where each landed

| Gate finding                                                              | Correction                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CRITICAL 2** — the tier and budget omitted an entire file               | Re-measured here: **596 files / 9261** at the commit (not 595 / 9256), **+3 / +23** (not +2 / +18), attribution 6+4+5+3+5 = 23, EVIDENCE **621** (not 516), DOC **399** (not 394), **seven** new files and **three** new suites. The attribution table, the gate table and the budget table above are all corrected, and the "nothing unexplained" claim is retracted where it was false                                                                   |
| **WARNING 2** — the design snippet described a shape that was never built | `design.md` rev 3.9: the parameter is a runner function, not an options object, and the reason is `system:retraction-action-window-sweep`. The second was mechanical harm — the scan requires `system:<taskId>`, so an editor copying the document's literal puts that case red                                                                                                                                                                            |
| **WARNING 3** — a ticked task with two absent deliverables                | Recorded in `tasks.md` T1c.16 item (5) and in `design.md` rev 3.9: done except for two dotfile entries an executor may not write, blocks paste-ready in this ledger, orchestrator places them                                                                                                                                                                                                                                                              |
| **WARNING 4** — "no honest split exists" is false as an absolute          | Corrected above to the true reason. The split DOES exist and lands CODE at **385**; declining it is a cost (a first PR observable only by log, a second review of the same file, a PR boundary for 70 lines), not an impossibility. An exception signed on "there is no alternative" is a different decision from one signed on "the alternative costs more"                                                                                               |
| **NOTA** — a number that does not reproduce                               | **136**, not 109. Re-measured by parsing every `constructor(` parameter list in the 562 non-test `.ts` files under `apps/api/src` — balanced paren spans, string- and comment-aware, split on top-level commas — and classifying each type annotation: 136 bare concrete `*UseCase` class names, 0 inline `UseCase<>`, 0 `InstanceType<typeof …>`. Exactly one site names the contract at all, through the alias this unit added, so the ratio is 136 to 1 |

### Out of scope — recorded as backlog rows, not fixed

**SMELL-155, SMELL-156, SMELL-157** in `docs/reports/roadmap-detected-smells-backlog.md`.

**SMELL-155 is recorded with a CORRECTED finding, because the gate's stated evidence did not
reproduce.** The gate reported that `tsc -b apps/api` reports exit 0 on a planted `TS2322` under
`packages/adapters/*/src` while `tsc -p apps/api/tsconfig.json --noEmit --incremental false` catches
it. Measured as a 2x2 here:

| plant                                                             | `tsc -b apps/api`       | `tsc -p … --noEmit --incremental false` |
| ----------------------------------------------------------------- | ----------------------- | --------------------------------------- |
| in `PendingRetractionSweepReads.ts`, which `src/index.ts` IMPORTS | **exit 1**, error named | **exit 2**, error named                 |
| in a new file in the same directory that nothing imports          | **exit 0**, silent      | **exit 0**, silent                      |

The two forms behave identically; there is no `-b`-versus-`-p` divergence. The CAUSE the gate named is
right and the CONSEQUENCE is real — `apps/api/tsconfig.json` includes `packages/*/src/**/*` and
`packages/core/*/src/**/*`, and `packages/adapters/<pkg>/src` is two levels down, so those files are
typechecked only when something in the program imports them — but the variable is reachability, not
the invocation form. The backlog row states the 2x2 rather than the divergence.

**SMELL-156** was measured rather than restated: **24 `scheduler.register(` calls in 21 files** live
outside `src/index.ts` and are invisible to the scan; of those 21 files exactly **one**
(`RecurrenceScheduler.ts`) names a system scope at all and **20** name none; and the one that does
would FAIL both of the scan's assertions — its task id is `recurring-posts-tick` while its reason is
`"recurrence-sweep"`, with no `system:` prefix. It is the precedent this scan's own header cites.

**SMELL-157** — no integration test drives the sweep against a real database, so the two-scope
argument is proven by code reading and doubles. The doubles prove what the sweep BINDS; they cannot
prove what `pg_policy` and the GUC then do with it, which is the half SMELL-149 is about.

### Gates — the whole list, re-run on the corrected tree

| Gate                                                                                            | Result                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsc -p apps/api/tsconfig.json --noEmit --incremental false` (the authoritative form, not `-b`) | exit **0**                                                                                                                                                    |
| `tsc --noEmit -p packages/shared`                                                               | exit **0**                                                                                                                                                    |
| `eslint --max-warnings 0`, 3 touched files, ONE pass                                            | exit **0** (one unused `eslint-disable` directive found and removed — the rule it named is not active on that file)                                           |
| `prettier -c`, 7 touched files                                                                  | **All matched files use Prettier code style** (3 reflowed with `--write` first; the pristine tree was verified clean under the repo config before blaming it) |
| the five touched suites                                                                         | **5 files / 61 passed** (scan 7, sweep 8, metrics 5, adapter 4, env 37)                                                                                       |
| `apps/api` unit tier (`vitest run --maxWorkers=2`)                                              | **596 files / 9263 passed / 0 failed / 0 skipped**, exit 0                                                                                                    |
| `integration:saga-recovery`                                                                     | **33 tests, 33 pass, 0 fail, 0 cancel, 0 skip**, exit 0 — Postgres and Redis on `omnipost-infra` verified UP first                                            |
| the whole DB integration tier (`TIER=pr-integration`, 13 batches)                               | **534 tests, 534 pass, 0 fail, 0 cancel, 0 skip**, runner exit **0**                                                                                          |
| fitness **#1 #3 #4 #5 #6 #8 #9 #10 #11 #16 #21 #23 #32 #40**                                    | every one exit **0**, each `run:` block extracted textually from `fitness.yml` and executed as written                                                        |
| the modified gate's red path                                                                    | PROVEN in both directions, twice (before and after the prettier reflow), with `sha256sum -c` on the restore                                                   |
| `pnpm check:circular`                                                                           | **No circular dependency found** (1614 files)                                                                                                                 |
| `pnpm check:dead-code`                                                                          | **0 regressions** (321 tracked baseline findings)                                                                                                             |

**The unit tier delta of THIS commit: 9261 → 9263, +2, both attributed** — the two rejection cases in
`RetractionActionWindowSweep.test.ts` (6 → 8). File count unchanged at 596: no suite was added.

**Every plant was restored byte-exact and verified.** `sha256sum -c` OK on `src/index.ts`
(`f5598480189ae3a5f3740da23a22e74c6bc251aaa7a365f1cd87026a306e151a`) after each of the four scan
plants, and on `packages/adapters/db-prisma/src/PendingRetractionSweepReads.ts` after the two
`TS2322` plants; the unimported probe file was deleted before `check:dead-code` ran.

### Budget — this follow-up commit only, additions PLUS deletions

| Stream       | Measured | What                                                                                                                                                      |
| ------------ | -------: | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CODE**     |   **81** | `RetractionActionWindowSweep.ts` 64/−17 — the rejection guard, the new code constant, `reportFailure`'s signature, and the header paragraph that says why |
| **EVIDENCE** |  **159** | `schedulerTickTenantScope.test.ts` 70/−11 · `RetractionActionWindowSweep.test.ts` 76/−2                                                                   |
| DOC          |  **324** | this section, the corrections to the entry above, `tasks.md` 20/−5, `design.md` 5/−1, backlog 3/−0                                                        |

CODE for the unit is therefore **455 + 81 = 536**, and the `size:exception` it owes grows from 55 to
**136 lines** — stated plainly rather than folded into the original figure. None of the 81 lines is
optional under the finding that produced them: an unguarded rejection is the poison-row failure the
task's own acceptance criterion (S-a-4) names.
