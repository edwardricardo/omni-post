# ADR-0035: Stories are part of creating UI — a story per component, run in a real browser, held by a ratchet

- **Status**: Accepted
- **Date**: 2026-10-06
- **Deciders**: Edward
- **Supersedes**: —
- **Superseded by**: —
- **Amends**: [CODING_STANDARDS.md](../development/CODING_STANDARDS.md) §Test Framework Rules (a row for
  component stories, and the criterion under it) and §Mandatory Requirements for Every Sprint (a
  story for every new component, and the gate); creates
  [REACT_STANDARDS.md](../frontend/REACT_STANDARDS.md), the page CODING_STANDARDS cited and nothing
  held
- **Related**: [ADR-0018](ADR-0018-dependency-freshness-canon.md) (the Storybook and `@vitest/*`
  packages entered the catalog as atomic families), [ADR-0019](ADR-0019-pnpm-11-migration.md) (the
  single `vite` 8 line the Vite framework builds on)

## Context

Measured on 2026-10-05 at `main` `8400ba05` (the slice 0.22 measurement, References):

1. **Nothing ran a story.** `@storybook/test-runner` had left the tree with #336 on 2026-10-02: it
   had no configuration and no `play` functions, was never invoked, and carried Jest, which
   CODING_STANDARDS forbids. No other runner was in the lockfile, no CI step built or ran
   Storybook, and the only recorded executions, `storybook build` and a dev `--smoke-test`, render
   no story.
2. **The stories asserted nothing.** None of the client's 58 stories had a `play` function, and
   the accessibility check could not fail: `parameters.a11y.test` was unset, so addon-a11y used its
   default `todo`, which reports a violation as a warning.
3. **3 of 254 component files had a story**: Button, Card and Input of `packages/ui`, whose stories
   lived under `apps/client/stories/`, away from the components. No client or admin component had
   one, and `packages/ui` had no test of its own.
4. **The admin Storybook never built.** Its configuration was created in `befaaa9c` (2026-04-22),
   the commit that deleted the admin's only story; it held 0 stories and failed at 10.4.6 and at
   10.6.0 with `SB_BUILDER-WEBPACK5_0002 … Can't resolve './stories'`.
5. **Both portals ran the webpack framework** `@storybook/nextjs`, and the client build relied on a
   webpack-only hook that hid the `node:` imports the `@packages/ui` barrel carried into the
   browser.

CODING_STANDARDS §React Component Standards cited `docs/frontend/REACT_STANDARDS.md`, a file that
did not exist (MASTER_PLAN_ES N-DOC-1).

## Decision

Two decisions by Edward, applied by slice 0.22 (tracker D29):

- **D29, 2026-10-02:** measure the Storybook, keep what runs, remove what does not, backfill a
  runnable story per component, and make stories part of creating UI ("el plan no es removerlo, es
  medir lo actual y ver si funciona"; "integrar la herramienta al flow de creacion de artefactos de
  la UI").
- **Option A, 2026-10-05:** the runner is `@storybook/nextjs-vite` with `@storybook/addon-vitest`
  on vitest browser mode with Playwright.

They come to six rules:

1. **A story per component, beside it.** Every component file under `packages/ui/src/components`,
   `apps/client/components` and `apps/admin/components` needs a sibling `<basename>.stories.tsx`
   covering its meaningful states. A new component lands with its story; an existing one gets its
   story through the backfill (task 0.22.3): `packages/ui` first, then the client, then admin.
2. **The runner.** Each story is a vitest test in headless Chromium: Storybook's Vite-based Next.js
   framework, `@storybook/addon-vitest`, `@vitest/browser` with `@vitest/browser-playwright`, and
   Playwright's Chromium (`apps/client/vitest.stories.config.ts`, run by
   `pnpm --filter @apps/client test:stories`, in the CI job `Storybook Stories` and the battery step
   `stories`). It adds no test framework: it is vitest, which the canon already names.
3. **The criterion.** A story passes when it renders with no page error, writes nothing to
   `console.error` or `console.warn` (`apps/client/.storybook/vitest.setup.ts`), passes its `play`
   function if it has one, and has zero axe violations at `error` over the WCAG 2.1 A/AA tags
   (`apps/client/.storybook/preview.tsx`), over the component's meaningful states — default,
   disabled, loading, error, empty — with a state the component lacks named as absent in the file
   header. A failing story is a defect: fixed in the same change or tracked as its own item, never
   skipped and never suppressed.
4. **The gate.** `pnpm check:stories` (`scripts/testing/story-per-component-gate.mjs`) counts, per
   root, the component files without a sibling story, and fails when a count differs from
   `scripts/testing/story-coverage-baseline.json` (40, 160 and 54 when it landed): above it, a
   component came without its story; below it, the baseline is lowered in the same change. When
   every count is 0 the baseline file is deleted and the gate requires 0. It runs in the battery
   step `stories-gate` and in the `code-quality` job of `ci.yml`.
