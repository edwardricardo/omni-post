# Testing Re-foundation — Measurements

The toolchain-lag and OSV measurements of the Testing Re-foundation; the tracker is [TESTING_REFOUNDATION.md](TESTING_REFOUNDATION.md).

**Owner:** Platform engineering

## Toolchain lag (WU-T.4a)

**BASELINE — the state this workstream started from, not the state of the tree; the current counts are in the re-measure two paragraphs below. Measured 2026-09-27T17:55:14Z: fifty-one npm packages, plus one containerised tool with no version to
measure. Forty-five packages sit below their latest-mature target; five of those lags carry a documented hold
row, one is ambiguously covered, and THIRTY-NINE carry NO HOLD — that last set is exactly what the
holds gate of WU-T.4(f) goes red on until each one gets a row or a bump. Five crossings may not ride
inside a family pull request, and one of them is larger than the plan recorded: the DOM
implementation's major is blocked by a _blanket_ `tough-cookie` override that nobody had connected to
it.**

The 52 rows below account for themselves: 45 lags (39 unheld + 5 held + 1 ambiguous), 5 packages
already at their latest mature, 1 candidate that is not installed at all, and k6, whose floating
container tag makes the maturity rule inapplicable rather than satisfied.

**CURRENT, re-measured 2026-10-15T18:47:25Z by `node scripts/testing/holds-gate.mjs` under Node 26.11.1,
exit 0 with EMPTY stderr: of the 51 packages in `scripts/testing/toolchain-population.json` (50 direct, 1
named transitive, no declared-absent candidate left), 10 sit below latest mature: 1 within the 30-day
budget of ADR-0036, 0 past it unheld, 9 held.**

The count's history, one measurement per line, oldest first — the instant, the number below latest mature,
and what moved it. A slice that moves the count appends its own line.

1. `2026-09-27T17:55:14Z` — **45** (39 unheld, 5 held, 1 ambiguous): the baseline in the paragraph above,
   measured before any slice.
2. `2026-09-27T23:10:56Z` — **41**: after `refound/0-toolchain-holds` wrote the fifteen missing hold rows
   and `refound/0-toolchain-eslint` took the first bump — `eslint` and `@eslint/js` to 9.39.5, the
   `@typescript-eslint` pair to 8.70.0, which dropped the pair out of the set. The run recorded the fall as
   the bump's: a row makes a lag legal, never absent.
3. `2026-09-27T23:57:09Z` — **41**: re-derived after `refound/0-holds-table-fix` corrected the table the
   rows live in; no version moved.
4. `2026-09-28T02:42:36Z` — **41**: slice `0.5` pinned `@types/node` from 25.9.3 to 24.13.6, a HELD lag
   both before and after. A package moved to its own line's ceiling leaves the lag set only when that
   ceiling IS the generic comparator (26.6.2 here), which for a downward pin it never is.
5. 2026-09-30, instant not recorded — **43**, then **41**: the repair slice `0.17` found the
   `@typescript-eslint` pair back in the set, because it matured at `2026-09-28T17:09Z` (the clock class
   this workstream keeps meeting), and took it out again by bumping the pair to 8.70.1.
6. 2026-10-02, instant not recorded — **40**: slice `0.21` took `eslint-plugin-boundaries` to its latest
   mature 7.2.0; slice `0.18`, rebased on top of it, moved no version.
7. `2026-10-02T07:24:51Z` — **39**: slice `0.6` took `tsx` 4.22.4 → 4.23.15, which IS the generic
   comparator, so the package leaves the set outright and its canon row is deleted with it.
8. `2026-10-02T07:39:28Z` — **38**: slice `0.8` took `msw` 2.14.6 → 2.15.0, the latest mature release, so
   the package leaves the set and its canon row is deleted with it.
9. `2026-10-02T09:30:50Z` — **36**: slice `0.7` took `@playwright/test` 1.61.1 → 1.63.0 and
   `@axe-core/playwright` 4.10.2 → 4.13.0, both the latest mature release. One canon row covered both, but
   the set counts packages, so retiring that row removed two lags.
10. `2026-10-02T09:40:50Z` — **32**: slice `0.9` took the testing-library family to its latest mature
    releases — `dom` 10.4.2, `jest-dom` 7.0.1, `react` 16.3.3, `user-event` 14.6.7 — and retired the one
    canon row that covered all four, so four lags left together.
11. `2026-10-02T10:13:15Z` — **27**: slice `0.11` took the Storybook family 10.4.6 → 10.6.0, the latest
    mature release, so its four packages left the set, and removed `@storybook/test-runner`, a held lag, so
    the population shrank 52 → 50 (the runner and the `jest` absence entry) and five lags left together.
12. `2026-10-02T20:43:59Z` — **25**: slice `0.12` took `jsdom` 29.1.1 → 30.1.1 and `isomorphic-dompurify`
    3.19.0 → 4.4.0, both the latest mature release, under human gate H1; the canon row `jsdom`, which held
    both, was deleted with them. Slice `0.13` had re-measured **27** at `18:53Z` without moving a version.
