# ADR-0024: Stryker is removed, and the options are documented before choosing a replacement

- **Status**: Accepted
- **Date**: 2026-09-26
- **Deciders**: Edward
- **Supersedes**: —
- **Superseded by**: —
- **Amends**: the mutation-testing posture recorded in
  `docs/architecture/NORMALIZATION_ROADMAP.md` §"Stryker realignment (2026-05-28
  audit)", which already downgraded mutation score from a hard gate to an
  informational signal. This ADR removes the tool entirely.

## Context

The investigation started as a review of one number — `maxWorkers: 2` in
`apps/api/vitest.stryker.config.ts`. Measuring that number established, in order,
that the file was inert, that the tool crashes, that the crash is not what it looks
like, and finally that the gate this repository calls its quality gate measures 14%
of the code and has never been able to fail anything.

### What is healthy, and is not in question

|                            |                                                       |
| -------------------------- | ----------------------------------------------------- |
| `vitest run` in `apps/api` | **8988 tests passing**, 577 files, 417s, peak 1314 MB |
| `turbo run test --force`   | **169/169 packages**                                  |

The test suite is sound. Nothing in this decision touches it. This matters because
the two tools are easy to conflate, and the owner's stated reason for removing
Stryker _now_ rather than replacing it is precisely to measure vitest with one
fewer variable in the way.

### The crash, diagnosed

| Finding                          | Evidence                                                                                                                                                                                                                                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Failure is **intermittent**      | Three runs of the identical command: **1 failure, 2 passes** (~33%), all three ~305s                                                                                                                                                                                                                             |
| Not memory                       | Tree peak 3.6 GB of 9.2; `dmesg` shows no OOM-killer activity                                                                                                                                                                                                                                                    |
| Not the V8 heap                  | With `--max-old-space-size=6144` (heap limit 6336 MB vs the box default of 2240) it fails identically, same error, same duration                                                                                                                                                                                 |
| Not the pool as such             | `vitest run --pool threads` passes all 8988 tests                                                                                                                                                                                                                                                                |
| The documented cause             | vitest: _"Some native libraries like Prisma and bcrypt have issues with threading and may crash"_ and _"the native module is likely not built to be multi-thread safe. As a workaround, you can switch to `pool: 'forks'`"_. This repository is Prisma, with 36 native `.node` addons installed including argon2 |
| Why it cannot be configured away | `@stryker-mutator/vitest-runner` hard-codes `pool: 'threads'`, `maxWorkers: 1` and `maxConcurrency: 1` in `dist/src/vitest-test-runner.js:38-49`. Its options schema is `additionalProperties: false` over exactly `dir`, `related`, `configFile` — **`vitest.pool` does not exist in any published version**    |
| Why the error carries no cause   | vitest's worker `'exit'` handler declares no parameters and discards `code` and `signal`. The fix landed on the v5 line and was **never backported to 4.x**; the backport request auto-closed                                                                                                                    |

### The blocker that decides it, and it is not the pool

The pool is real and a `pnpm patch` would fix it. The reason that is not enough:
the only layer that answers _"which tests are vacuous"_ is
`coverageAnalysis: "perTest"`, and it has **six open issues in the vitest-runner,
five with zero comments** — all corrupting in the same direction, a false
`Survived`, which accuses a test that genuinely verifies behaviour:

| Issue | What it reports                                                                               |
| ----- | --------------------------------------------------------------------------------------------- |
| #6192 | Mutant reported `Survived` **while its attributed tests FAIL** — persists in 10.0.0           |
| #6209 | Static mutants falsely `Survived`; `reloadEnvironment` declared and not implemented           |
| #6213 | `testsCompleted: 0` → `Survived`, reproduced **at a low worker count without CPU contention** |
| #6073 | Non-deterministic verdicts under `perTest`                                                    |
| #6144 | Static mutants under a `testFiles` filter                                                     |
| #6223 | The hard-coded pool (this repository's crash)                                                 |

**#6213 is the worst case here**, because its trigger is _few workers_ and the
runner forces `maxWorkers: 1`, the minimum possible. Patching the pool does not
touch it.

### A local defect that upstream does not owe us

