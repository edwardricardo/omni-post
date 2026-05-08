# Canon Candidate — axe-core/playwright a11y testing for E2E suites

## Metadata

- **Task surfacing this gap**: Phase 2 audit-toolkit activation. Initial audit dijo "axe-core 4.10.3 instalado pero cero `injectAxe`/`toHaveNoViolations` — dormido". Re-audit con grep correcto (`AxeBuilder`) revela que SÍ hay helpers wireados en ambos apps, pero con drift de defaults y cobertura mínima (1 spec en admin, 0 en client).
- **Specific decision**: cuál es el canon para (a) WCAG tag set, (b) impact severity threshold (qué impacta debe fallar CI vs warning), (c) ubicación del helper, (d) cobertura mínima por app (qué páginas deben tener spec a11y), (e) qué hacer con la divergencia entre admin (`expectPageToBeAccessible` standalone fn con defaults strict) y client (`CustomAssertions.expectPageToBeAccessible` method con defaults laxos).
- **Decision date**: 2026-05-07
- **Synthesized by**: claude-opus-4-7
- **Status**: pending

## Why this gap exists

**Existing canon adjacent**: ninguna entry en canon-index.json sobre a11y testing. Helpers ya existen en código pero no hay regla pinned ni cobertura uniforme.

**State actual del repo**:

- `apps/admin/tests/e2e/utils/a11y.ts` — standalone `expectPageToBeAccessible(page, opts)` con defaults `tags: ['wcag2a','wcag2aa']` + `includedImpacts: ['serious','critical']`. Usado en `apps/admin/tests/e2e/a11y.spec.ts` (smoke de login, 1 test).
- `apps/client/tests/e2e/utils/assertions.ts` — `CustomAssertions.expectPageToBeAccessible(opts)` con defaults `tags: ['wcag2a','wcag2aa']` + `includedImpacts: ['minor','moderate','serious','critical']`. **No hay specs que lo usen** (`tests/e2e/tests/` solo tiene analytics/auth/publishing/visual; ningún `a11y.spec.ts`).
- Drift de defaults: client falla CI por `minor` + `moderate` también — demasiado noisy para baseline. admin solo bloquea `serious` + `critical` lo cual es la práctica industria (Deque docs).

**Why default heuristic is insufficient**: sin canon, los desarrolladores futuros copian helper de un app u otro y propagan el drift. Además, falta WCAG 2.1 en los tags (admin solo cubre 2.0). Y la cobertura es 1 página total — necesitamos baseline ampliado.

## Research scope

- **Search keywords**: `playwright a11y axe wcag tag set`, `axe-core impact severity ci threshold`, `@axe-core/playwright canonical pattern`.
- **Sources targeted**: Playwright official docs, Deque (axe-core authors) API docs, axe-core-npm GitHub README.
- **Sources excluidas**: jest-axe content (different library, different API); blog posts pre-WCAG 2.1.

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
- **My reading**: el patrón canónico de la documentación oficial mapea 1-to-1 con lo que admin's helper ya hace. Diff: tags (admin tiene solo wcag2; canon recomienda agregar wcag21).

### [2] Deque — axe API documentation — [deque.com](https://www.deque.com/axe/core-documentation/api-documentation/)

- **Fetched**: 2026-05-07
- **Authority**: Deque Systems — autores de axe-core.
- **Key claims**:
  - Tag canon para producción: `wcag2aa` (baseline legal), `wcag21aa` (industry default actual), `wcag22aa` (latest standard 2023). El tag `best-practice` es opcional — recomendado pero no legal-binding.
  - **Impact severity levels**: `minor`, `moderate`, `serious`, `critical`.
  - **CI strategy recomendada**: fail pipeline en `serious` + `critical`; `moderate` + `minor` como warnings/informational. Razón: `serious`/`critical` son blockers reales de uso (e.g., screen reader no puede navegar); `minor`/`moderate` son refinements. Bloquear CI en `minor` genera fatiga y se desactivan.
  - `color-contrast` rule: expensive (paint-level analysis); recomendado correr en small set de páginas representativas, no en cada test.
  - Violation object shape: `{ id, impact, description, helpUrl, nodes }`.
- **My reading**: confirma que el default de admin (`['serious', 'critical']`) está alineado con Deque guidance; el default de client (`['minor','moderate','serious','critical']`) es overshoot.

### [3] axe-core-npm — @axe-core/playwright README — [github.com](https://github.com/dequelabs/axe-core-npm/blob/develop/packages/playwright/README.md)

- **Fetched**: 2026-05-07
- **Authority**: axe-core-npm official package README.
- **Key claims**:
  - API surface completa: `.analyze()`, `.include()`, `.exclude()`, `.withRules()`, `.withTags()`, `.disableRules()`, `.options()`, `.setLegacyMode()`.
  - Sin global setup — instancia `AxeBuilder` per-test con `page`.
  - "Automatically injects into all frames" por default. `setLegacyMode(true)` desactiva cross-origin frame testing.
  - Patch version de axe-core matches semver — minor bumps OK, major no.
- **My reading**: no global config simplifica el wiring. Helpers existentes ya siguen el patrón.

## Synthesis

### Recommendation: USE — canonical helper signature aligned across both apps

For E2E a11y testing in `apps/admin/tests/e2e/` y `apps/client/tests/e2e/`:

1. **Canonical helper signature** (ya implementada en admin, replicar en client):
   ```typescript
   export async function expectPageToBeAccessible(
     page: Page,
     options: A11yOptions = {}
   ): Promise<void>;
   ```
2. **Defaults canon**:
   - `tags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']` — WCAG 2.0 + 2.1, Level A + AA. Cobertura legal estándar.
   - `includedImpacts: ['serious', 'critical']` — fail CI solo en estos dos. `minor`/`moderate` quedan como warnings (no fallan pipeline).
   - `exclude: []` — no global excludes; cada spec añade los suyos según contexto.
