# React Standards — Components · Stories · Accessibility

> The short canonical page for React work in omni-post: what a component owes before it is handed
> over. Cited by CODING_STANDARDS §React Component Standards; the detailed rules live in
> [frontend-standards.md](../standards/frontend-standards.md).

**Owner:** Platform engineering
**Decision:** [ADR-0035](../technical/ADR-0035-stories-part-of-creating-ui.md) — stories are part of creating UI

---

## Where the rules live

| Topic                                                                                            | Source                                                                       |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| TypeScript, `Result`, naming, the test framework per domain, JSDoc                               | [CODING_STANDARDS.md](../development/CODING_STANDARDS.md)                    |
| Component architecture, Server and Client Components, TanStack Query, state, performance, ARIA   | [frontend-standards.md](../standards/frontend-standards.md)                  |
| Client code against the backend: the contract it follows, MSW in its tests, the proxy smoke test | [frontend-standards.md](../standards/frontend-standards.md) §2.6, §9.4, §9.5 |
| Component code, and component JSDoc: `@component` and the props on the interface                 | this page                                                                    |
| A story per component: the requirement, the pass criterion, the flow before hand-over, the gate  | this page                                                                    |
| The installed Next.js: its version-matched guide, read before writing Next.js code               | `apps/<app>/node_modules/next/dist/docs/` (see below)                        |