13. `2026-10-03T06:26:08Z` — **24**: the dead-devDependency removal ([D35](#decisions-log)) took
    `@ast-grep/cli`, a held lag, out of the tree, together with `@hey-api/client-fetch` and `loadtest`, both
    at latest, so the population shrank 50 → 47 and one lag left; the canon row `knip` lost that one name.
14. `2026-10-03T09:06:43Z` — **22**: slice (iii) took `secretlint` and its preset 12.3.1 → 13.0.6, the
    latest mature release ([D38](#decisions-log)), so both left the set and the canon row `knip` lost
    their two names.
15. `2026-10-03T10:03:06Z` — **21**: slice (iv) took `jscpd` 4.0.8 → 5.3.2, the latest mature release
    ([D39](#decisions-log)), so it left the set and the canon row `knip` lost its name.
16. `2026-10-04T05:07:09Z` — **15**: slice `0.14` took the build and format six to their latest mature
    releases — `vite` 8.0.16 → 8.3.1, `turbo` 2.9.16 → 2.11.4, `webpack` 5.106.2 → 5.111.1, `cross-env`
    10.0.0 → 10.1.0, `jiti` 2.6.1 → 2.7.0, `prettier` 3.9.5 → 3.9.9 — and deleted the canon row that held all
    six, so six lags left together; `vite` and `turbo` carry PRE-REGISTERED rows for the releases still inside
    the buffer.
17. `2026-10-04T05:41:03Z` — **9**: slice `0.15` took five quality-gate tools, six packages (`size-limit`
    and its preset move as one), to their latest mature releases — `knip` 6.12.2 → 6.38.0, `size-limit` and
    its preset 12.1.0 → 14.0.1, `lint-staged` 16.4.0 → 17.6.0, `@hey-api/openapi-ts` 0.97.3 → 0.99.0,
    `@faker-js/faker` 10.5.0 → 10.6.0 — and replaced the canon row that held them with what still lags, so
    six lags left together. `dependency-cruiser` kept a row of its own until item (v) of the replacement
    plan moved it to 18.4.0 on 2026-10-05 (`PR v`); since then that row is the PRE-REGISTERED hold until
    18.5.0 matures on `2026-10-07T19:18Z`, taken as a hold-bump PR. `knip` and `size-limit` carry
    PRE-REGISTERED rows: a newer release of each is already published and becomes the latest mature one
    when it leaves the 7-day buffer.
18. `2026-10-04T19:00:54Z` — **9**: `size-limit@14.1.0` matured at `13:10Z`, which raised the count to
    **11** (measured `18:59:12Z`, both packages held by their PRE-REGISTERED row); the bump of `size-limit`
    and its preset 14.0.1 → 14.1.0 took them back out, and their canon row and watchlist date entry were
    deleted with it.
19. `2026-10-06T13:37:20Z` — **12**: the hold bump took `jscpd` 5.3.2 → 5.3.3, the latest mature release, so
    it left the set; the same run with 5.3.2 installed measures **13** over 50 packages. Since line 18,
    `turbo` 2.11.5, `jscpd` 5.3.3 and `msw` 3.0.0 matured, each held by its row; PR C of slice `0.22`
    enrolled `@vitest/browser` and `@vitest/browser-playwright` at 4.1.11, held by the `vitest` row, with
    `@storybook/addon-vitest` and `@storybook/nextjs-vite` at latest mature and `playwright` now direct; and
    item (v) took `dependency-cruiser` to 18.4.0. The canon row `jscpd` is now the PRE-REGISTERED hold until
    5.4.0 matures on `2026-10-07T18:11Z`.
20. `2026-10-06T20:39:02Z` — **12**: the hold bump took the Storybook family, six packages, 10.6.0 → 10.6.1,
    the latest mature release, so all six left the set and the canon row `storybook` was deleted with them
    ([D25](#decisions-log)); 10.6.1 is `latest` and only 11.0.0 prereleases are newer, so nothing is
    pre-registered. The same gate with 10.6.0 installed measures **18** at `20:35:39Z`: the six matured
    between `17:14Z` and `17:20Z`, each held by that row until the bump. Since line 19 the population fell
    50 → 49: the admin Storybook removal (slice `0.22`, PR D) took `@storybook/nextjs` and `webpack` out,
    neither a lag, and PR E enrolled `@storybook/react` at 10.6.0, a lag held by that row from the moment
    its 10.6.1 matured at `17:19Z`.
21. `2026-10-07T15:27:33Z` — **12**: the hold bump took `knip` 6.38.0 → 6.39.0, the latest mature release,
    so it left the set; the same gate with 6.38.0 injected through `--installed` measures **13** at
    `15:22:47Z`, because 6.39.0 matured at `12:46Z` and the canon row `knip` held it until the bump. Since
    line 20 the population and the twelve lagging packages are unchanged; only targets moved inside held
    lags: the `vitest` family's 5.0.3 matured at `11:30Z` and `msw` 3.0.1 at `12:39Z`, each still held by
    its row. The canon row `knip` is now the PRE-REGISTERED hold until 6.40.0 matures on
    `2026-10-13T16:07Z`.
22. `2026-10-07T18:16:09Z` — **12**: the hold bump took `jscpd` 5.3.3 → 5.4.0, the latest mature release
    and also `latest`, so it left the set; the same gate with 5.3.3 still installed measures **13** at
    `18:12:08Z`, because 5.4.0 matured at `18:11Z` and the canon row `jscpd` held it until the bump. Since
    line 21 the population and the twelve lagging packages are unchanged, and no held target moved.
    Nothing newer than 5.4.0 is published, so nothing is pre-registered: the canon row `jscpd` was deleted
    with the bump, as [D25](#decisions-log) decided for the Storybook family.
23. `2026-10-07T19:20:17Z` — **12**: the hold bump took `dependency-cruiser` 18.4.0 → 18.5.0, the latest
    mature release and also `latest`, so it left the set; the same gate with 18.4.0 still installed measures
    **13** at `19:19:07Z`, because 18.5.0 matured at `19:18Z` and the canon row `dependency-cruiser` held it
    until the bump. Since line 22 the population and the twelve lagging packages are unchanged, and no held
    target moved. Nothing newer than 18.5.0 is published, so nothing is pre-registered: the canon row
    `dependency-cruiser` was deleted with the bump, as [D25](#decisions-log) decided for the Storybook family.
24. `2026-10-08T14:58:21Z` — **12**: the CVE floor took `vite` 8.3.1 → 8.3.3, above the latest mature 8.3.2,
    so it left the set; the same gate with 8.3.1 still installed measures **13** at `14:47:26Z`, because 8.3.2
    matured at `10:17Z` and the canon row `vite` held it until the bump. 8.3.2, the release that row had
    scheduled, is inside the range `>=8.3.0 <=8.3.2` of three `vitejs/vite` repository advisories that OSV
    and `pnpm audit` do not carry yet, so the pin took 8.3.3, the minimal patched version, 2.4 days after
    publication: a CVE floor taken over the buffer (CVE-floor row `vite`); its early-adoption entry in
    `scripts/testing/maturity-watchlist.json` lands in the follow-up commit of its pull request, once the
    number exists (the entry records the commit and the pull request, as #421 and #431 did). Since line 23 the population and the twelve lagging packages
    are unchanged; one held target moved: `turbo` 2.11.6 matured at `03:58Z`, still held by its row. The canon
    row `vite` is now the PRE-REGISTERED hold until 8.3.4 matures on `2026-10-15T12:07Z`.
25. `2026-10-10T04:04:04Z`, the secretlint hold bump — **12**: it took `secretlint` and its preset 13.0.6 → 13.0.7, the
    latest mature release and also `latest`, so both left the set; the same gate with 13.0.6 injected through
    `--installed` and `--outdated` measures **14** at `04:01:58Z`, because 13.0.7 matured at `01:06Z` and
    `01:07Z` and the canon row `secretlint` held both until the bump. Since line 24 the population and the
    twelve lagging packages are unchanged; four held targets moved, each still held by its row: `@types/node`
    26.6.4 matured at `2026-10-08T22:39Z`, `turbo` 2.11.7 at `2026-10-09T14:58Z`, `eslint` 10.12.0 at `20:08Z`
    the same day and `msw` 3.0.2 at `2026-10-10T01:31Z`. Nothing newer than 13.0.7 is published, so nothing
    is pre-registered: the canon row `secretlint` was deleted with the bump, as [D25](#decisions-log) decided
    for the Storybook family.
26. `2026-10-10T04:13:21Z` — **11**: the hold bump took `turbo` 2.11.4 → 2.11.7, the latest mature release and
    also `latest`, so it left the set; the same gate with 2.11.4 still installed measures **12** at `04:08:54Z`,
    because 2.11.7 matured at `2026-10-09T14:58Z` and the canon row `turbo` held it until the bump. Since line
    25 the population and the eleven other lagging packages are unchanged, and no held target moved. Per their
    release notes, 2.11.5 and 2.11.6 change how task inputs hash, so every turbo cache key moves once; the
    size-limit job's `turbo run build` exits 0 with 21 of 21 tasks run and none cached. Only 2.11.8 canaries are
    newer, so nothing is pre-registered: the canon row `turbo` was deleted with the bump, as
    [D25](#decisions-log) decided for the Storybook family. From 2.11.5 turbo writes a root `AGENTS.md`
    whenever it detects an AI agent, so the root `turbo.json` sets `"agentGuidance": false`, the switch
    its configuration reference documents: the repository keeps its documents under `docs/`.
27. `2026-10-11T09:39:34Z` — **11**: the hold bump took `jsdom` 30.1.1 → 30.1.2, the latest mature release and
    also `latest`, so it left the set; the same gate with 30.1.1 injected through `--installed` and
    `--outdated` measures **12** at `09:40:16Z` and exits 1 with `jsdom` as `lag: UNDOCUMENTED`, because
    30.1.2 (published `2026-10-04T09:15:00Z`) matured at `2026-10-11T09:15Z` and no canon row named it. That
    is the red the holds step of the `Dependency Consistency` job in `fitness.yml` gave `main`'s push run of
    `f73a8768`, the merge of #547, at `09:16:11Z`, and pull request #549 at `09:18:35Z`, where #547's own run
    had passed at `09:02:53Z`. #470's body, measured 2026-10-07, had announced the instant — "`jsdom` 30.1.2
    (matures 2026-10-11T09:15Z)", one of the four packages it said would turn the gate red before 2026-10-13
    with no row — and this bump answers it. OSV lists nothing for 30.1.2. Its release notes (the `v30.1.2`
    GitHub release; the repository root holds no `Changelog.md`) list fixes only, none a security fix: Unicode
    18.0.0 in internationalized domain names; smaller CSS property definitions; the slowdown building large
    DOM trees that v30.1.0 introduced; empty inherited CSS custom properties; stale `getComputedStyle()`
    results after stylesheet edits, and its throw for elements without inline style; selector matching after
    form-control state and focus changes; `element.focus()` on elements hidden by `display` or excluded by
    slot assignment; a window retained by stylesheet parsing after `window.close()`; `MutationObserver` memory
    growth; stale `select.selectedOptions`; negative CSS sizing values, a v30.1.0 regression; and nested
    `color-mix()`. They reach two surfaces here: the vitest `jsdom` environment of `apps/admin`,
    `apps/client`, `packages/query-client` and `packages/observability/browser-logger`, and the production
    sanitizer `apps/api > isomorphic-dompurify@4.4.0 > jsdom`, which parses markup into a DOM tree and so
    meets the tree-building fix; no note names HTML parsing or serialization. In the lockfile, parsed with
    `yaml.safe_load_all`, the bump moves jsdom's own subtree and nothing else, each move explained by a range
    30.1.2 raised: `data-urls` 7.0.0 → 8.0.0 (`^8.0.0`; its one release note is a `^22.14.0 || >=24.0.0` Node
    floor), `whatwg-url` 17.1.2 → 17.2.0 (`^17.2.0`, which needs `tr46 ^7.0.0`: 6.0.0 → 7.0.0, Unicode
    18.0.0), with `whatwg-url` 16.0.1 gone together with `data-urls` 7, `@exodus/bytes` 1.15.1 → 1.16.0
    (`^1.16.0`; `html-encoding-sniffer` 7.0.0, whose `^1.15.1` admits it, moved with it),
    `@asamuzakjp/dom-selector` 9.2.1 → 9.2.4, `@csstools/css-syntax-patches-for-csstree` 1.1.14 → 1.1.15, and
    `@asamuzakjp/css-color` 7.0.1 → 7.1.3, which takes `@csstools/css-calc` 3.4.3, `css-color-parser` 4.2.6
    and `css-parser-algorithms` 4.0.2. Natural resolution took `@asamuzakjp/css-color` 7.1.5, published
    `2026-10-11T05:57Z`, 3.7 hours earlier, so the lockfile was resolved once with pnpm's minimum release age
    at 10080 minutes, excluding the `vite` and `handlebars` CVE floors taken inside the buffer on purpose, and
    then deduplicated: 7.1.3 is the newest release of `^7.1.3` outside the buffer, and every version the bump
    adds is past it, so the maturity watchlist gains no entry. Since line 26 the population rose 49 → 50:
    `eslint-plugin-jsdoc` joined at 65.1.0 (#546), its latest mature release, with a PRE-REGISTERED canon row
    for 65.2.0. The eleven lagging packages are unchanged and no held target moved. Nothing newer than 30.1.2
    is published, so nothing is pre-registered and no canon row is written. The next two instants the live
    gate names are `@typescript-eslint/parser` and `@typescript-eslint/eslint-plugin` 8.71.1 at
    `2026-10-12T17:08Z` and `17:09Z`, then `isomorphic-dompurify` 4.5.0 at `2026-10-13T09:29Z`: with
    `--instant` the gate exits 0 at `2026-10-12T17:07:00Z`, 1 at `17:10:00Z` on the pair, and 1 at
    `2026-10-13T09:30:00Z` on all three.
28. `2026-10-11T19:01:28Z` — **11**: the hold bump took the `@typescript-eslint` pair 8.71.0 → 8.71.1 — the
    parser's catalog entry and the plugin's root `package.json` literal — about 22 hours BEFORE its maturity at
    `2026-10-12T17:08Z` (parser) and `17:09Z` (plugin), on Edward's instruction of 2026-10-11: a deviation from
    the 7-day buffer, tracked in `scripts/testing/maturity-watchlist.json` as 8.71.0 was on 2026-10-05, taken so
    that the instant line 27 names does not turn every pull request and `main` red the way 30.1.2 did. The count
    does not move: on 8.71.0 both packages read `at or above latest mature`, on 8.71.1 `at latest`, and with
    `--instant` the gate now exits 0 at `2026-10-12T17:10:00Z`, where line 27 measured 1 on the pair. 8.71.1 is
    `latest`; only 8.71.2 alphas are newer. OSV lists nothing for any of the ten family packages at 8.71.0, at
    8.71.1 or at any version, and GitHub's global and repository advisories list none. Their dependency, peer
    and engines ranges equal 8.71.0's apart from the family version, so the `typescript` peer
    `>=4.8.4 <6.1.0` still keeps TypeScript 7 out (canon row `typescript`) and the `eslint` peer still admits
    `^10.0.0` (canon row `eslint`); both rows now cite 8.71.1. The `v8.71.1` release notes list nine fixes,
    none a security fix; two reach the rules this repository enables: `no-unused-vars` reports a value used
    only as a type in a partially exported merged declaration (#12892), and the project service throttles its
    cleanup when opening files (#12934). Upstream #12980 (closed 2026-10-07, fixed by #12989 for the next
    release) is a false positive #12892 introduced when `no-unused-vars` runs without the typescript-eslint
    parser; here the rule runs only on `*.ts` and `*.tsx` through that parser, and `pnpm lint --max-warnings 0`
    exits 0 on 8.71.1, as do `pnpm typecheck:configs` and the 107 tests of `@packages/eslint-plugin-testing`,
    whose RuleTester parses TypeScript. In the lockfile, parsed with `yaml.safe_load_all`, the ten family
    packages swap 8.71.0 → 8.71.1 and nothing else moves: resolved once with pnpm's minimum release age at
    10080 minutes, excluding the `vite` and `handlebars` CVE floors and the ten family packages, then
    deduplicated: the update alone left seven 8.71.0 family packages behind for `eslint-plugin-jsdoc` 65.1.0
    (`utils ^8.70.1`), `@es-joy/jsdoccomment` 0.98.0 (`types ^8.70.0`) and `@vitest/eslint-plugin` 1.6.27
    (`utils` and `scope-manager` `^8.58.0`), and `pnpm dedupe` moved all three onto 8.71.1, which every one of
    those ranges admits. Since line 27 the
    population and the eleven lagging packages are unchanged, and no held target moved. Nothing but 8.71.2
    alphas is newer, so nothing is pre-registered and no canon row is written. The next instants the live gate
    names are `isomorphic-dompurify` 4.5.0 at `2026-10-13T09:29Z` (with `--instant` the gate exits 0 at
    `09:28:00Z` and 1 at `09:30:00Z` on it alone), then `playwright` and `@playwright/test` 1.64.0 at
    `2026-10-14T20:42Z` / `20:44Z`, `size-limit` and its preset 14.2.0 at `21:53Z` / `21:54Z` the same day,
    `jscpd` 5.4.1 at `2026-10-16T11:42Z` and `prettier` 3.9.10 at `2026-10-17T08:35Z`; at
    `2026-10-20T00:00:00Z` the gate names all seven as undocumented lags.
29. `2026-10-14T00:46:40Z` — **12**: the hold bump took `isomorphic-dompurify` 4.4.0 → 4.5.0, the `apps/api`
    literal that carries jsdom into production through the HTML sanitizer, at the instant line 28 named: 4.5.0
    (published 2026-10-06T09:29:42Z) matured at `2026-10-13T09:29Z` with no row, so the live gate on `main`
    read `lag: UNDOCUMENTED` and exited 1 on it alone from `09:30Z` until this bump (measured at
    `2026-10-14T00:36Z`). Upstream, the two tarballs differ only in `package.json`: `dompurify ^3.4.12` →
    `^3.4.16` and `jsdom ^30.0.0` → `^30.1.2`, plus three devDependencies; both ranges name the versions the
    lockfile already holds (the `dompurify` CVE-floor override 3.4.16, and `jsdom` 30.1.2 since line 27), so
    in the lockfile, parsed with `yaml.safe_load_all`, one package and one snapshot swap
    `isomorphic-dompurify@4.4.0` → `@4.5.0` and nothing else moves. Resolved with pnpm's minimum release age
    at 10080 minutes and no exclude, because every deliberately young pin had matured (`vite` 8.3.3 at
    `2026-10-13T04:10Z`, `handlebars` 4.7.10 at `2026-10-12T22:37Z`, the `@typescript-eslint` pair at
    `2026-10-12T17:08Z`); `pnpm dedupe --check` exits 0, `pnpm audit --audit-level low` finds nothing, OSV
    lists nothing for 4.4.0 or 4.5.0, the 27 cases of `apps/api/tests/unit/security/sanitizerOutputs.test.ts`
    pass on 4.5.0, `pnpm check:legal` is current (the subprocessors inventory records names, not versions) and
    M1/M7/M8 are unchanged. 4.5.0 is `latest`, and its engines `^22.22.2 || ^24.15.0 || >=26.0.0` admit the
    repository's Node. On 4.5.0 the package reads `at latest` and the live gate exits 0 at
    `2026-10-14T00:39Z`. Since line 28 the population is unchanged at 50 and the lagging packages are twelve:
    `knip` 6.40.0 matured at `2026-10-13T16:07Z` under the row pre-registered on 2026-10-07
    (`lag: held by knip`), one more lag and no red. Nothing newer than 4.5.0 is published, so nothing is
    pre-registered and no canon row is written. The next instants the live gate names: `playwright` and
    `@playwright/test` 1.64.0 at `2026-10-14T20:42Z` / `20:44Z` (with `--instant` the gate exits 0 at
    `20:41:00Z` and 1 at `20:43:00Z` on `playwright` alone), `size-limit` and its preset 14.2.0 at `21:53Z` /
    `21:54Z` the same day, `jscpd` 5.4.1 at `2026-10-16T11:42Z`, `prettier` 3.9.10 at `2026-10-17T08:35Z`, and
    five published since line 28: `dependency-cruiser` 18.6.0 at `2026-10-18T19:35Z`, the `@typescript-eslint`
    pair 8.71.2 at `2026-10-19T17:09Z` / `17:11Z`, the six Storybook packages 10.6.2 at `2026-10-19T18:22Z`,
    `@testing-library/user-event` 14.6.8 at `2026-10-20T06:41Z` and `turbo` 2.11.8 at `2026-10-20T18:09Z`; at
    `2026-10-20T18:08:00Z` the gate names sixteen undocumented lags and at `18:10:00Z` seventeen, `turbo` the
    last. `eslint-plugin-jsdoc` 65.2.0 (`2026-10-14T08:22Z`) and `vite` 8.3.4 (`2026-10-15T12:07Z`) mature
    under their pre-registered rows: the gate exits 0 at `2026-10-14T08:23:00Z`.
30. `2026-10-14T04:03:49Z` — **12**: no version moved; two PRE-REGISTERED canon rows were written for the two
    instants line 29 named, so the live gate on `main` does not go red at either. The row `@playwright/test`
    holds `@playwright/test` and `playwright` at 1.63.0 until 1.64.0 (published `2026-10-07T20:42:55Z` for
    `playwright` and `20:44:27Z` for `@playwright/test`) matures at `2026-10-14T20:42Z` / `20:44Z`; the row
    `size-limit` holds `size-limit` and `@size-limit/preset-small-lib` at 14.1.0 until 14.2.0 (published
    `2026-10-07T21:53:57Z` / `21:54:10Z`) matures at `21:53Z` / `21:54Z`. Without the rows,
    `--instant 2026-10-14T20:43:00Z` exits 1 on `playwright` alone (`@playwright/test` reaches 1.64.0 only at
    `20:44:27Z`) and `--instant 2026-10-14T21:55:00Z` exits 1 on all four; with them both exit 0, at 14 and 17
    lagging packages, and the live run exits 0. On each pair alone (`--population`) the gate exits 0 at
    `20:42:50Z` / `21:53:50Z`, and without the rows 1 at `20:43:00Z` / `21:54:00Z` on the first package and at
    `20:44:30Z` / `21:54:15Z` on both; with them, 0 at all six. OSV lists nothing for `playwright`,
    `@playwright/test` or `playwright-core` at 1.63.0 or 1.64.0, nor for `size-limit` or its preset at 14.1.0
    or 14.2.0; neither release note names a security fix, and `@vitest/browser-playwright@4.1.11` peers
    `playwright: "*"`, so it admits 1.64.0. The population is unchanged at 50 and the twelve lagging packages
    are all held; `eslint` 10.12.0 matured at `2026-10-09T20:08Z` under its row, which now names it as the v10
    reference release. The next instants the live gate names: `eslint-plugin-jsdoc` 65.2.0 at
    `2026-10-14T08:22Z` and `vite` 8.3.4 at `2026-10-15T12:07Z`, both under pre-registered rows, the two pairs
    above, and seven with no row: `jscpd` 5.4.1 at `2026-10-16T11:42Z` (with `--instant` the gate exits 0 at
    `2026-10-16T00:00:00Z` and 1 at `12:00:00Z` on `jscpd` alone), `prettier` 3.9.10 at `2026-10-17T08:35Z`,
    `dependency-cruiser` 18.6.0 at `2026-10-18T19:35Z`, the `@typescript-eslint` pair 8.71.2 at
    `2026-10-19T17:09Z` / `17:11Z`, the six Storybook packages 10.6.2 at `2026-10-19T18:22Z`,
    `@testing-library/user-event` 14.6.8 at `2026-10-20T06:41Z` and `turbo` 2.11.8 at `2026-10-20T18:09Z`; at
    `2026-10-20T18:08:00Z` the gate names twelve undocumented lags and at `18:10:00Z` thirteen, `turbo` the
    last, four fewer than line 29 measured because the two pairs are held.
31. `2026-10-14T18:27:49Z` — **12**: the hold bump took `knip` 6.39.0 → 6.40.0, the latest mature release, so
    it left the set; the same gate with 6.39.0 still installed measures **13** at `18:17:14Z`, because 6.40.0
    matured at `2026-10-13T16:07Z` (line 29) and the canon row `knip` held it until the bump. OSV lists
    nothing for 6.39.0, 6.40.0 or 6.41.0. 6.40.0 declares the dependency, peer and engines ranges of 6.39.0,
    key for key; its release notes add the Jasmine and osls plugins, exclude test files from package entries
    in production mode, resolve null package exports, workspace exports with fallback arrays and Serverless
    file variables, and fix the Commitlint, Capacitor, simple-git-hooks, PostCSS, Playwright, Vitest, Rsbuild,
    oxlint and Jest plugins, none a security fix. In the lockfile, parsed with `yaml.safe_load_all`, one
    package and one snapshot swap `knip@6.39.0` → `@6.40.0` with identical dependencies, the root importer
    moves with them, and nothing else moves: resolved with pnpm's minimum release age at 10080 minutes and no
    exclude, `pnpm dedupe --check` exits 0 and the deprecated subdependencies stay 26. The scan's JSON report
    on 6.40.0 is identical to 6.39.0's, 308 keys, so `knip-baseline.json` is unchanged and
    `node scripts/knip-ratchet.mjs` exits 0 with 0 regressions. Since line 30 the population is unchanged at
    50 and one lag joined: `eslint-plugin-jsdoc` 65.2.0 matured at `2026-10-14T08:22Z` under its
    pre-registered row, hence 13 before the bump. 6.41.0 is `latest` (published `2026-10-09T07:57:03Z`), so
    the canon row `knip` is now the PRE-REGISTERED hold until it matures at `2026-10-16T07:57Z`, and the
    watchlist date entry `hold-knip-6.41.0` schedules that bump. On `knip` alone (`--population`), without the
    row the gate exits 0 at `2026-10-16T07:57:02Z` and 1 at `07:57:04Z`; with it, 0 at both and at
    `07:58:00Z`; on the full population it exits 0 at `07:56:00Z` and `07:58:00Z`, and without the row 1 at
    `07:58:00Z`, naming only `knip`. 6.41.0 drops `fdir` and needs `unbash ^5.0.0`, `oxc-parser ^0.153.0`,
    `formatly ^0.11.4`, `zod ^4.6.5` and `smol-toml ^1.9.0`, so that bump moves lockfile copies its own unit
    measures. The other instants line 30 names are unchanged: with `--instant` the gate names the same twelve
    undocumented lags at `2026-10-20T18:08:00Z` and thirteen at `18:10:00Z`.
32. `2026-10-14T20:44:51Z` — **14** (4 within budget, 10 held, 0 undocumented): no version moved; the policy
    changed ([ADR-0036](../technical/ADR-0036-dependency-update-cadence.md), Edward, 2026-10-14). Security floors
    stay immediate, every other bump waits for the weekly Tuesday window, and the gate reads a lag as red only
    once the oldest stable release above the installed version has been mature for 30 days, 37 days after it
    was published. The six scheduled canon rows — `vite`, `knip`, `eslint-plugin-jsdoc`, `@playwright/test` /
    `playwright`, `size-limit` / `@size-limit/preset-small-lib` and the `@typescript-eslint` pair — were
    deleted, the eight `hold-*` date entries left `scripts/testing/maturity-watchlist.json`, and the gate now
    refuses a row whose text describes a scheduled hold: on the table as it stood it exited 1 naming those six
    rows. Since line 31 two lags joined and none is red: `playwright` and `@playwright/test` 1.64.0 matured at
    `20:42Z` / `20:44Z` and read `within budget (0 d of 30)`, as `eslint-plugin-jsdoc` 65.2.0 does (mature
    since `08:22Z`, under a scheduled row nothing read); `msw` reads `within budget (9 d of 30)` beside its
    row; the other ten are held past the budget. Four rows were rewritten from the day's measurements:
    `vitest` (no peer blocks 5, `@stryker-mutator/vitest-runner` is in no manifest, the migration is its own
    change, and `@vitest/mocker` 5.0.4 is the first to peer `msw ^3.0.0`), `@vitejs/plugin-react` (no blocker:
    5.1.4 fails its own `vite` peer and 5.2.0 fixes it, but 5.2.0 has been mature since 2026-03-19, so the row
    stays until the window takes it; deleted, the gate exits 1), `@types/node` (24.19.1, mature since
    2026-10-08, goes in the window; the 26 line with Node 26) and `esbuild` (a CVE floor for
    GHSA-g7r4-m6w7-qqqr). With `--instant` the gate exits 0 at `2026-10-16T12:00:00Z` (19 below latest mature,
    9 within budget) and at `2026-10-19T18:00:00Z` (23, 13 within budget), where line 31 named twelve
    undocumented lags at `2026-10-20T18:08:00Z`; with no window at all, the first red is `eslint-plugin-jsdoc`
    at `2026-11-13T08:22:22Z` (exit 0 at `08:22:00Z`, 1 at `08:23:00Z`). The first window is Tuesday
    2026-10-20.
33. `2026-10-15T02:12:05Z` — **15** (6 within budget, 9 held, 0 undocumented), the first run under Node
    26.11.1: `workstream/node-26` ([ADR-0038](../technical/ADR-0038-node-26-ahead-of-lts.md),
    [D52](#decisions-log)) moved `@types/node` from 24.13.6 to 26.6.5 with the runtime, and 26.6.5 is
    `latest`, so the package left the held set and reads `at latest`; its row stays, now holding the
    runtime major. Since line 32 the `size-limit` / `@size-limit/preset-small-lib` pair 14.2.0 matured
    (`21:53Z` / `21:54Z`) and reads `within budget (0 d of 30)`. No other lag moved.
34. `2026-10-15T15:22:40Z` — **12** (3 within budget, 9 held, 0 undocumented): the hold bump took
    `@playwright/test` and `playwright` 1.63.0 → 1.64.0, with `playwright-core`, and `size-limit` and
    `@size-limit/preset-small-lib` 14.1.0 → 14.2.0, the latest mature releases, so the four left the set;
    `vite` 8.3.4 matured at `12:07Z` and joined it, `within budget (0 d of 30)`. 1.64.0 (published
    `2026-10-07T20:42:55Z` for `playwright` and `20:44:27Z` for `@playwright/test`) keeps the engines of
    1.63.0, `>=20`, and pins its own sibling exactly; 14.2.0 (`21:53:57Z` / `21:54:10Z`) keeps the ranges of
    14.1.0 apart from `@size-limit/rolldown`'s `rolldown ^1.2.12`, which the lockfile's 1.2.12 meets. OSV
    lists nothing for any of them. The 1.64.0 release notes list four breaking changes: device descriptors
    now forward `screen`, test-file JSX follows `tsconfig.json`, `--update-snapshots=missing` passes, and
    elements inside hidden iframes count as hidden. The first two reach only the quarantined E2E specs, and
    the third reaches no run here. The fourth reaches vitest browser mode, whose tests run in an iframe, and
    the client stories pass 68 of 68 on Chromium 156.0.8078.4 (revision 1248). The 14.2.0 notes list three
    changes: `exports` as the default path when there is no `main`, an unlowered process listener limit for
    small checks, and plugin types. Both checks here name a `path`, and on the built portals they measure
    907.03 kB (limit 1.35 MB) and 1.36 MB (limit 1.75 MB). In the lockfile, parsed with `yaml.safe_load_all`,
    the three Playwright and four size-limit packages swap versions, and the peer suffixes move with them:
    `@playwright/test` in the six snapshots that carry it (`next` and the five that embed it), `playwright`
    in `@vitest/browser-playwright`, and `playwright-core` in `@axe-core/playwright`. Nothing else moves:
    1934 packages and 1936 snapshots, as before. Resolved with pnpm's minimum release age at 10080 minutes,
    excluding the twelve pins the base already held younger than that (`next` and its nine `@next/*`
    packages at 16.4.1, `@types/node` 26.6.5 and `fastify` 5.12.6), then with
    `pnpm update -r --lockfile-only` of the three Playwright packages. Without that update, lockfile
    preference kept the 1.63.0 trio as the optional `next` peer of `packages/i18n` and
    `packages/observability/sentry-next`, and `pnpm dedupe --check` does not flag it. After it,
    `pnpm dedupe --check` exits 0, the deprecated subdependencies stay 26, and the peer report is unchanged.
    `latest` is 1.64.1 (`2026-10-14T11:58Z`, two bug fixes), mature at `2026-10-21T11:54Z` / `11:58Z`; nothing
    is newer than 14.2.0.
35. `2026-10-15T15:54:20Z` — **10** (1 within budget, 9 held, 0 undocumented): the bump took `vite` 8.3.3 →
    8.3.4, the latest mature release and `latest`, so it left the set, with `postcss` 8.5.28 → 8.5.29 for
    vite's `postcss ^8.5.29` (the `postcss: "catalog:"` override applies the catalog value to vite's copy);
    neither CVE floor moves. It also took three releases inside the 7-day buffer under the owner's 72-hour
    rule, each re-verified at its maturity instant by a later commit: `eslint-plugin-jsdoc` 65.1.0 → 65.2.4
    (mature at `2026-10-17T04:55Z`), which left the set and reads `at or above latest mature` beside 65.2.0;
    `jscpd` 5.4.0 → 5.4.1 (`2026-10-16T11:42Z`); and `prettier` 3.9.9 → 3.9.10 (`2026-10-17T08:35Z`), a CVE
    floor: the minimal patched version of GHSA-4cm8-f57v-mqm6 (medium, CWE-400, quadratic parsing of Markdown
    GFM tables, `>=3.9.0 <=3.9.9`), a `prettier/prettier` repository advisory of 2026-10-11 that OSV and
    GitHub's global endpoint do not carry yet (CVE-floor row `prettier`). OSV lists nothing for any of the
    five at the versions taken. The release notes: `vite` 8.3.4 lists bug fixes, bundled-dev
    `import.meta.hot.acceptExports` and rolldown updates; `postcss` 8.5.29 `</style>` escaping in the output
    of non-Root nodes, comments in `list.comma()` and `list.space()`, and a custom-property fix;
    `eslint-plugin-jsdoc` 65.2.0 to 65.2.4 a `check-alignment` option, fixes to `no-undefined-types`,
    `check-param-names` and `convert-to-jsdoc-comments`, and CRLF line endings for the lines fixers add, which
    reach `eslint.jsdoc.config.ts` only through the fixers of `require-jsdoc` and `require-param`, both
    disabled there: `pnpm check:jsdoc --all` reads 1014 of 2144 in-scope files holding 9545 violations on
    65.2.4 and on 65.1.0, file for file, over the same tree; `jscpd` 5.4.1 a new `--similarity` method, an
    `edn` reporter, `--changed` and `--report-name`, and fixes to `--compare`, `--dead-code`,
    `--ignore-pattern` and its git subprocesses: `pnpm check:duplicates` reads 1003 clones, all in the
    baseline, and a planted clone still exits 1 as `[NEW]`; `prettier` 3.9.10 the bundled
    `micromark-extension-gfm-table` update, and `pnpm format:check` reformats no file. In the lockfile, parsed
    with `yaml.safe_load_all`, fourteen packages swap versions (those five, `nanoid` 3.3.18 → 3.3.20 for
    postcss's `^3.3.19`, and jscpd's eight platform binaries) and the peer suffixes move with them; nothing
    else moves: 1934 packages and 1936 snapshots, as before. Resolved with pnpm's minimum release age at 10080
    minutes, excluding the twelve young pins of line 34 and the eleven young targets (the three tools and
    jscpd's eight binaries), then with `pnpm update -r --lockfile-only` of `postcss` and `prettier`: lockfile
    preference had kept `postcss` 8.5.28 under a stale peer variant of `webpack`, `minimizer-webpack-plugin`
    and `@sentry/nextjs`, and `prettier` 3.9.9 under `apps/api > @react-email/render`. `pnpm dedupe --check`
    exits 0, the deprecated subdependencies stay 26, the peer report is unchanged apart from the versions, the
    client stories pass 68 of 68 on vite 8.3.4, and the portals measure 907.02 kB and 1.36 MB. The next
    instants the live gate names: `knip` 6.41.0 at `2026-10-16T07:57Z` and `eslint-plugin-jsdoc` 65.2.6 at
    `2026-10-18T12:58Z`, both `within budget`; at `2026-10-20T00:00:00Z` it reads 21 below latest mature,
    12 within budget and none undocumented.
36. `2026-10-15T16:32:47Z` — **10** (1 within budget, 9 held, 0 undocumented): the bump took `knip` 6.40.0 →
    6.41.0 inside the 7-day buffer under the owner's 72-hour rule (published `2026-10-09T07:57:03Z`, taken at
    6.4 d, mature at `2026-10-16T07:57Z`, re-verified then by a later commit); 6.41.0 is `latest` and reads
    `at latest`, and it was not in the set, so the count holds. It took `zod` 4.4.3 → 4.6.5 with it, the
    latest mature release (`2026-09-13T23:25:14Z`), because 6.41.0 declares `zod ^4.6.5` and the catalog value
    is the tree's single zod 4 copy; `zod` is a production dependency, not a population package. OSV and the
    GitHub repository advisories list nothing for either at the versions taken, nor for the 25 packages the
    lockfile adds. The knip 6.41.0 notes add the Flue and Expo Router plugins, React Native config extensions,
    tsconfig references under `--use-tsconfig-files`, nested `.gitignore` files on workspace globs and
    binaries from absent optional dependencies, and move to `unbash` 5 and `formatly` 0.11: the scan's key set
    is the baseline's, 308 keys, so `knip-baseline.json` is unchanged and `node scripts/knip-ratchet.mjs`
    exits 0 with 0 regressions and 0 resolved. The zod 4.5 and 4.6 notes change parsing (`z.iso.datetime()`
    requires seconds, string `min`, `max` and `length` count code points, a strict object reports every issue
    beside `unrecognized_keys`, `__proto__` is always stripped), build a `safeParse` error on first read, and
    change JSON Schema output. Measured: the OpenAPI document `createApp()` dumps is byte-identical on 4.4.3
    and 4.6.5 (420 paths), so the regenerated API types equal the committed ones; of the 14 structured-output
    schemas under `apps/api/src/ai`, 3 change, each `.nullable()` string or number now emitted as
    `type: [T, "null"]` instead of an `anyOf`, the same constraint. In the lockfile, parsed with
    `yaml.safe_load_all`, 25 packages swap versions (`zod`, `knip`, `formatly` 0.7.1 → 0.11.4, `unbash`
    4.0.12 → 5.0.0, and `oxc-parser`, `@oxc-project/types` and 19 `@oxc-parser` bindings 0.150.0 → 0.153.0)
    and the peer suffixes of the zod consumers move with them; nothing else moves: 1934 packages and 1936
    snapshots, as before. Resolved with pnpm's minimum release age at 10080 minutes, excluding the 23 young
    pins of line 35 and `knip` 6.41.0, then with `pnpm update -r --lockfile-only zod`: lockfile preference had
    kept 4.4.3 under the root's `@t3-oss/env-core` and `env-nextjs` and under `eslint-plugin-react-hooks`.
    `pnpm dedupe --check` exits 0 and the deprecated subdependencies stay 26. The suites pass as before (api
    9655 of 9655, the services tier 828 of 828, the client stories 68 of 68), the tests typecheck ratchet holds
    at 2133, and the built API boots and answers `/health` under the test env. The portals measure 915.04 kB
    and 1.37 MB, against 907.02 kB and 1.36 MB at line 35: zod's classic import alone bundles to
    92.1 kB gzipped on 4.6.5 against 64.7 kB on 4.4.3. At `2026-10-20T00:00:00Z` the gate reads 20 below latest
    mature, 11 within budget and none undocumented.
37. `2026-10-15T18:47:25Z` — **10** (1 within budget, 9 held, 0 undocumented): the population rose 50 → 51
    with `prisma`, the CLI through which the gate now measures the Prisma family's freshness (residual (3)
    of `holds-gate.mjs`; `@prisma/client` and `@prisma/adapter-pg` are read for equality only: the
    population's family `prisma` holds the three to one version, as each importer declares them and as
    each member resolves another as a dependency or a peer). The same change took the family 7.9.1 →
    7.10.0, its latest stable release (the `prev` dist-tag; `latest` is the release candidate
    8.0.0-rc.23, not taken), published `2026-08-25T12:47:51Z` and mature since
    `2026-09-01T12:47:51Z`, so `prisma` reads `at or above latest mature` and the count
    holds. Pinned back to 7.9.1 (`--ignore-scripts`), the gate reads
    `prisma 7.9.1 7.10.0 lag: UNDOCUMENTED` and exits 1 at `2026-10-02T00:00:00Z` and at
    `2026-10-01T12:47:52Z`, and exits 0 at
    `2026-10-01T12:47:50Z` (29 d of 30); with the manifest and the lockfile restored byte for byte
    (sha256), it exits 0 again. OSV, GitHub's global advisories and the `prisma/prisma` repository
    advisories list nothing for 7.9.1 or 7.10.0. In the lockfile, parsed with `yaml.safe_load_all`, the 11
    packages of the family swap 7.9.1 → 7.10.0 one for one (`prisma`, `@prisma/client`, `adapter-pg`,
    `client-runtime-utils`, `config`, `debug`, `driver-adapter-utils`, `engines`, `engines-version`,
    `fetch-engine`, `get-platform`) and nothing else moves: 1952 packages and 1954 snapshots, as before.
    Resolved with pnpm's minimum release age at 10080 minutes, excluding the 23 young pins of line 35 and
    `knip` 6.41.0, then with `pnpm update -r --lockfile-only` of the family: lockfile preference had kept
    the `prisma` 7.9.1 peer of `@prisma/client` under `apps/api` and `packages/adapters/db-prisma`.
    `pnpm dedupe --check` exits 0 and the deprecated subdependencies stay 26. The family check landed in
    the same unit: at `2026-10-16T03:16:22Z` the tree prints
    `family prisma 7.10.0 in lockstep (3 members, 8 resolutions read in 3 importers)` and exits 0; with
    `@prisma/adapter-pg` planted at 7.9.1 in `infra/prisma` and installed (`--offline --ignore-scripts`),
    it exits 1 naming `7.9.1 — @prisma/adapter-pg in @infra/prisma` against the seven 7.10.0
    resolutions; with the manifest
    and the lockfile restored byte for byte (sha256) and reinstalled, it exits 0 again. The lockfile
    resolved alone (`--lockfile-only`) does not move it, because `pnpm ls` reads the installed tree.

**The `documented hold` column cites each row by PACKAGE IDENTITY — the first name in the canon row's own
`Package` cell — and never by canon line number.** A line number is wrong the next time anything above the
row is edited, and this slice's own predecessor proved it: deleting one row shifted every citation below it by
one, silently. `rg vitest docs/security/SECURITY_CANON.md` finds the row; a line number finds whatever moved
into that position.

The correction itself: `refound/0-toolchain-holds` wrote the fifteen missing
rows, and `refound/0-toolchain-eslint` took the first bump — `eslint` and `@eslint/js` to 9.39.5, the
`@typescript-eslint` pair to 8.70.0, which drops the pair out of the lag set and deletes its row. The count
falls by a bump; a row makes a lag legal, never absent.

No metric moves in this slice. The lag table is measured state, not a metric: it is re-derived by
re-running the commands below, never by editing a number in place.
