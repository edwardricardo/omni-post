# ADR-0038: Node 26 ahead of its LTS date

- **Status**: Accepted
- **Date**: 2026-10-15
- **Decision-makers**: Maintainer
- **Consulted**: —
- **Informed**: —
- **Supersedes**: —
- **Superseded by**: —
- **Amended**: 2026-10-22, §"Amendment of 2026-10-22: Node 26.12.1" (the `engines.node` floor and
  both image stages move to 26.12.1, the security release of 2026-10-21)
- **Amends**: slice `0.16` of `openspec/changes/testing-refoundation/tasks.md` ("the runtime follows
  LTS, never Current") and its dating to 2026-10-28 by tracker decisions D46 and D51
- **Related**: [ADR-0017](ADR-0017-production-build-bundler.md) (the image build model);
  [ADR-0018](ADR-0018-dependency-freshness-canon.md) (the 7-day maturity buffer);
  [ADR-0036](ADR-0036-dependency-update-cadence.md) (security floors immediate, the Tuesday window);
  [ADR-0037](ADR-0037-storybook-nextjs-vite-patch-for-next-16-4.md) (the patch the four Dockerfiles
  copy); tracker decision D52 in [TESTING_REFOUNDATION.md](../development/TESTING_REFOUNDATION.md)

The runtime moves from Node 24 to Node 26 on 2026-10-15, thirteen days before Node 26 becomes Active
LTS on 2026-10-28. One change raises `.nvmrc`, the `engines.node` of all 101 manifests, the
`@types/node` pin, the CI setup and both stages of the four images. The Maintainer accepts the risk of
running a Current release for those thirteen days, and the maturity watchlist re-checks the move on
2026-10-28.

## Context

1. **The plan.** Slice `0.16` moved the runtime on Node 26's Active LTS date, 2026-10-28, under the
   rule "the runtime follows LTS, never Current". Decisions D46 and D51 kept it a dated unit outside
   Phase 0, and the watchlist's date entry `contract-0.16-node-26` was due that day.
2. **The program.** On 2026-10-14 the Maintainer started a dependency catch-up whose first rule is "Node
   first": every later unit, from the inventory recalibration to the family bumps, is measured on
   the runtime it will run on. Node 24 enters Maintenance on 2026-10-20 (`nodejs/Release`,
   `schedule.json`).
3. **Node 26 on 2026-10-15.** Current since 2026-05-05, Active LTS on 2026-10-28. 26.12.0 was
   released on 2026-10-14 and carries no security content. 26.11.1, released on 2026-10-07, is the
   latest 26.x past the 7-day buffer, and the version `actions/setup-node` installs for `"26"`: the
   `actions/node-versions` manifest, last updated 2026-10-08T03:09Z, lists it first.
4. **The tree on Node 26.** Measured against the lockfile: of the 1,071 locked packages that declare
   `engines.node`, every one admits 26.11.1 and 26.12.0 except `@img/sharp-win32-ia32@0.35.5`
   (`^20.9.0`), an optional Windows binary no Linux install fetches. The one direct dependency that
   excluded 26, opossum 9.0.0, moved to 10.0.0 in the previous change. The native addons are N-API
   (sharp, argon2, msgpackr-extract, bufferutil, utf-8-validate, the SWC, rolldown, rollup,
   lightningcss, Tailwind oxide and oxc binaries, `@parcel/watcher`), whose ABI holds across Node
   releases, so nothing is rebuilt. Prisma 7.9.1 declares `^20.19 || ^22.12 || >=24.0`, and its
   system requirements page says it "supports and tests all Active LTS and Maintenance LTS Node.js
   releases. Releases that are not in these states like Current … probably also work, but are not
   recommended for production use".
5. **Why one change.** Two facts tie every site together, and a third limits what enforces it:
   - the engines gate (`scripts/testing/engines-node-gate.mjs`) refuses a process on another major
     than `.nvmrc`, a manifest whose `engines.node` differs from the root's, and a `@types/node` pin
     on another major, so `.nvmrc`, the manifests, the pin and every Node that runs the gate (CI and
     the local battery) move together;
   - Node 26 ships no corepack: it is "no longer distributed as of Node.js v25.0.0"
     (nodejs/node#61207), so `RUN corepack enable` in the four Dockerfiles and
     `corepack enable pnpm` in `dependency-updates.yml` stop working;
   - pnpm does not enforce `engines.node` here. Measured with pnpm 12.6.0 on 2026-10-15: with
     `engineStrict` unset, as in this repository, a Node 24.15.0 process installs a workspace whose
     every project declares `>=26.11.1 <27`, exit 0 and no warning, and `pnpm install
--frozen-lockfile --offline` in this tree under 24.15.0 also exits 0; with `engineStrict` on,
     pnpm refuses the root project's range only (`ERR_PNPM_UNSUPPORTED_ENGINE`, "current:
     {"node":"24.15.0"}").

## Decision

The Maintainer, 2026-10-14 (18:0x EDT): move to Node 26 now, document the early move, and re-check the
package state on 2026-10-28.

1. **Runtime.** `.nvmrc` holds `26`; `engines.node` is `>=26.11.1 <27` in the root `package.json` and
   in the other 100 workspace manifests. Amended on 2026-10-22: `>=26.12.1 <27`
   (§"Amendment of 2026-10-22: Node 26.12.1").
2. **Types.** `@types/node` moves to the 26 line: 26.6.5, `latest`, taken inside the 7-day buffer under
   the Maintainer's 72-hour rule (it matures 2026-10-16T18:46Z), with a maturity watchlist entry.
3. **Images.** The build stage of all four Dockerfiles is
   `node:26.11.1-bookworm-slim@sha256:86f07bc9c5dce4578cf37e5a418b7bfc7f817cda25cde66e2b66e95ed86c4567`; the production stage is
   `gcr.io/distroless/nodejs26-debian13@sha256:746f728c8b61c9beb5d0350f054b4049c4cef0ae71d5b3f8f33bc57904bbc37e`, the `latest` index (v26.12.0), still run
   as `USER nonroot`. Amended on 2026-10-22: `node:26.12.1-bookworm-slim@sha256:28147155…`
   and `nodejs26-debian13@sha256:456bd22a…`, both v26.12.1 (§"Amendment of 2026-10-22: Node
   26.12.1").
4. **pnpm in the images.** Each build stage installs pnpm 12.6.0 from its immutable GitHub release,
   checked against the sha256 GitHub records for the asset of the image's architecture, downloaded
   with node's own `fetch` (`docs/deployment/base-images.md` §"pnpm in the build stage").
   `packageManager` stays the version contract.
5. **CI.** Every workflow that names a Node version names `26`; the shared
   `setup-node-pnpm-cache` action reads `.nvmrc` when its caller names none; the major-updates job of
   `dependency-updates.yml` installs pnpm with `pnpm/action-setup` before `setup-node`.
6. **The re-check.** The watchlist's date entry `contract-0.16-node-26`, due 2026-10-28, becomes
   "Re-check Node 26 move on 2026-10-28: LTS promotion, distroless digest, pins".

## Rationale

- **One runtime for the program.** Each unit after this one is certified once, on the runtime it
  ships with, instead of on Node 24 first and again after 2026-10-28.
- **The exposure is short and on the same line.** The LTS promotion is a release of the 26.x line,
  not a new major: what changes on 2026-10-28 is the support commitment, and the re-check reads it.
- **The floor is what CI installs.** 26.11.1 is the latest mature 26.x and what `setup-node`
  resolves for `"26"`, so CI, local work and the build stage run the same release, and the floor
  admits nothing older. It also carries nodejs/node#66273, released in 26.11.0: the node:test parser
  no longer crashes on child stdout that mimics a V8 frame, the class of DEF-83 in `MASTER_PLAN.md`.
  Since 2026-10-22 the floor is 26.12.1, the security release CI and both image stages run.
- **The release asset, not npm.** pnpm 12's npm package is a launcher whose install step places the
  same native executable from its `@pnpm/exe.<platform>` optional dependencies, so both routes run
  one binary. The release route pins it by digest in the Dockerfile; the npm route trusts the
  registry at build time with no local pin.
- **`.nvmrc` as the action's default.** Seventeen call sites of the shared action pass no version.
  Reading `.nvmrc` ties them to the file the engines gate reads, so the next major moves them
  without an edit.

## Alternatives Considered

- **Wait for the LTS date.** The original plan. Rejected by the Maintainer: every unit of the catch-up
  until 2026-10-28 would be certified on Node 24 and certified again after the move, while Node 24
  enters Maintenance on 2026-10-20.
- **Move only CI.** Rejected: production would run a major the tests never ran on, and the engines
  gate refuses a CI Node on another major than `.nvmrc`, so `.nvmrc` and the manifests would move
  anyway.
- **Move only the images.** Rejected for the mirror reason: the tests would run on a major production
  does not use.
- **`npm install -g pnpm@12.6.0` or `npm install -g corepack` in the images.** Rejected: the same
  binary or one more moving part, with no digest pinned in the tree (Rationale).
- **`engineStrict: true` in `pnpm-workspace.yaml`, so `pnpm install` refuses a Node outside the
  range.** Considered and not taken in this change. Measured with pnpm 12.6.0 (Context item 5), it
  checks only the root project's `engines.node`, and only when `engineStrict` is on. The engines gate,
  in CI and in the local battery, already refuses a process on another major than `.nvmrc`. A strict
  install would also turn any later dependency whose `engines` exclude the running Node from a
  warning into a failed install.

## Consequences

- **Every process that runs the gates needs Node 26 from this commit.** The engines gate, in CI and
  in the local battery, exits 1 on any other major. The install does not: pnpm installs this tree
  under Node 24 with exit 0 and no warning (Context item 5), so a local run on the wrong Node is
  caught by the gate, never by `pnpm install`. Local work runs under `fnm exec --using 26.11.1`
  until the fnm default moves after merge, every live worktree reinstalls, and a branch on the Node
  24 base stays on 24 until it is rebased.
- **Operators** need Node 26 and pnpm 12.6.0 wherever they run `pnpm` (migrations, the app role):
  a new Infrastructure row in `docs/deployment/DEPLOYMENT_CHECKLIST.md`.
- **Build and runtime differ by one minor**: 26.11.1 builds, 26.12.0 runs. The distroless repository
  has no version tags, and the N-API addons do not depend on the minor. That held until 2026-10-22,
  when both stages moved to 26.12.1 (§"Amendment of 2026-10-22: Node 26.12.1").
- **Production runs a release Prisma does not test** until 2026-10-28. The re-check reads Prisma's
  statement again. Every install under Node 26 prints Prisma's preinstall notice, "Prisma only
  supports Node.js versions 20.19+, 22.12+, 24.0+. Please use a supported Node.js version.", and
  continues: `prisma generate` runs after it (measured on 2026-10-15, exit 0).
- **`setup-node` follows the 26 line.** When the `actions/node-versions` manifest lists 26.12.0, CI
  moves to it inside the major; the floor stays 26.11.1 until a change raises it. The amendment of
  2026-10-22 raised it to 26.12.1, the release CI had installed since 2026-10-21.
- **Two watchlist reviews** for `@types/node` 26.6.5: 2026-10-16, at its maturity, and 2026-10-23, entered by the follow-up commit once this change has its sha and PR number, the convention of every entry in that file.
- **The build stage is pinned by digest**, so Dependabot now tracks both `FROM` lines of each
  Dockerfile.
- **Node 26 printed two kinds of warning**, neither a failure. The battery holds zero warnings, so
  this change fixes them at their source instead of deferring them:
  - Node 26 defines an experimental `localStorage` global that prints an `ExperimentalWarning` when
    it is read without `--localstorage-file`. The reader is msw 2.15.0, not vitest: its cookie-store
    module (`lib/core/utils/cookieStore.mjs`) builds a `CookieStore` when it loads, and the
    constructor reads `typeof localStorage`, so every node-environment worker that imports msw
    printed it, 8 lines per run of the `apps/api` suite and 1 in `@providers/telegram` (traced with
    a preload that prints the stack of the first read). No server code here uses Web Storage, so
    `NODE_TEST_EXEC_ARGV` (`--no-experimental-webstorage`) in `packages/vitest-shared` turns the
    feature off in those workers: `defineWorkspaceVitestConfig` writes it into `test.execArgv` for
    the node environment only, and the `apps/api` and `apps/workers` configs, which do not go
    through the factory, spread it. A DOM environment keeps the DOM's `localStorage`. Production
    reads nothing: the built API served requests for 30 seconds under that preload with no read,
    and the four images, run against the test services, printed no warning. msw 3.0.3 builds no
    cookie store under Node, so the argument can go with the msw 3 move;
  - `@tailwindcss/node` 4.3.0 called `module.register()`, which Node 26 deprecates (DEP0205), once
    per process in both portal suites and builds and in the test contracts that load their configs.
    Tailwind 4.3.1 calls `module.registerHooks()` where it exists. `tailwindcss` and
    `@tailwindcss/postcss` move from 4.3.0 to 4.3.3, the latest release (2026-07-16T12:03Z), with
    no advisory in OSV; the lockfile moves only the 16 `tailwindcss` and `@tailwindcss/*` packages,
    4.3.0 to 4.3.3. Since 4.3.1 a spacing utility emits `0` or `var(--spacing)` where it emitted
    `calc(var(--spacing) * 0)` or `calc(var(--spacing) * 1)`, the same values, and the portal CSS
    is 0.6 to 0.7 percent smaller. `tailwindcss@4.1.18` stays, pinned exactly by
    `@react-email/tailwind@2.0.6`: it is the core package, which registers no hook;
  - the story run's DEP0205 is not Tailwind's: Storybook's `importModule` calls `module.register()`
    for its TypeScript loader when `loadMainConfig` reads `.storybook/main.ts`, in 10.6.1 and in
    10.6.2, the latest release. Only 11.0.0-alpha.6 calls `module.registerHooks()` on Node 26, and
    10.6.1's loader hook is asynchronous, which `registerHooks()` does not accept, so no patch can
    move it. The Maintainer chose, on 2026-10-15, to silence DEP0205 in that one process until a stable
    Storybook 11 is installed: `apps/client` runs `test:stories` as
    `NODE_OPTIONS="${NODE_OPTIONS:-} --disable-warning=DEP0205" vitest run --config
vitest.stories.config.ts`, which appends to the caller's `NODE_OPTIONS` and keeps `vitest` the
    script's command, so knip still reads the stories config as used. The cost, stated: another
    DEP0205 in the story process or a process it starts would be hidden too. The watchlist date entry
    `storybook-11-dep0205` re-checks it in each Tuesday window;
  - Measured after both fixes: `apps/api` 609 files and 9,654 tests, `apps/workers` 17 and 129, the
    admin portal 17 and 129, the client portal 45 and 556, `@providers/telegram` 4 and 73, and the
    client stories 9 and 68 pass; no suite prints an `ExperimentalWarning` or a DEP0205, the story
    run with its one deprecation silenced.
- **`@types/node` 26 declares `assert.ok` with two overloads** (a message function, or a format
  string with arguments). Under TypeScript 6 that made two loops in each of
  `tests/threading.planner.integration.test.ts` and `tests/threading.xprovider.integration.test.ts`
  circular (TS7022: `tweet` read `result.value.tweets[i]` while `assert.ok` narrowed `result`), and
  the tests typecheck ratchet of `apps/api` rose from 2135 to 2137. The four loops now read
  `tweets` once, after `assert.ok(result.ok)`, and iterate `tweets.entries()`; the ratchet measures
  2133, and its ledger dropped both `TS7022` keys.
- **Measured on 2026-10-15 under Node 26.11.1**, on this change:
  - the lockfile moved only `@types/node`: one copy, 26.6.5, where 24.13.6 and 26.6.4 stood, and
    `undici-types` 7.18.2 left with 24.13.6 (packages 1942 → 1940, snapshots 1946 → 1944);
    `pnpm dedupe --check` and `pnpm install --frozen-lockfile --offline` exit 0;
  - `apps/api` 608 files and 9,613 tests, `apps/workers` 17 and 129, the admin portal 17 and 129,
    the client portal 45 and 556, and the client stories 9 and 68 pass, with the test environment
    loaded the way the battery loads it; both portal builds pass;
  - `apps/api` coverage on Node 26 measures statements 59.04, branches 49.94, functions 60.05 and
    lines 59.61, above every floor of `apps/api/vitest.config.ts` (56.2, 47.8, 57.3, 56.8);
  - the four images build with `podman`; each runs `/nodejs/bin/node` v26.12.0 as `nonroot`;
    argon2 round-trips in the API image; both portal images answer 200 on `/api/health` and `/`,
    and `podman healthcheck run` passes for both; Trivy 0.75.0 finds no HIGH or CRITICAL
    vulnerability in the runtime digest (debian 13.7).
- **Records moved with it:** the canon row `@types/node` in `docs/security/SECURITY_CANON.md`;
  `docs/deployment/base-images.md` and `docs/deployment/LOCAL.md`; the stated runtime in
  `CLIENT-APP.md`, `DEPENDENCIES.md` and `DEPENDENCIES_ES.md`, the two standards documents, both
  investor documents, `TESTING_INFRASTRUCTURE.md` and the coverage note of
  `apps/api/vitest.config.ts`; slice `0.16` in `tasks.md`, `TESTING_REFOUNDATION.md` and
  `MASTER_PLAN.md`; the `tailwindcss` row of `DEPENDENCIES.md` and `DEPENDENCIES_ES.md`, and the
  `@tailwindcss/node` consumer named in the canon row `source-map-js`.

## Amendment of 2026-10-22: Node 26.12.1

The Maintainer, 2026-10-22: take Node 26.12.1, the security release of 2026-10-21, now, in both stages of
the four images and as the `engines.node` floor. It is the case "A 26.x security release" of
§"Revisit if", and a deviation inside the 7-day buffer, as ADR-0036 takes every security floor:
26.12.1 was published on 2026-10-21 and matures on 2026-10-28, the day of Node 26's LTS promotion
and of this ADR's re-check.

**What 26.12.1 fixes on the 26.x line** (the Node.js security releases of 2026-10-21: 26.12.1,
24.22.1 and 22.23.4; the highest severity on 26.x is High):

| CVE                              | Severity     | Subsystem                                                                                          | Reach in this repository                                                                                                                                                                                                                                               |
| -------------------------------- | ------------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CVE-2026-111497                  | High         | Brotli decoder out-of-bounds write                                                                 | The global `fetch` (bundled undici) decodes a `content-encoding: br` response body, so every outbound fetch whose body is read; some targets are tenant-chosen (`apps/api/src/video/uploadPipeline.ts:692`, `fetch(webhook.url, …)`). No direct `node:zlib` Brotli use |
| CVE-2026-106069, CVE-2026-106072 | High, Medium | TLS hostname check: non-canonical IP addresses; a DNS SAN authenticating an IP endpoint            | Every outbound TLS connection (provider APIs, webhooks, CRM adapters); no `checkServerIdentity` or `servername` override in the tree                                                                                                                                   |
| CVE-2026-105483                  | High         | TLS normalization of IP addresses written in fullwidth digits                                      | The same surface                                                                                                                                                                                                                                                       |
| CVE-2026-105482                  | High         | `dns.resolve` truncates a name at NUL                                                              | No `node:dns` import in `apps/`, `packages/` or `infra/`; dependencies not measured                                                                                                                                                                                    |
| CVE-2026-105481                  | Medium       | The `http` keep-alive agent processes a response written before the request                        | Outbound `http.Agent` users (axios in `providers/tiktok`, gaxios, the SDKs)                                                                                                                                                                                            |
| CVE-2026-106074                  | Medium       | `crypto.randomUUID()` and `randomInt()` caches saved into startup snapshots and single executables | Not reachable: no snapshot or single-executable build                                                                                                                                                                                                                  |
| CVE-2026-106070                  | Low          | zlib `ZipFile`                                                                                     | Not reachable: not used                                                                                                                                                                                                                                                |
| CVE-2026-106071, CVE-2026-106073 | Low          | The permission model (wildcard radix, `realpathSync`)                                              | Not reachable: no `--permission`                                                                                                                                                                                                                                       |

The release also moves the bundled undici from 8.11.2 to 8.12.2, c-ares to 1.34.9 and the root
certificates to NSS 3.131.1, rejects certificate chains that contain a blocked public key, and
reverts a change that shipped in 26.12.0 only: with it, `require(esm)` inside a module that
`module.register()` loads fails with `ERR_INTERNAL_ASSERTION` (nodejs/node#66767, reverted by
nodejs/node#66786). The upstream reproduction exits 1 on `746f728c` (v26.12.0) and prints `ok` on
`456bd22a` (v26.12.1); the one hook this repository registers in production, Sentry's
`import-in-the-middle` hook (with a DSN), did not trigger it in a reproduction on either digest.

**What moved.**

| Site                                | Before                                                            | After                                                                                                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Build stage of the four Dockerfiles | `node:26.11.1-bookworm-slim@sha256:86f07bc9…`                     | `node:26.12.1-bookworm-slim@sha256:28147155d47dc31abe0a46e0d12b59b2fb3d0a2dcc5dc65fce76a074180b16fe`                                                                     |
| Production stage                    | `gcr.io/distroless/nodejs26-debian13@sha256:746f728c…` (v26.12.0) | `gcr.io/distroless/nodejs26-debian13@sha256:456bd22a48bc4b8b82b19041d7d9ff9c14e4ff0b80ea32c0b912be2f8288dbf7` (v26.12.1; the `latest` index, uploaded 2026-10-21T16:39Z) |
| `engines.node`, 101 manifests       | `>=26.11.1 <27`                                                   | `>=26.12.1 <27`                                                                                                                                                          |

`.nvmrc` stays `26`. `@types/node` stays 26.6.5, the newest 26.x types, which do not track the Node
minor. No workflow changes: `setup-node` reads `.nvmrc`, and every job of CI and Production CI/CD on
`487be6b5` already installed 26.12.1, which `actions/node-versions` listed from 2026-10-21T14:44Z.
The lockfile does not move.

**Measured on 2026-10-22.**

- At 15:09:30Z the `latest` index of `gcr.io/distroless/nodejs26-debian13` and the tag
  `node:26.12.1-bookworm-slim` resolved to the two digests above, and both images ran v26.12.1.
  Google uploaded three root indexes in the two days before, so the re-check of 2026-10-28 reads
  it again.
- Trivy 0.76.1 (database of 2026-10-22T13:15Z) with the gate's flags finds 0 HIGH or CRITICAL
  vulnerabilities in `456bd22a`, as in `746f728c` (debian 13.7). `ca-certificates` moved to
  20250419+deb13u1 (DSA-6572-1); `libssl3t64` 3.5.7-1~deb13u3 and `libc6` 2.41-12+deb13u4 did not.
  The build stage keeps glibc 2.36-9+deb12u14 and npm 11.20.0.
- The four images build with `podman` from this change; each runs `/nodejs/bin/node` v26.12.1 as
  `nonroot`; argon2 round-trips in the API image; the API and workers `CMD` entries resolve their
  module graph and stop at the environment validation; both portal images answer 200 on
  `/api/health` and `/` and pass `podman healthcheck run`; and Trivy, with the gate's flags, finds
  no HIGH or CRITICAL vulnerability in any of them.
- Build and runtime both run 26.12.1, so the Consequence "Build and runtime differ by one minor" no
  longer holds (SB-237 in `docs/reports/review-suggestions-book.md`).
- The engines gate reads 101 manifests at `>=26.12.1 <27`, runtime 26 and `@types/node` 26.6.5;
  `pnpm install --frozen-lockfile --offline` exits 0 under Node 26.11.1, below the new floor, with
  no warning and no lockfile change, as Context item 5 measured for Node 24; `pnpm check:legal`,
  `pnpm check:support`, the holds gate (52 packages, 0 undocumented) and the watchlist check pass.

**What no gate saw.** Trivy reports an image's Debian packages and its `node_modules` manifests,
never the `node` executable, so the `Container Security` gate stayed green from 2026-10-21 over
images that ran v26.12.0 (SMELL-207 in `docs/reports/roadmap-detected-smells-backlog.md`).

**The re-check.** The watchlist's date entry `contract-0.16-node-26`, still due 2026-10-28,
carries a dated reference to this amendment: that review also confirms that 26.12.1 is mature,
that no newer 26.x security release is out, and that CI and both image stages run it.

## Legal impact

None: the runtime version changes. No personal data, cookie or storage key, OAuth scope, recipient,
retention period, acceptance record or controller role changes, and the legal inventories record no
runtime version.

## Support impact

`none for node-26-ahead-of-lts — no support document under docs/support/ lists the paths this
decision touches (.nvmrc, the workspace manifests, pnpm-workspace.yaml, the four Dockerfiles, .github/)`

## Deployment impact

- `docs/deployment/DEPLOYMENT_CHECKLIST.md — added: Node.js 26 and pnpm 12.6.0` (Infrastructure):
  every `pnpm` command an operator runs needs that runtime.
- The base images change in both stages of the four Dockerfiles, recorded in
  `docs/deployment/base-images.md` (§"Moved to Node 26 on 2026-10-15", §"pnpm in the build stage").
  The `Container Security` job builds, runs and scans the new images on every pull request; no
  repository variable or secret, runtime variable or external account changes.
- The amendment of 2026-10-22:
  `docs/deployment/DEPLOYMENT_CHECKLIST.md — updated: Node.js 26 and pnpm 12.6.0` (operators need
  v26.12.1 or a later 26.x; `engines.node` `>=26.12.1 <27`); both stages of the four Dockerfiles,
  recorded in `docs/deployment/base-images.md` (§"Moved to Node 26.12.1 on 2026-10-22"). No
  repository variable or secret, runtime variable or external account changes.

## Revisit if

- **2026-10-28**, the watchlist's date entry: confirm Node 26's promotion to Active LTS; re-read the
  `gcr.io/distroless/nodejs26-debian13` `latest` index digest and its `var/lib/dpkg/status.d`
  against `456bd22a` (the pin since 2026-10-22; `746f728c` before); re-measure the build stage's
  26.x, the `setup-node` resolution, the `engines.node` floor and `@types/node`; read Prisma's
  support statement.
- A 26.x security release: a floor, taken immediately (ADR-0036), in the build stage, the distroless
  digest and, when CI must not resolve below it, the `engines.node` floor.
- Prisma, or a production dependency, states Node 26 unsupported, or fails on it.
- Node moves 26's LTS date.
- A stable Storybook 11 is published (it calls `module.registerHooks()` on Node 26): move the
  family to it and drop `--disable-warning=DEP0205` from `apps/client`'s `test:stories`, with the
  story run measured free of DEP0205 without the flag.
- pnpm's release stops being immutable, or pnpm publishes its own checksums.

## Risks and Mitigations

| Risk                                                      | Mitigation                                                                                                                               |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| A defect in a Current release reaches production          | Thirteen days to the LTS promotion of the same line; security releases are taken immediately; the re-check on 2026-10-28                 |
| Prisma does not test Current                              | Prisma's engines admit 26; the integration tier runs on 26; the re-check reads Prisma's statement                                        |
| A Node 24 process installs or tests the tree              | The engines gate exits 1 on another major than `.nvmrc`, in CI and in the battery; `pnpm install` does not refuse it (no `engineStrict`) |
| The pnpm asset changes after the pin                      | The release is immutable, and `sha256sum -c` fails the build on any other bytes                                                          |
| The runtime digest goes stale                             | Dependabot tracks it; the re-check re-reads it; base-images.md item 3 moves the four together                                            |
| An operator runs `pnpm` on Node 24                        | The checklist row names the check, `node --version`, because pnpm installs on Node 24 without a warning                                  |
| The distroless image carries a newer minor than the build | N-API addons; the `Container Security` smoke runs every image and the API's argon2 round trip                                            |

## References

- Node.js: [release schedule](https://github.com/nodejs/Release/blob/main/schedule.json) (v24
  Maintenance 2026-10-20, v26 LTS 2026-10-28); [distribution history](https://github.com/nodejs/node/pull/61207),
  nodejs/node#61207, "no longer distributed as of Node.js v25.0.0" for corepack;
  [`actions/node-versions` manifest](https://github.com/actions/node-versions/blob/main/versions-manifest.json)
- Prisma: [system requirements](https://www.prisma.io/docs/orm/reference/system-requirements)
- pnpm: [release v12.6.0](https://github.com/pnpm/pnpm/releases/tag/v12.6.0), immutable, asset
  digests `3f4c66f6…` (`pnpm-linux-x64.tar.gz`) and `973af2b3…` (`pnpm-linux-arm64.tar.gz`)
- Images: `docker.io/library/node:26.11.1-bookworm-slim@sha256:86f07bc9c5dce4578cf37e5a418b7bfc7f817cda25cde66e2b66e95ed86c4567`;
  `gcr.io/distroless/nodejs26-debian13@sha256:746f728c8b61c9beb5d0350f054b4049c4cef0ae71d5b3f8f33bc57904bbc37e`;
  since 2026-10-22, `docker.io/library/node:26.12.1-bookworm-slim@sha256:28147155d47dc31abe0a46e0d12b59b2fb3d0a2dcc5dc65fce76a074180b16fe`
  and `gcr.io/distroless/nodejs26-debian13@sha256:456bd22a48bc4b8b82b19041d7d9ff9c14e4ff0b80ea32c0b912be2f8288dbf7`
- Node.js 26.12.1: [release notes](https://nodejs.org/en/blog/release/v26.12.1);
  [security releases of 2026-10-21](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases);
  nodejs/node#66767 and its revert, nodejs/node#66786
- Map: the surface map of the dependency catch-up, explorer N0, 2026-10-15; this change is its unit
  N2
- Docs: [base-images.md](../deployment/base-images.md); [DEPLOYMENT_CHECKLIST.md](../deployment/DEPLOYMENT_CHECKLIST.md);
  [SECURITY_CANON.md](../security/SECURITY_CANON.md) row `@types/node`
- Code: `scripts/testing/engines-node-gate.mjs`; `scripts/testing/maturity-watchlist.json`, entries
  `contract-0.16-node-26` and `@types/node@26.6.5`; `NODE_TEST_EXEC_ARGV` in
  `packages/vitest-shared/src/index.ts`
- Upstream: Tailwind CSS 4.3.1 changelog, "Remove deprecation warnings by using
  `Module#registerHooks` instead of `Module#register` on Node 26+"; Node.js CLI,
  [`--no-experimental-webstorage`](https://nodejs.org/docs/latest-v26.x/api/cli.html)
- Branch: `workstream/node-26`; the amendment of 2026-10-22, `workstream/runtime-node-26-12-1`