5. **What did not run is removed.** The admin Storybook left the tree — its four `.storybook`
   files, two scripts and five devDependencies — with `@storybook/nextjs` and `webpack` out of the
   catalog. One is re-created on the Vite framework when the admin backfill starts; port 6007 stays
   reserved for it.
6. **The flow before hand-over.** Write or update the story, run `test:stories`, open the story in
   `storybook dev` and look at each state and its Accessibility panel, then hand over with the
   result in the pull request body.

The canon carries them: CODING_STANDARDS §Test Framework Rules gains the story row and the
criterion, §Mandatory Requirements the story for a new component and the gate, §Storybook port
convention the colocation; `docs/frontend/REACT_STANDARDS.md` states the requirement, the criterion,
the flow and the gate, and links `docs/standards/frontend-standards.md` as the detailed body.

## Rationale

1. **A story that nothing runs proves nothing.** The first run of the 58 client stories failed 17
   on real defects: icon-only buttons and inputs with no accessible name, a controlled input with no
   `onChange`, text under the 4.5:1 contrast ratio. Fourteen were fixed in the stories and three by
   correcting two Light-theme tokens, `--destructive` and `--muted-foreground`, to meet WCAG AA
   (Edward, 2026-10-06).
2. **A real browser, because those defects need one.** axe-core's README states that its
   `color-contrast` rule is known not to work with JSDOM, so the jsdom suites cannot see the
   contrast failures the first run found.