`apps/api/stryker.config.mjs` never set `disableBail`, and the runner computes
`bail: this.options.disableBail ? 0 : 1`. With `bail: 1`, `killedBy` records **one
test per mutant** and every other test that genuinely kills that mutant is left
labelled `Covering` — which in `mutation-testing-metrics` is literally _"the total
number of tests that didn't even cover a single mutant (useless tests?)"_. **The
configuration manufactured false vacuous-test verdicts by construction.**

### Upstream responsiveness

**Twenty of the twenty most recent issues have zero maintainer comments.** In
#6073 an outside contributor root-caused the defect to an exact line, prototyped
the fix and offered the PR on 2026-07-26: two months of silence.

Stated fairly: **the project is not abandoned.** Releases are regular, a major
shipped 2026-08-14, and community PRs do get merged. What it does not do is
respond. The operational conclusion is narrow and it is the one that matters here:
**never plan around upstream answering.**

### Scope: what the "quality gate" actually covered

Measured by running the configuration's own globs against the disk:

|                                       |                                    |
| ------------------------------------- | ---------------------------------- |
| `mutate` entries                      | 60 → **29 positive**, 31 negations |
| Files actually mutated                | **280**                            |
| Non-test source files in the monorepo | **~1999**                          |
| **Real coverage**                     | **≈14%**                           |

- **269 files of `apps/api/src` were never mutated, and 200 of them are
  `src/infrastructure/`** — repositories, container, adapters. The layer where the
  tenant and persistence defects live, including the `PrismaPostRepository` read
  defect found in the same session as this decision.
- **`packages/core`: 540 files, 0% mutated.** It carries its own
  `stryker.config.mjs` declaring `break: 89`, which **was never evaluated once**,
  because only `apps/api` declared a `mutation` script and the nightly ran
  `turbo run mutation`.
- `apps/client` (424 files) and `apps/admin` (182): 0%.
- **The nightly step was `continue-on-error: true`.** The score could never fail
  anything. The only live gate was "did a report file get written".

### The installation, counted

|                                              |                                                              |
| -------------------------------------------- | ------------------------------------------------------------ |
| `stryker*.config.mjs` files                  | **65** (26 one-per-package + 39 ad-hoc slices in `apps/api`) |
| Total lines of Stryker configuration         | **2410**                                                     |
| That any automation ever executed            | **1**                                                        |
| `break` thresholds that were never evaluated | **23**                                                       |
| `.stryker-tmp/` sandboxes left on disk       | **10 × ~114 MB = 1.2 GB**                                    |
| Report JSONs **tracked in git**              | **6**, totalling **20.4 MB**, stale since May                |

The tracked JSONs escaped `.gitignore` because its rule matches one exact
basename; they also embed full source snapshots, which produce false positives in
any repository-wide search for a deleted symbol.

Two defects found while counting, neither fixed — both files are deleted:

- `apps/api/stryker-micro-D3.config.mjs` declared
  `mutate: ["src/analytics/*.ts", "!src/analytics/*.ts", "!src/analytics/*.ts"]` —
  the include is immediately double-negated, so that configuration **mutated
  nothing**.
- `apps/api/vitest.stryker.config.ts` existed, per its own JSDoc, _"only for this
  cap"_ — and both keys it set are overridden by the runner, so the memory cap it
  documented **never applied**. It also declared `@layer test-infrastructure`, a
  value the canon forbids, which went unseen because eight fitness checks filter
  with an unanchored `.stryker` substring.

## Decision

**Remove Stryker completely, and do not choose a replacement in the same change.**

Removed: the 65 configurations and `vitest.stryker.config.ts`, the 4 support
scripts, the 6 tracked report JSONs, the `mutation` npm scripts, the `mutation`
turbo task, the `mutation` quality gate in `openspec/config.yaml`, the catalog
pins, the `publicHoistPattern` that let 21 packages resolve the binary without
declaring it, the devDependency pairs in three manifests, the nightly's two
mutation steps, and the 1.2 GB of on-disk sandboxes. 50 packages leave the
lockfile, all of them Stryker's or exclusive to it.