**Next.js itself.** The installed Next.js (16.x) has breaking changes against older versions: APIs, conventions and file layout may differ from what you know. Before writing Next.js code, read the guide the package ships for its own version, at `apps/<app>/node_modules/next/dist/docs/`; it resolves per app, because the repository root has no `node_modules/next`. The note lives here because `next dev` would otherwise write it as `AGENTS.md` and `CLAUDE.md` into each app (Next's `agentRules`), which CLAUDE.md §Documentation Policy forbids: both portals set `agentRules: false`, as `turbo.json` sets `agentGuidance: false`.

## Component code

- Function Declaration Order:
  1. State declarations (useState)
  2. Refs (useRef)
  3. Callback functions (useCallback) — declare before use
  4. Effects (useEffect) — must come after functions they depend on
  5. Render helpers
  6. Return JSX
- Dependencies: All functions used in hooks must be in dependency arrays
- Named exports for components, default exports only for pages

## Component JSDoc — props on the interface

A component file carries `@component` in addition to `@layer infrastructure` (fitness #12). Its props are documented **on the props `interface`**, one JSDoc comment above each prop, and the component function carries a description only: `pnpm check:jsdoc` (fitness #47) asks a component for a description and nothing else, and this canon leaves `@param` tags out of the function.

```tsx
/**
 * @file CampaignList.tsx
 * @description List view of campaigns with filter/sort controls and inline actions.
 * @component CampaignList
 * @layer infrastructure
 */

interface CampaignListProps {
  /** Account whose campaigns will be listed. Required. */
  accountId: string;
  /** When true, shows archived campaigns mixed with active ones. Default: false. */
  includeArchived?: boolean;
  /** Fired after the user triggers archive/unarchive on any row. */
  onChange?: (campaignId: string) => void;
}

/**
 * Renders a paginated list of campaigns for an account, with inline archive,
 * duplicate, and analytics actions. Filters persist in the URL query string.
 */
export function CampaignList({ accountId, includeArchived = false, onChange }: CampaignListProps) {
  // ...
}
```

### Reference: why two tags, and why the interface

The two tags answer different questions: `@layer` locates the file in the hexagonal architecture (always `infrastructure` for UI); `@component` marks the file as a React component for readers and grep-based tooling. `@param` tags on the component function are redundant, not forbidden: the gate neither requires nor refuses them. The interface is where a reader, the editor's hover and every tool that types the component find the prop's meaning; the description on the function says what the component renders.

## A story per component

- **Which files.** A component file is any `.tsx` under `packages/ui/src/components`, `apps/client/components` or `apps/admin/components` that is not a `*.test.tsx`, `*.spec.tsx` or `*.stories.tsx`.
- **Where its story lives.** Beside it, with the same base name: `button.tsx` → `button.stories.tsx`, `TeamMemberRow.tsx` → `TeamMemberRow.stories.tsx`. Only that sibling counts.
- **When.** A new component lands with its story in the same change. An existing component without one gets it through the backfill: `packages/ui` first, then the client, then admin.
- **What it imports.** `import type { Meta, StoryObj } from "@storybook/react"` in a package, `from "@storybook/nextjs-vite"` in an app; a `play` function takes `expect`, `userEvent`, `within` and `fn` from `storybook/test`. The file carries the canon header (`@file`, `@description`, `@layer infrastructure`).
- **What it covers.** The component's meaningful states — default, disabled, loading, error, empty — not only its first render. A state the component does not have is named as absent in the file's header, so the absence reads as a decision.
- **What runs it.** The client Storybook collects its own stories and those of `packages/ui` through the globs of `apps/client/.storybook/main.ts`; `packages/ui` runs no Storybook of its own. The admin Storybook, re-created on 2026-11-20 on the same framework and runner, collects the stories of `apps/admin/components` through `apps/admin/.storybook/main.ts`. Both previews are built by `createStoryPreview` of `@packages/ui/storybook` (`packages/ui/src/storybook/index.tsx`), each with its own intl provider, catalogs, styles and default theme: light for the client, dark for the admin, the theme each portal starts in.
- **App Router components.** A component that uses `useRouter` from `next/navigation` needs `parameters.nextjs.appDirectory: true` in the Storybook preview; `@packages/ui/storybook` sets it for both portals. Autodocs pages are not generated, so no story carries `tags: ["autodocs"]`.

## When a story passes

`pnpm --filter @apps/client test:stories` and `pnpm --filter @apps/admin test:stories` run each story of their portal as a vitest test in headless Chromium. A story passes when:

1. it renders with no page error: nothing it renders or plays throws;
2. it writes nothing to `console.error` or `console.warn` — the console contract of `packages/vitest-shared/src/storyConsoleContract.ts`, which both portals' `vitest.stories.config.ts` load as `@packages/vitest-shared/story-console-contract`, so React's warnings, such as a missing key or an update outside `act()`, fail it;
3. its `play` function, when it has one, passes;
4. axe reports zero violations at `error` over the WCAG 2.1 A/AA tags `wcag2a`, `wcag2aa`, `wcag21a` and `wcag21aa` (`parameters.a11y` in `packages/ui/src/storybook/index.tsx`, the preview both portals share).

It runs in a real browser because jsdom cannot evaluate colour contrast: axe-core's README states that its `color-contrast` rule is known not to work with JSDOM. A failing story is a defect, fixed in the same change or, if large, tracked as its own item. It is never skipped (`tags: ["!test"]`) and never suppressed (an `a11y.test` of `todo` or `off`, or an axe rule switched off).

## The flow before hand-over

1. **Write or update the story** beside the component, covering each meaningful state.
2. **Run it:** `pnpm --filter @apps/client test:stories` exits 0 for a client or `packages/ui` component, `pnpm --filter @apps/admin test:stories` for an admin component. A machine without the browser needs `pnpm --filter @apps/client exec playwright install chromium` once; both portals pin the same Playwright, so one browser serves both.
3. **Look at it:** `pnpm --filter @apps/client storybook` serves `storybook dev` on port 6006, `pnpm --filter @apps/admin storybook` on port 6007. Open the story, check that each state renders as intended, and read its **Accessibility** panel, which runs the same axe check in your browser.
4. **Hand over** with the run's result and what you looked at in the pull request body.

## The gate

`pnpm check:stories` (`scripts/testing/story-per-component-gate.mjs`) counts, in each of the three roots, the component files without a sibling story and compares each count with `scripts/testing/story-coverage-baseline.json`:

- **Above the baseline:** a component landed without its story. The gate exits 1 and lists the root's uncovered files. Add the story; the baseline never rises to absorb one.
- **Below the baseline:** a story landed and the baseline is stale. The gate exits 1 and prints the new count; lower that root's number to it in the same change.
- **Every count at 0:** the gate asks for the baseline file to be deleted in that change, and from then on it requires 0 in every root.

It runs in the battery step `stories-gate` and in the `code-quality` job of `ci.yml`; the stories themselves run in the battery steps `stories` (client and `packages/ui`) and `stories-admin`, and both portals' in the CI job `Storybook Stories`. The count is not a ledger: a change that adds one story and one uncovered component in the same root keeps the count and passes, so review reads the printed list.

## How to extend

1. **A change to the story requirement, the pass criterion or the runner** → ADR (ADR-0035 is the current one); update this page and CODING_STANDARDS §Test Framework Rules and §Mandatory Requirements for Every Change in the same change.
2. **A new component root** → add it to `ROOTS` in `scripts/testing/story-per-component-gate.mjs` and to the baseline with its measured count, with `apps/api/tests/unit/scripts/storyPerComponentGate.test.ts` updated in the same change.
3. **An app that gains a Storybook** → its own `test:stories` script, battery step and CI job under the same criterion, its preview built with `createStoryPreview` of `@packages/ui/storybook`, its `vitest.stories.config.ts` loading `@packages/vitest-shared/story-console-contract`, and its own dedicated port, so two Storybooks can run side by side (6006 the client, 6007 the admin). Nothing of another portal's preview or setup is copied.
4. **Any other React rule** → [frontend-standards.md](../standards/frontend-standards.md), the detailed body.