3. **One test runner family.** Vitest is the canon's runner, and Storybook documents the test
   runner as superseded by the Vitest addon, recommended for Vite-powered frameworks; Jest stays
   forbidden. Moving to the Vite framework also meant fixing at its source the barrel defect the
   webpack hook had hidden (#425–#428).
4. **A ratchet, because the backlog is large and the requirement starts now.** When the gate
   landed, all 254 component files lacked a sibling story, so a hard-zero gate would fail every run
   until the backfill ends, and no gate would let the count grow. A count per root holds the line
   at what exists, and each new story lowers it.
5. **Colocation, because a script can check it.** A sibling file is a fact the gate reads without
   parsing anything, and the client Storybook's globs already reach `apps/client/components` and
   `packages/ui/src`.
6. **Remove what does not run.** The admin configuration had never built and held no story; keeping
   it kept the webpack framework with its dependency chain, an override and two audit ignores
   (#439).

## Alternatives Considered

- **RTL tests only** (`@testing-library/react` in jsdom). Rejected as the only check: jsdom cannot
  evaluate colour contrast, and a component test leaves no rendered state to look at. RTL stays for
  behaviour; §Mandatory Requirements keeps its line.
- **Portable stories in the jsdom suite** (`composeStories`). Rejected: the stories would run, but
  with the same contrast blindness.
- **Snapshot tests.** Rejected: a snapshot asserts that the markup did not change, not that it is
  accessible or correct; it runs in jsdom; and an update that records a regression reads in review
  as a markup diff.
- **`@storybook/test-runner` on Jest.** Retired on 2026-10-02 (#336): no configuration, no `play`
  functions, never invoked, and it carried Jest, which the canon forbids.
- **Keep the webpack framework and write our own Playwright runner over the static build's
  `index.json`** (option B, 2026-10-05). Rejected: a runner of our own to maintain, and the barrel
  defect left hidden behind the webpack hook.
- **Remove Storybook now** (option C, 2026-10-05). Rejected: it contradicts D29, and the client
  Storybook built and ran.
- **A per-file ledger instead of a count.** Rejected: a 254-entry list would spend the pull request
  budget the backfill needs. The count's masking residual is fitness #38's tradeoff, and the gate
  prints the files.

## Consequences

**Positive**

- Every story is a test: a thrown render, a console error or an axe violation fails CI and the
  battery.
- Each component gets a rendered surface to look at, state by state, before hand-over.
- `packages/ui`, which had no test of its own, gains executed coverage story by story.
- The citation in CODING_STANDARDS resolves.

**Negative / costs**

- **Budget per pull request.** A new component carries its story in the same change, about 60 to
  90 lines per story file by the slice plan's estimate, inside the ~400-line delivery heuristic.
- **The backfill is large**, by the slice plan's estimates: after its first slice, 33 `packages/ui`
  components (6 to 8 pull requests); 160 client components (about 28 to 30, after a setup slice that
  gives the preview TanStack Query and `msw/browser`); 54 admin components (about 10, after the
  admin Storybook is re-created).
- **The baseline ratchet.** A change that gives an existing component its story lowers its root's
  count in the same change, or the gate fails it as stale. A change that adds one story and one
  uncovered component in the same root keeps the count and passes, so review reads the printed list.
- **Admin stories do not run yet.** The gate counts `apps/admin/components`, but nothing collects an
  admin story until the admin Storybook is re-created.
- **A browser in CI and on each machine.** The `Storybook Stories` job installs Chromium through a
  cache keyed by the client's Playwright version; the battery never downloads one, so a machine
  needs `pnpm --filter @apps/client exec playwright install chromium` once.
- **msw 3 waits** for a `@vitest/mocker` whose `msw` peer admits it (SECURITY_CANON row `msw`).
- **The first backfill slice** is PR E (`workstream/0-22-e-ui-stories`, number assigned at
  publication), planned to move the Button, Card and Input stories beside their components, add
  stories for four more primitives, and lower the `packages/ui` count from 40 to 33.

## Legal impact

None: internal tooling. No personal data, processing purpose, legal basis, retention, subprocessor
or customer-facing term changes. The axe check measures components in isolation against WCAG 2.1
A/AA; it is not an accessibility conformance claim for the product, and this ADR makes none.

## Revisit if

- Storybook retires `@storybook/addon-vitest`, or `@storybook/nextjs-vite` stops supporting the
  client's Next.js or Vite major: the runner is re-measured, and Jest stays out.
- The vitest 5 migration lands (SECURITY_CANON row `vitest` holds the family below 5): browser mode
  is re-measured on the stories in the same change.
- The backfill stops before every count reaches 0: the requirement is re-decided openly instead of
  living on as a permanent baseline.
- A component cannot render in isolation (an async Server Component, for example): an exemption
  needs an ADR, never a skipped or suppressed story.

## Risks and Mitigations

| Risk                                                                                      | Mitigation                                                                                                                                            |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| A story renders only the default state                                                    | The criterion names the states, and a state that does not apply is named absent in the header, so review sees the decision                            |
| A failing story is silenced instead of fixed                                              | The canon names the three forms (`tags: ["!test"]`, an `a11y.test` of `todo` or `off`, an axe rule switched off); no gate reads them yet, review does |
| The count masks a regression                                                              | The gate prints every uncovered file of a root whose count rose; the residual is stated in the tracker's Gates row                                    |
| A console call made while a module loads, or a violation at another viewport, goes unseen | Stated residuals of the runner (tracker §Gates, "Story runner"); a change to the setup or the viewports carries its own red proof                     |
| The admin backfill starts before its runner exists                                        | Its first slice re-creates the admin Storybook; an admin story written earlier runs when that lands                                                   |
| A missing browser fails the run for the wrong reason                                      | The battery's preflight names the install command; CI keys its browser cache on the Playwright version                                                |

## References

- Storybook, "Test runner" (superseded by the Vitest addon) —
  https://storybook.js.org/docs/writing-tests/integrations/test-runner
- Storybook, "Vitest addon" — https://storybook.js.org/docs/writing-tests/integrations/vitest-addon
- Storybook, "Accessibility tests" (`parameters.a11y.test`: `off`, `todo`, `error`) —
  https://storybook.js.org/docs/writing-tests/accessibility-testing
- Vitest, "Browser Mode" — https://vitest.dev/guide/browser/
- axe-core 4.13.0 README, environment support (`color-contrast` and JSDOM) — installed package,
  `node_modules/.pnpm/axe-core@4.13.0/node_modules/axe-core/README.md`
- W3C, Web Content Accessibility Guidelines 2.1 — https://www.w3.org/TR/WCAG21/
- Tracker: [TESTING_REFOUNDATION.md](../development/TESTING_REFOUNDATION.md) D29 and D25, §Gates
  rows "Story runner" and "Story per component"; contract
  `openspec/changes/testing-refoundation/tasks.md` 0.22.1–0.22.6
- Pull requests: #336 (the test runner retired), #425–#428 (the barrel made browser-safe), #432
  (the runner), #439 (the admin Storybook removed), #441 (the gate)
- Research notes (the maintainer's tooling directory, not in the repository):
  `/root/.claude/omnipost-tools/research-2026-10-05/slice-0.22-measurement.md` (§8, the measured
  state) and `slice-0.22-plan.md` (§2, the pull requests; §3, the follow-up slices and their
  estimates); engram #1078 (D29) and #1244 (option A)
- Code: `apps/client/vitest.stories.config.ts`; `apps/client/.storybook/main.ts`, `preview.tsx` and
  `vitest.setup.ts`; `scripts/testing/story-per-component-gate.mjs` and
  `scripts/testing/story-coverage-baseline.json`; `scripts/testing/battery.sh` (steps `stories`,
  `stories-gate`); `.github/workflows/ci.yml` (job `stories`, step "Story per component check")