3. **Helper location**: `apps/<app>/tests/e2e/utils/a11y.ts` — standalone export (NO method on a class). Más simple de tree-shake + más reusable.
4. **Spec coverage baseline**: cada app tiene `a11y.spec.ts` cubriendo al menos:
   - Página pública crítica (login).
   - Una página post-login representativa (dashboard / inbox / scheduling).
     Más páginas se agregan incrementalmente cuando una nueva ruta cae bajo "compliance scope".
5. **Tag override por spec**: para páginas que necesitan WCAG 2.2 explícitamente (e.g., ARIA Authoring patterns nuevos), `expectPageToBeAccessible(page, { tags: [...defaults, 'wcag22aa'] })`.
6. **Impact override por spec**: para páginas legacy sabidas con violations `moderate` en remediation, `includedImpacts: ['serious', 'critical']` (el default ya — sin override). Para auditoría temporal estricta: `includedImpacts: ['minor', 'moderate', 'serious', 'critical']` con time-boxed scope (no committed).

### Recommendation: ALIGN — fix the client helper drift

`apps/client/tests/e2e/utils/assertions.ts:CustomAssertions.expectPageToBeAccessible` actualmente usa `includedImpacts: ['minor','moderate','serious','critical']` como default — overshoot vs canon. Action:

- **Opción A (preferida)**: refactor a standalone function en `apps/client/tests/e2e/utils/a11y.ts` (mirror del admin), con defaults canon. Dejar el method en `CustomAssertions` como deprecated wrapper que llama a la function nueva (preserva backward-compat con specs que ya usen el class).
- **Opción B**: solo cambiar los defaults en el class method. Más conservador, mismo objetivo. Aceptable pero deja la divergencia estructural.

Recomiendo Opción A — alinea con admin + simplifica.

### Recommendation: AVOID

- **`includedImpacts: ['minor', 'moderate', 'serious', 'critical']` como default global**. Genera CI noise; los devs desactivan el job. Para auditoría profunda, usar override per-spec con time-box.
- **`best-practice` tag en CI**. Recomendaciones, no requirements legales. Pueden generar violaciones que no son bugs reales (e.g., "no h1" en una page que es content-fragment). Activar solo si product/design valida la lista de mejoras.
- **`disableRules(['color-contrast'])` global**. Tentación cuando theme switching falla. Mejor: scope per-page con `.exclude()` los selectores que dependen del theme + asegurar que el test corra en un theme conocido (Playwright fixture).
- **AxeBuilder en unit tests Vitest**. AxeBuilder es Playwright-only (necesita un browser real). Para component-level a11y use jest-axe con jsdom (separate canon entry, future).
- **Snapshot de `violations` array completo**. Frágil — cualquier cambio en help URL o description rompe el snapshot. Usar `violationFingerprints({ id, nodes.target })` si snapshot es necesario.

### Tradeoffs / decision tree

- **Page pública crítica (auth)**: spec mínimo + defaults canon. Bloqueo en serious/critical.
- **Page post-auth core (dashboard)**: spec con login fixture primero, después analyze. Defaults canon.
- **Page con embed externo (charts third-party)**: `.exclude('.recharts-wrapper')` o similar para evitar reportar violations que no podemos arreglar.
- **Page con animation / theme switching**: spec con `await page.waitForLoadState('networkidle')` + setear theme conocido antes de analyze.
- **Page con dynamic state (modal abierto)**: trigger el modal, `await page.locator('[role="dialog"]').waitFor()`, después analyze.

### Pinned values / flags

- **WCAG tags (CI default)**: `['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']`.
- **Impact threshold (CI default)**: `['serious', 'critical']` blocking; `['minor', 'moderate']` informational only.
- **Helper signature**: `expectPageToBeAccessible(page: Page, options?: { tags?: string[]; exclude?: string[]; includedImpacts?: A11yImpact[] }): Promise<void>`.
- **Helper location**: `apps/<app>/tests/e2e/utils/a11y.ts` — one file per app, exporting one function.
- **Spec location**: `apps/<app>/tests/e2e/a11y.spec.ts` — one file per app, growing list of `test()` blocks per page.
- **Library version**: `@axe-core/playwright@4.10.2` (already pinned exact in apps/{admin,client}/package.json).
- **Coverage minimum**: 2 páginas per app (1 público + 1 post-login).

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
- `apps/admin/tests/e2e/a11y.spec.ts` — keeps working; tag bump pasa por el helper sin cambio en la spec.

**Files MODIFY (drift fix)**:

- `apps/client/tests/e2e/utils/assertions.ts:CustomAssertions.expectPageToBeAccessible` — deprecate or refactor to delegate to new standalone function. Preferred: leave method as thin wrapper that calls the new function, mark `@deprecated` in JSDoc.

**Files NEW**:

- `apps/client/tests/e2e/utils/a11y.ts` — standalone function mirroring admin's shape with canon defaults.
- `apps/client/tests/e2e/a11y.spec.ts` — smoke test (login page) using the new helper.

**Files NOT touched** (until naturally opened):

- Other spec files in either app — no a11y assertions added retroactively.

## Edward's review

- [x] Sources are sufficient (3: Playwright docs + Deque + axe-core-npm)
- [x] Recommendations match project values (drift fix + minimal coverage baseline)
- [x] Pinned values reasonable (WCAG 2.0+2.1 AA, serious/critical only)
- [x] Approve append to `canon_research_index.md`
- [x] Trigger client helper alignment + apps/client a11y smoke spec POC
- [x] Trigger admin helper tag-set extension (add wcag21a/wcag21aa)
- Notes: approved 2026-05-07.
