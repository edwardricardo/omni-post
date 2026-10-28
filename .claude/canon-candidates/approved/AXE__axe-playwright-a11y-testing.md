# Canon Candidate — axe-core/playwright a11y testing for E2E suites

## Metadata

- **Task surfacing this gap**: Phase 2 audit-toolkit activation. The initial audit said "axe-core 4.10.3 installed but zero `injectAxe`/`toHaveNoViolations` — dormant". A re-audit with the correct grep (`AxeBuilder`) shows that there ARE helpers wired in both apps, but with drifted defaults and minimal coverage (1 spec in admin, 0 in client).
- **Specific decision**: what the canon is for (a) the WCAG tag set, (b) the impact severity threshold (which impact must fail CI vs warn), (c) the helper's location, (d) the minimum coverage per app (which pages must have an a11y spec), (e) what to do about the divergence between admin (`expectPageToBeAccessible`, a standalone fn with strict defaults) and client (`CustomAssertions.expectPageToBeAccessible`, a method with lax defaults).
- **Decision date**: 2026-05-07
- **Synthesized by**: claude-opus-4-7
- **Status**: pending

## Why this gap exists

**Existing canon adjacent**: no entry in canon-index.json about a11y testing. Helpers already exist in code, but there is no pinned rule and no uniform coverage.

**Current state of the repo**:

- `apps/admin/tests/e2e/utils/a11y.ts` — standalone `expectPageToBeAccessible(page, opts)` with defaults `tags: ['wcag2a','wcag2aa']` + `includedImpacts: ['serious','critical']`. Used in `apps/admin/tests/e2e/a11y.spec.ts` (login smoke, 1 test).
- `apps/client/tests/e2e/utils/assertions.ts` — `CustomAssertions.expectPageToBeAccessible(opts)` with defaults `tags: ['wcag2a','wcag2aa']` + `includedImpacts: ['minor','moderate','serious','critical']`. **No spec uses it** (`tests/e2e/tests/` only has analytics/auth/publishing/visual; no `a11y.spec.ts`).
- Defaults drift: client fails CI on `minor` + `moderate` too — too noisy for a baseline. admin blocks only `serious` + `critical`, which is industry practice (Deque docs).

**Why default heuristic is insufficient**: without a canon, future developers copy the helper from one app or the other and propagate the drift. Also, WCAG 2.1 is missing from the tags (admin only covers 2.0). And the coverage is 1 page in total — we need a wider baseline.

## Research scope

- **Search keywords**: `playwright a11y axe wcag tag set`, `axe-core impact severity ci threshold`, `@axe-core/playwright canonical pattern`.
- **Sources targeted**: Playwright official docs, Deque (axe-core authors) API docs, axe-core-npm GitHub README.
- **Sources excluded**: jest-axe content (different library, different API); blog posts pre-WCAG 2.1.

## Sources consulted

### [1] Playwright — Accessibility Testing — [playwright.dev](https://playwright.dev/docs/accessibility-testing)

- **Fetched**: 2026-05-07
- **Authority**: Playwright official documentation.
- **Key claims**:
  - Canonical pattern: `import AxeBuilder from '@axe-core/playwright'; const results = await new AxeBuilder({ page }).analyze(); expect(results.violations).toEqual([])`.
  - WCAG conformance via `.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])`. Recommended set covers WCAG 2.0 + 2.1 Level A + AA.
  - Scoping methods: `.include(selector)`, `.exclude(selector)`, `.disableRules(['rule-id'])`.
  - Fixture pattern recommended for reuse: extend `test` with `makeAxeBuilder` factory that pre-applies tags + common excludes.
  - "AxeBuilder.analyze() will scan the page in its current state" — must interact (login, navigate, expand menu) before `.analyze()` if testing dynamic states.
- **My reading**: the canonical pattern of the official documentation maps 1-to-1 onto what admin's helper already does. Diff: tags (admin has only wcag2; the canon recommends adding wcag21).

### [2] Deque — axe API documentation — [deque.com](https://www.deque.com/axe/core-documentation/api-documentation/)

