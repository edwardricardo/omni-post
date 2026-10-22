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

At the baseline (2026-09-27T17:55:14Z) the 52 rows below accounted for themselves: 45 lags (39 unheld + 5 held + 1 ambiguous), 5 packages
already at their latest mature, 1 candidate that is not installed at all, and k6, whose floating
container tag makes the maturity rule inapplicable rather than satisfied.

**CURRENT, re-measured 2026-10-21T22:15:17Z by `node scripts/testing/holds-gate.mjs` under Node 26.11.1,
exit 0 with EMPTY stderr: of the 52 packages in `scripts/testing/toolchain-population.json` (51 direct, 1
named transitive, no declared-absent candidate left), 9 sit below latest mature: 1 within the 30-day
budget of ADR-0036, 0 past it unheld, 8 held.**

The count's history, one measurement per line, oldest first — the instant, the number below latest mature,
and what moved it. A slice that moves the count appends its own line, re-measured with
`node scripts/testing/holds-gate.mjs`, never edited in place; a hold row makes a lag legal, never absent.

1. `2026-09-27T17:55:14Z` — **45** (39 unheld, 5 held, 1 ambiguous): the baseline, before any slice.
2. `2026-09-27T23:10:56Z` — **41**: fifteen hold rows written; `eslint` and `@eslint/js` 9.39.5, and the `@typescript-eslint` pair 8.70.0, which left the set.
3. `2026-09-27T23:57:09Z` — **41**: re-derived after `refound/0-holds-table-fix`; no version moved.
4. `2026-09-28T02:42:36Z` — **41**: slice `0.5` pinned `@types/node` 25.9.3 → 24.13.6, held before and after.
5. 2026-09-30, instant not recorded — **43**, then **41**: the `@typescript-eslint` pair matured back into the set (`2026-09-28T17:09Z`); slice `0.17` took it to 8.70.1.
6. 2026-10-02, instant not recorded — **40**: slice `0.21` took `eslint-plugin-boundaries` to 7.2.0.
7. `2026-10-02T07:24:51Z` — **39**: slice `0.6` took `tsx` 4.22.4 → 4.23.15.
8. `2026-10-02T07:39:28Z` — **38**: slice `0.8` took `msw` 2.14.6 → 2.15.0.
9. `2026-10-02T09:30:50Z` — **36**: slice `0.7` took `@playwright/test` 1.61.1 → 1.63.0 and `@axe-core/playwright` 4.10.2 → 4.13.0.
10. `2026-10-02T09:40:50Z` — **32**: slice `0.9` took the testing-library family: `dom` 10.4.2, `jest-dom` 7.0.1, `react` 16.3.3, `user-event` 14.6.7.
11. `2026-10-02T10:13:15Z` — **27**: slice `0.11` took Storybook 10.4.6 → 10.6.0 and removed `@storybook/test-runner`; population 52 → 50.
12. `2026-10-02T20:43:59Z` — **25**: slice `0.12` took `jsdom` 29.1.1 → 30.1.1 and `isomorphic-dompurify` 3.19.0 → 4.4.0 under H1; slice `0.13` had measured **27** at `18:53Z`.
13. `2026-10-03T06:26:08Z` — **24**: the dead-devDependency removal ([D35](TESTING_REFOUNDATION.md#decisions-log)) took out `@ast-grep/cli`, `@hey-api/client-fetch` and `loadtest`; population 50 → 47.
14. `2026-10-03T09:06:43Z` — **22**: slice (iii) took `secretlint` and its preset 12.3.1 → 13.0.6 ([D38](TESTING_REFOUNDATION.md#decisions-log)).
15. `2026-10-03T10:03:06Z` — **21**: slice (iv) took `jscpd` 4.0.8 → 5.3.2 ([D39](TESTING_REFOUNDATION.md#decisions-log)).
16. `2026-10-04T05:07:09Z` — **15**: slice `0.14` took the build and format six: `vite` 8.3.1, `turbo` 2.11.4, `webpack` 5.111.1, `cross-env` 10.1.0, `jiti` 2.7.0, `prettier` 3.9.9.
17. `2026-10-04T05:41:03Z` — **9**: slice `0.15` took `knip` 6.38.0, `size-limit` and its preset 14.0.1, `lint-staged` 17.6.0, `@hey-api/openapi-ts` 0.99.0 and `@faker-js/faker` 10.6.0.
18. `2026-10-04T19:00:54Z` — **9**: `size-limit` 14.1.0 matured at `13:10Z` (**11** at `18:59:12Z`); the bump took `size-limit` and its preset 14.0.1 → 14.1.0.
19. `2026-10-06T13:37:20Z` — **12**: `jscpd` 5.3.2 → 5.3.3 (**13** before); `turbo` 2.11.5 and `msw` 3.0.0 matured under their rows, `@vitest/browser` and `@vitest/browser-playwright` enrolled at 4.1.11, `dependency-cruiser` 18.4.0.
20. `2026-10-06T20:39:02Z` — **12**: the Storybook family, six packages, 10.6.0 → 10.6.1 ([D25](TESTING_REFOUNDATION.md#decisions-log); **18** before); population 50 → 49.
21. `2026-10-07T15:27:33Z` — **12**: `knip` 6.38.0 → 6.39.0, mature at `12:46Z` (**13** before).
22. `2026-10-07T18:16:09Z` — **12**: `jscpd` 5.3.3 → 5.4.0, mature at `18:11Z` (**13** before).
23. `2026-10-07T19:20:17Z` — **12**: `dependency-cruiser` 18.4.0 → 18.5.0, mature at `19:18Z` (**13** before).
24. `2026-10-08T14:58:21Z` — **12**: the CVE floor took `vite` 8.3.1 → 8.3.3, past 8.3.2, mature at `10:17Z` and inside three `vitejs/vite` advisories (**13** before).
25. `2026-10-10T04:04:04Z` — **12**: `secretlint` and its preset 13.0.6 → 13.0.7 (**14** before).
26. `2026-10-10T04:13:21Z` — **11**: `turbo` 2.11.4 → 2.11.7, mature at `2026-10-09T14:58Z` (**12** before); the root `turbo.json` sets `"agentGuidance": false`.
27. `2026-10-11T09:39:34Z` — **11**: `jsdom` 30.1.1 → 30.1.2, mature at `2026-10-11T09:15Z` with no row, which turned `main` red until the bump (**12** before); population 49 → 50 with `eslint-plugin-jsdoc`.
28. `2026-10-11T19:01:28Z` — **11**: the `@typescript-eslint` pair 8.71.0 → 8.71.1, about 22 h before its maturity, on Edward's instruction (maturity watchlist).
29. `2026-10-14T00:46:40Z` — **12**: `isomorphic-dompurify` 4.4.0 → 4.5.0, mature at `2026-10-13T09:29Z` with no row, which turned `main` red until the bump; `knip` 6.40.0 matured under its row at `2026-10-13T16:07Z`.
30. `2026-10-14T04:03:49Z` — **12**: no version moved; pre-registered rows for `@playwright/test` and `playwright` 1.64.0 and for `size-limit` and its preset 14.2.0.
31. `2026-10-14T18:27:49Z` — **12**: `knip` 6.39.0 → 6.40.0 (**13** before); `eslint-plugin-jsdoc` 65.2.0 matured under its row at `2026-10-14T08:22Z`.
32. `2026-10-14T20:44:51Z` — **14** (4 within budget, 10 held, 0 undocumented): no version moved; [ADR-0036](../technical/ADR-0036-dependency-update-cadence.md) set the 30-day budget and the weekly window and the six scheduled rows left; `playwright` and `@playwright/test` 1.64.0 matured within budget.
33. `2026-10-15T02:12:05Z` — **15** (6 within budget, 9 held, 0 undocumented): the first run on Node 26.11.1 ([ADR-0038](../technical/ADR-0038-node-26-ahead-of-lts.md), [D52](TESTING_REFOUNDATION.md#decisions-log)); `@types/node` 24.13.6 → 26.6.5; `size-limit` and its preset 14.2.0 matured within budget.
34. `2026-10-15T15:22:40Z` — **12** (3 within budget, 9 held, 0 undocumented): `@playwright/test` and `playwright` 1.63.0 → 1.64.0, `size-limit` and its preset 14.1.0 → 14.2.0; `vite` 8.3.4 matured within budget.
35. `2026-10-15T15:54:20Z` — **10** (1 within budget, 9 held, 0 undocumented): `vite` 8.3.3 → 8.3.4 with `postcss` 8.5.29; under the 72-hour rule `eslint-plugin-jsdoc` 65.2.4, `jscpd` 5.4.1 and `prettier` 3.9.10, a CVE floor for GHSA-4cm8-f57v-mqm6.
36. `2026-10-15T16:32:47Z` — **10** (1 within budget, 9 held, 0 undocumented): `knip` 6.40.0 → 6.41.0 under the 72-hour rule, with `zod` 4.4.3 → 4.6.5.
37. `2026-10-15T18:47:25Z` — **10** (1 within budget, 9 held, 0 undocumented): population 50 → 51 with `prisma`; the Prisma family 7.9.1 → 7.10.0, held to one version by the new family check.
38. `2026-10-21T22:00:01Z` — **18** (9 within budget, 9 held, 0 undocumented): no population package moved: the `dompurify` CVE floor 3.4.16 → 3.4.17 is outside it. Since entry 37 the population went 51 → 52 with `fast-check`, the Storybook family went 10.6.1 → 10.6.3, and eight newer releases matured inside the budget, each taken by a later move of this unit: `@playwright/test` and `playwright` 1.64.1, `@testing-library/user-event` 14.6.8, the `@typescript-eslint` pair 8.71.2, `dependency-cruiser` 18.6.0, `eslint-plugin-jsdoc` 65.3.4 and `turbo` 2.11.8.
39. `2026-10-21T22:02:13Z` — **16** (7 within budget, 9 held, 0 undocumented): the `@typescript-eslint` pair 8.71.1 → 8.71.2, two lags matured at once (parser and plugin).
40. `2026-10-21T22:04:31Z` — **15** (6 within budget, 9 held, 0 undocumented): `eslint-plugin-jsdoc` 65.2.4 → 65.3.4.
41. `2026-10-21T22:07:10Z` — **14** (5 within budget, 9 held, 0 undocumented): `dependency-cruiser` 18.5.0 → 18.6.0.
42. `2026-10-21T22:10:38Z` — **11** (2 within budget, 9 held, 0 undocumented): `@playwright/test` and `playwright` 1.64.0 → 1.64.1, `@testing-library/user-event` 14.6.7 → 14.6.8.
43. `2026-10-21T22:13:23Z` — **10** (1 within budget, 9 held, 0 undocumented): `turbo` 2.11.7 → 2.11.8.
44. `2026-10-21T22:15:17Z` — **9** (1 within budget, 8 held, 0 undocumented): `@vitejs/plugin-react` 5.1.4 → 6.1.2, and its hold row left; `msw` is the one lag within budget.

**The `documented hold` column cites each row by PACKAGE IDENTITY — the first name in the canon row's own
`Package` cell — and never by canon line number.** A line number is wrong the next time anything above the
row is edited, and this slice's own predecessor proved it: deleting one row shifted every citation below it by
one, silently. `rg vitest docs/security/SECURITY_CANON.md` finds the row; a line number finds whatever moved
into that position.

### How this was measured

**Measurement instant: `2026-09-27T17:55:14Z`.** Re-derive from the repository root with:

```bash
pnpm outdated -r --format json      # installed vs the registry's `latest` dist-tag, all 98 manifests
pnpm ls -r --depth 0 --json         # the installed version of every DIRECT dependency
pnpm view <pkg> time --json         # every published version of <pkg> with its publish instant
pnpm view <pkg>@<v> engines dependencies peerDependencies --json   # the crossing checks below
```

`Installed` comes from `pnpm ls -r --depth 0` — every direct dependency in this population resolves
to exactly one version, so no manifest disagrees with the catalog. Two rows are transitive and say
so; their installed version is read from the store layout under `node_modules/.pnpm/`.

**The comparator is "latest mature", never `latest`** (`testing-toolchain-alignment` › _The freshness
comparator is "latest mature", never "latest"_; ADR-0018's 7-day buffer). A version is MATURE when
both hold:

1. it is **stable** — no `-alpha`, `-beta`, `-rc`, `-next`, `-canary` or `-dev` identifier; and
2. it was published **at least 7 × 24 h** before the measurement instant, i.e. on or before
   `2026-09-20T17:55:14Z`.

`Latest mature` is the highest version satisfying both. Where a cell also names a **ceiling of a
constrained line** (the runtime major for `@types/node`, the v9 line for `eslint` and `@eslint/js`,
the v4 line for the runner, the v5 line for the React plugin), that is the highest mature version
inside the line the plan actually targets — and it is frequently not the same number. No committed
script owns this selection yet; WU-T.4(f) is what turns the rule into a gate.

**The budget** ([ADR-0036](../technical/ADR-0036-dependency-update-cadence.md), 2026-10-14). A lag below latest
mature needs no canon row while the OLDEST stable release above the installed version has been mature for
less than 30 days, so it turns red 37 days after that release was published; the weekly Tuesday window takes
it inside that time. `scripts/testing/holds-gate.mjs` prints such a lag as `within budget (<n> d of 30)`, and
only a lag past the budget needs a row.

**Why the instant is written to the second.** Maturity is a moving boundary, and it moved inside this
one day: `tsx@4.23.15` was published `2026-09-20T07:22:17Z`, so at 04:49 Z this morning it was 6.9 d
old and the target was 4.23.13; it matured at 07:22 Z, and by 17:55 Z it is 7.4 d old, so **the target
is 4.23.15**. The design's rollout order names tsx 4.23.13 for that reason and is superseded by this
row, not contradicted by it. `dependency-cruiser@18.4.0` (`2026-09-20T09:42:11Z`) crossed the same
boundary the same morning. Others moved the other way: `size-limit@14.1.0` was published today at
13:10 Z and is 0.2 d old, so the target there is 14.0.0.

### The test battery — runner, browser driver, doubles, DOM

| dep                                 | installed               | latest mature (published)                                                                                                                         | documented hold (yes/no — where)                                                                                                                                                                                                                                                                                                                                                                                | CVE floor                                                                           |
| ----------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `vitest`                            | 4.1.11                  | 5.0.2 (2026-09-25), mature since 2026-10-02 (re-measured 2026-10-06; it read 5.0.1 when measured 2026-09-27). **v4 ceiling = 4.1.11 = installed** | **held** — canon row `vitest` (the `@vitest/*` peers move with it). Staying on 4 is signed (D20) and reasoned in research; the row is what a gate can read                                                                                                                                                                                                                                                      | 4.1.11 (CVE-floor row `vitest` + `@vitest/*`) — met; a floor, not a ceiling         |
| `@vitest/coverage-v8`               | 4.1.11                  | 5.0.1 (2026-09-15) — exact peer of the runner, moves in lockstep                                                                                  | **held** — canon row `vitest`, which names it                                                                                                                                                                                                                                                                                                                                                                   | 4.1.11 (CVE-floor row `vitest` + `@vitest/*`) — met                                 |
| `@vitest/ui`                        | 4.1.11                  | 5.0.1 (2026-09-15) — same family lock                                                                                                             | **held** — canon row `vitest`, which names it                                                                                                                                                                                                                                                                                                                                                                   | 4.1.11 (CVE-floor row `vitest` + `@vitest/*`) — met                                 |
| `@vitest/browser`                   | 4.1.11                  | 5.0.2 (2026-09-25) — the family's v5 line, held with the runner (row `vitest`); measured 2026-10-06                                               | **held** — canon row `vitest`, which names it; runs the client stories in Chromium since 2026-10-05 (slice `0.22`)                                                                                                                                                                                                                                                                                              | 4.1.11 (CVE-floor row `vitest` + `@vitest/*`) — met                                 |
| `@vitest/browser-playwright`        | 4.1.11                  | 5.0.2 (2026-09-25) — the same family lock (row `vitest`); measured 2026-10-06                                                                     | **held** — canon row `vitest`, which names it; the Playwright provider of the stories run, `playwright` its required peer                                                                                                                                                                                                                                                                                       | 4.1.11 (CVE-floor row `vitest` + `@vitest/*`) — met                                 |
| `@vitest/eslint-plugin`             | 1.6.27 since 2026-10-02 | **1.6.27 (2026-08-10, 53.3 d) — latest mature**, added by slice `0.10`, at `2026-10-02T09:46Z`                                                    | **no** — no lag; an ADDITION, declared as a root devDependency LITERAL (one manifest, ADR-0018), never a catalog entry                                                                                                                                                                                                                                                                                          | —                                                                                   |
| `@playwright/test`                  | 1.64.0                  | **1.64.0 (2026-10-07, 7.8 d) — latest mature** since 2026-10-15 (hold bump), at `2026-10-15T15:22Z`; `latest` 1.64.1 matures `2026-10-21T11:58Z`  | **no** lag until `2026-10-21T11:58Z`, when 1.64.1 matures; then **in budget** with no row, the Tuesday window takes it (ADR-0036); the scheduled row was deleted 2026-10-14, and an earlier row of that name by slice `0.7`, its own remove-when met                                                                                                                                                            | —                                                                                   |
| `playwright` / `playwright-core`    | 1.64.0                  | **1.64.0 (2026-10-07)**; `latest` 1.64.1 matures `2026-10-21T11:54Z`                                                                              | **no** lag until `2026-10-21T11:54Z`; then **in budget**, moving with `@playwright/test` in the Tuesday window of ADR-0036, no row. `@playwright/test` pins `playwright` exactly; `apps/client` also declares it through the catalog, atomic with the runner, as the required peer of `@vitest/browser-playwright` (range: `*`), so the population lists it with no absence; `playwright-core` stays transitive | —                                                                                   |
| `@axe-core/playwright`              | 4.13.0                  | **4.13.0 (2026-08-11, 51.7 d) — latest mature** since 2026-10-02 (slice `0.7`), at `2026-10-02T09:27Z`                                            | **no** — no lag; deleted with the canon row `@playwright/test`, which named it too                                                                                                                                                                                                                                                                                                                              | —                                                                                   |
| `msw`                               | 2.15.0                  | 3.0.0 (2026-09-28) — mature since `2026-10-05T15:45Z`; `latest` 3.0.1 matures `2026-10-07T12:39Z`                                                 | **held** since `2026-10-05T15:45Z` — canon row `msw`: slice `0.22` chose vitest browser mode (`@storybook/addon-vitest` + `@vitest/browser 4.1.11`); `@vitest/mocker 4.1.11` peers `msw ^2.4.9` and browser-mode module interception loads `msw/browser`, so msw 3 waits for a `@vitest/mocker` whose peer admits 3.x — re-read on the day                                                                      | —                                                                                   |
| `jsdom`                             | 30.1.2                  | **30.1.2 (2026-10-04, 7.0 d) — latest mature**, and `latest`, since 2026-10-11 (hold bump), at `2026-10-11T09:39Z`                                | **no** — no lag and no row: 30.1.2 matured at `2026-10-11T09:15Z` with none, so the gate went red on `main` and #549 from `09:16Z` until the hold bump; the canon row `jsdom`, which carried all three crossings, was DELETED by slice `0.12`                                                                                                                                                                   | `undici` 8.11.2, `tough-cookie` 6.0.2 — natural resolution; both overrides deleted  |
| `isomorphic-dompurify` (PRODUCTION) | 4.5.0                   | **4.5.0 (2026-10-06, 7.6 d) — latest mature**, and `latest`, since 2026-10-14 (hold bump), at `2026-10-14T00:39Z`                                 | **no** — no lag and no row: 4.5.0 matured at `2026-10-13T09:29Z` with none, so the gate went red on `main` from `09:30Z` until the hold bump (line 29 of the log below); nothing newer is published, so nothing is pre-registered                                                                                                                                                                               | `dompurify` 3.4.16 (CVE-floor row `dompurify`) — met by 4.5.0's `dompurify ^3.4.16` |
| `@testing-library/react`            | 16.3.3                  | **16.3.3 (2026-08-27, 35.7 d) — latest mature** since 2026-10-02 (slice `0.9`), at `2026-10-02T09:39Z`                                            | **no** — no lag; the canon row `@testing-library/dom`, which named all four, was DELETED by slice `0.9`                                                                                                                                                                                                                                                                                                         | —                                                                                   |
| `@testing-library/dom`              | 10.4.2                  | **10.4.2 (2026-09-13, 18.6 d) — latest mature** since 2026-10-02 (slice `0.9`), at `2026-10-02T09:39Z`                                            | **no** — no lag; deleted with that same canon row, the one it was named first in                                                                                                                                                                                                                                                                                                                                | —                                                                                   |
| `@testing-library/jest-dom`         | 7.0.1                   | **7.0.1 (2026-08-09, 53.4 d) — latest mature** since 2026-10-02 (slice `0.9`), at `2026-10-02T09:39Z`                                             | **no** — no lag; deleted with that same canon row; 7.0.1 adds an OPTIONAL `vitest` peer, met by 4.1.11                                                                                                                                                                                                                                                                                                          | —                                                                                   |
| `@testing-library/user-event`       | 14.6.7                  | **14.6.7 (2026-09-02, 30.3 d) — latest mature** since 2026-10-02 (slice `0.9`), at `2026-10-02T09:39Z`                                            | **no** — no lag; deleted with that same canon row, which named it too                                                                                                                                                                                                                                                                                                                                           | —                                                                                   |
| `@faker-js/faker`                   | 10.6.0                  | **10.6.0 (2026-08-14, 50.5 d) — latest mature** since 2026-10-04 (slice `0.15`)                                                                   | **no** — no lag; deleted with the shared quality-gate canon row that named it. Its CVE-floor row now pins 10.6.0, the latest stable, over the minimal patched 10.5.0                                                                                                                                                                                                                                            | 10.5.0 (CVE-floor row `@faker-js/faker`) — met by 10.6.0                            |

### Types, runtime and transpiler

| dep           | installed | latest mature (published)                                                                                                                                                                                                  | documented hold (yes/no — where)                                                                                                                                                                                                                             | CVE floor |
| ------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| `typescript`  | 6.0.3     | 7.0.2 (2026-07-08, 81.1 d). **v6 ceiling = 6.0.3 = installed**                                                                                                                                                             | **held** — canon row `typescript`; the catalog comment that called 6.0.3 "latest stable" was corrected 2026-09-27 and now points at that row                                                                                                                 | —         |
| `@types/node` | 26.6.5    | **26.6.5 (2026-10-09, 7.2 d) — latest mature** 26.x since `2026-10-16T18:46Z`, and `latest`; taken in the buffer under the 72-hour rule by `workstream/node-26` (ADR-0038), 7-day review clean; was 24.13.6 by slice `0.5` | **no lag** — `at latest` in the holds gate. Canon row `@types/node` now holds the runtime major, 26: a published 27.x stays out until the runtime moves. `scripts/testing/engines-node-gate.mjs` refuses a pin whose major differs from the declared runtime | —         |
| `tsx`         | 4.23.15   | **4.23.15 (2026-09-20, 12.0 d at `2026-10-02T07:22Z`) — installed = latest mature since slice `0.6`**                                                                                                                      | **no** — no lag; the canon row `tsx` was DELETED by that slice, its own remove-when met                                                                                                                                                                      | —         |

### Lint and formatting

| dep                                | installed | latest mature (published)                                                                | documented hold (yes/no — where)                                                                                                                                               | CVE floor |
| ---------------------------------- | --------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| `eslint`                           | 9.39.5    | 10.12.0 (2026-10-02, 11.3 d). **v9 ceiling 9.39.5 = installed**, the line's last release | **held** — canon row `eslint`, rewritten 2026-09-27; the 9.36.0 → 9.39.5 gap that row did not cover is closed by the bump                                                      | —         |
| `@eslint/js`                       | 9.39.5    | 10.0.1 (2026-02-06, 233.0 d). **v9 ceiling 9.39.5 = installed**                          | **held** — canon row `@eslint/js`, written 2026-09-27; a root `package.json` literal, not a catalog entry                                                                      | —         |
| `@typescript-eslint/parser`        | 8.71.1    | **8.71.1 (2026-10-05)**, latest mature; 8.71.2 (2026-10-12) mature `2026-10-19T17:11Z`   | **no** lag until `2026-10-19T17:11Z`; then **in budget** with no row, the Tuesday window (ADR-0036); taken early on 2026-10-11 (watchlist entry)                               | —         |
| `@typescript-eslint/eslint-plugin` | 8.71.1    | **8.71.1 (2026-10-05)**, latest mature; 8.71.2 (2026-10-12) mature `2026-10-19T17:09Z`   | **no** lag until `2026-10-19T17:09Z`, when 8.71.2 matures; then **in budget** with no row (ADR-0036); its own `typescript` peer `>=4.8.4 <6.1.0` also keeps TypeScript 7.x out | —         |
| `eslint-plugin-jsdoc`              | 65.2.4    | 65.2.0 (2026-10-07, 8.3 d); **65.2.4 installed above it**, taken at 5.5 d (72-hour rule) | **no** lag until `2026-10-18T12:58Z`, when 65.2.5 and 65.2.6 mature; then **in budget** with no row, the Tuesday window (ADR-0036); 65.2.4 itself matures `2026-10-17T04:55Z`  | —         |
| `eslint-plugin-react`              | 7.37.5    | 7.37.5 (2025-04-03) — no lag, and no newer release exists                                | n/a. Its peer `eslint: … \|\| ^9.7` is half the reason eslint stays on 9                                                                                                       | —         |
| `eslint-plugin-jsx-a11y`           | 6.10.2    | 6.10.2 (2024-10-26) — no lag, and no newer release exists                                | n/a. Its peer `eslint: … \|\| ^9` is the other half                                                                                                                            | —         |
| `eslint-plugin-boundaries`         | removed   | 7.2.0 (2026-08-09) — no longer measured: removed from the tree                           | n/a — **removed** in `PR v-c` (2026-10-05), dependency-cruiser's rules in its place (SMELL-183 closed); 7.1.0 → 7.2.0 by slice `0.21` on 2026-10-02 (SMELL-66)                 | —         |
| `prettier`                         | 3.9.10    | 3.9.9 (2026-09-23, 22.4 d); **3.9.10 installed above it**, a CVE floor taken at 5.3 d    | **no** lag; 3.9.10 is `latest`, mature `2026-10-17T08:35Z`: the minimal patched version of GHSA-4cm8-f57v-mqm6 (CVE-floor row `prettier`), over the buffer                     | 3.9.10    |

### Build and orchestration

| dep                    | installed | latest mature (published)                                                                    | documented hold (yes/no — where)                                                                                                                                                                   | CVE floor                                                                                   |
| ---------------------- | --------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `vite`                 | 8.3.4     | **8.3.4 (2026-10-08, 7.2 d) — latest mature**, and `latest`, since this bump                 | **no** — no lag; 8.3.4 matured at `2026-10-15T12:07Z` and read `within budget (0 d of 30)` until this bump; the CVE floor 8.3.3 does not move                                                      | 8.3.3 (CVE-floor row `vite`); the value is 8.3.4, which takes `postcss` 8.5.29              |
| `@vitejs/plugin-react` | 5.1.4     | 6.1.1 (2026-08-28, 30.6 d). **v5 ceiling 5.2.0 (2026-03-12)**, published 11 min before 6.0.0 | **held** — canon row `@vitejs/plugin-react`, only because the lag was past the budget when ADR-0036 landed; no peer blocks it: 5.1.4 fails its own `vite` peer, and 5.2.0 fixes it                 | —                                                                                           |
| `turbo`                | 2.11.7    | **2.11.7 (2026-10-02, 7.6 d) — latest mature**, and `latest`                                 | **no** — no lag; the canon row `turbo` was deleted with this bump; 2.11.5 and 2.11.6 change how task inputs hash, per their notes, so cache keys move once; the size-limit build exits 0, uncached | —                                                                                           |
| `webpack`              | 5.111.1   | n/a — not a direct dependency since 2026-10-06 (slice `0.22`)                                | **no** — no population entry: the admin Storybook was its one declarer; it stays only as the peer of `@sentry/webpack-plugin@5.3.0` under `@sentry/nextjs`, and next builds with its own copy      | `browserslist` 4.28.7 (CVE-floor row `browserslist`) — range-scoped, in webpack's own chain |
| `cross-env`            | 10.1.0    | **10.1.0 (2025-09-29, 369.5 d) — latest mature** since 2026-10-04 (slice `0.14`)             | **no** — no lag; deleted with the six-tool canon row, which named it                                                                                                                               | —                                                                                           |
| `jiti`                 | 2.7.0     | **2.7.0 (2026-05-05, 151.3 d) — latest mature** since 2026-10-04 (slice `0.14`)              | **no** — no lag; deleted with the six-tool canon row, which named it; a root `package.json` literal, and eslint loads `eslint.config.ts` through it                                                | —                                                                                           |

### Storybook, and the Jest chain it carries

| dep                       | installed | latest mature (published)                                                                                          | documented hold (yes/no — where)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | CVE floor |
| ------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `storybook`               | 10.6.1    | **10.6.1 (2026-09-29, 7.1 d) — latest mature** since 2026-10-06 (hold bump), at `2026-10-06T20:39Z`; also `latest` | **no** — no lag; the PRE-REGISTERED canon row `storybook` was DELETED with the bump, as [D25](TESTING_REFOUNDATION.md#decisions-log) decided for this family: 10.6.1 is `latest` and only 11.0.0 prereleases are newer, so nothing is left to pre-register. 10.6.0 before it, since 2026-10-02 (slice `0.11`), whose own family row carried a remove-when that could NOT fire: `apps/admin` had zero `*.stories.*` files, its build failed identically at 10.4.6 and 10.6.0, and slice `0.22` removed it on 2026-10-06. The bump is proven by `apps/client`: build exit 0 with 77 index entries (68 stories, 9 docs), `storybook dev --smoke-test --ci` exit 0, and `test:stories` 68 of 68 over 9 files                                             | —         |
| `@storybook/addon-a11y`   | 10.6.1    | **10.6.1 (2026-09-29, 7.1 d) — latest mature** since 2026-10-06 (hold bump), at `2026-10-06T20:39Z`; also `latest` | **no** — no lag; moved with the family, and the canon row `storybook`, which named it, was deleted with the bump                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | —         |
| `@storybook/addon-docs`   | 10.6.1    | **10.6.1 (2026-09-29, 7.1 d) — latest mature** since 2026-10-06 (hold bump), at `2026-10-06T20:39Z`; also `latest` | **no** — no lag; moved with the family, and the canon row `storybook`, which named it, was deleted with the bump                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | —         |
| `@storybook/addon-vitest` | 10.6.1    | **10.6.1 (2026-09-29, 7.1 d) — latest mature** since 2026-10-06 (hold bump), at `2026-10-06T20:39Z`; also `latest` | **no** — no lag; moved with the family, and the canon row `storybook`, which named it, was deleted with the bump. It runs the client stories as vitest browser tests; 10.6.1 widens its optional `vitest`, `@vitest/browser`, `@vitest/browser-playwright` and `@vitest/runner` peers to admit `^5`, still met at 4.1.11                                                                                                                                                                                                                                                                                                                                                                                                                             | —         |
| `@storybook/nextjs`       | —         | n/a — REMOVED since 2026-10-06 (slice `0.22`)                                                                      | **no** — no lag, because the package is gone: `apps/client` moved to `@storybook/nextjs-vite` on 2026-10-05, and `apps/admin`, its last declarer, lost its Storybook on 2026-10-06 — no stories, and a build that exited 1 with `SB_BUILDER-WEBPACK5_0002` at 10.4.6 and at 10.6.0. Its removal took 305 lockfile snapshots out and added none: the webpack builder and its loaders, `node-polyfill-webpack-plugin` with the browserify crypto chain, and `memfs`. The `braces` and `elliptic` audit ignores and the `webpack-dev-middleware` override left with them, each proven orphaned (SECURITY_CANON rows); its canon row was the `storybook` family's, which dropped it and was itself deleted the same day, when the family moved to 10.6.1 | —         |
| `@storybook/nextjs-vite`  | 10.6.1    | **10.6.1 (2026-09-29, 7.1 d) — latest mature** since 2026-10-06 (hold bump), at `2026-10-06T20:39Z`; also `latest` | **no** — no lag; moved with the family, and the canon row `storybook`, which named it, was deleted with the bump. The client's framework: 10.6.1 keeps the peers of 10.6.0, `next ^14.1.0 \|\| ^15.0.0 \|\| ^16.0.0` (16.4.1), `vite` up to `^8` (8.3.4) and `react`/`react-dom` up to `^19`; it brings the deprecated `tsconfck@3.1.6` through `vite-tsconfig-paths`, which it calls only below Vite 8 (SECURITY_CANON §"Compatibility pins")                                                                                                                                                                                                                                                                                                       | —         |
| `@storybook/react`        | 10.6.1    | **10.6.1 (2026-09-29, 7.1 d) — latest mature** since 2026-10-06 (hold bump), at `2026-10-06T20:39Z`; also `latest` | **no** — no lag; enrolled at 10.6.0 on 2026-10-06 (slice `0.22`, PR E) and moved with the family the same day, and the canon row `storybook`, which named it, was deleted with the bump. `packages/ui` declares it beside `storybook` for the stories colocated with its components, which the client Storybook runs; 10.6.1 peers `react`/`react-dom` up to `^19` (19.2.7), `storybook ^10.6.1` and `typescript >= 4.9.x` (6.0.3)                                                                                                                                                                                                                                                                                                                   | —         |
| `@storybook/test-runner`  | —         | n/a — REMOVED since 2026-10-02 (slice `0.11`)                                                                      | **no** — no lag, because the package is gone: no workflow and no script invoked it, and its canon row was DELETED with its own remove-when met. Its removal took `jest@30.4.2`, `nyc@15.1.0`, `jest-process-manager@0.4.0`, `wait-on@7.2.0` and `joi@17.13.8` out of the lockfile — 219 of the slice's 230 removed bare keys lie in its dependency closure, and the slice nets −195 once the 10.6.0 set adds 35. The stray `@types/node@26.0.0` keeps 19 of its 37 declarers: 17 `@types/*` packages, `jest-worker@27.5.1` and `protobufjs@7.6.5` (`@types/wait-on` left with the chain) — see [§Declared gaps](TESTING_REFOUNDATION.md#declared-gaps)                                                                                               | —         |
| `jest` (transitive)       | —         | n/a — ABSENT from the lockfile since 2026-10-02 (slice `0.11`)                                                     | **no** — no lag, and no population entry either: the canon statement that Jest is not a framework of this repository is now TRUE IN THE TREE. Measured after removal: zero `jest@` keys, zero files importing Jest; the one jest-named package left is `jest-worker@27.5.1`, declared then by `terser-webpack-plugin` and, since 2026-10-06 (slice `0.22`), only by webpack 5.111's `minimizer-webpack-plugin@5.13.0`, under `@sentry/nextjs` > `@sentry/webpack-plugin`                                                                                                                                                                                                                                                                             | —         |

### Repository-quality gates that run in the same workflows

| dep                                            | installed | latest mature (published)                                      | documented hold (yes/no — where)                                       | CVE floor                                                                       |
| ---------------------------------------------- | --------- | -------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `knip`                                         | 6.41.0    | **6.41.0 (2026-10-09, 7.6 d) — latest mature**, and `latest`   | **no** — no lag; taken at 6.4 d, mature since `2026-10-16T07:57Z`      | `smol-toml` 1.9.0 by natural resolution; its override deleted with the bump     |
| `jscpd`                                        | 5.4.1     | **5.4.1 (2026-10-09, 7.5 d) — latest mature**, and `latest`    | **no** lag; mature `2026-10-16T11:42Z`; flagged: its rustls 0.23.45    | —                                                                               |
| `dependency-cruiser`                           | 18.5.0    | **18.5.0 (2026-09-30, 7.0 d) — latest mature**, and `latest`   | **no** — no lag; its canon row deleted with the bump                   | —                                                                               |
| `secretlint`                                   | 13.0.7    | **13.0.7 (2026-10-03, 7.1 d) — latest mature**, and `latest`   | **no** — no lag; the canon row `secretlint` was deleted with this bump | —                                                                               |
| `@secretlint/secretlint-rule-preset-recommend` | 13.0.7    | 13.0.7 — same band, and `latest`                               | **no** — no lag; moves with `secretlint`, whose row was deleted        | —                                                                               |
| `size-limit`                                   | 14.2.0    | **14.2.0 (2026-10-07, 7.7 d) — latest mature**, and `latest`   | **no** — no lag; nothing newer is published, so no row                 | —                                                                               |
| `@size-limit/preset-small-lib`                 | 14.2.0    | 14.2.0 — same band, and `latest`                               | **no** — no lag; moves with `size-limit`                               | —                                                                               |
| `@ast-grep/cli`                                | —         | n/a — REMOVED since 2026-10-03 ([D35][decisions-log])          | **no** — no lag, because the package is gone: nothing invoked it       | —                                                                               |
| `lint-staged`                                  | 17.6.0    | **17.6.0 (2026-09-26, 8.0 d) — latest mature**, and `latest`   | **no** — no lag; its config validates on 17.6.0 (`--debug`)            | —                                                                               |
| `@hey-api/openapi-ts`                          | 0.99.0    | **0.99.0 (2026-06-22, 104.0 d) — latest mature**, and `latest` | **no** — no lag; regenerated types are byte-identical                  | `js-yaml` 4.3.2 (CVE-floor row `js-yaml`) — that row names this package's chain |
| `@hey-api/client-fetch`                        | —         | n/a — REMOVED since 2026-10-03 ([D35][decisions-log])          | **no** — no lag: npm-deprecated, bundled in `@hey-api/openapi-ts`      | —                                                                               |

[decisions-log]: TESTING_REFOUNDATION.md#decisions-log

### Load generators, and the one tool with no version to measure

| dep                     | installed                                                                                        | latest mature (published)                                                                              | documented hold (yes/no — where) | CVE floor |
| ----------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | -------------------------------- | --------- |
| `autocannon`            | 8.0.0                                                                                            | 8.0.0 (2024-10-14) — no lag                                                                            | n/a                              | —         |
| `loadtest`              | —                                                                                                | n/a — REMOVED since 2026-10-03 ([D35](TESTING_REFOUNDATION.md#decisions-log))                          | **no** — removed, nothing ran it | —         |
| k6 (container, not npm) | `grafana/k6:latest` — floating: the `k6-load` job pulls `:latest`, and its run step names no tag | **unmeasurable**: a floating tag has no version to compare, so the 7-day rule cannot be applied at all | n/a                              | —         |

### The five crossings — each its own decision, never inside a family pull request

`testing-toolchain-alignment` › _A bump that crosses into production or raises the runtime floor is
its own decision_ forbids these from riding along with a test-tool family. Every claim below is read
from a published manifest or from this tree, not inferred.

1. **`jsdom` 29.1.1 → 30.1.0 — [H1], slice `refound/0-toolchain-jsdom`, and LARGER than recorded.**
   Three crossings, not the two the plan names:
   - **Runtime floor.** `jsdom@30.1.0` declares `engines.node: ^22.22.2 || ^24.15.0 || >=26.0.0`;
     `jsdom@29.1.1` declares `^20.19.0 || ^22.13.0 || >=24.0.0`. Local Node is exactly `v24.15.0` and
     every workflow uses a floating `"24"`, so the `engines.node` declaration added by slice
     `refound/0-toolchain-types-node` must be at least `^24.15.0` to be a real gate — `">=24"` would
     pass while the floor is violated.
   - **Production transitive.** `isomorphic-dompurify@3.19.0`, an `apps/api` PRODUCTION dependency,
     declares `jsdom ^29.1.1`. Moving the catalog alone leaves two jsdom copies. The production
     package that admits jsdom 30 is `isomorphic-dompurify@4.x` — latest mature 4.3.0, declaring
     `jsdom ^30.0.0` **and the same `^22.22.2 || ^24.15.0 || >=26.0.0` Node floor** — so the runtime
     floor crosses into production whichever order the two move in.
   - **Two CVE-override bands, and one is a hard blocker.** `jsdom@30.1.0` depends on
     `undici ^8.10.2`, outside the range-scoped `"undici@>=7.0.0 <7.29.0": 7.29.0` override
     (`pnpm-workspace.yaml:240`, floor row `:285`): that band stops applying to this chain, and the
     advisory needs re-auditing against undici 8. It also depends on `tough-cookie ^6.0.2` — and
     `tough-cookie: 4.1.3` (`pnpm-workspace.yaml:300`, floor row `:278`) is a **BLANKET** override.
     The store holds exactly one copy, `tough-cookie@4.1.3`, so as written the override would force
     jsdom 30 onto a version its own manifest forbids. The canon's own gotcha applies — a blanket
     override silently wins over a later range-scoped one (floor row `:270`) — so the pin must be
     re-scoped, with the advisory re-audited against the published 6.x line (6.0.2 exists), inside
     that slice. **Nothing in the plan, the design or the earlier measurement recorded this.**
   - **Taken 2026-10-02 by slice `0.12` ([D31](TESTING_REFOUNDATION.md#decisions-log)), at 30.1.1 with `isomorphic-dompurify`
     4.4.0, so one jsdom copy serves production.** The runtime floor needed no edit: slice `0.5` had
     already declared `>=24.15.0 <25` in all 98 manifests. `undici` resolves 8.11.2 naturally and its
     7.x override was deleted as inert; `tough-cookie` is range-scoped to `<4.1.3`, so jsdom 30 and msw
     take 6.0.2 while `request`'s chain keeps the floor.
2. **`typescript` 6.0.3 → 7.0.2 — HOLD; there is no Phase 0 slice for it, and that is correct.**
   `@typescript-eslint/parser@8.71.1` and `@typescript-eslint/eslint-plugin@8.71.1` — installed since
   2026-10-11, taken about 22 hours before their `2026-10-12T17:08Z` / `17:09Z` maturity on Edward's
   instruction and tracked in `scripts/testing/maturity-watchlist.json`, as 8.71.0 was on 2026-10-05 — still
   peer `typescript: ">=4.8.4 <6.1.0"`, byte-identical to 8.70.0's, 8.70.1's and 8.71.0's, and so do the
   8.71.2 alphas. TypeScript 7 is therefore not
   takeable today at any `@typescript-eslint` version, so the hold row is the deliverable, not a bump. Its
   remove-when is observable: `@typescript-eslint` publishes a peer range admitting 7.
3. **`@vitejs/plugin-react` 5.1.4 → 6.1.1 — its own decision, and NOT slice
   `refound/0-toolchain-vite-shims`.** That slice is WU-T.4(e), the 86 dead `vite` shims; it is not a
   plugin bump. The plugin compiles the JSX of both Next portals under vitest (ADR-0019), so a major
   crosses into the frontend build and not only into the test run. Either its own slice with both
   portals' suites green, or a hold. Note the in-major move nobody has taken either: the v5 ceiling
   is 5.2.0 and the tree is on 5.1.4.
4. **`@eslint/js` 9.36.0 → 10.0.1 — needed its OWN hold row, and now has one.** It is a root literal, not
   a catalog entry, and until 2026-09-27 no hold row named it: it tracked `eslint` in practice, and practice
   is not readable by a gate, so the holds gate flagged it while `eslint` beside it passed.
   `refound/0-toolchain-holds` wrote the row (canon row `@eslint/js`) and `refound/0-toolchain-eslint` took
   the in-major move to 9.39.5 in the SAME pull request as `eslint`, which is the only thing that keeps the
   two on one version. 10.x stays out until the `eslint` row's own remove-when fires.
5. **`@types/node` 25.9.3 → 24.13.6 — a deliberate DOWNWARD move, slice
   `refound/0-toolchain-types-node`.** Against the generic comparator the latest mature is 26.6.2; the
   target is the runtime major, which is the named exception in `testing-toolchain-alignment` ›
   _`@types/node` tracks the runtime major, downward if necessary, and `engines.node` is declared_.
   The catalog change alone does not make "types major = runtime major" true in the store: a second
   copy, `@types/node@26.0.0`, arrives through open-range transitives. This section first said it would
   leave with `@storybook/test-runner`; slice `0.11` measured that FALSE on 2026-10-02 — 19 of its 37
   declarers survive the removal — so it stays a declared gap (see [§Declared gaps](TESTING_REFOUNDATION.md#declared-gaps)).

### Where each measured lag goes

| Destination                                                              | Packages                                                                                                                                                                                                                                                                                                           | What that slice must prove                                                                                               |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `refound/0-toolchain-holds` (WU-T.4(f))                                  | the vitest trio's hold; the corrected `eslint` and `@storybook/test-runner` rows (slice `0.11` deleted the second); one row per no-slice lag below                                                                                                                                                                 | the gate reads the holds table, fails closed on zero parsed rows, and every surviving remove-when is observable          |
| `refound/0-toolchain-eslint` (WU-T.4(b))                                 | `eslint` **and** `@eslint/js` 9.36.0 → 9.39.5, **and the `@typescript-eslint` pair 8.65.0 → 8.70.0** (re-plan 2026-09-27: the pair had no slice, and bumping it is the only path to the `typescript` row), all in one pull request                                                                                 | `pnpm lint --max-warnings 0` exit 0; both React plugins' peers still resolve; the holds rows rewritten with today's date |
| `refound/0-toolchain-types-node` (WU-T.4(c))                             | **LANDED 2026-09-28.** `@types/node` 25.9.3 → 24.13.6; `engines.node` `>=24.15.0 <25` in all 98 manifests — the floor the plan asked for, with the explicit single-major CEILING the plan's `^24.15.0` left implicit, because the gate compares an exact string and a caret range names no ceiling it could refuse | `pnpm exec tsc -b --force` exit 0; the engines gate red-proven                                                           |
| `refound/0-toolchain-tsx` (WU-T.4(b))                                    | `tsx` 4.22.4 → **4.23.15** (not 4.23.13 — it matured today)                                                                                                                                                                                                                                                        | every `--import tsx` entrypoint still runs; re-measure maturity before pinning                                           |
| `refound/0-toolchain-browser` (WU-T.4(b))                                | `@playwright/test` 1.61.1 → 1.63.0 (with `playwright` / `playwright-core`), `@axe-core/playwright` 4.10.2 → 4.13.0                                                                                                                                                                                                 | LANDED: 1.63 drops Ubuntu 20.04; no CI job runs it (M2 `0`), runners `ubuntu-latest`; Debian 12 proven; image → WU-6.E8  |
| `refound/0-toolchain-msw` (WU-T.4(b))                                    | `msw` 2.14.6 → 2.15.0. msw 3 is a crossing held by the canon row `msw` from `2026-10-05T15:45Z`: ESM-only, and outside the `msw ^2.4.9` peer of `@vitest/mocker` 4.1.11                                                                                                                                            | the suites that already use MSW stay green                                                                               |
| `refound/0-toolchain-rtl` (WU-T.4(b))                                    | `@testing-library/{dom,jest-dom,react,user-event}` — the family moves atomically                                                                                                                                                                                                                                   | LANDED: client 541 + admin 114 green; syncpack 0 over 614, so no split; bare lock keys moved by exactly 4                |
| `refound/0-toolchain-vitest-plugin` (WU-T.4(b))                          | **LANDED 2026-09-28, rebased 2026-10-02.** add `@vitest/eslint-plugin` 1.6.27 as a root devDependency LITERAL — ADR-0018 gives a direct dependency declared in ONE manifest a literal, not a catalog entry — registered in `eslint.config.ts` with ZERO rules enabled                                              | LANDED: zero rules enabled; `vitest/no-focused-tests` resolves and fires only when forced; `eslint` exit 0               |
| `refound/0-toolchain-storybook` (WU-T.4(d) + T.4(e))                     | **LANDED 2026-09-29, rebased 2026-10-02.** `@storybook/test-runner` REMOVED — nothing invoked it — and `jest`, `nyc`, `jest-process-manager`, `wait-on` and `joi` left with it; the `storybook` family 10.4.6 → 10.6.0 atomically; the dead `GHSA-q7cg` ignore deleted                                             | LANDED: Jest absent, 0 files import it; `@types/node@26.0.0` SURVIVES (37 → 19) — plan clause FALSE                      |
| `refound/0-toolchain-jsdom` (WU-T.4(b), **[H1]**)                        | **LANDED 2026-10-02 (#372).** `jsdom` 29.1.1 → 30.1.1, `isomorphic-dompurify` 3.19.0 → 4.4.0; the `undici` override deleted, no 7.x copy left; `tough-cookie` range-scoped to `<4.1.3`                                                                                                                             | all THREE crossings resolved in one pull request, or a hold naming all three                                             |
| `refound/0-toolchain-build` (WU-T.4(b)) — **re-plan 2026-09-27**         | **LANDED 2026-10-04 (#391).** `vite` 8.3.1, `turbo` 2.11.4, `webpack` 5.111.1, `cross-env` 10.1.0, `jiti` 2.7.0, `prettier` 3.9.9; `postcss` 8.5.28 for vite's own range                                                                                                                                           | LANDED: tsc, the builds, lint and `format:check` exit 0; 3.9.9 reformats nothing; vite and turbo pre-registered          |
| `refound/0-toolchain-quality-gates` (WU-T.4(b)) — **re-plan 2026-09-27** | **LANDED 2026-10-04 (#392).** `knip` 6.38.0, `size-limit` + preset 14.0.1 (14.1.0 the same evening), `lint-staged` 17.6.0, `@hey-api/openapi-ts` 0.99.0, `@faker-js/faker` 10.6.0; `dependency-cruiser` stays at 17.4.0 with its own canon row and moves with item (v) of the replacement plan                     | LANDED: every gate keeps its verdict; `du` ignored, ledger 312 → 310; knip pre-registered, size-limit 14.1.0 taken       |
| `workstream/eslint-boundaries-policies` (WU-T.4(b), slice `0.21`)        | **LANDED 2026-10-02.** `eslint-plugin-boundaries` 7.1.0 → 7.2.0, with the `boundaries/dependencies` config migrated to the v7 syntax (SMELL-66) — the package left the no-slice row below when the contract gave it slice `0.21`                                                                                   | `pnpm lint --max-warnings 0` exit 0 with 0 `[boundaries]` lines; every per-layer probe still errors on the bumped plugin |
| **No enumerated slice — a hold row is the deliverable**                  | `typescript` (peer-blocked at every published `@typescript-eslint`), `@vitejs/plugin-react` (crossing), `jest` (left the tree with `@storybook/test-runner` in slice `0.11`, never bumped), and k6's floating tag                                                                                                  | each row carries a measured reason, today's date, and a remove-when that can actually fire                               |

**Two limits of this table, stated rather than discovered later.** (1) It measures DIRECT dependencies
plus the transitives the plan owns by name (`playwright`, and `jest` until slice `0.11` took it out of the tree); a lag reachable only through some
other parent is invisible to it, which is why WU-T.4(f)'s gate reads the same `pnpm outdated -r`
output rather than this prose. (2) "Latest mature" is computed at one instant, and the boundary moves
daily in both directions — `tsx` and `dependency-cruiser` crossed into maturity during the day this
was written, and `size-limit@14.1.0` was published while it was being written. Every slice
re-measures before it pins, per `testing-toolchain-alignment` › _The freshness comparator is "latest
mature", never "latest"_.

---

## OSV measurement (WU-3.7a)

Two measurements, taken with the same method and the same pinned binary. Each is kept as taken; the
decision material rests on the later one. Raw scanner output is not committed.

### The two measurements

| Quantity                                                  | 2026-09-28 (original)                              | 2026-10-02 (rebased)                                         |
| --------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| Tree                                                      | commit `08b49f4e` (branch `refound/3-osv-measure`) | `91f26952` plus this slice, which changes only this document |
| Instant                                                   | 2026-09-28T11:52Z                                  | 2026-10-02T09:56Z                                            |
| `pnpm-lock.yaml` sha256                                   | `eba24db6…69e3f`                                   | `8456b570…c5d5bff`                                           |
| Packages the scanner read from the lockfile               | 2656                                               | 2684                                                         |
| Scanner                                                   | `osv-scanner` 2.6.0, sha256 `ca69b3d3…85b108`      | the same binary, fetched again by tag, sha256 re-verified    |
| `osv-scanner` advisories · packages                       | 6 · 4                                              | 4 · 3                                                        |
| by severity (GitHub rating)                               | 2 high · 1 moderate · 3 low                        | 2 high · 1 moderate · 1 low                                  |
| `pnpm audit` (`metadata` counts)                          | 6 — 2 listed, 4 ignored                            | 4 — 0 listed, 4 ignored                                      |
| seen by `osv-scanner`, not by `pnpm audit`                | 0                                                  | 0                                                            |
| seen by `pnpm audit`, not by `osv-scanner`                | 0                                                  | 0                                                            |
| covered by `auditConfig.ignoreGhsas` (5 entries)          | 4 of 6                                             | 4 of 4                                                       |
| not covered by any ignore                                 | 2 — both `joi` 17.13.4, low, dev-only              | 0 — `joi` resolves to 17.13.8 since slice `0.17`             |
| **moderate+ that `pnpm audit` misses AND nobody audited** | **0**                                              | **0**                                                        |
| ignore entries that match no finding                      | 1 — `GHSA-q7cg-457f-vx79`                          | 1 — the same                                                 |
| `--all-vulns` output against the default JSON             | byte-identical                                     | byte-identical                                               |
| CI gate form, `pnpm audit --audit-level moderate`         | exit 0                                             | exit 0                                                       |

The binary is the `v2.6.0` release asset `osv-scanner_linux_amd64`, downloaded by tag into a scratch
directory (never installed) and checked against sha256
`ca69b3d3cd08f889a49dc0a383122f71cc528b83803671df5fd874d97485b108`; the original lockfile digest is
`eba24db62503a8a8b9d26e31fc5a289c93344f644b7e9eaef7ea307d03d69e3f`, today's is
`8456b570462e906d6b4a2a8e7fa271030adf6e556ff6fabeebe466676c5d5bff`. `osv-scanner` exits 1 when it has
findings; that is not a failure.

| Command                                                                              | 2026-09-28                                             | 2026-10-02                                     |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------- |
| `osv-scanner --lockfile=pnpm-lock.yaml --format=sarif --output-file=…` (the CI form) | exit 1 · 6 results / 6 rules                           | exit 1 · 4 results / 4 rules                   |
| `osv-scanner --lockfile=pnpm-lock.yaml --format=json --output-file=…`                | exit 1 · 6 advisories over 4 packages                  | exit 1 · 4 advisories over 3 packages          |
| `osv-scanner scan source --lockfile=… --all-vulns --format=json`                     | exit 1 · byte-identical to the default JSON            | exit 1 · byte-identical to the default JSON    |
| `osv-scanner scan source -r . --format=json`                                         | exit 1 · 1 Extract call (`pnpm-lock.yaml`), same 6 ids | not repeated                                   |
| `pnpm audit --json`                                                                  | exit 1 · 2 listed; 3 low · 1 moderate · 2 high         | exit 0 · 0 listed; 1 low · 1 moderate · 2 high |
| `pnpm audit --audit-level moderate` (`production-ci.yml:50`)                         | exit 0 · 2 low listed · 4 ignored                      | exit 0 · 4 ignored                             |

### Every finding, classified

| Package            | Advisory · alias                       | Severity       | Audited ignore | Seen by `pnpm audit`     | Reach              | 2026-09-28 | 2026-10-02 |
| ------------------ | -------------------------------------- | -------------- | -------------- | ------------------------ | ------------------ | ---------- | ---------- |
| `image-size@2.0.2` | `GHSA-5p2g-fcmc-qvqq` · CVE-2025-71329 | high (8.7)     | yes            | yes, as an ignored count | **prod-reachable** | yes        | yes        |
| `image-size@2.0.2` | `GHSA-w3rx-r6r6-pgpr` · CVE-2025-71330 | high (8.7)     | yes            | yes, as an ignored count | **prod-reachable** | yes        | yes        |
| `request@2.88.2`   | `GHSA-p8p7-x288-28g6` · CVE-2023-28155 | moderate (6.1) | yes            | yes, as an ignored count | dev-only           | yes        | yes        |
| `elliptic@6.6.1`   | `GHSA-848j-6mx2-7j84` · CVE-2025-14505 | low (5.6)      | yes            | yes, as an ignored count | dev-only           | yes        | yes        |
| `joi@17.13.4`      | `GHSA-6w3j-5fw6-r9vr` · CVE-2026-84368 | low (3.7)      | **no**         | yes, listed by name      | dev-only           | yes        | no         |
| `joi@17.13.4`      | `GHSA-gg4h-3hg2-grpc` · CVE-2026-84367 | low (3.7)      | **no**         | yes, listed by name      | dev-only           | yes        | no         |

An advisory on the ignore list never appears in the audit's `advisories` object but is still counted in
its `metadata`: that is how every finding is provably visible to `pnpm audit` while only the unignored
ones are printed. Reach comes from the lockfile, parsed with `yaml.safe_load_all` (pnpm 12 writes two
documents): one breadth-first walk from every importer's `dependencies`, one from its `devDependencies`,
both through each snapshot's `dependencies` and `optionalDependencies`. Today's closures are 1280 prod and
2012 dev over 2694 snapshot ids (1280 / 1988 / 2666 on 2026-09-28). `image-size` is prod-reachable through
`@providers/bluesky`, the one production caller `SECURITY_CANON.md` names; `request` arrives through root
`jq@1.7.2` › `jsdom@0.2.19`, `elliptic` through `@storybook/nextjs` › `node-polyfill-webpack-plugin`, and on
2026-09-28 `joi` arrived through `@storybook/test-runner` › `jest-process-manager` › `wait-on@7.2.0`.

**Since 2026-10-06 none of these ignores remains**, and the tables above stay as measured: the
`request` ignore left on 2026-10-02 with `jq` ([D32](TESTING_REFOUNDATION.md#decisions-log)), the two `image-size` ignores on
2026-10-03 with 2.0.4 ([D37](TESTING_REFOUNDATION.md#decisions-log)), and the `elliptic` ignore, with the `braces` ignore added
after these measurements ([D33](TESTING_REFOUNDATION.md#decisions-log)), on 2026-10-06 with the admin Storybook (#439).
`auditConfig.ignoreGhsas` is `[]`; WU-3.7(b) re-measures before it decides.

### Findings named, not fixed here

Each was re-checked against the files on 2026-10-02; the first three were still true then, and slice `0.11`
closed the third the same day.

1. **The CI job downloads an unpinned binary.** `audit.yml:107` fetches
   `releases/latest/download/osv-scanner_linux_amd64`, so the version is whatever upstream published
   last. The 2.x line moved to a subcommand CLI (`osv-scanner scan source …`), and the flat `--lockfile`
   form the job uses still works at 2.6.0 (measured above) with nothing guaranteeing the next release.
2. **The job's comment misstates its baseline.** `audit.yml:110` says "baseline has 90 vulns"; the
   measured counts are 6 (2026-09-28) and 4 (2026-10-02), and `--all-vulns` changes neither.
3. **`GHSA-q7cg-457f-vx79` is an orphan ignore whose canon row names the wrong package.** It matches no
   finding on either date. The OSV record names `joi` (CVE-2026-48038, moderate; affected `<17.13.4` and
   `>=18.0.0 <18.2.1`), and the installed `joi` (17.13.4 then, 17.13.8 now) is outside both ranges;
   `SECURITY_CANON.md:254` attributes it to `request`. **CLOSED 2026-10-02 by slice `0.11`**: `pnpm audit`
   returns the same ignored set with and without the entry, both on the lockfile before the removal and on
   the one after it, which holds no `joi` at all, so the entry and its canon row were deleted.
4. **No longer true:** on 2026-09-28 two `low` `joi` advisories sat unignored on that same version; on
   2026-10-02 `joi` 17.13.8 carries none.
5. **The scanner has one thing to read here.** The recursive source scan on 2026-09-28 made exactly one
   Extract call, `pnpm-lock.yaml`: there is no second ecosystem for it to cover.
6. **Two id spaces.** SARIF rule ids are the CVE aliases (today `CVE-2025-71329`, `CVE-2025-14505`,
   `CVE-2023-28155`, `CVE-2025-71330`); the JSON report and `auditConfig.ignoreGhsas` use GHSA ids. An
   ignore file for a gate has to use the id space the scanner matches on.
7. **No `osv-scanner.toml` exists in the tree** (searched by name on both dates).

### Decision material for WU-3.7(b) — stated, not decided

- **The criterion.** Decision D8 keeps OSV-Scanner only if it sees a class `pnpm audit` does not; as a
  measurable test: at least one moderate-or-higher advisory that `pnpm audit` does not see AND that
  nobody has audited.
- **Today's measurement (2026-10-02T09:56Z).** That count is **0**. The advisory sets are identical in
  both directions (4 = 4), and every finding is covered by an audited ignore; no finding is unaudited at
  all. The rebase did not change the conclusion the 2026-09-28 measurement supported (6 = 6, count 0).
- **What follows from the evidence.** The job reads the same lockfile against the same advisory data as
  `pnpm audit`. Keeping it as a real gate means a pinned binary, an `osv-scanner.toml` with one reasoned,
  expiring ignore per audited finding, and removing the `set +e` that swallows its exit code; retiring it
  removes findings 1 and 2 with it. Finding 3 lived in `SECURITY_CANON.md` and `pnpm-workspace.yaml`
  whichever branch is taken, and slice `0.11` closed it in both.