Fitness #36 is **reduced, not deleted**: its subject was two things, the `mutate`
arrays and the `include` arrays of `apps/api/vitest.config.ts`. The second half
stays — a coverage glob matching zero files is still a gate measuring nothing.

Not chosen here: what replaces it. That decision waits deliberately, so vitest's
own behaviour can be measured without Stryker in the picture.

## Rationale

A gate that covers 14% of the code, cannot fail, crashes one run in three, and
whose one useful output is corrupted by four open upstream bugs plus one local
misconfiguration is not a gate. It is a claim. Keeping it while knowing this is
worse than not having it, because its report reads as authoritative: a false
`Survived` tells a developer to delete or rewrite a test that was doing its job.

Removing it before choosing a replacement is the owner's call and it is the right
one. The two tools interact — Stryker drives vitest — so any measurement of
vitest's own performance taken while Stryker is installed and crashing cannot
separate one tool's defect from the other's.

## Alternatives Considered

- **Patch the pool with `pnpm patch` and keep going.** Rejected for now, not
  because patching is unsupported — `pnpm patch` commits the patch and survives
  installs — but because it fixes the crash and leaves the four false-`Survived`
  bugs untouched. The output would still be unsafe to act on.
- **Switch to `coverageAnalysis: "all"`.** This does avoid the `perTest` bugs, and
  it was measured to complete the dry run reliably. Rejected on arithmetic: with
  42437 mutants each running 5810 tests, Stryker's own estimate was
  `remaining: ~10065h` — **417 days**.
- **Wait for upstream.** Rejected: 20 of 20 recent issues have no maintainer
  response, and a root-caused fix with an offered PR has sat for two months.
- **Keep the configuration and narrow the scope with `--testFiles`.** A real,
  supported option that this repository never used, and it would have made the dry
  run smaller. Rejected as insufficient: it addresses the crash's scale, not the
  verdict corruption, and it would preserve 2410 lines of configuration of which
  one file was ever executed.
- **Replace with another mutation-testing tool.** Deferred, not rejected. Stryker
  is effectively the only maintained mutation-testing tool for this ecosystem,
  which is itself decision-relevant and belongs on the record.

## Options for the replacement decision

Recorded here so the decision, when it happens, starts from measured ground.

| Option                                                                                               | What it gives                                                                                                                                                                                                                                                                                                                              | What it costs                                                                                                                                                                                                                     | What it does NOT give                                                                                             |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **`@vitest/eslint-plugin`** (`expect-expect`, `no-conditional-expect`) — **not currently installed** | Names the test with no assertion, and the test whose assertion sits inside a branch that is false at runtime. **100% of the tests** in the monorepo, deterministic, seconds, inside the lint that already runs                                                                                                                             | One devDependency and a measured baseline. Requires `assertFunctionNames: ["expect", "assert", "assert.*"]` — **158 of the 573 unit files use `node:assert`**, and without that setting every one of them reads as assertion-free | Nothing about a test that asserts the wrong thing. It catches the coarse third of the problem, not the subtle one |
| **Stryker with `pnpm patch`** on the pool                                                            | Real mutation testing, maintainably (the patch is committed and survives installs)                                                                                                                                                                                                                                                         | A patch to carry against every release                                                                                                                                                                                            | Does not fix the four false-`Survived` bugs, including the one that triggers at low worker counts                 |
| **Stryker with `coverageAnalysis: "all"`**                                                           | Mutation testing **without** the false-vacuous bugs                                                                                                                                                                                                                                                                                        | Runtime × number of tests. Measured: **417 days** at `apps/api` scope. Viable only on small packages                                                                                                                              | Does not say which test kills which mutant — i.e. does not answer the original question                           |
| **Staged rebuild over `packages/core`**                                                              | 49 packages, **all native-free, all with tests**. Measured candidates: `@core/accounts` (4 src / ~43 cases), `@core/projects` (4 / ~58), `@core/customer-auth` (9 / ~33, native-free because it depends on the `PasswordHasher` **port**), and `@core/application` (3 files, widest blast radius — every other core package depends on it) | —                                                                                                                                                                                                                                 | Depends on first choosing the tool                                                                                |

