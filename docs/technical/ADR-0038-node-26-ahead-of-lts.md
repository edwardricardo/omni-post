# ADR-0038: Node 26 ahead of its LTS date

- **Status**: Accepted
- **Date**: 2026-10-15
- **Deciders**: Edward (owner)
- **Supersedes**: —
- **Superseded by**: —
- **Amends**: slice `0.16` of `openspec/changes/testing-refoundation/tasks.md` ("the runtime follows
  LTS, never Current") and its dating to 2026-10-28 by tracker decisions D46 and D51
- **Related**: [ADR-0017](ADR-0017-production-build-bundler.md) (the image build model);
  [ADR-0018](ADR-0018-dependency-freshness-canon.md) (the 7-day maturity buffer);
  [ADR-0036](ADR-0036-dependency-update-cadence.md) (security floors immediate, the Tuesday window);
  [ADR-0037](ADR-0037-storybook-nextjs-vite-patch-for-next-16-4.md) (the patch the four Dockerfiles
  copy); tracker decision D52 in [TESTING_REFOUNDATION.md](../development/TESTING_REFOUNDATION.md)

The runtime moves from Node 24 to Node 26 on 2026-10-15, thirteen days before Node 26 becomes Active
LTS on 2026-10-28. One change raises `.nvmrc`, the `engines.node` of all 101 manifests, the
`@types/node` pin, the CI setup and both stages of the four images. The owner accepts the risk of
running a Current release for those thirteen days, and the maturity watchlist re-checks the move on
2026-10-28.

## Context

1. **The plan.** Slice `0.16` moved the runtime on Node 26's Active LTS date, 2026-10-28, under the
   rule "the runtime follows LTS, never Current". Decisions D46 and D51 kept it a dated unit outside
   Phase 0, and the watchlist's date entry `contract-0.16-node-26` was due that day.
2. **The program.** On 2026-10-14 the owner started a dependency catch-up whose first rule is "Node
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
5. **Why one change.** Three facts tie every site together:
   - pnpm refuses to install a workspace whose projects' `engines.node` excludes the running Node,
     whatever `engineStrict` says, so the manifests and every place that installs move together;
   - the engines gate (`scripts/testing/engines-node-gate.mjs`) refuses a process on another major
     than `.nvmrc`, and a `@types/node` pin on another major;
   - Node 26 ships no corepack: it is "no longer distributed as of Node.js v25.0.0"
     (nodejs/node#61207), so `RUN corepack enable` in the four Dockerfiles and
     `corepack enable pnpm` in `dependency-updates.yml` stop working.

## Decision

The owner, 2026-10-14 (18:0x EDT): move to Node 26 now, document the early move, and re-check the
package state on 2026-10-28.

1. **Runtime.** `.nvmrc` holds `26`; `engines.node` is `>=26.11.1 <27` in the root `package.json` and
   in the other 100 workspace manifests.
2. **Types.** `@types/node` moves to the 26 line: 26.6.5, `latest`, taken inside the 7-day buffer under
   the owner's 72-hour rule (it matures 2026-10-16T18:46Z), with a maturity watchlist entry.
3. **Images.** The build stage of all four Dockerfiles is
   `node:26.11.1-bookworm-slim@sha256:86f07bc9c5dce4578cf37e5a418b7bfc7f817cda25cde66e2b66e95ed86c4567`; the production stage is
   `gcr.io/distroless/nodejs26-debian13@sha256:746f728c8b61c9beb5d0350f054b4049c4cef0ae71d5b3f8f33bc57904bbc37e`, the `latest` index (v26.12.0), still run
   as `USER nonroot`.
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
  no longer crashes on child stdout that mimics a V8 frame, the class of DEF-83 in `MASTER_PLAN_ES.md`.
- **The release asset, not npm.** pnpm 12's npm package is a launcher whose install step places the
  same native executable from its `@pnpm/exe.<platform>` optional dependencies, so both routes run
  one binary. The release route pins it by digest in the Dockerfile; the npm route trusts the
  registry at build time with no local pin.
- **`.nvmrc` as the action's default.** Seventeen call sites of the shared action pass no version.
  Reading `.nvmrc` ties them to the file the engines gate reads, so the next major moves them
  without an edit.

## Alternatives Considered

- **Wait for the LTS date.** The original plan. Rejected by the owner: every unit of the catch-up
  until 2026-10-28 would be certified on Node 24 and certified again after the move, while Node 24
  enters Maintenance on 2026-10-20.
- **Move only CI.** Rejected: CI on 26 needs `engines.node` at 26, which a Node 24 image build cannot
  install, and production would run a major the tests never ran on.
- **Move only the images.** Rejected for the mirror reason: an image on 26 cannot install manifests
  that declare 24, and the tests would run on a major production does not use.
- **`npm install -g pnpm@12.6.0` or `npm install -g corepack` in the images.** Rejected: the same
  binary or one more moving part, with no digest pinned in the tree (Rationale).

## Consequences

- **Every install needs Node 26 from this commit.** A Node 24 process cannot install the tree: local
  work runs under `fnm exec --using 26.11.1` until the fnm default moves after merge, every live
  worktree reinstalls, and a branch on the Node 24 base installs under 24 until it is rebased.
- **Operators** need Node 26 and pnpm 12.6.0 wherever they run `pnpm` (migrations, the app role):
  a new Infrastructure row in `docs/deployment/DEPLOYMENT_CHECKLIST.md`.
- **Build and runtime differ by one minor**: 26.11.1 builds, 26.12.0 runs. The distroless repository
  has no version tags, and the N-API addons do not depend on the minor.
- **Production runs a release Prisma does not test** until 2026-10-28. The re-check reads Prisma's
  statement again.
- **`setup-node` follows the 26 line.** When the `actions/node-versions` manifest lists 26.12.0, CI
  moves to it inside the major; the floor stays 26.11.1 until a change raises it.
- **Two watchlist reviews** for `@types/node` 26.6.5: 2026-10-16, at its maturity, and 2026-10-23, entered by the follow-up commit once this change has its sha and PR number, the convention of every entry in that file.
- **The build stage is pinned by digest**, so Dependabot now tracks both `FROM` lines of each
  Dockerfile.
- **Records moved with it:** the canon row `@types/node` in `docs/security/SECURITY_CANON.md`;
  `docs/deployment/base-images.md`; the stated runtime in `CLIENT-APP.md`, `DEPENDENCIES.md` and
  `DEPENDENCIES_ES.md`, the two standards documents, both investor documents and
  `TESTING_INFRASTRUCTURE.md`; slice `0.16` in `tasks.md`, `TESTING_REFOUNDATION.md` and
  `MASTER_PLAN_ES.md`.

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

## Revisit if

- **2026-10-28**, the watchlist's date entry: confirm Node 26's promotion to Active LTS; re-read the
  `gcr.io/distroless/nodejs26-debian13` `latest` index digest and its `var/lib/dpkg/status.d`
  against `746f728c`; re-measure the build stage's 26.x, the `setup-node` resolution, the
  `engines.node` floor and `@types/node`; read Prisma's support statement.
- A 26.x security release: a floor, taken immediately (ADR-0036), in the build stage, the distroless
  digest and, when CI must not resolve below it, the `engines.node` floor.
- Prisma, or a production dependency, states Node 26 unsupported, or fails on it.
- Node moves 26's LTS date.
- pnpm's release stops being immutable, or pnpm publishes its own checksums.

## Risks and Mitigations

| Risk                                                      | Mitigation                                                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| A defect in a Current release reaches production          | Thirteen days to the LTS promotion of the same line; security releases are taken immediately; the re-check on 2026-10-28 |
| Prisma does not test Current                              | Prisma's engines admit 26; the integration tier runs on 26; the re-check reads Prisma's statement                        |
| A Node 24 process installs or tests the tree              | pnpm refuses the install; the engines gate refuses a process on another major than `.nvmrc`                              |
| The pnpm asset changes after the pin                      | The release is immutable, and `sha256sum -c` fails the build on any other bytes                                          |
| The runtime digest goes stale                             | Dependabot tracks it; the re-check re-reads it; base-images.md item 3 moves the four together                            |
| An operator runs `pnpm` on Node 24                        | The checklist row; pnpm refuses the install and names the engines range                                                  |
| The distroless image carries a newer minor than the build | N-API addons; the `Container Security` smoke runs every image and the API's argon2 round trip                            |

## References

- Node.js: [release schedule](https://github.com/nodejs/Release/blob/main/schedule.json) (v24
  Maintenance 2026-10-20, v26 LTS 2026-10-28); [distribution history](https://github.com/nodejs/node/pull/61207),
  nodejs/node#61207, "no longer distributed as of Node.js v25.0.0" for corepack;
  [`actions/node-versions` manifest](https://github.com/actions/node-versions/blob/main/versions-manifest.json)
- Prisma: [system requirements](https://www.prisma.io/docs/orm/reference/system-requirements)
- pnpm: [release v12.6.0](https://github.com/pnpm/pnpm/releases/tag/v12.6.0), immutable, asset
  digests `3f4c66f6…` (`pnpm-linux-x64.tar.gz`) and `973af2b3…` (`pnpm-linux-arm64.tar.gz`)
- Images: `docker.io/library/node:26.11.1-bookworm-slim@sha256:86f07bc9c5dce4578cf37e5a418b7bfc7f817cda25cde66e2b66e95ed86c4567`;
  `gcr.io/distroless/nodejs26-debian13@sha256:746f728c8b61c9beb5d0350f054b4049c4cef0ae71d5b3f8f33bc57904bbc37e`
- Map: the surface map of the dependency catch-up, explorer N0, 2026-10-15; this change is its unit
  N2
- Docs: [base-images.md](../deployment/base-images.md); [DEPLOYMENT_CHECKLIST.md](../deployment/DEPLOYMENT_CHECKLIST.md);
  [SECURITY_CANON.md](../security/SECURITY_CANON.md) row `@types/node`
- Code: `scripts/testing/engines-node-gate.mjs`; `scripts/testing/maturity-watchlist.json`, entries
  `contract-0.16-node-26` and `@types/node@26.6.5`
- Branch: `workstream/node-26`
