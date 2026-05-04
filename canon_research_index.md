# Canon Research Index

Fuentes externas validadas por batch. Consultar ANTES de cualquier nuevo research para evitar re-investigar.

---

## Code Quality / Dead Code Detection

### knip — recognized canon

- Ya documentado en commit `e4ccb89` (T1-E revisitado). Effective TypeScript 2026 + Vercel adoption.

### jscpd — defaults para monorepos TypeScript

- **URL:** https://github.com/kucherenko/jscpd
- **Resumen:** `minTokens: 50`, `threshold: 1` (% duplicación), `format: ts/tsx/js/jsx`, ignore `tests/**`, `fixtures/**`, `dist/**`, `.next/**`, `generated/**`, `**/*.stories.tsx`. `exitCode: 1` para hard-fail en CI.
- **Consumido por:** B-tools-1 (2026-05-04) — creación de `jscpd.json` (config previo era defaults inline).

---

## A11y / E2E

### @axe-core/playwright — canonical helper pattern

- **URL:** https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright
- **Resumen:** `new AxeBuilder({ page }).withTags(["wcag2a","wcag2aa"]).analyze()` devuelve `{ violations: Violation[] }`. Patrón canónico: helper file `tests/e2e/utils/a11y.ts` reutilizable por specs. Filtrar por `impact in ["serious","critical"]` para no fallar por minor/moderate noise.
- **Consumido por:** B-tools-1 (2026-05-04) — `apps/admin/tests/e2e/utils/a11y.ts` espeja patrón ya implementado en `apps/client/tests/e2e/utils/assertions.ts`.

---

## Visual Regression

### reg-suit — storage backend (NO existe `reg-publish-github-plugin`)

- **URL:** https://github.com/reg-viz/reg-suit
- **Resumen:** reg-suit canon tiene plugins oficiales: `reg-publish-s3-plugin`, `reg-publish-gcs-plugin`, `reg-publish-fs-plugin`. **NO** existe un plugin oficial para "snapshots en branch del repo". `reg-notify-github-plugin` solo notifica vía PR comment, no almacena. Decisión de storage es prerequisito para wirear reg-suit.
- **Consumido por:** B-tools-1 (2026-05-04) — reg-suit DEFERIDO a PR-48 (decisión de storage pendiente).

---

## Git Hygiene

(referencias previas — T1-C revisitado canon, commit `57e3c30`)

---

## Logging / Observability

(referencias previas — apps/api/src/lib/logger.ts canon — ver CLAUDE.md §Logging)
