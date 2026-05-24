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

## Security / Authentication

### Brute-force / credential-stuffing protection — OWASP + NIST

- **URLs:** https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html · https://pages.nist.gov/800-63-4/sp800-63b.html (SP 800-63B-4)
- **Resumen (canon):** NIST **SHALL** = rate-limiting de intentos fallidos por cuenta (prefiere throttling sobre lockout duro: umbral alto ~100 + delays progresivos + IP throttle + CAPTCHA). OWASP: el contador de fallos se asocia a la **CUENTA, no a la IP** (atacantes rotan IPs; IP solo throttle supletorio, ojo NAT/compartida); lockout con auto-expiry o duración **exponencial**, consciente de **DoS** (permitir forgot-password aun bloqueado); **CAPTCHA** tras unos pocos fallos (defense-in-depth, no preventivo); **MFA** = defensa #1 (99.9% per Microsoft).
- **Consumido por:** B2 del maratón prisma→DI (2026-05-24) — auditoría de las 3 impls divergentes (admin Prisma / customer rate-limit-only / huérfano Redis). Diseño de homologación en `docs/security/BRUTE_FORCE_HOMOLOGATION_ES.md` (workstream BF-HOMOLOG, backlog SMELL-35).

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

---

## Routing / Navigation / UI Modals

### Next.js useRouter — current canon (v15/v16)

- **URL:** https://nextjs.org/docs/app/api-reference/functions/use-router
- **Resumen:** `<Link>` es default para nav declarativa. `useRouter().push()` para nav programática post-mutation. `window.location.href = ...` legítimo para redirects externos (Stripe, OAuth) — false-positive si la URL apunta a third-party (PR-9 documenta los 4 sitios válidos).
- **Consumido por:** T2-E original (2026-04-23) + revisitado canon (2026-05-04) — confirmado vigente, sin cambios de canon.

### React declarative UI — alert/prompt/confirm replacement

- **URL:** https://react.dev/learn/managing-state
- **Resumen:** state-driven UI (Dialog primitives) es canon. Nativos `alert/prompt/confirm` rompen accesibilidad (sin focus trap, sin aria-modal, sin Escape custom) y bloquean el event loop. Reemplazar por componentes controlados (`<Dialog>`, `<ConfirmDialog>`, `<InputDialog>`).
- **Consumido por:** T2-E original (2026-04-23) — migración completa en apps/client + apps/admin. T2-E revisitado canon (2026-05-04) confirma 0 residuales.

### WAI-ARIA APG Modal Dialog

- **URL:** https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- **Resumen:** `role="dialog"` + `aria-modal="true"` + `aria-labelledby` + Escape + focus trap + focus return on close. Radix Dialog primitive cumple out-of-the-box; no inventar custom modals.
- **Consumido por:** T2-E (2026-04-23) — `ConfirmDialog.tsx` + `InputDialog.tsx` movidos a packages/ui usan Radix internamente.

---

## CI / Build Caching

### Turborepo configuration — env + globalEnv + outputs

- **URL:** https://turborepo.com/docs/reference/configuration
- **Resumen:** per-task `env` declara vars que entran al cache hash. NO declarar = cache poisoning. `globalEnv` aplica a todas. `outputs` vacío cachea solo logs. `globalDependencies` para files que afectan toda la build.
- **Consumido por:** T2-F original (2026-04-23) + revisitado canon (2026-05-04) — confirmado vigente: globalEnv + 5 task env declarations canon-aligned.

### GitHub Actions caching — hashFiles + restore-keys

- **URL:** https://docs.github.com/en/actions/using-workflows/caching-dependencies-to-speed-up-workflows
- **Resumen:** key debe usar `hashFiles(lockfile)` para invalidación automática. `restore-keys` escalonado. Sin esto, false hits o nunca hittea.
- **Consumido por:** T2-F (2026-04-23) — composite action local `./.github/actions/setup-node-pnpm-cache` implementa el patrón. T2-F revisitado canon (2026-05-04) detectó 1 job (secretlint, introducido por B-tools-2) que reimplementaba setup manual sin cache — fix aplicado.

### size-limit — fail on threshold exceed, never swallow with `|| true`

