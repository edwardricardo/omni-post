# React Standards — Components · Stories · Accessibility

> The short canonical page for React work in omni-post: what a component owes before it is handed
> over. Cited by CODING_STANDARDS §React Component Standards; the detailed rules live in
> [frontend-standards.md](../standards/frontend-standards.md).

**Owner:** Platform engineering
**Decision:** [ADR-0035](../technical/ADR-0035-stories-part-of-creating-ui.md) — stories are part of creating UI

---

## Where the rules live

| Topic                                                                                           | Source                                                      |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| TypeScript, `Result`, naming, the test framework per domain, JSDoc and `@component`             | [CODING_STANDARDS.md](../development/CODING_STANDARDS.md)   |
| Component architecture, Server and Client Components, TanStack Query, state, performance, ARIA  | [frontend-standards.md](../standards/frontend-standards.md) |
| A story per component: the requirement, the pass criterion, the flow before hand-over, the gate | this page                                                   |

## A story per component

- **Which files.** A component file is any `.tsx` under `packages/ui/src/components`, `apps/client/components` or `apps/admin/components` that is not a `*.test.tsx`, `*.spec.tsx` or `*.stories.tsx`.
- **Where its story lives.** Beside it, with the same base name: `button.tsx` → `button.stories.tsx`, `TeamMemberRow.tsx` → `TeamMemberRow.stories.tsx`. Only that sibling counts.
- **When.** A new component lands with its story in the same change. An existing component without one gets it through the backfill: `packages/ui` first, then the client, then admin.
- **What it imports.** `import type { Meta, StoryObj } from "@storybook/react"` in a package, `from "@storybook/nextjs-vite"` in an app; a `play` function takes `expect`, `userEvent`, `within` and `fn` from `storybook/test`. The file carries the canon header (`@file`, `@description`, `@layer infrastructure`).
- **What it covers.** The component's meaningful states — default, disabled, loading, error, empty — not only its first render. A state the component does not have is named as absent in the file's header, so the absence reads as a decision.
- **What runs it.** The client Storybook collects its own stories and those of `packages/ui` through the globs of `apps/client/.storybook/main.ts`; `packages/ui` runs no Storybook of its own. The admin has none until one is re-created on the same framework (port 6007 is reserved for it), so an admin story is required by the gate but not yet run.

## When a story passes

`pnpm --filter @apps/client test:stories` runs each story as a vitest test in headless Chromium. A story passes when:

1. it renders with no page error: nothing it renders or plays throws;
2. it writes nothing to `console.error` or `console.warn` — the console contract of `apps/client/.storybook/vitest.setup.ts`, so React's warnings, such as a missing key or an update outside `act()`, fail it;
3. its `play` function, when it has one, passes;
4. axe reports zero violations at `error` over the WCAG 2.1 A/AA tags `wcag2a`, `wcag2aa`, `wcag21a` and `wcag21aa` (`parameters.a11y` in `apps/client/.storybook/preview.tsx`).

It runs in a real browser because jsdom cannot evaluate colour contrast: axe-core's README states that its `color-contrast` rule is known not to work with JSDOM. A failing story is a defect, fixed in the same change or, if large, tracked as its own item. It is never skipped (`tags: ["!test"]`) and never suppressed (an `a11y.test` of `todo` or `off`, or an axe rule switched off).

## The flow before hand-over

1. **Write or update the story** beside the component, covering each meaningful state.
2. **Run it:** `pnpm --filter @apps/client test:stories` exits 0. A machine without the browser needs `pnpm --filter @apps/client exec playwright install chromium` once.
3. **Look at it:** `pnpm --filter @apps/client storybook` serves `storybook dev` on port 6006. Open the story, check that each state renders as intended, and read its **Accessibility** panel, which runs the same axe check in your browser.
4. **Hand over** with the run's result and what you looked at in the pull request body.

## The gate

`pnpm check:stories` (`scripts/testing/story-per-component-gate.mjs`) counts, in each of the three roots, the component files without a sibling story and compares each count with `scripts/testing/story-coverage-baseline.json`:

- **Above the baseline:** a component landed without its story. The gate exits 1 and lists the root's uncovered files. Add the story; the baseline never rises to absorb one.
- **Below the baseline:** a story landed and the baseline is stale. The gate exits 1 and prints the new count; lower that root's number to it in the same change.
- **Every count at 0:** the gate asks for the baseline file to be deleted in that change, and from then on it requires 0 in every root.

It runs in the battery step `stories-gate` and in the `code-quality` job of `ci.yml`; the stories themselves run in the battery step `stories` and the CI job `Storybook Stories`. The count is not a ledger: a change that adds one story and one uncovered component in the same root keeps the count and passes, so review reads the printed list.

## How to extend

1. **A change to the story requirement, the pass criterion or the runner** → ADR (ADR-0035 is the current one); update this page and CODING_STANDARDS §Test Framework Rules and §Mandatory Requirements in the same change.
2. **A new component root** → add it to `ROOTS` in `scripts/testing/story-per-component-gate.mjs` and to the baseline with its measured count, with `apps/api/tests/unit/scripts/storyPerComponentGate.test.ts` updated in the same change.
3. **An app that gains a Storybook** (the admin's re-creation) → its own `test:stories` script, battery step and CI job under the same criterion, and its port in CODING_STANDARDS §Storybook port convention.
4. **Any other React rule** → [frontend-standards.md](../standards/frontend-standards.md), the detailed body.