- **Fetched**: 2026-05-07
- **Authority**: Deque Systems — the authors of axe-core.
- **Key claims**:
  - Tag canon for production: `wcag2aa` (legal baseline), `wcag21aa` (current industry default), `wcag22aa` (latest standard, 2023). The `best-practice` tag is optional — recommended but not legally binding.
  - **Impact severity levels**: `minor`, `moderate`, `serious`, `critical`.
  - **Recommended CI strategy**: fail the pipeline on `serious` + `critical`; `moderate` + `minor` as warnings/informational. Reason: `serious`/`critical` are real usage blockers (e.g., a screen reader cannot navigate); `minor`/`moderate` are refinements. Blocking CI on `minor` causes fatigue, and the checks get disabled.
  - `color-contrast` rule: expensive (paint-level analysis); recommended to run on a small set of representative pages, not in every test.
  - Violation object shape: `{ id, impact, description, helpUrl, nodes }`.
- **My reading**: it confirms that admin's default (`['serious', 'critical']`) is aligned with Deque guidance; client's default (`['minor','moderate','serious','critical']`) overshoots.

### [3] axe-core-npm — @axe-core/playwright README — [github.com](https://github.com/dequelabs/axe-core-npm/blob/develop/packages/playwright/README.md)

- **Fetched**: 2026-05-07
- **Authority**: axe-core-npm official package README.
- **Key claims**:
  - Full API surface: `.analyze()`, `.include()`, `.exclude()`, `.withRules()`, `.withTags()`, `.disableRules()`, `.options()`, `.setLegacyMode()`.
  - No global setup — instantiate `AxeBuilder` per test with `page`.
  - "Automatically injects into all frames" by default. `setLegacyMode(true)` disables cross-origin frame testing.
  - axe-core's patch versions match semver — minor bumps are OK, major ones are not.
- **My reading**: having no global config simplifies the wiring. The existing helpers already follow the pattern.

## Synthesis

### Recommendation: USE — canonical helper signature aligned across both apps

For E2E a11y testing in `apps/admin/tests/e2e/` and `apps/client/tests/e2e/`:

1. **Canonical helper signature** (already implemented in admin; replicate it in client):
   ```typescript
   export async function expectPageToBeAccessible(
     page: Page,
     options: A11yOptions = {}
   ): Promise<void>;
   ```
2. **Canon defaults**:
   - `tags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']` — WCAG 2.0 + 2.1, Level A + AA. Standard legal coverage.
   - `includedImpacts: ['serious', 'critical']` — fail CI only on these two. `minor`/`moderate` stay as warnings (they do not fail the pipeline).
   - `exclude: []` — no global excludes; each spec adds its own according to context.
3. **Helper location**: `apps/<app>/tests/e2e/utils/a11y.ts` — standalone export (NOT a method on a class). Simpler to tree-shake + more reusable.
4. **Spec coverage baseline**: each app has an `a11y.spec.ts` covering at least:
   - A critical public page (login).
   - A representative post-login page (dashboard / inbox / scheduling).
     More pages are added incrementally when a new route falls under "compliance scope".
5. **Tag override per spec**: for pages that explicitly need WCAG 2.2 (e.g., new ARIA Authoring patterns), `expectPageToBeAccessible(page, { tags: [...defaults, 'wcag22aa'] })`.
6. **Impact override per spec**: for known legacy pages with `moderate` violations under remediation, `includedImpacts: ['serious', 'critical']` (already the default — no override). For a temporary strict audit: `includedImpacts: ['minor', 'moderate', 'serious', 'critical']` with a time-boxed scope (not committed).

### Recommendation: ALIGN — fix the client helper drift

`apps/client/tests/e2e/utils/assertions.ts:CustomAssertions.expectPageToBeAccessible` currently uses `includedImpacts: ['minor','moderate','serious','critical']` as its default — an overshoot vs the canon. Action:

- **Option A (preferred)**: refactor to a standalone function in `apps/client/tests/e2e/utils/a11y.ts` (a mirror of admin's), with canon defaults. Leave the method in `CustomAssertions` as a deprecated wrapper that calls the new function (it preserves backward compatibility with specs that already use the class).
- **Option B**: only change the defaults in the class method. More conservative, same goal. Acceptable, but it leaves the structural divergence.

I recommend Option A — it aligns with admin + simplifies.

### Recommendation: AVOID

- **`includedImpacts: ['minor', 'moderate', 'serious', 'critical']` as a global default**. It generates CI noise; the devs disable the job. For a deep audit, use a per-spec override with a time box.
- **`best-practice` tag in CI**. Recommendations, not legal requirements. They can generate violations that are not real bugs (e.g., "no h1" on a page that is a content fragment). Turn it on only if product/design validates the list of improvements.
- **Global `disableRules(['color-contrast'])`**. A temptation when theme switching fails. Better: scope it per page, with `.exclude()` on the selectors that depend on the theme + make sure the test runs in a known theme (Playwright fixture).
- **AxeBuilder in Vitest unit tests**. AxeBuilder is Playwright-only (it needs a real browser). For component-level a11y use jest-axe with jsdom (a separate canon entry, future).
- **Snapshot of the full `violations` array**. Fragile — any change in a help URL or description breaks the snapshot. Use `violationFingerprints({ id, nodes.target })` if a snapshot is needed.

### Tradeoffs / decision tree

- **Critical public page (auth)**: minimal spec + canon defaults. Blocking on serious/critical.
- **Core post-auth page (dashboard)**: spec with the login fixture first, then analyze. Canon defaults.
- **Page with an external embed (third-party charts)**: `.exclude('.recharts-wrapper')` or similar, to avoid reporting violations we cannot fix.
- **Page with animation / theme switching**: spec with `await page.waitForLoadState('networkidle')` + set a known theme before analyze.
- **Page with dynamic state (open modal)**: trigger the modal, `await page.locator('[role="dialog"]').waitFor()`, then analyze.

### Pinned values / flags

- **WCAG tags (CI default)**: `['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']`.
- **Impact threshold (CI default)**: `['serious', 'critical']` blocking; `['minor', 'moderate']` informational only.
- **Helper signature**: `expectPageToBeAccessible(page: Page, options?: { tags?: string[]; exclude?: string[]; includedImpacts?: A11yImpact[] }): Promise<void>`.
- **Helper location**: `apps/<app>/tests/e2e/utils/a11y.ts` — one file per app, exporting one function.
- **Spec location**: `apps/<app>/tests/e2e/a11y.spec.ts` — one file per app, growing list of `test()` blocks per page.
- **Library version**: `@axe-core/playwright@4.10.2` (already pinned exact in apps/{admin,client}/package.json).
- **Coverage minimum**: 2 pages per app (1 public + 1 post-login).

## Proposed canon-index.json entry

```json
{
  "key": "axe-core-playwright-a11y-testing-for-e2e-suites",
  "topic": "axe-core/playwright a11y testing for E2E suites",
  "area": "Testing · E2E · Accessibility",
  "summary": "Canonical pattern for WCAG 2.0 + 2.1 Level A + AA accessibility testing in Playwright E2E suites via @axe-core/playwright. Each app exports one standalone helper at apps/<app>/tests/e2e/utils/a11y.ts: expectPageToBeAccessible(page, options?) wraps AxeBuilder with canon defaults — tags ['wcag2a','wcag2aa','wcag21a','wcag21aa'] + includedImpacts ['serious','critical'] (per Deque CI guidance: minor/moderate are informational, not blocking). Specs at apps/<app>/tests/e2e/a11y.spec.ts cover at minimum 1 public page (login) + 1 post-login page (dashboard / inbox / scheduling). Per-spec overrides via options for stricter audits or page-specific tag bumps (e.g., wcag22aa). Avoid: best-practice tag in CI (recommendations, not legal); blocking on minor/moderate (causes CI fatigue); snapshotting full violations array (fragile).",
  "keyTakeaway": "AxeBuilder per-test (no global setup) + canonical helper expectPageToBeAccessible(page, options?) at apps/<app>/tests/e2e/utils/a11y.ts. Canon defaults: tags ['wcag2a','wcag2aa','wcag21a','wcag21aa'], impacts ['serious','critical']. Cover 1 public + 1 post-login page minimum per app. Existing class-method form on CustomAssertions in apps/client is deprecated in favor of the standalone function (mirrors apps/admin shape). minor/moderate impacts are informational, never blocking — Deque CI guidance.",
  "patternAdopted": "Canonical helper (mirror admin → align client): `export async function expectPageToBeAccessible(page: Page, options: A11yOptions = {}): Promise<void>` at apps/<app>/tests/e2e/utils/a11y.ts. Defaults: tags ['wcag2a','wcag2aa','wcag21a','wcag21aa'], includedImpacts ['serious','critical'], exclude []. Filters violations by impact set, asserts toHaveLength(0) with diagnostic message listing offending rules. Specs at apps/<app>/tests/e2e/a11y.spec.ts use the helper directly. Phase 2 implementation: (1) Update apps/admin helper to add wcag21a/wcag21aa to default tags. (2) Mirror helper to apps/client/tests/e2e/utils/a11y.ts (NEW). (3) Mark CustomAssertions.expectPageToBeAccessible deprecated; delegate to the new standalone function. (4) Add apps/client/tests/e2e/a11y.spec.ts smoke (login page mirroring admin). (5) Optionally add post-login page spec in both apps. Existing admin a11y.spec.ts gets the wcag21 tag bump in its single test. POC = the client smoke spec.",
  "usedIn": "Phase 2 audit-toolkit activation (2026-05-07) — axe-core/playwright canon + helper alignment + client smoke. Pre-existing admin helper validated as canon-aligned with one tag-set extension.",
  "date": "2026-05-07",
  "sources": [
    {
      "url": "https://playwright.dev/docs/accessibility-testing",
      "fetchedAt": "2026-05-07",
      "title": "Playwright — Accessibility Testing (AxeBuilder canonical pattern)"
    },
    {
      "url": "https://www.deque.com/axe/core-documentation/api-documentation/",
      "fetchedAt": "2026-05-07",
      "title": "Deque — axe API documentation (WCAG tags + impact severity CI guidance)"
    },
    {
      "url": "https://github.com/dequelabs/axe-core-npm/blob/develop/packages/playwright/README.md",
      "fetchedAt": "2026-05-07",
      "title": "axe-core-npm — @axe-core/playwright README (full API surface)"
    }
  ],
  "synthesizedBy": "claude-opus-4-7",
  "confidence": "high",
  "lastVerified": "2026-05-07",
  "version": 1,
  "appliesTo": [
    "apps/admin/tests/e2e/",
    "apps/client/tests/e2e/",
    "apps/admin/tests/e2e/utils/",
    "apps/client/tests/e2e/utils/"
  ]
}
```

## Impact on existing code

**Files that ALIGN with canon (validation, light update only)**:

- `apps/admin/tests/e2e/utils/a11y.ts` — canon-aligned shape. **Extend defaults** to include `wcag21a` + `wcag21aa` tags.
- `apps/admin/tests/e2e/a11y.spec.ts` — keeps working; the tag bump goes through the helper with no change to the spec.

**Files MODIFY (drift fix)**:

- `apps/client/tests/e2e/utils/assertions.ts:CustomAssertions.expectPageToBeAccessible` — deprecate or refactor to delegate to new standalone function. Preferred: leave method as thin wrapper that calls the new function, mark `@deprecated` in JSDoc.

**Files NEW**:

- `apps/client/tests/e2e/utils/a11y.ts` — standalone function mirroring admin's shape with canon defaults.
- `apps/client/tests/e2e/a11y.spec.ts` — smoke test (login page) using the new helper.

**Files NOT touched** (until naturally opened):

- Other spec files in either app — no a11y assertions added retroactively.

## Maintainer's review

- [x] Sources are sufficient (3: Playwright docs + Deque + axe-core-npm)
- [x] Recommendations match project values (drift fix + minimal coverage baseline)
- [x] Pinned values reasonable (WCAG 2.0+2.1 AA, serious/critical only)
- [x] Approve append to `canon_research_index.md`
- [x] Trigger client helper alignment + apps/client a11y smoke spec POC
- [x] Trigger admin helper tag-set extension (add wcag21a/wcag21aa)
- Notes: approved 2026-05-07.