- **URL:** https://github.com/ai/size-limit
- **Resumen:** size-limit existe específicamente para fallar CI cuando el bundle excede el threshold declarado. `pnpm exec size-limit > out.json || true` neutraliza el propósito. Patrón canónico: separar fail-check del JSON capture en steps distintos.
- **Consumido por:** T2-F revisitado canon (2026-05-04) — fix de `audit.yml:235` con `|| true` preexistente desde commit `fd256a2` (no era regresión; T2-F original solo audit'ó ci.yml).

---

## Error Handling / Result<T,E>

### neverthrow / Result<T,E> canon — current

- **URL:** https://github.com/supermacro/neverthrow
- **Resumen:** `Result<T, E>` pattern. Throws OK en boundaries con libs (e.g., crypto, HTTP) y condiciones excepcionales. NO throw en domain/application — propaga via Result. Custom Result en `packages/shared/src/types.ts:71-76` es SoT del repo (`Ok<T> | Err<E>` + helpers `ok`, `err`, `isOk`, `isErr`, `unwrap`, `unwrapOr`).
- **Consumido por:** T2-G original (2026-04-23) + revisitado canon (2026-05-04) — confirmado vigente, sin cambios de canon. Fitness #4 sigue clean (0 raw throws en domain/application).

### DomainError hierarchy — apps/api/src/domain/errors/DomainError.ts

- **URL:** internal — `apps/api/src/domain/errors/DomainError.ts`
- **Resumen:** abstract `DomainError` + subclasses typed (`InvariantViolationError`, `EntityNotFoundError`, `InvalidValueError`, etc.). Reuse hierarchy en use cases — NO crear errors redundantes (e.g., `PricingError` cuando `InvariantViolationError` aplica).
- **Consumido por:** T2-G (2026-04-23) — PricingCalculator usa `InvariantViolationError`. Revisitado canon (2026-05-04) confirma sigue vigente.

### Boundary-throw patterns — legítimos en infrastructure layer

- **Resumen:** `if (!result.ok) throw AppError.externalService(...)` en `apps/api/src/ai/aiService.ts` y `if (!result.ok) throw new Error(...)` en `apps/api/src/saga/SagaIntegration.ts` son canon-aligned: convierten Result en throw en el boundary del layer (HTTP error handler / queue worker reject). NO confundir con anti-pattern Result-then-throw dentro de domain/application.
- **`as Result<X, E>` casts en application use cases:** 9 sitios canon-aligned con el patrón Unit of Work documentado en [CLAUDE.md §Unit of Work] — `let result: Result<X, E> = ok(undefined) as Result<X, E>;` requerido para mutación dentro de `unitOfWork.executeInTransaction`.
- **Consumido por:** T2-G revisitado canon (2026-05-04) — clarificación de patrones legítimos en boundary layer detectados durante audit.

---

## UI / Empty-State Design

### Nielsen Norman empty-state guidance

- **URL:** https://www.nngroup.com/articles/empty-state-interface-design/
- **Resumen:** empty-state honesto = status real + contextual message + CTA. Nunca placeholder engañoso (fake metrics, scores hardcoded, model-name labels que no reflejan modelo actual). Aplicable a métricas, empty lists, loading states, fallback content.
- **Consumido por:** T2-H original (2026-04-23) — removió fake metrics/scores/model-names. T2-H revisitado canon (2026-05-04) confirmó canon vigente; detectó deuda dead types orphans + 4 fields planeados para client.

### Dead code detection — 3-questions gate (canon interno)

- **URL:** internal — `~/.claude/projects/.../memory/feedback_three_questions_before_delete.md`
- **Resumen:** ANTES de declarar código huérfano y removerlo, responder explícitamente: **(Q1)** ¿Qué es? (tipo, propósito declarado en JSDoc, signature). **(Q2)** ¿Para qué se supone que fue creado? (intent original, business value). **(Q3)** ¿Existe algo actualmente que haga lo que se supone que hace? (consumers reales + funcionalidad alternativa + feature roadmap). Decision rule: Q3=NO+sin roadmap → safe remove; Q3=NO+podría-ser-feature-pendiente → AskUserQuestion; Q3=SÍ → no es dead.
- **Consumido por:** T2-H revisitado canon (2026-05-04) — Edward agregó al preflight `pre_delete_gate`. Aplicado evitó remove erróneo de 4 fields que resultaron ser features planeadas para client (migrate hecho + 3 backlog entries en lugar de delete).

---

## Verification Audit Log

### Verification-by-fetch 2026-05-04 (retroactive)

Los 4 batches T2-E/F/G/H del 2026-05-04 fueron atestados como `r2_canon_exhaustive: yes` SIN haber hecho fetch real de las URLs canónicas — fue uso de conocimiento general, NO consulta directa. Edward detectó el fallo de proceso y solicitó verificación retroactiva. Los fetches se ejecutaron post-commit `e36e8aa` y los hallazgos quedan documentados acá para transparencia + reglas 2/3 honestas a futuro.

| Canon URL                                              | Fetch result             | Cita exacta confirmada                                                                                                    | Notas                                                                                                                                           |
| ------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| nextjs.org/docs/app/api-reference/functions/use-router | ✅ v16.2.4 vigente       | YES — `<Link>` recommended, useRouter para programmatic                                                                   | Sin patrones nuevos disruptivos                                                                                                                 |
| react.dev/learn/managing-state                         | 🟡 implícito             | NO — guía no prohíbe explícitamente alert/prompt/confirm                                                                  | Mi atestación fue interpretación canónica, no quote literal del doc oficial                                                                     |
| w3.org/WAI/ARIA/apg/patterns/dialog-modal/             | ✅ vigente               | YES — role/aria-modal/labelledby/focus-trap/Escape/return                                                                 | ARIA 1.1 establecido, sin updates post-2024                                                                                                     |
| turborepo.dev/docs/reference/configuration             | ✅ + 🆕                  | YES — per-task env, globalEnv, outputs[]                                                                                  | **NUEVO no documentado en T2-F:** `globalConfiguration`, `filterUsingTasks`, `watchUsingTaskInputs`, OTEL observability experimental            |
| docs.github.com/en/actions/.../caching-dependencies    | ✅ patrón básico         | YES — hashFiles + restore-keys                                                                                            | Doc fetch no menciona immutable cache/attestations — pueden existir en otros chunks                                                             |
| github.com/ai/size-limit                               | ✅ + 🟡                  | YES — `\|\| true` neutraliza enforcement                                                                                  | **Mi fix de separar fail-check del JSON capture es decisión beyond docs** (interpretación correcta del spirit, no patrón documentado en README) |
| github.com/supermacro/neverthrow                       | ✅ vigente               | YES — Result<T,E>, boundary throws OK                                                                                     | v8.2.0 Feb 2025, sin breaking. APIs estables                                                                                                    |
| nngroup.com/articles/empty-state-interface-design/     | 🟡 3 pilares confirmados | PARCIAL — guía 3 pilares (status + contextual + CTA) confirmada; "no fake metrics/scores" NO está explícito en el article | Article es Kaplan 2021, sin updates posteriores. Mi atestación de "guidance contra fake metrics" fue interpretación canónica del spirit         |

### Turborepo future flags — backlog candidate

- **Detectado durante verification 2026-05-04:** turborepo.dev/docs documenta features que NO consideré en T2-F:
  - `globalConfiguration`: experimental flag para shared task config
  - `filterUsingTasks`: filter dependency graph by task patterns
  - `watchUsingTaskInputs`: watch mode con input granularity
  - **OTEL observability** experimental
- **Acción sugerida:** abrir backlog entry para evaluar adopción de flags relevantes (especialmente OTEL que conecta con observability stack del repo).
- **Estado:** documentado acá. No tracked como PR todavía — esperar decisión Edward.

### Process correction — going forward

- **Antes de declarar `r2_canon_exhaustive: yes`** en cualquier batch futuro: ejecutar WebFetch real de cada URL citada. Resumir cita exacta vs interpretación.
- **Atestación honesta:** distinguir "cita literal del canon" vs "interpretación canónica del spirit". Ambas pueden ser válidas, pero deben marcarse distinto.
- **Cuando WebFetch revele drift** (canon nuevo, breaking changes, dead URLs): documentar acá + abrir backlog entry si requiere adopción.
