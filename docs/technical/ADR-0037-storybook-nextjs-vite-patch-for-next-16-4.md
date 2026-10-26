# ADR-0037: A patched `@storybook/nextjs-vite` 10.6.1 for next 16.4, until Storybook 10.6.3

- **Status**: Accepted (resolved 2026-10-21 — the Storybook family moved to 10.6.3, which carries
  #36732, and the patch, its record and the Dockerfiles' `COPY patches/` left with it; issue #666)
- **Date**: 2026-10-15
- **Deciders**: Edward (owner)
- **Supersedes**: —
- **Superseded by**: —
- **Related**: [ADR-0018](ADR-0018-dependency-freshness-canon.md) (exact pins and the 7-day
  buffer); [ADR-0019](ADR-0019-pnpm-11-migration.md) (the `@secretlint/node` patch removed on
  2026-10-03, and the Dockerfiles' `COPY patches/` removed with it);
  [ADR-0035](ADR-0035-stories-part-of-creating-ui.md) (a failing story is a defect, never skipped);
  [ADR-0036](ADR-0036-dependency-update-cadence.md) (security floors are immediate)

The client stories run on a patched `@storybook/nextjs-vite` 10.6.1 until Storybook publishes
10.6.3. The patch is Storybook's own merged fix, storybookjs/storybook#36732: five lines in one
built file. It exists because next 16.4.1, a security floor, breaks the framework's App Router mock.
The maturity watchlist reviews it every two or three days, and it leaves with the family's move to
10.6.3.

## Context

1. **The floor.** next 16.4.1 is the minimal patched release for GHSA-673q-mjm6-r5xr and
   GHSA-2464-fhr4-w9xw (critical) and GHSA-p3m5-59mp-jv5r (high), `vercel/next.js` repository
   advisories of 2026-10-14. The high is reachable through the login and register Server Actions of
   both portals, and the second critical through Image Optimization (`SECURITY_CANON.md`, row `next`
   and its note). ADR-0036 takes a security floor immediately.
2. **The break.** On next 16.4.1 every client story fails. The battery step `stories` of `864af28b`,
   the floor commit, run at 2026-10-14T20:21Z, reports `Test Files 9 failed (9)` and
   `Tests 68 failed (68)`, each with `TypeError: Cannot read properties of undefined (reading 'data')`
   in next's `useRouter` (`next/dist/client/components/navigation.js:158`), called by next's
   `RedirectBoundary`.
3. **The cause.** next 16.4 reads the router's `bfcacheId` from
   `layout?.parentRenderTree.data.bfcacheId`, where 16.3.8 read `layout?.parentCacheNode.bfcacheId`
   (`navigation.js:162`): the `LayoutRouterContext` value now carries the render tree, which keeps
   its node under `.data`. `@storybook/nextjs-vite` 10.6.1 mocks that context in `AppRouterProvider`
   (`dist/_browser-chunks/chunk-342N7CWU.js:105-125`) with `childNodes`, `tree`, `parentTree`,
   `parentCacheNode`, `url` and `loading`, and no `parentRenderTree`. With
   `parameters.nextjs.appDirectory: true` (`apps/client/.storybook/preview.tsx`), the framework's
   `RouterDecorator` wraps every story in that provider and in next's real `RedirectBoundary`, which
   calls the real `useRouter`, so a story fails whether or not its component navigates.
4. **Upstream fixed it and has not published the fix.** Read on 2026-10-15 between 00:56Z and 01:00Z:

   | Item                                                 | State                                                                                                                          |
   | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
   | Issue #36720                                         | closed 2026-10-13T14:03:50Z                                                                                                    |
   | PR #36732, `@storybook/nextjs-vite`                  | merged into `next` 2026-10-13T14:03:48Z, merge commit `8d47b13d`                                                               |
   | PR #36588, the webpack framework `@storybook/nextjs` | merged 2026-10-14T09:03:25Z, merge commit `7213a660`; that framework is not in this tree                                       |
   | PR #36762, "Release: Patch 10.6.3"                   | open since 2026-10-13T14:07:10Z; its changelog lists both PRs, and its head `ab9ce2b0` carries #36732's change unchanged       |
   | npm                                                  | `latest` 10.6.2 (2026-10-12T18:22Z) and `next` 11.0.0-alpha.6 (2026-10-12T16:46Z): neither tarball contains `parentRenderTree` |
   | Canary builds                                        | none: npm lists no version built from either PR                                                                                |

5. **The rule.** CLAUDE.md §Problem-Solving Standards forbids a temporary patch. An exception needs
   the owner's decision, and this ADR records it.

## Decision

The owner, 2026-10-15: _"Patch today, well documented, under constant review until it is resolved —
add it to the watchlist until then."_

1. **One patched dependency**: `@storybook/nextjs-vite@10.6.1`, through pnpm's
   `patchedDependencies` in `pnpm-workspace.yaml`, file `patches/@storybook__nextjs-vite@10.6.1.patch`.
2. **The patch is upstream's change and nothing else.** #36732 adds one property to the
   `LayoutRouterContext` value of `AppRouterProvider`, after `parentCacheNode` and before `url`,
   with its comments, and touches no other context (`GlobalLayoutRouterContext` is unchanged). The
   patch adds the same five lines at the same place of the built file,
   `dist/_browser-chunks/chunk-342N7CWU.js`, the only file of the package that holds the mock:

   ```js
             // START Next.js v16.4 support
             // eslint-disable-next-line @typescript-eslint/ban-ts-comment
             // @ts-ignore Only available in Next.js >= v16.4.0
             parentRenderTree: { data: { bfcacheId: 0 } },
             // END
   ```

   The blank line the source has before `// START` is absent because the 10.6.1 build drops blank
   lines and keeps comments, as its own `// START Next.js v15.2 support` block shows.

3. **Constant review.** The maturity watchlist carries a `date` entry,
   `patch-storybook-nextjs-vite-10.6.3`, due 2026-10-17. Each review reads npm for 10.6.3 and the
   state of #36762. A review that finds 10.6.3 unpublished records outcome `flagged` with what it
   read, and adds the next `date` entry, due two or three days later, with the id
   `patch-storybook-nextjs-vite-10.6.3-<due>`. The chain ends with the review that finds 10.6.3
   published, which names the change that moves the family.
4. **The images copy `patches/`.** pnpm reads every file `patchedDependencies` names on each install,
   whether or not that install resolves the patched package, so the four Dockerfiles copy `patches/`
   beside `pnpm-workspace.yaml` before their `pnpm install`, as they did until 2026-10-03 (ADR-0019).

## Rationale

- **The floor protects production; the patch touches a test mock.** Holding next at 16.3.8 keeps a
  reachable high and two criticals in both portals to keep a development-only story run green.
  `@storybook/nextjs-vite` is a devDependency of `apps/client` alone, and no runtime image carries
  it: the portals ship `.next/standalone`, which holds only what the application imports.
- **Equivalent to a merged fix, so nothing is invented here.** A reviewer compares five lines with
  #36732. The release branch of 10.6.3 carries the same change, so the move to 10.6.3 replaces the
  patch with the same code.
- **It fails closed.** Read in pnpm 12.6.0's source (`dist/pnpm.mjs`) and measured on 2026-10-15
  (Consequences):
  - The key names an exact version. A family move edits the catalog, which marks the lockfile's
    `catalogs` setting stale and forces a full resolution (`getOutdatedLockfileSetting`), and a full
    resolution refuses a key that matched no package (`verifyPatches`, `ERR_PNPM_UNUSED_PATCH`;
    `allowUnusedPatches` is false by default and unset here). The family cannot move past 10.6.1
    while the entry stands.
  - A patch that no longer applies fails the install (`ERR_PNPM_PATCH_FAILED`).
  - The lockfile records the patch's hash, so an edited patch file fails
    `pnpm install --frozen-lockfile`, which CI runs, until the lockfile is regenerated with it.
- **A watchlist entry, not a calendar note.** The maturity reminder workflow opens an issue on the
  due day, and `maturity-watchlist.mjs --check` fails CI on a review more than three days overdue,
  so a review cannot lapse unnoticed.

## Alternatives Considered

- **Wait for 10.6.3.** Rejected: it is unpublished, with no date. Meanwhile the floor either waits,
  keeping the advisories open, or lands over 68 failing stories, which ADR-0035 calls a defect.
- **`appDirectory: false`.** Rejected. CODING_STANDARDS.md (§"React component JSDoc — props on the
  interface", its Storybook note) requires `appDirectory: true` for App Router components that use
  `next/navigation`. No component with a story imports `next/navigation` today, so the 68 stories
  would pass, but 17 files of `apps/client` import it (`lib/auth/authContext.tsx` among them), and
  the first story of a component that reads it would render against the Pages Router mock. It also
  trades a deviation in a dependency for one in the project's own configuration.
- **A decorator in `preview.tsx`.** Impossible: `RouterDecorator` renders its own
  `LayoutRouterContext.Provider` directly around `RedirectBoundary`, and React resolves a context to
  its nearest provider, so a value from any project decorator is shadowed. By default
  (`reverseFileOrder`) the framework's decorator is also the outermost.
- **A canary build.** None exists for #36732 or #36588.
- **`@storybook/nextjs-vite` 10.6.2 or 11.0.0-alpha.6.** Rejected: neither tarball carries the fix,
  and 11.x is a prerelease major.
- **Hold next at 16.3.8.** Rejected: ADR-0036's first point, security floors are immediate.

## Consequences

- One patched dependency, recorded in `docs/security/SECURITY_CANON.md` §"Patched dependencies".
  `pnpm-workspace.yaml` gains `patchedDependencies`, and the lockfile its mirror and the patch hash in
  the package's snapshot keys.
- The Storybook family (`storybook`, `@storybook/addon-a11y`, `@storybook/addon-docs`,
  `@storybook/addon-vitest`, `@storybook/nextjs-vite`, `@storybook/react`) stays at 10.6.1 until
  10.6.3: 10.6.2 carries no fix, and pnpm refuses a move while the entry stands.
- The four Dockerfiles copy `patches/` again.
- One watchlist review every two or three days until 10.6.3 is published.
- Measured on 2026-10-15 between 01:31Z and 01:35Z, one command at a time, on the floor branch
  (base `fa441443`):
  - `pnpm patch-commit` also recorded `template/next-env.d.ts` and `template/typings.d.ts` as
    deleted: it lists the edited package through its `files` field, which names only
    `template/cli/**/*`, while the tarball ships both files. Those two blocks were removed by hand,
    so the patch is one hunk of five added lines, and the installed package differs from the
    registry tarball of 10.6.1 by exactly those lines (`diff -r`).
  - Parsed with `yaml.safe_load_all`, the lockfile changes only in its `patchedDependencies` mirror
    (hash `2a3b0748…`, the sha256 of the patch file), in the one `@storybook/nextjs-vite` snapshot
    key, which gains `(patch_hash=…)`, and in the `apps/client` importer that names it: 1958
    packages, 1962 snapshots and 102 importers before and after.
  - `pnpm install --frozen-lockfile --offline` exits 0. `pnpm --filter @apps/client test:stories`
    passes 68 of 68 tests in 9 files, where `864af28b` failed all 68. The client `storybook build`
    exits 0 with 77 index entries, 68 of them stories, and its iframe bundle carries
    `parentRenderTree`. `pnpm dedupe --check` exits 0, `pnpm audit --audit-level low` finds no known
    vulnerability (01:34:20Z), and `pnpm check:dead-code` reports 0 regressions.
  - Probed in a throwaway pnpm 12.6.0 workspace of two projects, `a` depending on a patched
    `is-number` 7.0.0 and `b` depending on nothing:
    - a frozen offline install of the root files and `b` alone, the shape of an image build,
      fails without `patches/` with
      `Failed to read patch file … No such file or directory`, and exits 0 with it;
    - moving the catalog to `is-number` 6.0.0 while the key stands fails with
      `ERR_PNPM_UNUSED_PATCH`;
    - an edited patch file fails the frozen install with
      `"patchedDependencies" configuration doesn't match the value found in the lockfile`.

## Legal impact

None: the test mock of a development dependency changes. No personal data, cookie or storage key,
OAuth scope, recipient, retention period, acceptance record or controller role changes, and no
runtime image carries the patched package.

## Support impact

`none for storybook-nextjs-vite-patch — no support document under docs/support/ lists the paths this
decision touches (pnpm-workspace.yaml, pnpm-lock.yaml, patches/, the four Dockerfiles)`

## Deployment impact

`none — no repository or runtime variable, external service or post-deployment check changes; the
four Dockerfiles copy patches/ as a build input before pnpm install, which no operator configures or
verifies`

## Revisit if

- Storybook publishes 10.6.3 without #36732, or closes #36762 unpublished: the patch then needs a
  new remove-when, and this ADR is amended.
- next changes `LayoutRouterContext` again: the patch provides only
  `parentRenderTree.data.bfcacheId`, and the stories would fail the same way.
- A story renders next's `LayoutRouter`, which reads `parentRenderTree.slots`
  (`layout-router.js:372`), a field neither upstream's mock nor the patch provides.
- A second dependency needs a patch: it gets its own ADR and its own entry in §"Patched
  dependencies", never a line in this one.

## Remove-when

`@storybook/nextjs-vite` 10.6.3 is published carrying #36732. The Storybook family's six catalog
members then move to 10.6.3 immediately on publication, not in the next weekly window: the move
closes the exception the next 16.4.1 floor needed, so it is taken as a security-tied deviation
inside the 7-day buffer (ADR-0018), and 10.6.3 enters the maturity watchlist, whose 7-day review is
its re-verification. That one change deletes `patches/@storybook__nextjs-vite@10.6.1.patch`, the
`patchedDependencies` entry and, when no other patch remains, the `COPY patches/` line of the four
Dockerfiles; it runs `pnpm --filter @apps/client test:stories` and the client `storybook build` on
the unpatched release, and the §"Patched dependencies" entry leaves with it. Until then the
watchlist reviews it: first due 2026-10-17, and every review that finds 10.6.3 unpublished records
`flagged` and adds the next entry two or three days later. pnpm enforces the order: while the entry
stands, a catalog move away from 10.6.1 fails the install with `ERR_PNPM_UNUSED_PATCH`.

## Risks and Mitigations

| Risk                                               | Mitigation                                                                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| A second patched dependency arrives without an ADR | §"Patched dependencies" lists every entry with its ADR; a `patchedDependencies` key with no entry there is a finding       |
| The patch masks an upstream change in 10.6.3       | The family move deletes the patch and re-runs the stories and the build on the unpatched release                           |
| The patch outlives its reason                      | A watchlist review every two or three days; `ERR_PNPM_UNUSED_PATCH` on the family move                                     |
| The patch file is edited without the lockfile      | The lockfile carries its hash; CI's frozen install refuses the mismatch                                                    |
| An image build cannot read the patch               | The four Dockerfiles copy `patches/`; the Container Security job builds all four images on every pull request              |
| Reviews lapse                                      | `maturity-watchlist.mjs --check` fails CI on a review more than three days overdue; the reminder opens an issue on the day |

## References

- Upstream: issue [storybookjs/storybook#36720](https://github.com/storybookjs/storybook/issues/36720);
  [PR #36732](https://github.com/storybookjs/storybook/pull/36732), merge commit
  `8d47b13d65ae9fc0544e9852073dd0eae3f6b959`; [PR #36588](https://github.com/storybookjs/storybook/pull/36588),
  merge commit `7213a660a4b50fc769aa46b450ac223599b51868`; release
  [PR #36762](https://github.com/storybookjs/storybook/pull/36762), head `ab9ce2b00d250a06afd0fc6c728c11d9ccc97c76`
- Evidence: the battery log of `864af28b`, `.claude/state/battery-logs/864af28b8f7e2af8479ebfaffac74810fd9d1e5c/stories.log`
  (local, untracked)
- Canon: [SECURITY_CANON.md](../security/SECURITY_CANON.md) §"Patched dependencies", row `next` and
  its note
- Standards: [CODING_STANDARDS.md](../development/CODING_STANDARDS.md) (§"React component JSDoc — props on the
  interface"); [ADR-0035](ADR-0035-stories-part-of-creating-ui.md)
- pnpm 12.6.0 source, `dist/pnpm.mjs`: `calcPatchHashes`, `verifyPatches`,
  `getOutdatedLockfileSetting`, `applyPatchToDir`
- Watchlist: `scripts/testing/maturity-watchlist.json`, entry `patch-storybook-nextjs-vite-10.6.3`
- Branch: `workstream/next-16-4-1-floor`