A measured constraint that applies to any option: **every package in this monorepo
runs on `pool: "forks"`**, explicitly or by vitest's default. The native-module
risk is confined to `apps/api`, `apps/workers`, `infra/prisma` and
`packages/adapters/db-prisma`, plus two transitive chains
(`@providers/instagram` → db-prisma, and `apps/client` → instagram).

## Consequences

- **No mutation signal until a replacement is chosen.** Stated plainly: this is a
  reduction in the checks the repository runs. It is a reduction of zero real
  signal, because the gate could not fail and its verdicts were corrupted, but the
  _absence_ is now honest instead of decorative.
- **SMELL-84 and SMELL-85 close by deletion, not by resolution.** Their subjects —
  29 empty negations, and 45 dead positive globs across 14 quarantined configs —
  cease to exist. This is the one place in this change where a backlog entry is
  retired without its underlying question being answered, and it is recorded here
  rather than left to look like progress.
- **Three documentation claims were corrected**, because they asserted a gate that
  did not exist: `docs/product/INVESTOR_ES.md` bundled mutation testing into a
  headline _"0 failures"_ test count; `docs/technical/DEPENDENCIES.md` listed the
  break threshold beside real coverage gates; and
  `docs/reports/testing/testing-infrastructure-complete.md` reported scores that
  cannot be reproduced, a config count that was wrong, and a section describing
  `apps/api/src/domain/`, a directory that no longer exists.
- **Two claims in `openspec/config.yaml` were corrected as measured false**, since
  they instruct every agent that reads it: _"NO docker build locally"_ (the four
  images were built and Trivy-scanned on this box) and _"NO full test suite at
  once"_ (8988 tests and 169/169 packages ran in one go). Its fitness-function
  count also said 41 where the suite has 42.
- **The unanchored `.stryker` filters in eleven fitness checks are now inert.**
  Eight of them are bare substrings rather than directory-anchored, which is the
  form that hid `vitest.stryker.config.ts` from twelve checks. Deleting that file
  removes today's blind spot; tightening the filters is deliberately left to a
  separate change, because it is eleven checks across two files that must move in
  lockstep.
- **20.4 MB leaves the working tree and 1.2 GB leaves the disk.** The tracked
  JSONs also stop polluting repository-wide symbol searches.

## Revisit if

- The `perTest` bugs — #6192, #6209, #6213, #6073 — are fixed and released. That
  is the single condition that makes Stryker able to answer the original question.
- A maintained alternative appears for this ecosystem.
- The cheap layer proves insufficient in practice: if `expect-expect` and
  `no-conditional-expect` come back near-zero across 8988 tests, the vacuous tests
  are of the subtle kind and only mutation testing will find them.

## Risks

- **Losing the habit.** With no mutation signal at all, nothing pushes back on a
  test that asserts a mock it configured itself. The cheap layer is the mitigation
  and it is not yet installed; until it is, this risk is live and unmitigated.
- **The removal is broad.** 76 tracked files, 12 manifest and configuration edits,
  a CI workflow and a fitness check. The mitigation is that the test suite itself
  is the control: `169/169` packages and `8988` tests must be byte-for-byte the
  same verdict after the change as before it.
- **`packages/core` had a `break: 89` on paper.** Deleting it removes an
  aspiration that was never enforced. The honest reading is that nothing was lost;
  the risk is that its absence is read as a lowering of standards rather than the
  correction of a fiction.

## References

- `stryker-js#6223`, `#6213`, `#6209`, `#6192`, `#6144`, `#6073` — the open issues
- vitest `#10587` (the worker-exit fix, v5 line) and `#10894` (the auto-closed
  backport request)
- <https://vitest.dev/config/pool> and <https://vitest.dev/guide/common-errors> —
  the documented native-module incompatibility with `pool: 'threads'`
- `docs/reports/CI_TEST_REACH_AUDIT.md` §G2, §G10 — the prior audit that already
  found "65 configs, exactly 1 executed" and refuted the "primary quality gate"
  label
- `docs/reports/CI_CACHE_INTEGRITY_AUDIT.md` §NAC-04 — the committed incremental
  state
- `docs/architecture/NORMALIZATION_ROADMAP.md` §"Stryker realignment" — the
  2026-05-28 downgrade from hard gate to informational signal
