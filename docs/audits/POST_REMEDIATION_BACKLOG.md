# Post-Remediation Backlog

> **Propósito.** Registro de **fixes paliativos aplicados durante ejecución del roadmap de remediación** (`REMEDIATION_ROADMAP.md` v2.1+) que resolvieron un bloqueador inmediato pero **no son la solución definitiva**. Cada entry captura: qué se hizo como band-aid, qué habría que hacer como fix de raíz, y cuándo revisarlo.
>
> **Regla operacional.** Cuando un batch del roadmap encuentra un bloqueador pre-existente fuera de su scope y se aplica un fix mínimo para desbloquear la ejecución, el fix se registra aquí. **Después de cerrado el roadmap completo**, Edward revisa este backlog y decide qué fixes ameritan upgrade a fix definitivo.
>
> **Formato.**
>
> ```markdown
> ### PR-<N> — <título corto>
>
> **Fecha de aplicación:** YYYY-MM-DD
> **Batch de origen:** T<tier>-<letter> (del roadmap v2.1)
> **Severidad del bug pre-existente:** bajo / medio / alto / crítico
> **Tipo:** config / code / infra / docs / tests
>
> **Fix paliativo aplicado** (qué se cambió):
> <archivo + línea + descripción>
>
> **Root cause real:**
> <qué bug está realmente ahí, que el band-aid oculta>
>
> **Fix definitivo recomendado:**
> <qué habría que hacer para resolver de raíz>
>
> **Cuándo revisar:**
> <inmediato / post-roadmap / sprint dedicado / batch específico (T<n>-<letter>)>
>
> **Estado:** APLICADO / REVIEWED / FIXED / WONT_FIX
> ```

---

## Entradas

### PR-1 — `@providers/threads` vitest `--passWithNoTests`

**Fecha de aplicación:** 2026-04-22
**Batch de origen:** T0-A (Secrets Rotation + Repo Hygiene)
**Severidad del bug pre-existente:** medio — bloqueaba `pnpm test` completo bajo turbo
**Tipo:** config

**Fix paliativo aplicado.**

`packages/providers/threads/package.json:13` — cambio de script `test`:

```diff
- "test": "vitest run",
+ "test": "vitest run --passWithNoTests",
```

Con el flag, vitest retorna exit 0 cuando no encuentra tests en lugar de exit 1. Desbloquea `pnpm test` + `pnpm turbo run test`.

**Root cause real.**

El paquete `@providers/threads` está **scaffolded sin suite de tests**. El script `test` existe porque es convención del monorepo (todos los packages tienen `test` para que turbo los orquesta), pero no hay archivos `*.test.ts`. El `--passWithNoTests` enmascara esa ausencia — el paquete sigue sin cobertura de tests.

Además: `@providers/shared` usa `node --test` con glob (`tests/**/*.test.ts`) y probablemente tiene el mismo problema latente (el glob no matchea nada pero node --test no falla igual que vitest). No investigado en profundidad.

**Fix definitivo recomendado.**

Opción 1 (preferida): **Escribir suite de tests** para `@providers/threads`. El provider Threads existe en el código (`packages/providers/threads/src/`), merece coverage mínima consistente con otros providers (`@providers/x`, `@providers/facebook`, etc., que tienen 100+ tests cada uno).

Opción 2: Si el provider se considera SCAFFOLD no-producto (no wireado en DI, no integrado en publishWorker), **DELETE del paquete** completo — tratar como T6-style §5.9 validación antes de borrar, Edward decide.

Decisión depende de: ¿`@providers/threads` es provider planeado/activo o scaffold muerto?

**Cuándo revisar.**

Post-roadmap completo. Cross-ref al cluster D7 (Critical Tests Coverage) del PLAN_MAESTRO.md — cuando D7 se ejecute (después del tramo de remediación), esta entrada debería quedar resuelta por escribir tests o eliminar el paquete.

**Estado:** FIXED (2026-04-29) — suite de tests creada (`packages/providers/threads/tests/ThreadsAdapter.test.ts`, 19 tests cubriendo metadata, render, publish two-step container flow para text/image/video/carousel, fetchAnalytics, getComments, postReply + paths AUTH/NETWORK). `--passWithNoTests` removido del package.json.

---

### PR-2 — TikTok `marketingApiClient.ts` location extraction bug fix

**Fecha de aplicación:** 2026-04-22
**Batch de origen:** T0-A (root-cause fix aplicado como excepción cross-batch para cumplir la regla "tests 100% verdes antes de commit")
**Severidad del bug pre-existente:** alto — 3 tests fallando en `marketingApiClient.test.ts`, funcionalidad real rota (audience insights por ubicación retornaba shape incorrecto)
**Tipo:** code + type

**Naturaleza especial.** A diferencia de PR-1 (fix paliativo con TODO), este es un **fix de raíz** aplicado durante T0-A por excepción. No requiere revisión posterior — el bug queda resuelto. Registrado aquí por trazabilidad: explica por qué un cambio en `@providers/tiktok` aparece en el commit de T0-A (Secrets Rotation).

**Fix aplicado.**

Archivo: `packages/providers/tiktok/src/marketingApiClient.ts`

1. Reemplazo del tipo `dimensions: Record<string, string>` (línea 83) por interface explícita `TikTokDimensions` que refleja el shape real de la API — `location` es `string | { country?: string }`, otros campos son `string | undefined`.

2. Fix del extractor de ubicación (líneas ~447-455, era 447-453):

   ```diff
   - const locationValue = dimension.location;
   - if (locationValue) {
   -   audienceInsight.location.push({
   -     country: locationValue,
   -     percentage: impressions,
   -   });
   - }
   + const locationValue = dimension.location;
   + const country =
   +   typeof locationValue === "string" ? locationValue : locationValue?.country;
   + if (country) {
   +   audienceInsight.location.push({
   +     country,
   +     percentage: impressions,
   +   });
   + }
   ```

**Root cause real.**

El tipo `Record<string, string>` era una mentira — la API de TikTok retorna `dimension.location` como objeto `{ country?: string }` (o `{}` vacío) en el endpoint de audience insights. El truthy check `if (locationValue)` aceptaba `{}` como verdadero y pusheaba estructura incorrecta al array (el objeto entero como `country`, o `{}` como `country`).

Introducido en commit `069155c` ("refactor: audit remediation A1-A7 — security, type safety, UoW, schemas, deps") — probable refactor incompleto.

**Fix definitivo recomendado.**

Ya aplicado — no pendiente.

**Cuándo revisar.**

N/A — resuelto. Solo confirmar en D4 (Conformidad Funcional) del PLAN_MAESTRO que el contrato TikTok audience insights retorna shape esperado en integración real (si es posible con mocks contra sandbox).

**Estado:** FIXED (2026-04-22)

---

### PR-3 — Lint cleanup: 5 unused imports/vars

**Fecha de aplicación:** 2026-04-22
**Batch de origen:** T0-A (cross-batch fix para cumplir `pnpm lint --max-warnings 0` pre-commit)
**Severidad del bug pre-existente:** bajo — warnings de ESLint `@typescript-eslint/no-unused-vars`, no afectan funcionalidad
**Tipo:** code

**Naturaleza especial.** Igual que PR-2, son **fixes de raíz** aplicados como excepción cross-batch. Cleanup directo de imports muertos, no paliativo. Registrado aquí por trazabilidad.

**Fixes aplicados (5):**

| #   | Archivo                                                             | Cambio                                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `apps/admin/app/(dashboard)/security/page.tsx:19`                   | Removido import `ActionButton` (no usado)                                                                                                                                                                                                                                            |
| 2   | `apps/admin/components/settings/OverviewTab.tsx:11`                 | Removido `CREDENTIAL_KEYS` del import destructurado                                                                                                                                                                                                                                  |
| 3   | `apps/api/tests/unit/security/PlatformCredentialService.test.ts:11` | Renombrado parámetro `overrides` → `_overrides` (convención CLAUDE.md para args intencionalmente no usados)                                                                                                                                                                          |
| 4   | `apps/api/tests/unit/subscriptionPlanService.test.ts:10`            | Removido `expect` del import de vitest (el test usa `assert` exclusivamente)                                                                                                                                                                                                         |
| 5   | `apps/client/components/onboarding/OnboardingChecklist.tsx:13,28`   | Removidos `useCompleteStep` import + `completeMutation` var. El hook nunca se invocaba — los steps se completan server-side via acciones del usuario (connect provider, create post, etc.). Residuo de diseño previo con botón "Complete step" que se reemplazó por auto-completion. |

**Root cause real.**

Drift acumulado durante sprints previos:

- #1, #2: refactors que removieron uso sin limpiar imports.
- #3: pattern inconsistente — otros mocks en el mismo archivo usan `_` prefix ya.
- #4: copy-paste de template de vitest que importa `expect` por default.
- #5: rediseño incompleto del componente — se auto-completó el flujo pero no se limpió el hook residual.

**Fix definitivo recomendado.**

Ya aplicado — cleanup directo.

**Cuándo revisar.**

N/A — resuelto. Idealmente el CI fitness function de CLAUDE.md (fitness.yml pendiente en T4-P) debería enforce `--max-warnings 0` por default, previniendo acumulación futura.

**Estado:** FIXED (2026-04-22)

---

### PR-4 — Deferred `no-explicit-any` enforcement (apps/admin, apps/client, packages, stories)

**Fecha de aplicación:** 2026-04-22
**Batch de origen:** T1-A (ESLint rules wire)
**Severidad del bug pre-existente:** medio — 92 `any` types fuera de backend core; no rompen producción pero degradan type safety
**Tipo:** config (scope temporal del rule)

**Fix paliativo aplicado.**

`eslint.config.cjs` — regla `@typescript-eslint/no-explicit-any` configurada como:

- `error` en `apps/api/src/{domain,application,infrastructure}/**/*.ts` (core layers — 0 violations actuales)
- `off` (default) en el resto del monorepo

Esto permite que lint quede verde en T1-A mientras mantiene enforcement en el scope crítico.

**Root cause real.**

~92 ocurrencias de `: any`, `as any`, `<any>` fuera de core layers:

- `apps/admin/stories/**` (Storybook — algunos legítimos por callbacks de demos)
- `apps/client/components/**` (especialmente `PublishDialog.tsx`, `BulkScheduleView.tsx`, content/templates)
- `apps/client/.storybook/**`
- `packages/ui/**` (tipos legacy en componentes compartidos)

Type safety debilitada; refactor requiere definir tipos específicos caso por caso.

**Fix definitivo recomendado.**

Iterativo por dominio:

1. **apps/admin**: durante T3-G (admin small god files split) — refactor types al paso.
2. **apps/client**: durante T3-F (client small god files split) + T2-K (type narrowing) — batch dedicado.
3. **packages/ui**: durante T5-D/T5-E (consolidaciones) — tipos compartidos definidos.
4. **Storybook (.stories)**: aceptable — scope override permanente en config.

Cuando cada cluster tenga `any` = 0, remover override correspondiente de `eslint.config.cjs`.

**Cuándo revisar.**

Progresivo durante T2-K, T3-F, T3-G, T4-R. Cierre total al final del tramo de remediación.

**Estado:** APLICADO (2026-04-22) — scope temporal

---

### PR-5 — Deferred `no-floating-promises` enforcement (backend orchestration/services/video/webhooks/workers)

**Fecha de aplicación:** 2026-04-22
**Batch de origen:** T1-A (ESLint rules wire)
**Severidad del bug pre-existente:** medio-alto — 30 fire-and-forget promises sin `void`/`await`/`.catch()`; errores asíncronos pueden perderse silenciosamente
**Tipo:** config (scope temporal) + code (violations reales pendientes)

**Fix paliativo aplicado.**

`eslint.config.cjs` — regla `@typescript-eslint/no-floating-promises` configurada con `projectService: true` (type-aware parser) scoped exclusivamente a:

- `apps/api/src/domain/**/*.ts`
- `apps/api/src/application/**/*.ts`
- `apps/api/src/infrastructure/**/*.ts`

No aplicada a `apps/api/src/orchestration/**`, `services/`, `video/`, `webhooks/processors/`, `apps/workers/src/**`.

**Root cause real.**

30 violations pre-existentes detectadas en el primer lint run:

| Archivo                                                                | Violations |
| ---------------------------------------------------------------------- | ---------: |
| `apps/api/src/index.ts:685`                                            |          1 |
| `apps/api/src/orchestration/PublishingOrchestrator.ts:297`             |          1 |
| `apps/api/src/orchestration/sync/StreamProcessor.ts:41,124`            |          2 |
| `apps/api/src/services/NotificationBroadcaster.ts:162`                 |          1 |
| `apps/api/src/video/thumbnailGeneration.ts:39`                         |          1 |
| `apps/api/src/video/uploadPipeline.ts:124,378`                         |          2 |
| `apps/api/src/video/videoProcessor.ts:102`                             |          1 |
| `apps/api/src/webhooks/processors/linkedinWebhookProcessor.ts:278,310` |          2 |
| `apps/api/src/webhooks/processors/snapchatWebhookProcessor.ts:227,253` |          2 |
| `apps/api/src/webhooks/realtimeWebhookBroadcaster.ts:608,621`          |          2 |
| `apps/workers/src/analyticsIngestWorker.ts:182`                        |          1 |
| `apps/workers/src/inboxSyncWorker.ts:180`                              |          1 |
| `apps/workers/src/publishWorker.ts:134`                                |          1 |

**Adicional:** `eslint.config.cjs` está en `ignores` (no linted — usa `__dirname` que requiere Node CJS globals no wireados).

**Fix definitivo recomendado.**

Per-file audit con 3 fixes posibles por cada floating promise:

1. `void promise` — si fire-and-forget es intencional (documenta intent)
2. `await promise` — si el resultado importa
3. `promise.catch(logger.error)` — si errores deben loggearse pero flujo continúa

Cluster de trabajo sugerido:

- **Workers** (3 violations): típicamente `main()` calls — review startup error handling. Cross-ref T4-I (workers retry + shutdown).
- **Video pipelines** (4 violations): fire-and-forget processing — probablemente necesitan `.catch()` con retry/notification. Cross-ref T4-X (webhook N+1 + retry queue).
- **Webhook processors** (6 violations): async acks. Similar a video.
- **Orchestration** (3): publishing + sync flows.
- **Services/broadcasters** (2): notifications.

Cuando cada cluster quede sin violations, expandir `typeAwareBackendPaths` en `eslint.config.cjs`.

**Cuándo revisar.**

Progresivo durante T4-I (workers), T4-X (webhook retry), T2-C (silent catches) que tocan paths relacionados. Cierre total al final del tramo.

**Estado:** APLICADO (2026-04-22) — scope temporal

---

### PR-6 — Frontend error handlers pending browser-logger port

**Fecha de aplicación:** 2026-04-22
**Fecha de cierre:** 2026-04-22 (mismo día — cerrado por creación de `@observability/browser-logger`)
**Batch de origen:** T1-A tightening (post-commit follow-up para alinear `no-console` al estándar CLAUDE.md "zero `console.*` in production code")
**Severidad del bug pre-existente:** medio — error logs sin correlation ID, sin routing a APM, sin redacción PII
**Tipo:** config (scope override temporal) → **resuelto con port abstracto**

**Fix paliativo aplicado.**

`eslint.config.cjs` — `"no-console": "error"` global (tightened — removido `allow: ["warn", "error"]`). Override temporal para 3 archivos frontend:

```js
{
  files: [
    "apps/admin/components/shared/ErrorBoundary.tsx",
    "apps/client/app/error.tsx",
    "packages/ui/src/components/VirtualScrollList.tsx",
  ],
  rules: { "no-console": "off" },
}
```

**Root cause real.**

Los 3 archivos usan `console.error(error)` para reportar errores de render/boundary. Son el único path disponible porque:

- No existe `@observability/browser-logger` port (backend tiene Pino, frontend no tiene equivalente wireado).
- Sin browser-logger port, `console.error` es el único sink disponible.
- Error boundaries/pages son puntos críticos donde NO logear es peor que logear sin estructura.

**Fix definitivo recomendado.**

Cuando se wire el browser-side logger port (batch que introduce `@observability/browser-logger` o similar, cross-ref LATERAL_FINDINGS L-347):

1. Crear port + adapter browser (envía a Sentry/Datadog RUM/similar con correlation ID, PII redact, structured fields).
2. Inyectar vía context provider en apps/admin + apps/client.
3. Reemplazar los 3 `console.error` por `logger.error(error, context)`.
4. Remover el override block de `eslint.config.cjs`.

**Cuándo revisar.**

Cuando se ejecute el batch que entrega browser-logger port. Hasta entonces, los 3 archivos quedan exentos.

**Estado:** FIXED (2026-04-22) — resuelto por creación de `@observability/browser-logger` package. Override ESLint removido. Los 3 archivos migrados a `BrowserLoggerPort`. Legacy `packages/shared/src/logger.ts` + `apps/admin/lib/logger.ts` + `apps/client/lib/logger.ts` eliminados. L-347 resuelto.

---

### PR-7 — `@typescript-eslint@8.57.2` + `tsconfck@3.1.6` + `madge@8.0.0` peer range declara `typescript@^5` pero repo usa `typescript@6.0.2`

**Fecha de aplicación:** 2026-04-22
**Batch de origen:** T1-F (JSDoc normalization + Storybook consolidation)
**Severidad del bug pre-existente:** bajo — warnings ruidosos durante `pnpm install`, sin impacto funcional en lint / build / tests
**Tipo:** deps

**Fix paliativo aplicado.**

**Ninguno.** Los warnings de peer deps son aceptados como deuda conocida y visible. Se consideró añadir `pnpm.peerDependencyRules.allowedVersions` en el root `package.json` para silenciarlos, pero Edward rechazó explícitamente el approach por considerarlo un ocultamiento ("cero parches, cero overrides, cero ocultamientos").

Warnings actuales al correr `pnpm install`:

```text
.
└─┬ @typescript-eslint/parser 8.57.2
  └─┬ @typescript-eslint/typescript-estree 8.57.2
    ├── ✕ unmet peer typescript@">=4.8.4 <6.0.0": found 6.0.2
    └─┬ @typescript-eslint/tsconfig-utils 8.57.2
      └── ✕ unmet peer typescript@">=4.8.4 <6.0.0": found 6.0.2

apps/admin
└─┬ vite-tsconfig-paths 6.1.1
  └─┬ tsconfck 3.1.6
    └── ✕ unmet peer typescript@^5.0.0: found 6.0.2

(similar para @typescript-eslint/eslint-plugin, type-utils, utils, project-service, y madge)
```

**Root cause real.**

El proyecto usa `typescript@6.0.2` (el major más reciente). Tres familias de paquetes declaran peer range `typescript@^5`:

1. **`@typescript-eslint@8.x`** — la versión que acepta oficialmente TS 6 es `@typescript-eslint@9.x` (2025). Saltar de v8 a v9 introduce breaking changes en reglas (varias renombradas o movidas) y config (`FlatConfig` estricto).
2. **`tsconfck`** (vía `vite-tsconfig-paths@6.1.1`) — upstream no ha actualizado peer range para aceptar TS 6. Funcionalmente parsea `tsconfig.json` igual en TS 5 y TS 6, pero la declaración está desfasada.
3. **`madge@8.0.0`** — idem; el analizador estático de imports circulares funciona con TS 6 pero el peer range dice 5.

Los warnings son de **declaración**, no de runtime. `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm typecheck` pasan en verde.

**Fix definitivo recomendado.**

Batch dedicado `T3-X — Upgrade typescript-eslint to v9 + audit peer ranges`:

1. Upgrade `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`, `@typescript-eslint/type-utils`, `@typescript-eslint/utils` de `8.57.2` → `9.x` (última estable).
2. Migrar `eslint.config.cjs` según changelog v9: rules renombrados (ej. `ban-types` → `no-restricted-types`, cambios en `no-unused-vars`), ajustes en `FlatConfig`.
3. Validar que todos los warnings ESLint pre-existentes siguen siendo 0.
4. Verificar que `vite-tsconfig-paths` / `tsconfck` / `madge` han actualizado su peer range a aceptar TS 6; si no, abrir issues upstream o considerar alternativas (`@vercel/tsconfig-paths-plugin`, `dpdm`).

Estimación: 4-6 horas (risk: medio — breaking changes en ~20 reglas ESLint).

**Cuándo revisar.**

Post-roadmap (fuera del alcance de los Tiers T0-T6). Cuando se ejecute el batch T3-X dedicado. Los warnings permanecen visibles en cada `pnpm install` hasta entonces — intencional.

**Estado:** APLICADO (aceptado como deuda conocida — warnings visibles, NO ocultos).

---

### PR-8 — Scheduling rules endpoint discrepancy (`/slots` vs `/rules`)

**Fecha de aplicación:** 2026-04-23
**Batch de origen:** T2-E (Path/nav corrections)
**Severidad del bug pre-existente:** medio — dos componentes del mismo dominio usan endpoints backend distintos para la misma entidad conceptual.
**Tipo:** code (endpoint routing)

**Fix paliativo aplicado.**

Durante T2-E migré dos componentes de scheduling a hooks TanStack + Dialogs:

- `apps/client/app/dashboard/scheduling/page.tsx` usa los endpoints `/api/backend/scheduling/slots` (GET/POST/PATCH) para manipular "rules" — pre-existente, se mantuvo.
- `apps/client/components/scheduling/MultiPlatformScheduler.tsx` usa `/api/backend/scheduling/rules` (GET/POST/PATCH + `/:id/toggle`) — pre-existente, se mantuvo.

Los nuevos hooks `useCreateSchedulingRule` / `useUpdateSchedulingRule` / `useToggleSchedulingRule` en `apps/client/hooks/api/useMultiPlatformScheduling.ts` apuntan al endpoint `/rules` (el que MultiPlatformScheduler ya usaba). `scheduling/page.tsx` refactorizó su handler para usar su Dialog + toast pero mantuvo el llamado a `/slots`.

**Root cause real.**

El backend tiene dos rutas distintas para lo que semánticamente parece ser la misma entidad: "scheduling rules":

- `apps/api/src/**/schedulingRoutes.ts` (o equivalente) expone tanto `/slots` como `/rules`.
- No está documentado cuál es el canónico ni cuál se considera deprecado.
- Posible escenario: evolución del esquema en que "slots" fue renombrado a "rules" pero la ruta antigua nunca se eliminó, y page.tsx fue escrito antes del rename.

**Fix definitivo recomendado.**

Batch dedicado (sugerido `T4-M` o futuro tier):

1. Auditar backend: identificar controller/route que maneja cada path; verificar si el schema/tabla es la misma.
2. Decidir endpoint canónico (probablemente `/rules` por semántica; `/slots` sugiere "slot" como unidad de tiempo, no como regla).
3. Migrar todos los consumidores al endpoint canónico (incluye `scheduling/page.tsx`).
4. Deprecar la ruta duplicada con un 301 a la canónica por ~1 release; luego remover.
5. Documentar en OpenAPI el endpoint canónico y la razón del rename.

Estimación: 3-4 horas (audit backend + migrar ~5 call sites + deprecation path + docs).

**Cuándo revisar.**

Post-roadmap o en un batch T4 dedicado a backend consolidation. No bloquea T2-E porque ambos endpoints funcionan en producción hoy (cada componente llama al suyo). Riesgo real: usuarios pueden ver comportamiento inconsistente entre las dos tabs (Multi-Platform Scheduler vs Rules tab del schedule page) si el backend trata `/slots` y `/rules` como tablas separadas.

**Estado:** APLICADO (documentado — ningún componente cambia de endpoint en T2-E).

---

### PR-9 — `window.location.href` en Stripe checkout / OAuth redirects (L-215 false positive)

**Fecha de aplicación:** 2026-04-23 (documentación)
**Batch de origen:** T2-E (Path/nav corrections) — durante re-audit del patrón nav
**Severidad del bug pre-existente:** N/A — no es bug
**Tipo:** docs (aclaración de falso positivo del roadmap)

**Descubrimiento.**

El roadmap (línea 3311) lista **L-215 — `useCheckout`/`useBillingPortal` window.location.href** como hallazgo de T2-E ("path/nav corrections"). La extensión de búsqueda durante T2-E encontró 3 usos de `window.location.href =` en el client:

- `apps/client/hooks/api/useBilling.ts:198` — redirect a Stripe Checkout hosted URL
- `apps/client/hooks/api/useBilling.ts:226` — redirect a Stripe Billing Portal hosted URL
- `apps/client/components/settings/crm/CrmConnectionCard.tsx:49` — redirect a provider OAuth authorization URL

**Los 3 son correctos.** `next/navigation`'s `router.push` solo navega dentro de la app Next.js (client-side, same-origin). Para redirigir a un dominio externo (Stripe, OAuth provider), el único método soportado es `window.location.href = externalUrl` (o equivalentemente `window.location.assign()`). El MDN docs confirma: _"Assigning a value to location.href makes the browser navigate to the new URL"_.

Usar `router.push` con una URL de otro origen produce el error: _"The `href` prop must point to a path starting with "/" or a valid external URL_.

**Conclusión.**

L-215 es un **falso positivo** del audit original. Los tres usos son canon para redirects externos. No se toca ningún archivo.

**Cuándo revisar.**

N/A — cerrado como WONT_FIX documentado. Si un lector futuro del roadmap cuestiona L-215, esta entrada explica la razón.

**Estado:** WONT_FIX (falso positivo — uso correcto para redirects externos).

---

### PR-10 — T2-I roadmap misidentified 5 pages as over-clientized (false positives)

**Fecha de aplicación:** 2026-04-23 (documentación)
**Batch de origen:** T2-I — durante audit extendido pre-ejecución
**Severidad del bug pre-existente:** N/A — roadmap tenía entries falsos positivos
**Tipo:** docs (clarificación)

**Descubrimiento.**

El roadmap T2-I listaba 12 pages como "over-clientized" candidatas a remover `"use client"`. Audit extendido (heurístico Node AST-ish buscando hooks React + event handlers + browser APIs + Next.js navigation + i18n + custom hooks) identificó **5 falsos positivos** que efectivamente REQUIEREN ser Client Components per Next.js App Router spec:

| L-#   | Archivo                      | Trigger que fuerza client                                      |
| ----- | ---------------------------- | -------------------------------------------------------------- |
| L-126 | `settings/sso/page.tsx`      | `useAuth()` — React Context, no soportado en Server Components |
| L-127 | `content/library/page.tsx`   | `useProject()` — React Context                                 |
| L-129 | `instagram/stories/page.tsx` | `useProject()` + `toast()` call (client-side side effect)      |
| L-132 | `ai/generate/page.tsx`       | `useState` + `onClick`                                         |
| L-133 | `ai/optimizer/page.tsx`      | `useState` + `onChange`                                        |

Fuente canon consultada: [Next.js App Router — Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) — _"React context is not supported in Server Components"_; Client Components son necesarios para `useState`, event handlers, browser APIs.

**Conclusión.**

Los 5 son **correctamente** Client Components. El roadmap audit original detectó `"use client"` directive pero no verificó si había triggers reales que lo requirieran. No se toca nada en código.

**Si en futuro se quiere reducir el bundle client:** las alternativas son:

- Mover el context provider más adentro del árbol (Next.js docs recomienda "render providers as deep as possible").
- Extraer la parte interactiva a un Client child más pequeño, dejando el page como Server que lo envuelve.

Ninguna de las dos aplica ya a estos 5 archivos — son páginas que conceptualmente son interactivas completas, no wrappers. El patrón actual está alineado con el canon.

**Cuándo revisar.**

N/A — cerrado como WONT_FIX documentado. Si el audit original se re-ejecuta, la nueva heurística debe filtrar por triggers reales antes de marcar como over-clientized.

**Estado:** WONT_FIX (falso positivo documentado — roadmap audit fue superficial).

---

### PR-11 — `ApiError` class divergence between admin and client apps

**Fecha de aplicación:** 2026-04-28 (documentación)
**Batch de origen:** T3-B (Auth flow unification) — durante audit pre-ejecución
**Severidad del bug pre-existente:** bajo — cada app es internamente consistente; las firmas distintas no causan bugs de runtime
**Tipo:** code (DRY / consistency)

**Descubrimiento.**

Audit del scope T3-B reveló que existen DOS clases `ApiError` con shape distinto, una por app:

| Ubicación                          | Constructor                        | Helpers                                                                                                                              |
| ---------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/admin/lib/parseApiError.ts`  | `(status, code, message)`          | `fromResponse`, `parseApiError`, `getErrorMessage`, `isPermissionDenied`, `isNotFoundError`, `STATUS_MESSAGES`/`ERROR_MESSAGES` maps |
| `apps/client/lib/api/types.ts:193` | `(message, status, code, details)` | (sólo class, sin helpers)                                                                                                            |

Cada app importa la suya local; no hay colisión runtime. La admin es notablemente más rica (mensajes user-facing curated, `fromResponse` parsing seguro).

**Por qué NO se incluyó en T3-B.**

T3-B se enfocó en el flujo de autenticación (Server Action + AuthProvider + sessionCookie helpers). Migrar `authApi.ts` a usar la `ApiError` de `lib/api/types.ts` (la que ya existe en client) cumplió L-209 sin añadir scope. Unificar las dos `ApiError` cross-app implica:

1. Decidir cuál es la canónica (probablemente admin's, que es más rica).
2. Crear nuevo package `@packages/api-errors` (o reutilizar `@packages/query-client` u otro shared-frontend).
3. Migrar imports en client (~10+ sites) y admin (~20+ sites).
4. Reconciliar las firmas (orden de args es distinto).
5. Tests del package compartido + smoke en cada app.

Es un batch dedicado (~2-3h), no un drive-by.

**Fix definitivo recomendado.**

Batch dedicado posterior (sugerido nombre: `T3-S — ApiError unification`):

1. Adoptar admin's shape como canon (constructor `(status, code, message)`, `fromResponse` static, helpers de mensaje).
2. Crear `@packages/api-errors/` con la clase + helpers + tests.
3. Migrar admin: `lib/parseApiError.ts` → re-export del package; importers no cambian (transparent migration).
4. Migrar client: `lib/api/types.ts` ApiError → re-export del package; `authApi.ts` ya usa la mejor; otros sites adaptan al constructor `(status, code, message)` (no `(message, status, code, details)`).
5. Verificar cero regressions con tests existentes.

**Cuándo revisar.**

Post T3-B. Sugerido: ejecutar entre T3-B y T3-C (mientras T3-D depende de mismo refactor pattern). O después del tier T3 completo cuando todos los `any` returns estén tipados (T2-K) y la unificación tenga payback inmediato.

**Estado:** FIXED (2026-04-29) — `@packages/api-errors` creado con shape canon `(status, code, message, details?)` + helpers (`fromResponse`, `parseApiError`, `getErrorMessage`, `isPermissionDenied`, `isNotFoundError`) + 20 tests unit. Admin migrado: `apps/admin/lib/parseApiError.ts` re-exporta del package (callers sin cambios). Client migrado: `apps/client/lib/api/types.ts` re-exporta + 3 call sites flipeados al nuevo orden de args (`request.ts` x2, `authApi.ts` x1) + tests actualizados. Tsconfig paths + vitest aliases wireados en ambos apps.

---

### PR-18 — T3-R deferrals: L-94 (channels OAuth) + L-95 (Test/Settings UI cleanup) bloqueados por decisión producto

**Fecha de aplicación:** 2026-04-29 (documentación)
**Batch de origen:** T3-R (SidebarNav + OAuth + Test/Settings) — partial completion: L-305 ejecutado, L-94/L-95 diferidos
**Severidad del bug pre-existente:** medio-alto — 10 de 11 providers no permiten conectar canales (OAuth connect dead) + UI con botones "Coming soon" deshabilitados
**Tipo:** code + product (decisión de scope requerida antes del fix)

**Descubrimiento.**

T3-R agrupa tres findings con perfiles muy distintos:

- **L-305** (QUICK / AUTO) — Anti-patrón `document.cookie` + `window.location.reload()` para locale switching en `SidebarNav.tsx`. Auto-decidible. **Cerrado en este batch** vía Server Action + `revalidatePath`.
- **L-94** (HEAVY / NEEDS*EDWARD) — `channels` OAuth connect dead for 10/11 providers. Solo Bluesky tiene flow funcional (App Password). Los demás (X, Instagram, Facebook, YouTube, TikTok, LinkedIn, Pinterest, Snapchat, Threads, Telegram) tienen botones "Connect" que abren modal pero no ejecutan OAuth real — el código tiene un comentario explícito *"OAuth flow not yet implemented — requires redirect to provider OAuth URL"\_ en `dashboard/channels/page.tsx`.
- **L-95** (QUICK / DECIDE) — Channels list UI muestra botones "Test" y "Settings" deshabilitados con tooltip "Coming soon". Decisión: implementar features reales o eliminar de la UI.

**Por qué NO se ejecutaron L-94 y L-95 ahora.**

Ambos requieren decisión producto que no podemos tomar sin Edward:

1. **L-94 — OAuth real para 10 providers.** Cada provider tiene flow OAuth distinto:
   - Cliente IDs / secrets de cada provider deben configurarse (env vars).
   - Redirect URLs registrados con cada provider (admin config).
   - Endpoints de callback en backend (cada provider tiene shape de response distinto).
   - Token storage (encriptado en DB — ya existe el módulo CRYPTO).
   - Refresh token flows por provider (algunos 60 días, otros 90, otros lifetime).
   - **Decisión producto:** ¿Qué providers tienen prioridad? ¿OAuth en orden de demanda real o todos a la vez? Estimación: 3-6h por provider × 10 = 30-60h.

2. **L-95 — Test/Settings buttons.** Decisión binaria:
   - **Implementar Test:** ¿qué hace "Test"? ¿Validación de credenciales? ¿Ping de health-check? ¿Post de prueba?
   - **Implementar Settings:** ¿qué editor por canal? ¿Webhook URLs? ¿Throttling? ¿Posting schedule preferences?
   - **Eliminar:** simplemente quitar los botones del UI. ~15 min.

**Fix definitivo recomendado.**

Opción A (parcial — L-95 cleanup ahora, L-94 después):

- Eliminar botones "Test"/"Settings" del UI inmediatamente. Cierra L-95.
- Agendar T3-R.2 dedicado para L-94 cuando Edward priorice providers.

Opción B (full implementation):

- Sesión dedicada con Edward para definir scope OAuth.
- Implementar provider por provider en sub-batches T3-R.2.X (uno por provider).
- Cada sub-batch incluye: env vars, callback route, token storage, refresh flow, tests integration.

Opción C (keep deferred):

- Posponer ambos hasta que Edward priorice. Mantener UI actual con botones deshabilitados.

**Cuándo revisar.**

Próxima sesión con Edward post-T3-R parcial. Edward decide A/B/C; si A, ejecutar L-95 cleanup en batch dedicado (~30 min). Si B, agendar sesión de planning OAuth provider-by-provider.

**Estado:** DIFERIDO — pre-existente a T3-R, T3-R parcial preserva UI actual sin tocar OAuth/Settings. NO se introduce nueva deuda; la deuda ya existía y queda registrada explícitamente con plan de re-evaluación.

---

### PR-19 — L-455 false positive (`usePublishingEngine` hardcoded URL) + dead-code observation

**Fecha de aplicación:** 2026-04-30 (documentación)
**Batch de origen:** T4-A Phase 1 — verificación previa a fix
**Severidad del bug pre-existente:** N/A — finding incorrectamente clasificado
**Tipo:** docs (clarificación de falso positivo + dead-code finding adicional)

**Descubrimiento.**

El roadmap T4-A lista L-455 como "usePublishingEngine hardcoded URL boundary leak". Verificación de `packages/ui/src/hooks/usePublishingEngine.ts`:

```typescript
const publish = useCallback(
  async (apiEndpoint: string, postId?: string) => {
    // ...
    const response = await fetch(apiEndpoint, {
      /* ... */
    });
  },
  [
    /* deps */
  ]
);
```

`apiEndpoint` es **parámetro de la función `publish`**, no una constante hardcoded. El caller controla la URL. El hook no contiene URL literal en su body. **L-455 es falso positivo** — el audit original probablemente confundió `fetch(apiEndpoint, ...)` con un literal hardcoded.

**Bonus discovery: el hook entero es dead code.**

`grep -rln "usePublishingEngine" apps/admin/components apps/admin/app apps/client/components apps/client/app` retorna cero coincidencias. Solo aparece en barrel exports de `packages/ui` y en archivos `*.tsbuildinfo`. Patrón paralelo a L-364 — abstracción genérica jamás consumida por las apps.

**Por qué NO se elimina en T4-A.**

T4-A scope es boundary leaks, no dead-code cleanup. Borrar `usePublishingEngine` es ortogonal: el hook no causa boundary leak (no importa Fastify ni framework code), simplemente no se usa. L-364 sí se elimina en Phase 3 porque su no-consumption es la causa misma del fix correcto del leak.

**Fix definitivo recomendado.**

Batch dedicado posterior (sugerido `T5-H — Dead code in shared packages`): audit de exports sin consumers en `packages/ui`, `packages/api-common`, `packages/adapters/*` + deletion + verificación post.

**Cuándo revisar.** Post-T4. Hasta entonces el hook sigue exportado pero inútil.

**Estado:** WONT_FIX (L-455 audit original incorrecto). Dead-code observation registrada para batch futuro.

---

### PR-12 — T3-F + T3-G deferrals: single-hook complex state files + blocked + orphan-pending

**Fecha de aplicación:** 2026-04-28 (documentación)
**Batch de origen:** T3-F (apps/client) + T3-G (apps/admin) — durante audit pre-ejecución
**Severidad del bug pre-existente:** N/A — no hay bug, son decisiones de scope
**Tipo:** docs (clarificación de scope — postergaciones documentadas)

**Descubrimiento.**

Audit estructural de los 15 archivos del T3-F roadmap (medición LOC + count de hooks/funciones/types) reveló tres grupos con valor de split distinto:

| Grupo | Patrón                                          | Valor del split                                          | Acción T3-F |
| ----- | ----------------------------------------------- | -------------------------------------------------------- | ----------- |
| A     | Multi-hook bundle (4-9 TanStack hooks por file) | Alta — separar types / queries / mutations es claro      | EJECUTAR    |
| B     | Single hook complex state machine               | Dudosa — extraer helpers dispersa, no reduce mental load | DIFERIR     |
| C     | No es hook (auth API client funcs)              | N/A — ya tocado en T3-B                                  | EXCLUIR     |

**Grupo A — Ejecutado en T3-F (7 archivos):**

`useInbox.ts` (335/9), `useBilling.ts` (275/7), `useSso.ts` (249/7), `useTasks.ts` (254/6), `useAssets.ts` (224/6), `useCampaigns.ts` (201/5), `useAIPromptTemplates.ts` (180/4).

**Grupo B — Diferido (6 archivos, single-hook o sequencial):**

| Archivo                        | LOC | Razón de diferimiento                                                                                                                                         |
| ------------------------------ | --: | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useSchedulingDashboard.ts`    | 318 | 1 hook con state machine grande; partir = extraer helpers dispersos sin reducir complejidad mental                                                            |
| `useTemplateVersionControl.ts` | 280 | 1 hook con history/diff/revert state; refactor agresivo arriesga regresiones en feature poco testeada                                                         |
| `useABTestManager.ts`          | 273 | 1 hook con CRUD + sample metrics; mismo patrón                                                                                                                |
| `useABTests.ts`                | 230 | 1 hook; bajo el umbral práctico de "god" para hooks de feature compleja                                                                                       |
| `useAutoSave.ts`               | 206 | 2 hooks pero `usePostDraft` es wrapper thin de `useAutoSave`; secuencia lineal, no hay separación natural en queries/mutations (no usa TanStack internamente) |
| `useTemplates.ts`              | 172 | 1 hook chiquito; el roadmap lo listaba por estar >150 LOC pero no necesita split                                                                              |

**Bloqueado:**

- `useContentLibraryState.ts` (290 LOC, L-240) — depende de **L-77 (T3-P)** que va a reescribir el wire a la API real. Cualquier split previo se va a invalidar cuando T3-P se ejecute. Postergado hasta que T3-P decida el shape final del hook.

**Excluido:**

- `lib/auth/authApi.ts` (266 LOC, L-244) — listado en roadmap pero **no es un hook** (0 hooks, 1 función `parseApiError`-like, 7 types). Ya fue tocado en T3-B (migración a `ApiError` typed). El LOC es justificado por los 7 types públicos. No requiere split.

---

**Apéndice T3-G (apps/admin) — mismo framework aplicado.**

**Grupo A — Ejecutado en T3-G (5 archivos):**

`useCompliance.ts` (635/13), `usePricingTiers.ts` (305/9), `useGatewaySwitches.ts` (216/5), `useSettings.ts` (179/6), `useAdminUsers.ts` (172/5).

**Grupo B / blocked — Diferido en T3-G (1 archivo):**

- **`useAnalytics.ts`** (163 LOC, L-315) — 1 hook + depende de **L-325 (T3-P)** que reescribirá el wire al API real (composite fake-AI). Mismo patrón que `useContentLibraryState` (T3-F). Se ejecutará junto con T3-P.

**Orphan-pending — Diferido en T3-G (1 archivo):**

- **`useMultiPlatformScheduling.ts`** (159 LOC, L-316/L-320) — ORPHAN-pending: T6-A (2026-04-21) decidió **WIRE + SUPER_ADMIN gate** pero el WIRE aún no se ejecutó (sólo tests, cero consumers en producción). Split ahora = refactor doble cuando el WIRE se haga. Postergado hasta que T6-A WIRE-ee este hook (incluye L-341 + L-343 rescatados).

**Por qué la regla "150-400 LOC = split" no se aplicó al pie de la letra.**

El roadmap fija 150 LOC como umbral, pero un hook con state complejo legítimamente puede llegar a 300 LOC sin ser un "god file". La regla práctica útil es: split cuando hay **separación de responsabilidades** clara dentro del archivo (Grupo A), no cuando el LOC es alto pero la responsabilidad es única (Grupo B). Forzar splits en Grupo B aumenta el costo de lectura (saltar entre archivos para entender un flujo lineal) sin reducir complejidad real.

**Cuándo revisar.**

- **Grupo B**: re-evaluar después de T4 cuando el resto de la deuda de hooks esté limpia. Si en ese punto los 5 hooks siguen siendo dolor real, hacer T3-F.2 con análisis caso-por-caso. Si nadie reportó dolor, marcar como WONT_FIX.
- **`useContentLibraryState`**: ejecutar AS PART OF T3-P, en el mismo commit que el wire al API real (evita refactor doble).
- **`authApi.ts`**: ya cerrado en T3-B; no requiere acción.

**Estado:** DIFERIDO con justificación. T3-F del roadmap se cierra como **completado parcial** (8 de 15 archivos ejecutados). Los 7 restantes están documentados arriba con razón explícita; no se pierden.

---

### PR-13 — T3-H closure: 1 inherited from prior work + 2 deferred (high risk / cross-batch)

**Fecha de aplicación:** 2026-04-28 (documentación)
**Batch de origen:** T3-H (Small god files apps/api + packages) — durante audit pre-ejecución
**Severidad del bug pre-existente:** N/A — análisis de scope
**Tipo:** docs (clarificación de scope — postergaciones documentadas)

**Descubrimiento.**

Audit de los 3 findings del T3-H roadmap reveló que cada uno tiene historia distinta:

- **L-57 `publishHandler.ts` (629 LOC original) — YA RESUELTO en trabajo previo.** Splitado en `PublishingOrchestrator.ts` (444 LOC) + `PublishingOrchestratorExecution.ts` (426 LOC) + `PublishingOrchestratorHelpers.ts` (267 LOC) vía herencia (PublishingOrchestrator extends PublishingOrchestratorExecution). Sub-dominios: orchestration plan management, execution flow, helper utilities.
- **L-34 `index.ts` (725 LOC) — DIFERIDO.** Ver razón abajo.
- **L-7 `webhookDashboardService.ts` (854 LOC) — DIFERIDO a T4-X.** Ver razón abajo.

**L-34 `index.ts` — Razón de diferimiento.**

API entry point con ordering constraints estrictas en ESM:

1. `dotenv.config()` debe ejecutarse **antes** que cualquier import que lea `process.env`.
2. OpenTelemetry SDK debe inicializarse **antes** del primer Fastify import (instrumentación a nivel de require/import hook).
3. Process signal handlers deben registrarse **después** de `app.listen()` (sin server activo no hay shutdown lógica).
4. El top-level `await import("@observability/opentelemetry")` está condicionado a `TRACING_ENABLED=true` y **debe ser top-level** (no dentro de función).

Estructura interna actual:

- Lines 1-39: env + OTel init (top-level, ordering crítico)
- Lines 41-128: imports (88 líneas, todos)
- Lines 132-617: `createApp()` (485 LOC, bien organizado en secciones con comments)
- Lines 620-718: `start()` + signal handlers (98 LOC)
- Lines 720-725: invocation

El archivo crece **linealmente con cada nueva route** (additive). Splitearlo (extraer createApp a `app.ts`, start a `start.ts`) reduce el LOC del entry point pero **dispersa** lógica que actualmente está coherente en un solo lugar. El bottleneck de complejidad cognitiva de `index.ts` no es el LOC — es el ordering constraints, que se mantienen iguales o se vuelven más sutiles tras un split.

Adicional: T1-B (BackgroundTaskScheduler integration) ya tocó este archivo cuidadosamente para integrar `scheduler.shutdownAll()` en SIGINT/SIGTERM handlers. Splitear ahora dispersa ese trabajo coordinado.

**Cuándo re-evaluar:** si el archivo crece más allá de 1000 LOC, o si añadir nuevas routes empieza a producir merge conflicts frecuentes en el bloque de imports/registro. Hasta entonces: WONT_FIX-pendiente.

**L-7 `webhookDashboardService.ts` — Razón de diferimiento a T4-X.**

Service class con 854 LOC, 10 métodos en 4 sub-dominios:

- **Dashboard metrics** (2 métodos): `getDashboardMetrics`, `getDlqMetrics`
- **Event listings** (3 métodos): `getRecentEvents`, `getEventDetails`, `exportWebhookEvents`
- **Subscriptions** (1 método): `getSubscriptions`
- **DLQ retry** (3 métodos): `getDeadLetterQueue`, `retryDeadLetterEvent`, `retryAllDeadLetterEvents`

T4-X (Webhook dashboard N+1 + retry queue) está en backlog y va a **reescribir profundamente**:

- `getDashboardMetrics` y `getDlqMetrics` — fix N+1 (probablemente requiere agregar índices o consolidar queries)
- `retryAllDeadLetterEvents` — wirear retry queue real (actualmente stub)
- `getRecentEvents` — posible fix N+1 en eventos por suscripción

Splitear en T3-H **antes** que T4-X reescriba esos métodos crea problemas de coordinación:

- T4-X tiene que navegar split files mientras reescribe lógica
- Si el N+1 fix introduce un servicio compartido o cambio estructural (e.g., DataLoader pattern, Repository facade), el split de T3-H queda en deuda
- Doble refactor en feature poco testeada incrementa riesgo de regresiones

**Mejor:** T4-X ejecuta split + N+1 fix + retry queue wire en un único batch coordinado, manteniendo la coherencia del trabajo.

**Cuándo re-evaluar:** ejecutar AS PART OF T4-X. T4-X debe abrir con un mini-PR estructural (split a `webhookDashboard/{metrics,events,subscriptions,dlq}.ts` + facade), después aplicar el N+1 + retry queue fix por sub-módulo. Estimación combinada: ~6-8h vs T3-H solo split (~2h) + T4-X aparte (~6h).

**Estado:** APLICADO (cierre documentado). T3-H del roadmap se cierra como **completado** porque:

1. L-57 ya está resuelto (heredado de trabajo previo).
2. L-34 y L-7 tienen plan de re-ejecución claro: L-34 cuando crezca >1000 LOC o produzca conflicts; L-7 dentro de T4-X.

Sin código nuevo en este batch — sólo verificación de scope + documentación.

---

### PR-14 — T3-I deferral: 20-component refactor split into scheduled sub-batches

**Fecha de aplicación:** 2026-04-28 (documentación)
**Batch de origen:** T3-I (Component size violations UI top 20) — durante audit pre-ejecución
**Severidad del bug pre-existente:** N/A — análisis de scope
**Tipo:** docs (clarificación de scope — postergación con schedule)

**Descubrimiento.**

T3-I es **estructuralmente diferente** al resto del tier T3:

| Aspecto             | T3-F/G (hooks)                         | T3-I (componentes UI)                                |
| ------------------- | -------------------------------------- | ---------------------------------------------------- |
| Patrón de split     | Mecánico (types/api/queries/mutations) | Caso-por-caso (sub-components, hooks, helpers)       |
| Riesgo por archivo  | Bajo (hooks TanStack aislados)         | Medio-alto (state machines, side effects, render)    |
| Diseño requerido    | Mínimo (template)                      | Significativo (cada split = decisión arquitectónica) |
| Tests existentes    | Cubren el comportamiento               | A menudo escasos para componentes UI grandes         |
| Estimación roadmap  | 4-6h (T3-F) / 3-5h (T3-G)              | **20-30h** (T3-I)                                    |
| Flag `NEEDS_EDWARD` | No (auto-decidible)                    | **Sí en 19 de 20** (decisiones por archivo)          |

Forzar los 20 splits en una sola sesión produce trabajo superficial que no aporta valor real (5 mini-refactors mezclados, difíciles de revisar, sin patrón unificado). La regla práctica más honesta: **un componente por sub-batch enfocado**, con análisis individual y aprobación de Edward por archivo.

**Sub-batches propuestos (T3-I.1..T3-I.7):**

11 archivos independientes (sin cross-batch deps), agrupados por familia conceptual:

- **T3-I.1 — `editor/PlatformPreview.tsx` (664 LOC)** — preview multi-platform aislado. Sub-componentes esperados: PlatformBadge, MediaThumb, ContentBlock por proveedor.
- **T3-I.2 — Instagram media family (1310 LOC, 2 files):** `instagram/MediaUploadZone.tsx` (675) + `instagram/VideoSplitPreview.tsx` (635). Comparten dominio (subida + procesamiento de video). Split coordinado.
- **T3-I.3 — Dashboard pages family (~2107 LOC, 3 files):** `dashboard/channels/page.tsx` (726), `dashboard/posts/page.tsx` (695), `dashboard/settings/billing/page.tsx` (686). Probable patrón compartido (page → cards/list/dialogs).
- **T3-I.4 — Templates family (546 LOC, 1 file):** `templates/VariableInserter.tsx` (546). `TemplateManagementDashboard.tsx` excluido (cross L-99).
- **T3-I.5 — `publishing/PublishingInterface.tsx` (463 LOC)** — flujo de publicación multi-step.
- **T3-I.6 — `ai/PromptTemplateManager.tsx` (458 LOC)** — admin de prompt templates.
- **T3-I.7 — `usePredictiveData.ts` (604 LOC, hook)** — analytics predictivos. Hook de cálculo, no componente; podría caber bajo T3-F.2 retrospectivo.

**Cross-batch (8 archivos): NO ejecutar en T3-I, esperar batch coordinado.**

- `webhooks/DeadLetterQueue.tsx` (729), `webhooks/WebhookSubscriptions.tsx` (688), `webhooks/WebhookEventsList.tsx` (503) — todos cross T3-N (TanStack migration). T3-N reescribirá su data layer.
- `editor/SchedulePicker.tsx` (447) — cross L-78/L-120.
- `shared/SidebarNav.tsx` (446 admin) — cross T3-R (logout + OAuth admin UI).
- `posts/[id]/page.tsx` (511) — cross L-98.
- `subscriptions/ChangePlanDialog.tsx` (487) — recomendable esperar settlement de billing/checkout flows.
- `security/RbacManager.tsx` (480) — cross L-297.
- `packages/ui/business/useContentEditor.ts` (506) — cross L-503.

**Por qué scheduling vs ejecutar todo ahora.**

Edward chose D explicitly because:

1. T3-I no tiene cadencia mecánica como T3-F/G. Cada componente es una decisión.
2. NEEDS_EDWARD en 19 de 20 — el 95% requiere alineación producto que sólo Edward puede dar.
3. Tests UI insuficientes — riesgo de regresiones invisibles si se mezclan 5+ refactors.
4. Calidad > velocidad: un split bien hecho de PlatformPreview vale más que 5 splits superficiales.

**Cuándo ejecutar.**

Sub-batches T3-I.1..T3-I.7 se ejecutan **bajo demanda** según prioridad de Edward, **uno por sesión enfocada**. El cross-batch (8 archivos) se ejecuta dentro de los batches cross-ref que ya están en backlog (T3-N para webhooks, T3-R para SidebarNav, etc.) — no requiere acción separada.

**Cuándo revisar.**

- Después de cerrar el resto del tier T3 (T3-J, T3-K..T3-R), Edward decide qué sub-batches T3-I priorizar primero.
- Si en algún momento un componente alcanza 1000+ LOC o produce conflicts frecuentes, salta de cola al primer T3-I.X disponible.

**Estado:** DIFERIDO con schedule. T3-I del roadmap se cierra como **deferred-with-plan** (no completado, no abandonado — agendado para sub-batches enfocados). El schedule reemplaza el batch monolítico de 20-30h por 7 sub-batches de 1-3h cada uno con calidad sostenible.

---

### PR-15 — Admin webhook subscription project selector hits non-existent backend route

**Fecha de aplicación:** 2026-04-29 (documentación)
**Batch de origen:** T3-N (Webhooks TanStack migration) — descubierto durante audit pre-ejecución
**Severidad del bug pre-existente:** medio — feature degradada silenciosa (selector siempre vacío) sin error visible al usuario
**Tipo:** code + product (decisión de scope requerida antes del fix)

**Descubrimiento.**

`apps/admin/components/webhooks/WebhookSubscriptions.tsx:152` ejecuta:

```typescript
const fetchProjects = async () => {
  try {
    const response = await fetch("/api/backend/projects", { credentials: "include" });
    if (response.ok) {
      const data = await response.json();
      setProjects(data);
    }
  } catch {
    // Failed to fetch projects — select will show empty list
  }
};
```

Sin embargo, **`GET /api/backend/projects` no existe como ruta del backend.** `apps/api/src/projects/projectRoutes.ts` solo registra:

- `GET /projects/:projectId` — fetch by id (route con path param obligatorio)
- `GET /accounts/:accountId/projects` — list per-account
- `POST /accounts/:accountId/projects` — create
- otros métodos con `:projectId` o `:accountId` en path

La ruta sin parámetros nunca matcheó. El fetch retorna 404, el `if (response.ok)` queda en `false`, y el `catch` con comentario explícito _"select will show empty list"_ confirma que el problema es conocido (o al menos asumido) por quien lo escribió. **Resultado en producción: el selector de proyectos en el modal de "create webhook subscription" siempre muestra lista vacía.**

**Por qué NO se fixea en T3-N.**

T3-N es una migración estructural (raw fetch → TanStack Query). El bug es **producto-bloqueante**, no técnico:

1. **Decisión arquitectónica pendiente:** ¿el admin necesita un selector cross-account de proyectos? Per T6-A (decisión cerrada 2026-04-21): _"Admin no tiene concept de proyecto"_. Eso sugiere que el selector entero podría ser legacy de cuando admin manejaba proyectos. Si la respuesta es "no", el selector debe eliminarse — no fixearse.
2. **Si la respuesta es "sí"**, se requiere:
   - Decidir el modelo: cross-account (admin global) vs per-account (admin selecciona account primero, luego ve sus projects)
   - Si cross-account: añadir nueva ruta backend `GET /admin/projects` con auth admin, paginación, y filtrado
   - Si per-account: cambiar UX para que el modal pida primero account, luego cargue projects via `GET /accounts/:accountId/projects` (que sí existe)
   - Añadir método al admin apiClient (`api.admin.getAllProjects()` o equivalente)
3. T3-N preserva el comportamiento actual (incluyendo el bug). El refactor a TanStack mantiene la misma llamada rota `/api/backend/projects` dentro del nuevo hook `useWebhookSubscriptions`. Cuando se fixee este finding, el cambio será en una sola location (el hook), no esparcido por el componente.

**Fix definitivo recomendado (cuando Edward decida scope).**

Opción A (eliminar selector):

- Quitar el campo `projectId` del modal de `WebhookSubscriptions.tsx`
- Backend: confirmar que `webhooks/subscriptions` route ignora `projectId` (o lo deriva del account de la subscription)
- Eliminar `fetchProjects` del flujo

Opción B (cross-account admin):

- Backend: añadir ruta `GET /admin/projects` con paginación + filtros + auth SUPER_ADMIN. Audit log obligatorio (cross-account access).
- Admin apiClient: añadir `api.admin.getAllProjects(filters)` en `dashboardClient.ts`
- Hook: nuevo `useAdminProjects(filters)` query
- Componente: reemplazar fetch directo por hook

Opción C (per-account):

- Cambiar UX: paso 1 selecciona account, paso 2 selecciona project
- Hook: reusar `useAccountProjects(accountId)` (ya existe en client app — replicar para admin)

**Cuándo revisar.**

Próximo turno con Edward post-T3-N. Decisión producto (A/B/C) → batch dedicado para implementación. Sugerido nombre: `T3-N.1` o entrada nueva en roadmap.

**Estado:** DIFERIDO — pre-existente al T3-N, preserva comportamiento, decisión de producto pendiente. NO se introduce nueva deuda con T3-N.

---

### PR-16 — Client `useChannels()` legacy hook hits non-existent route + shape mismatch

**Fecha de aplicación:** 2026-04-29 (documentación)
**Batch de origen:** T3-Q (ClientContentEditor autosave + schedule wire) — descubierto durante audit pre-ejecución de Phase 2
**Severidad del bug pre-existente:** alto — dos features completas (canales settings + recurring posts form) renderizan estado vacío permanente sin error visible
**Tipo:** code + product (refactor de páginas consumidoras pendiente)

**Descubrimiento.**

`apps/client/hooks/api/useChannels.ts:44` ejecuta:

```typescript
const response = await fetch("/api/backend/channels", { credentials: "include" });
if (!response.ok) throw new Error("Failed to fetch channels");
const data = await response.json();
return data.channels as Channel[];
```

Sin embargo, **`GET /api/backend/channels` no existe**. El backend (`apps/api/src/channels/channelRoutes.ts`) solo expone:

- `GET /channels/:channelId` (single, requiere id)
- `GET /projects/:projectId/channels` (listado per-project)
- `POST /channels`, `POST /channels/bluesky/connect`, `PUT /channels/:channelId`, `PATCH /channels/:channelId/set-primary` (T3-Q Phase 1), `DELETE /channels/:channelId`, `DELETE /channels/:channelId/hard`

Adicionalmente el shape `Channel` que asume el hook (campos `providerId`, `providerName`, `accountName`, `capabilities`, `usage`, `lastUsed`, `connectedAt`, `expiresAt`, `isConnected`) **no coincide** con lo que `toChannelView` retorna desde el backend (`{ id, projectId, name, platform, isPrimary, status, createdAt, updatedAt }`). Aún si la ruta existiera, los consumers leerían `undefined` para todos los fields críticos.

Consumidores impactados (data permanece undefined → renderizado vacío):

- `apps/client/app/dashboard/channels/page.tsx` — gestión de canales del cliente, lee `channel.capabilities.publish`, `channel.usage.postsThisMonth`, `channel.providerName`, etc.
- `apps/client/components/scheduling/RecurringPostForm.tsx` — selector de canales en posts recurrentes.

**Por qué NO se fixea completo en T3-Q.**

T3-Q es _ClientContentEditor autosave + schedule_ con D5.1.b (Channel.isPrimary). Refactorizar `useChannels()` a project-scoped requiere también reescribir `dashboard/channels/page.tsx` (rendering completo basado en campos del shape antiguo) — eso es un refactor estructural amplio fuera del scope de T3-Q.

T3-Q resuelve **solo lo necesario para el editor**:

1. Crea hooks nuevos `useProjectChannels(projectId)` + `useSetPrimaryChannel` en módulo separado, alineados con el backend real (`GET /projects/:projectId/channels`).
2. Editor (Phase 5) consume los hooks nuevos.
3. Settings UI per Phase 6 incorpora botón "Set as primary" via `useSetPrimaryChannel` apuntando al hook nuevo (no toca el rendering de la página existente, que sigue mostrando estado vacío).
4. `RecurringPostForm.tsx` queda con consumer roto (igual que estaba pre-T3-Q — el form ya estaba renderizando empty channel select).

**Fix definitivo recomendado (cuando Edward decida scope).**

Opción A — refactor unificado (preferida):

- Eliminar `apps/client/hooks/api/useChannels.ts` (el hook roto).
- Reemplazar todos sus call-sites por `useProjectChannels(projectId)` (creado en T3-Q).
- Reescribir `dashboard/channels/page.tsx` con shape canónico (sin `capabilities`/`usage`/etc. — esos campos no existen en backend; si se quieren, son features nuevas que requieren backend work).
- Actualizar `RecurringPostForm.tsx` para usar shape canónico.
- Tests integration completos.

Opción B — defer hasta resolver L-94/L-95 (T3-R):

- L-94 (channels OAuth dead) y L-95 (channels Test/Settings disabled) ya estaban marcados NEEDS_EDWARD.
- Cuando Edward decida flow producto (qué features mostrar en `/dashboard/channels`), se hace refactor unificado de UI + hooks en un solo batch.

**Cuándo revisar.**

Próximo batch que toque `/dashboard/channels` (probablemente T3-R cuando se resuelvan L-94/L-95) o batch dedicado post-T3 si Edward prioriza fixear el shape mismatch antes.

**Estado:** DIFERIDO — pre-existente a T3-Q. T3-Q crea hooks nuevos correctos para el editor flow sin tocar consumers rotos pre-existentes. NO se introduce nueva deuda — la deuda existía desde antes y queda registrada explícitamente.

---

### PR-17 — `apiClient.schedulePost` callers en post detail y preview pages omiten `channelIds`

**Fecha de aplicación:** 2026-04-29 (documentación + forward-compat fix)
**Batch de origen:** T3-Q (ClientContentEditor schedule wire) — descubierto al cambiar la signature de `schedulePost` durante Phase 3
**Severidad del bug pre-existente:** alto — feature "Schedule from post detail" siempre 400 en backend, sin error visible al usuario más allá del toast
**Tipo:** code + product (UI selector de canales pendiente)

**Descubrimiento.**

Phase 3 de T3-Q corrige el bug de field name (`scheduledAt` → `scheduledFor`) en `apps/client/lib/api/clients/publishingClient.ts` y aprovecha para hacer `channelIds` requerido (matching backend `SchedulePostBodySchema` en `apps/api/src/posts/postRoutes.ts:42`). Esto descubrió dos call-sites pre-existentes que llamaban `apiClient.schedulePost(postId, scheduledAt)` sin `channelIds`:

- `apps/client/app/dashboard/posts/[id]/page.tsx:109`
- `apps/client/app/dashboard/posts/[id]/preview/page.tsx:92`

Ambas páginas tienen un dialog de "Schedule" con solo un date picker — **no recogen channelIds en ningún momento**. Aún sin el bug del field name, el backend habría rechazado estas llamadas con 400 (`channelIds` es required). El comportamiento histórico: el usuario hace click en "Schedule", ve un toast genérico "Schedule failed" sin más contexto, y la operación nunca se completa.

**Fix paliativo aplicado.**

Ambos call-sites pasan `[]` como `channelIds` para mantener compilación TS:

```typescript
// dashboard/posts/[id]/page.tsx:109
await apiClient.schedulePost(postId, new Date(scheduleDate).toISOString(), []);

// dashboard/posts/[id]/preview/page.tsx:92
await apiClient.schedulePost(postId, new Date(scheduleDate).toISOString(), []);
```

El comportamiento queda **igual de roto** que antes (400 backend), pero el código compila y el bug del schema name queda fijo. Comentarios explícitos en código lo señalan.

**Root cause real.**

Estas dos páginas fueron escritas asumiendo que `schedulePost` solo necesitaba un timestamp (probablemente el autor pensó que el backend usaría todos los canales conectados por default). El backend nunca implementó esa default — siempre exigió `channelIds` explícito. La feature ha estado rota desde su introducción.

**Fix definitivo recomendado.**

Las dos páginas necesitan un selector de canales (canon: el mismo `ChannelMultiSelect` que T3-Q Phase 5 introduce en el editor). El selector usa `useProjectChannels(projectId)` y aplica el patrón D5.A+B (default channel pre-seleccionado + override). Cuando se haga eso:

1. Reemplazar el dialog de Schedule en ambas páginas por uno que incluya el selector.
2. Usar `useSchedulePost(postId, scheduledFor, channelIds)` (creado en T3-Q Phase 3).
3. Eliminar los comentarios `PR-17` y los `[]` literales.

Cross-batch con T3-R (channels OAuth + UI cleanup) si Edward decide tocar esa zona.

**Cuándo revisar.**

Próximo batch que toque `dashboard/posts/[id]` (probablemente T3-I L-148 cuando se ejecute el split de ese archivo, o batch dedicado post-T3 si Edward prioriza la UX de schedule desde post detail).

**Estado:** FIXED (2026-04-29) — `dashboard/posts/[id]/page.tsx` y `dashboard/posts/[id]/preview/page.tsx` ambos consumen ahora `useProjectChannels` + `ChannelMultiSelect` + `useSchedulePost` con smart-default + override (mismo patrón D5.A+B que el editor). Los `[]` literales fueron reemplazados por `selectedChannelIds` reales con primary pre-checked. Toast de validación si el usuario intenta programar sin canales seleccionados.

---

### PR-20 — EventSnapshot policy decision (when to snapshot, retention, who calls `createSnapshot`)

**Origen.** T4-B (2026-04-30) — implementación de `EventSnapshot` model + tabla `event_snapshots`.

**Contexto.** El modelo `EventSnapshot` y los métodos `createSnapshot` / `getSnapshot` existen como infrastructure-ready desde Genesis del proyecto (D0v4 audit § Infrastructure §3.2). T4-B materializó el schema (modelo Prisma + migración + tabla creada en DB). El código está listo para ser consumido pero **no hay caller**: ningún aggregate emite `createSnapshot` durante su ciclo de vida y ninguna rehydration consulta `getSnapshot` antes de replay.

**Por qué no se cerró en T4-B.** La decisión de **cuándo crear snapshots** y **cuándo replay desde snapshot** es una decisión de dominio, no de infrastructure. Depende de:

1. Qué aggregates tienen streams largos en producción (no medido aún — sistema reciente).
2. Política de retention (¿quedarse con el snapshot más reciente solamente, o conservar histórico?).
3. Trigger policy (¿cada N events?, ¿cada N días?, ¿bajo demanda durante warmup?).
4. Versioning policy: si un aggregate cambia de shape entre versiones, qué pasa con snapshots viejos.

T4-B aplicó la regla "código huérfano ≠ inútil" — la infra existe porque el negocio la previó; mantenerla wireada al schema no impone costo y habilita la decisión cuando haga falta.

**Plan estructurado.**

1. **Trigger** — la decisión se reabre cuando ocurra alguna de:
   - Stream rehydration latency > 500 ms p95 en métricas observability (cuando se mida).
   - Algún aggregate alcanza ~100 eventos por stream (consultar `SELECT stream_id, COUNT(*) FROM stored_events GROUP BY 1 ORDER BY 2 DESC LIMIT 10`).
   - Edward prioriza un evento de feature donde el snapshot pattern sea ROI claro.
2. **Investigación previa requerida**:
   - Canon de Kurrent (Event Store DB), Sequent, EventSourcing.NET — ¿cuándo recomiendan snapshots?
   - Anti-pattern: "Snapshot Paradox" (los snapshots erróneos son peor que no snapshots — versioning + invalidation policy).
   - ¿Por aggregate o por stream? Algunos sistemas snapshot solo "hot" aggregates.
3. **Implementación esperada**:
   - Decidir trigger por aggregate (probablemente método en aggregate root: `shouldSnapshot(): boolean`).
   - Wire en `EventSourcedRepository.save()` o similar para invocar `createSnapshot` post-append cuando trigger fires.
   - Wire en `rehydrate()` para consultar `getSnapshot` antes de replay.
   - Retention: cron / outbox-style cleanup de snapshots viejos por stream (mantener N más recientes).
   - Versioning: agregar `aggregate_version` / `snapshot_schema_version` field si decisión es histórico, o invalidar al cambiar shape.

**Bloqueado por.** Métricas reales de stream length + decisión de producto sobre rehydration latency target.

**Cuándo revisar.**

Cuando observability reporte stream lengths > 100 eventos en aggregates relevantes, o cuando Edward priorice optimizar warm-cold rehydration UX.

**Estado:** PENDING (deferred del T4-B 2026-04-30).

---

### PR-21 — `OutboxInboxCleaner` retention policy + cron task

**Origen.** T4-C (2026-04-30) — implementación de tabla `outbox_inbox` (consumer-side dedupe).

**Contexto.** T4-C agrega una tabla `outbox_inbox` (`messageId @id`, `processedAt`, `consumerId`) que persiste un row por cada evento procesado por un consumer del outbox. La tabla crece de forma monótona: cada dispatch del relay agrega una row, y nunca se purga. En estado estable, eso es ~100 rows/min por outbox event (asumiendo el polling cadence default), o sea ~150K rows/día. En el horizonte de 1 año = ~50M rows.

El propósito de la tabla es defense-in-depth contra re-processing tras un crash o re-claim (lease expiry). El `messageId` solo es relevante mientras el evento podría ser re-claimed; una vez que el row del outbox tiene `publishedAt IS NOT NULL` y supera el retention de `OutboxCleaner` (default 7d), el inbox row asociado es vestigial.

**Por qué no se cerró en T4-C.** La política de retention es una decisión separada que requiere observability data (¿cuántos rows tras N días?, ¿cuál es el query rate del lookup `tryClaimForProcessing`?). La implementación es trivial — clase `OutboxInboxCleaner` análoga a `OutboxCleaner`, registrada en `BackgroundTaskScheduler`.

**Plan estructurado.**

1. **Trigger** — abrir cuando ocurra alguna de:
   - `outbox_inbox` row count > 1M (consultar `SELECT count(*) FROM outbox_inbox`).
   - Latencia del `outboxInbox.create()` p95 > 50ms (índice degradado por table size).
2. **Implementación esperada**:
   - Crear `apps/api/src/infrastructure/outbox/OutboxInboxCleaner.ts` siguiendo el patrón de `OutboxCleaner.ts`.
   - Default retention = 7 días (mismo que `OutboxCleaner`) — un message no puede ser re-claimed si ya pasó el retention del outbox event.
   - Registrar en DI + start en `index.ts`.
   - Tests análogos a `OutboxCleaner.test.ts`.

**Bloqueado por.** Métricas reales de table growth.

**Cuándo revisar.**

Cuando se observe el patrón de growth en producción, o tras 30 días de uso del outbox post-T4-C.

**Estado:** PENDING (deferred del T4-C 2026-04-30).

---

### PR-22 — Migración a CDC vía Debezium para outbox dispatch

**Origen.** T4-C (2026-04-30) — escalabilidad futura.

**Contexto.** T4-C usa el **polling publisher** pattern del Transactional Outbox (cada 1 s, batch hasta 100). Es el approach más simple y suficiente hasta volúmenes de ~10K events/min. Por encima de ese threshold, el polling overhead (CPU + DB load del UPDATE...WHERE IN SELECT) compite con el throughput legítimo.

El alternative pattern es **transaction log tailing** vía Debezium (Kafka Connect): un proceso lee el WAL de PostgreSQL y publica events a Kafka inmediatamente, con latency p99 < 100ms y zero polling overhead. Es el approach usado por Netflix, Uber y la mayoría de sistemas de gran escala según el canon (`microservices.io transactional-outbox`).

**Por qué no se cerró en T4-C.** Requiere infraestructura nueva: Kafka cluster + Debezium connector + connector config + Schema Registry. Cambio arquitectónico mayor que requiere decisión de producto sobre el message broker (Kafka vs Pulsar vs Redis Streams). El polling con SKIP LOCKED + jitter + lease (T4-C) resuelve los problemas inmediatos sin esa inversión.

**Plan estructurado.**

1. **Trigger** — abrir cuando ocurra alguna de:
   - `OutboxEvent` row count > 100K activos (no-published) en cualquier momento.
   - p95 dispatch latency > 5s (polling cadence dominando).
   - Decisión de producto introduce dispatch externo (Kafka consumers, downstream services no-API).
2. **Investigación previa requerida**:
   - ¿Kafka, Pulsar, Redis Streams o NATS? — requiere decisión de stack.
   - ¿Postgres logical decoding (`wal2json`/`pgoutput`)? — verificar config y replication slot management.
   - Schema Registry (Confluent vs Apicurio) si Kafka.
3. **Implementación esperada**:
   - Habilitar `wal_level=logical` en PostgreSQL config.
   - Deploy Debezium connector con `OutboxEvent` table como source.
   - Migrar consumers downstream a leer del topic Kafka en lugar del `EventDispatcher` in-process.
   - Mantener `OutboxRelay` como fallback durante migración (dual-dispatch period).
   - Eventualmente retirar `OutboxRelay` y reemplazarlo por health-check del Debezium connector.

**Bloqueado por.** Decisión de producto sobre message broker + presupuesto de infra.

**Cuándo revisar.**

Cuando volumen de outbox supere 100K events/min sostenidos, o cuando se introduzca el primer consumer downstream out-of-process.

**Estado:** PENDING (deferred del T4-C 2026-04-30).

---

### PR-23 — `LISTEN/NOTIFY` para wake-up del OutboxRelay (latency optimization)

**Origen.** T4-C (2026-04-30) — optimización de latency.

**Contexto.** T4-C usa polling cadence default de 1s. Esto significa que un evento escrito al outbox a `t=0` espera promedio 500ms (worst case 1s) antes de ser dispatched. Para use cases donde la latency p99 de dispatch debe ser < 100ms (ej. real-time notifications, webhook delivery con SLA), el polling 1s es insuficiente.

El optimización canónica es PostgreSQL `LISTEN/NOTIFY`: el `PrismaOutboxWriter.writeEvents()` emite `pg_notify('outbox_new_event', ...)` después del INSERT, y el `OutboxRelay` mantiene una connection con `LISTEN outbox_new_event` que dispara una `poll()` inmediatamente cuando llega notification. El polling timer queda como fallback para eventos perdidos (NOTIFY no garantiza delivery).

**Por qué no se cerró en T4-C.** Requiere mantener una connection PG dedicada al LISTEN (no puede compartirse con el pool), más manejo de reconexión + buffer de notifications durante reconnect. Es complejidad significativa para una optimización que actualmente no tiene métricas que la justifiquen.

**Plan estructurado.**

1. **Trigger** — abrir cuando ocurra alguna de:
   - p99 dispatch latency observada > 1s y se requiere SLA < 500ms.
   - Use case introducido que necesita real-time delivery (UI live updates, real-time webhooks).
2. **Investigación previa**:
   - Canon: `https://www.postgresql.org/docs/current/sql-notify.html`.
   - Pattern: ya usado por `pg-listen` (Node lib) y supabase realtime.
   - Trade-off: NOTIFY no es transactional con la transacción que lo emite — el listener puede recibirlo antes del COMMIT del writer. Solución: hacer el writer notificar **después** del COMMIT vía `process.nextTick` post-transaction, o aceptar el race y confiar en que el polling lo captura.
3. **Implementación esperada**:
   - `OutboxRelay` recibe un `pg.Client` dedicado (no del pool).
   - `LISTEN outbox_new_event` en el dedicated client.
   - `pg_notify('outbox_new_event', '')` después del COMMIT en `PrismaOutboxWriter`.
   - On notification → llamar `poll()` (debounce si llegan muchas a la vez).
   - Polling fallback cada 5s en lugar de 1s (NOTIFY cubre el happy path).

**Bloqueado por.** Métricas observability (latency p99) + decisión de producto sobre real-time SLA.

**Cuándo revisar.**

Cuando se introduzca un use case que requiera real-time dispatch o cuando latency p99 > 1s sea visible en dashboards.

**Estado:** PENDING (deferred del T4-C 2026-04-30).

---

### PR-24 — Migrate `webhookJobProcessor` to `QueuePortRegistry` + `DeadLetterQueuePort`

**Origen.** T4-H (2026-05-01) — refactor del adapter queue-bullmq.

**Contexto.** `apps/api/src/webhooks/webhookJobProcessor.ts:53-105` crea `Queue` y `Worker` instancias directamente con `new Queue(QUEUE_NAMES.WEBHOOK_PROCESSING)` + `new Queue(QUEUE_NAMES.WEBHOOK_DEAD_LETTER)` + 2 `new Worker(...)`. Bypassa completamente el `QueuePort`/`QueuePortRegistry` introducidos por T4-H.

T4-H expone `QueuePortRegistry.forQueue(name)` y `BullMQDeadLetterQueueAdapter.archive()`. El webhookJobProcessor podría migrar para:

- Producer side: `registry.forQueue(QUEUE_NAMES.WEBHOOK_PROCESSING).enqueue(...)` en lugar de `new Queue(...).add()`.
- DLQ side: `dlqAdapter.archive(entry)` en lugar de `deadLetterQueue.add(...)` con shape ad-hoc.
- Connection: compartir `IORedis` connection del registry en lugar de crear sus 2 propias.

**Por qué no se cerró en T4-H.** Touching `webhookJobProcessor` arrastra T4-G (Integration events handlers) que está blocked by T6 (NEEDS_EDWARD decisions sobre L-44/L-45 webhook handlers stubs). El refactor estructural (queue + DLQ + connection sharing) es safe pero pequeño; el problema es que T4-G podría querer cambiar la lógica de processing en formas que dejen este refactor obsoleto. Esperar.

**Plan estructurado.**

1. **Trigger** — abrir cuando se ejecute T4-G (Integration events handlers NO-OP).
2. **Implementación esperada**:
   - Inyectar `QueuePortRegistry` en `WebhookJobProcessor` constructor.
   - Reemplazar `new Queue(WEBHOOK_PROCESSING)` con `registry.forQueue(WEBHOOK_PROCESSING)`.
   - Reemplazar `new Queue(WEBHOOK_DEAD_LETTER)` con `BullMQDeadLetterQueueAdapter` apuntando a `WEBHOOK_DEAD_LETTER`.
   - Reemplazar el shape ad-hoc del DLQ `{ originalJob, failure }` con `DeadLetterEntry` canónico.
   - Workers (`new Worker(...)`) pueden quedar directos (consumer-adapter actual no cubre todos los hooks de Worker).

**Bloqueado por.** T4-G unblock (Edward CP3 decision sobre L-44/L-45 stubs).

**Estado:** PENDING (deferred del T4-H 2026-05-01).

---

### PR-25 — Migrate workers + processors que crean `Queue/Worker` directos a `QueuePortRegistry`

**Origen.** T4-H (2026-05-01) — refactor del adapter queue-bullmq.

**Contexto.** Después del refactor T4-H, los siguientes archivos siguen creando `new Queue(...)` o `new Worker(...)` directamente sin pasar por `QueuePortRegistry`:

- `apps/workers/src/autoRenewalWorker.ts:28,54` — Queue + Worker propios para `AUTO_RENEWAL`.
- `apps/workers/src/inboxSyncWorker.ts:150` — Worker para `INBOX_SYNC`.
- `apps/workers/src/analyticsIngestWorker.ts:151` — Worker para `ANALYTICS_AGGREGATION`.
- `apps/workers/src/publishWorker.ts:81+` — Worker para `PUBLISH` (usa `createBullMQConsumerAdapter` parcialmente).
- `apps/workers/src/providers/instagram/publishingWorker.ts:86` — usa `createBullMQConsumerAdapter` y `createBullMQQueueAdapter` (ya cubierto por T4-H pero specific config queda).
- `apps/api/src/billing/GatewaySwitchJobService.ts:30` — Queue para `GATEWAY_SWITCH`.
- `apps/api/src/billing/gatewaySwitchProcessor.ts:30` — Worker para `GATEWAY_SWITCH`.
- `apps/api/src/infrastructure/integration-events/IntegrationEventConsumer.ts:191` — Worker para `INTEGRATION_EVENTS`.
- `apps/api/src/saga/SagaIntegration.ts` — utiliza `QueuePort` indirectamente; revisar si necesita migración.

T4-H solo fixea el adapter y los 3 dispatchers que ya usaban `QueuePort` (analytics, inbox-sync, repurpose). Los workers y processors directos siguen funcionando pero no comparten el registry — cada uno crea sus propias `IORedis` connections (ineficiente con N workers) y no aprovecha la abstracción.

**Por qué no se cerró en T4-H.** Es scope de T4-I (Workers retry + shutdown + auth errors) y T4-J (Workers ubicación + provider registry). T4-I está blocked-by T4-H (que se acaba de cerrar) → quedará desbloqueado al revisar al final de batch. La migración va junto con el refactor de retry/shutdown para no abrir y cerrar el mismo archivo dos veces.

**Plan estructurado.**

1. **Trigger** — automáticamente al ejecutar T4-I (queda desbloqueado por T4-H).
2. **Implementación esperada por archivo**:
   - Cada worker/processor recibe `QueuePortRegistry` via DI (los workers tienen su propio container; deben inicializarlo igual que API).
   - Reemplazar `new Queue(name)` con `registry.forQueue(name)` para producer side.
   - Workers pueden seguir usando `new Worker(name, handler)` directamente (consumer-adapter actual no cubre todos los hooks como `worker.on("failed", ...)` para DLQ); alternativamente extender `consumer-adapter` con event hooks. Decidir caso por caso.
   - Compartir Redis connection del registry para reducir overhead.

**Bloqueado por.** T4-I (que ahora está desbloqueado).

**Estado:** PENDING (deferred del T4-H 2026-05-01) — esperado close en T4-I.

---

### PR-26 — `DeadLetterQueuePort.list()` + `.retry()` implementation

**Origen.** T4-H (2026-05-01) — port introducido con producer-side completo (`archive`) pero `list/retry` no-implementados.

**Contexto.** `BullMQDeadLetterQueueAdapter` introducido en T4-H solo implementa `archive()` (mover failed job al DLQ). Los métodos `list({limit, offset})` y `retry(jobId)` están declarados en el port pero no implementados — throw `Error("Not implemented")` con referencia a este PR.

La razón es scope: T4-H mismo no tiene un consumer que necesite list/retry. Los consumers naturales son:

- Admin UI/API que muestra el DLQ y permite re-trigger manual (parcialmente existe en `outboxAdminRoutes.ts` pero para outbox, no para BullMQ DLQ).
- `webhookJobProcessor` que tiene su propio worker DLQ con re-process logic ad-hoc (PR-24).
- T4-I retry policies que pueden requerir auto-retry de DLQ entries bajo ciertas condiciones.

**Por qué no se cerró en T4-H.** "Crear sin consumer" es exactamente el patrón que la regla "infrastructure-ready ≠ inútil" autoriza, pero **solo cuando hay forma natural de testear**. Para `list/retry`:

- `list()` requeriría iterar entries del Queue — testeable contra mock pero el shape del entry deserializado requiere cuidado (es un Job de BullMQ con `data` json).
- `retry(jobId)` requeriría leer el entry, extraer `originalJob.data` + `originalJob.opts`, hacer `mainQueue.add(...)`, luego remover de DLQ. Atomicidad debatible (transaction de Redis vs. acepta race).

Implementar bien estos 2 métodos es ~2 h adicionales solo para infraestructura sin consumer. Mejor diferir hasta que un consumer natural aparezca y guíe el shape final (e.g., paginated vs. cursor, search by failure reason, etc.).

**Plan estructurado.**

1. **Trigger** — abrir cuando ocurra alguna de:
   - Admin UI requiere mostrar BullMQ DLQ entries (probablemente parte de T5 dashboard).
   - T4-I retry policies necesitan auto-retry de DLQ entries.
   - PR-24 (webhookJobProcessor migration) requiere re-process logic estandarizado.
2. **Implementación esperada**:
   - `list({limit, offset})`: usa `Queue.getJobs(["waiting", "delayed"], offset, offset + limit)` + map a `DeadLetterEntry`.
   - `retry(jobId)`: `Queue.getJob(jobId)` → extract → `targetQueue.add(originalJobName, originalData, originalOpts)` → `dlqJob.remove()`. Document race-condition trade-off.
   - Tests: cubrir paginación, retry happy path, retry job not found, retry connection error.

**Bloqueado por.** Aparición del primer consumer natural.

**Estado:** PENDING (deferred del T4-H 2026-05-01).

---

### PR-27 — Notification handler para `ChannelAuthFailedEvent`

**Origen.** T4-I (2026-05-01) — el `ChannelAuthFailureRecorder` introducido en T4-I escribe el event al outbox, pero no hay handler que lo consuma para crear notification al usuario.

**Contexto.** T4-I introduce el flujo completo de detección + persistencia: cuando un worker (`inboxSyncWorker` o `analyticsIngestWorker`) detecta `result.error === "AUTH"` desde un provider adapter, llama `recorder.record(channelId, provider, reason)`. El recorder ejecuta una transacción que:

1. Marca `Channel.needsReauth = true`, `authFailedAt = now()`, `authFailureReason = reason`.
2. Escribe `ChannelAuthFailedEvent` al outbox.

El worker después throw el error, BullMQ aplica retry policy (3 attempts con jitter), y eventualmente DLQ.

**Lo que falta:** un consumer del `ChannelAuthFailedEvent` que cree una notification visible al usuario apropiado vía el sistema `NotificationEventHandlers` existente. Sin esto, el usuario no se entera del problema hasta que abra el dashboard de channels y vea el flag `needsReauth`.

**Por qué no se cerró en T4-I.** Decisión NEEDS_EDWARD: ¿quién recibe la notification?

- Account owner solamente (más simple, pero project admins en ese account podrían ser quienes deben actuar).
- Project admins del project que owns el channel (más relevante operativamente, pero requiere lookup project membership).
- Todos los project members (más alarmista, ruido para users no-admin).
- Combinación: critical channels (primary) → todos; non-primary → solo admins.

Necesita decisión de producto sobre escalation policy + UX preferences.

**Plan estructurado.**

1. **Trigger** — abrir cuando Edward decida la recipient policy.
2. **Implementación esperada**:
   - Agregar método `onChannelAuthFailed(channelId, provider, reason, context)` en `NotificationEventHandlers`.
   - Wire en el `EventDispatcher` registration (ya hay un pattern para outbox events): handler resuelve recipient(s) via `Channel → Project → ProjectMembers`.
   - `CreateNotificationUseCase` con kind `CHANNEL_AUTH_FAILED`, message human-readable, action link al re-auth flow.
   - Tests del handler.
3. **Integration test:** end-to-end desde worker AUTH error hasta notification creada en DB.

**Bloqueado por.** Decisión Edward sobre recipient policy.

**Cuándo revisar.**

Cuando Edward decida la policy o cuando el primer reporte de "channel silent failure" llegue de producción.

**Estado:** PENDING (deferred del T4-I 2026-05-01).

---

### PR-28 — PII redaction paths en logger config

**Origen.** T4-M (2026-05-01) — canon research identificó OWASP A09:2025 gap.

**Contexto.** El logger factory en `apps/api/src/lib/logger.ts:13-34` aplica redaction de fields auth-related (password, token, apiKey, accessToken, refreshToken, authorization, cookie) — esto cubre la categoría "credentials" de OWASP Logging Cheat Sheet.

Pero la categoría **PII** está sin cubrir:

| Categoría OWASP  | En redact paths? | Riesgo                       |
| ---------------- | ---------------- | ---------------------------- |
| Auth credentials | ✅               | Bajo                         |
| Cookies/tokens   | ✅               | Bajo                         |
| email            | ❌               | A09:2025 — PII leak          |
| ssn              | ❌               | A09:2025 — high-severity PII |
| creditCard / pan | ❌               | A09:2025 — PCI-DSS violation |
| phone            | ❌               | A09:2025 — PII leak          |
| address          | ❌               | A09:2025 — PII leak          |
| dateOfBirth      | ❌               | A09:2025 — PII leak          |

**Por qué no se cerró en T4-M.** Agregar PII redaction sin auditar primero los call-sites puede romper functionality:

- Admin UI puede legítimamente necesitar ver `user.email` en logs de actividad sospechosa.
- Customer support workflows pueden requerir últimos 4 dígitos de PAN para identificación.
- Compliance audit logs DEBEN mostrar quién accedió qué (PII no se redacta en audit category).

Decisión simplista (`logger.redact = ['*.email']`) tiene blast radius alto — log entries que actualmente muestran emails dejarían de mostrarlos, posiblemente rompiendo dashboards/alerts.

**Plan estructurado.**

1. **Trigger** — abrir cuando ocurra alguna de:
   - Compliance audit (GDPR/CCPA/SOC2) detecta PII en logs.
   - Security review request explícito.
   - Volumen de log entries con PII supere threshold de tooling externo.

2. **Investigación previa requerida**:
   - Audit `grep -rn "logger\.\(info\|warn\|error\)\b" apps/api/src` — categorizar call-sites por whether they include PII.
   - Threat model: para cada PII type, decide ¿debe ser redactado en TODOS los logs o solo en algunos?
   - Tail-end behavior: ¿`remove: true` (drop completo) o `censor: "[REDACTED]"` (placeholder)?
   - Audit log exception: la category `audit` puede necesitar bypass (compliance demanda full names/emails).

3. **Implementación esperada**:
   - Extender `apps/api/src/lib/logger.ts:REDACT_PATHS` con paths PII.
   - Considerar separation: `auditLogger` (sin PII redaction) vs `httpLogger` (con PII redaction).
   - Tests con payloads que incluyan PII para verificar redaction.
   - Documentar en `docs/security/` el threat model + decisiones por PII type.

**Bloqueado por.** Compliance/security review + threat model.

**Cuándo revisar.**

Cuando se acerque audit GDPR/SOC2 o cuando security team priorice PII handling.

**Estado:** PENDING (deferred del T4-M 2026-05-01) — security review necesaria.

---

### PR-29 — Cache stampede protection (single-flight, jitter, stale-while-revalidate)

**Origen.** T4-L (2026-05-01) — canon research identificó stampede protection como pattern recomendado pero out-of-scope inmediato.

**Contexto.** El `CachePort` introducido en T4-L expone `getOrSet(key, factory, ttlSeconds?)` con semántica cache-aside simple: si miss, invoca el factory, cachea, retorna. Múltiples requests concurrentes para la misma key con cache miss → todos invocan el factory → si el factory hace una DB query expensive o un provider API call, hay thundering herd / cache stampede.

Canon (Wikipedia "Cache stampede", BentoCache, 1xAPI single-flight 2026, AWS ElastiCache docs) recomienda 4 patterns combinables:

1. **Single-flight / request coalescing**: in-process Promise sharing — todos los callers concurrentes esperan al mismo Promise mientras el factory ejecuta una sola vez.
2. **Probabilistic early expiration (XFetch)**: refresh proactivo antes de expiry para evitar el "cliff edge". Algoritmo XFetch de Redis Labs.
3. **Stale-while-revalidate**: servir valor stale instantáneamente, refresh en background.
4. **Jitter / staggered TTLs**: TTL = base + random(0, jitter) para evitar que muchas keys expiren simultáneamente.

**Por qué no se cerró en T4-L.** Stampede protection requiere:

- **Métricas de hot keys**: ¿qué keys son las que tienen alta concurrency? Sin métricas, optimizar es premature optimization.
- **Decisión de policy por key class**: ¿single-flight para todo, o solo para factories `expensive`? ¿stale-while-revalidate para queries non-critical, fail-fast para auth?
- **Cambio en CachePort signature**: agregar `getOrSet(key, factory, { ttl, staleWhileRevalidate, jitter, deduplication })` o overloads. Requiere migración de los 7 callers actuales (5 servicios + 2 UCs) si la signature cambia.

Hacer todo eso sin métricas reales es overengineering.

**Plan estructurado.**

1. **Trigger** — abrir cuando ocurra alguna de:
   - Métricas de cache miss latency p99 > 500ms con concurrent requests > 10/sec.
   - Reporte explícito de "hot key" causando DB load spike.
   - Auth cache (rbac) muestra patterns de stampede tras cache invalidation events.

2. **Investigación previa requerida**:
   - Audit de los 7 callers actuales: identificar factories expensive (>100ms) vs cheap (<10ms).
   - Decision tree: ¿qué pattern para qué tipo de factory?
   - Canon de [BentoCache](https://bentocache.dev/docs/grace-periods) + [Wikipedia XFetch](https://en.wikipedia.org/wiki/Cache_stampede#Probabilistic_early_expiration).

3. **Implementación esperada**:
   - Extender `CachePort.getOrSet` con `{ stampedeProtection: 'single-flight' | 'xfetch' | 'stale-while-revalidate' | 'none' }` opt-in option.
   - `RedisCacheAdapter` implementa via in-process `Map<key, Promise>` para single-flight + Redis SETNX lock para cross-pod single-flight.
   - `InMemoryCacheAdapter` implementa via in-process Map (suficiente para tests).
   - Métricas Prometheus: `cache_stampede_collisions_total` por key prefix.

**Bloqueado por.** Métricas reales de hot keys + decision de qué policy aplica dónde.

**Cuándo revisar.**

Cuando aparezca el primer reporte de DB load spike correlacionado con cache invalidation, o cuando observability detecte cache miss concurrency > N para una key.

**Estado:** PENDING (deferred del T4-L 2026-05-01).

---

### PR-30 — `BranchManager.branchCache` dead code investigation

**Origen.** T4-L (2026-05-01) — audit del per-class cache reveló pattern write-only.

**Contexto.** Durante T4-L se auditaron los 5 per-class `Map<>` caches en `apps/api/src/`. Cuatro tienen reads y writes claros. El quinto, `apps/api/src/content/BranchManager.ts:branchCache` (declarado en línea 17), aparece solo en `branchCache.set(...)` (línea 68). **Cero reads detectados** vía grep en el archivo completo.

T4-L migró el cache al `CachePort` por consistencia, pero **NO agregó reads que no existían** — el patrón "set, never get" se preserva. Esto significa que la migration es safe (no introduce regression) pero deja la pregunta abierta: ¿el cache debería estar siendo leído en `getBranch()` o métodos similares?

Posibilidades:

1. **Dead code residual**: refactor anterior eliminó el read path pero olvidó eliminar el write. Cache ocupa memoria sin propósito.
2. **Implementación incompleta**: el read estaba planeado en `getBranch()` o equivalent, nunca se completó. Bug latente: `getBranch()` siempre va a DB cuando el cache podría servir.
3. **Premature optimization removed**: implementación previa cacheaba al crear, leía en otro flow que se simplificó. La cache quedó como artefacto.

**Por qué no se cerró en T4-L.** Investigación requiere lectura completa de `BranchManager` + sus consumers + git history para distinguir entre las 3 posibilidades. Más invasivo que T4-L (que era cache infrastructure consolidation).

**Plan estructurado.**

1. **Trigger** — abrir cuando se prioritice content versioning features o cuando BranchManager se modifique por otra razón.

2. **Investigación**:
   - Read completo de `BranchManager.ts` + `VersionController.ts` + tests asociados.
   - `git log -p --follow apps/api/src/content/BranchManager.ts` para historial del cache.
   - Identificar consumers de `BranchManager.getBranch` (si existe ese método) y verificar si esperan cache.
   - Decision: (a) eliminar el cache (residual) → liberar memoria; (b) agregar reads donde corresponda (incomplete) → fix performance bug; (c) algo intermedio.

3. **Implementación esperada por opción**:
   - (a): eliminar la línea `cache.set` migrada; eliminar la inyección del `CachePort`.
   - (b): agregar `cache.getOrSet` en el read paths que actualmente van directo a DB.
   - (c): contexto-dependiente.

**Bloqueado por.** Otra razón para tocar `BranchManager` + capacidad para verificar git history.

**Cuándo revisar.**

Cuando aparezca un ticket relacionado con BranchManager (perf, feature, bug) o cuando alguien revise content versioning architecture en general.

**Estado:** PENDING (deferred del T4-L 2026-05-01).

---

### PR-31 — Remaining direct `RedisCacheManager` consumers post-T4-L (PostsService duplicate pool + autoCacheMiddleware + cacheDecorators)

**Origen.** T4-L (2026-05-01) — audit post-cierre del batch detectó 3 sitios que siguen consumiendo `RedisCacheManager` directamente, fuera del `TOKENS.CachePort` consolidado.

**Contexto.** T4-L consolidó 5 servicios + 2 UCs detrás de `CachePort`, pero **deliberadamente no tocó** 3 sitios HTTP-tier / decorator-tier que tienen razones legítimas o requieren scope mayor. Audit:

| Sitio                                                                                                                                                           | Naturaleza                                                        | Problema                                                                                                                                                                                                                                                                                    | Scope para fix                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/posts/postsService.ts:64` (`createPostsService`) — registrado en `setupServices.ts:446` con `new RedisCacheManager({ keyPrefix: "posts:", ... })` | Servicio core de posts                                            | **Duplica el pool L1+L2**: el T4-L singleton (`TOKENS.RedisCacheManager`, prefix `api:`) y el de PostsService (prefix `posts:`) son 2 instancias separadas en el mismo proceso → 2 conexiones ioredis, 2 registros Prometheus, 2 L1 LRU pools. Pre-T4-L issue, no introducido por el batch. | MEDIUM — refactor PostsService para resolver `TOKENS.RedisCacheManager` (o `TOKENS.CachePort` si la signature lo permite) en lugar de instanciar. Verificar que la migración de keys de `posts:` a `api:posts:` (o keep `posts:` con sub-prefix) no rompe consumers que dependen del prefix actual. |
| `apps/api/src/middleware/autoCacheMiddleware.ts`                                                                                                                | Fastify plugin para HTTP response caching                         | Usa features avanzados del manager (headers-driven invalidation, ETag handling, response shape inspection) que NO están en `CachePort`. Razón legítima para mantener concrete dependency.                                                                                                   | HIGH — extender `CachePort` para exponer headers/ETag o aceptar la concrete class permanentemente como tier-specific exception (similar al patrón "ports for cross-cutting concerns" de Cockburn). Decisión arquitectónica, no rewrite mecánico.                                                    |
| `apps/api/src/lib/cache/cacheDecorators.ts` (`@cache`, `@invalidateCache` decorators)                                                                           | TypeScript decorators de método para caching ergonómico per-class | Aceptan `RedisCacheManager` concrete por argumento. Internal helpers, no exhibido en la app surface.                                                                                                                                                                                        | QUICK — refactorizar a aceptar `CachePort`. Las features que usan (`get`, `set`, `del`) ya están en el port.                                                                                                                                                                                        |

Adicionalmente, `apps/api/src/monitoring/cacheStatsRoutes.ts` y `apps/api/src/index.ts` resuelven `TOKENS.RedisCacheManager` directo para exposición de stats / decoración de Fastify. Esto es legítimo (el manager expone `getStats()`, `flush()`, `warmCache()` que NO están en el port y son apropiados para ops tooling) y NO requiere fix.

**Por qué no se cerró en T4-L.** El plan T4-L explícitamente declaró:

> "**`autoCacheMiddleware` migration to CachePort** → middleware usa features avanzados del `RedisCacheManager` (headers-driven invalidation, ETag handling). Migration requiere extender el port o aceptar la concrete class. Out of scope T4-L; revisar si necesario en batch específico."

PostsService no estaba en el plan original como issue (la duplicación de pools es pre-existente y T4-L se enfocó en la familia de findings L-49/L-13/L-377/L-381). La detección post-batch surge del audit "lo que queda directamente acoplado al manager".

**Plan estructurado.**

1. **Trigger** — abrir cuando: (a) métricas confirmen overhead real de los 2 ioredis connections, (b) se priorice unification por completitud arquitectónica, (c) cacheDecorators se modifique por otra razón (cleanup oportunista).

2. **Sub-batches sugeridos** (independientes):
   - **31-A**: PostsService → singleton `TOKENS.RedisCacheManager`. Audit de keys `posts:*` actuales (Redis CLI `KEYS posts:*` o equivalente) para definir migration path. ~2-3h.
   - **31-B**: cacheDecorators → `CachePort`. Refactor mecánico + actualizar tests. ~1h.
   - **31-C**: autoCacheMiddleware → decisión arquitectónica. O extender `CachePort` con `cacheResponse(req, res, opts)` opt-in, o documentar como tier-specific exception en `docs/architecture/caching.md`. Investigación previa: revisar uso real en routes (probablemente menor de lo esperado). ~3-5h.

3. **Bloqueado por.** Decisión sobre 31-C (port extension vs documented exception). 31-A y 31-B son AUTO sin decisiones bloqueantes.

**Cuándo revisar.**

Cuando se priorice un batch dedicado a "cache architecture finalization" o cuando alguno de los 3 sitios se modifique por razón ortogonal (refactor de PostsService, rewrite de autoCacheMiddleware, cleanup de decorators).

**Estado:** PENDING (surfaced del T4-L audit 2026-05-01).

---

### PR-32 — Cache anti-pattern fitness grep + 2 sites missed por T4-L

**Fecha de aplicación:** 2026-05-01
**Batch de origen:** post-T4-P audit (cierre del audit gap de T4-L)
**Severidad del bug pre-existente:** medio — 2 per-class `Map<>` caches survived T4-L migration debido a scope incompleto del audit; CLAUDE.md §Caching claim sobre fitness grep era falsa
**Tipo:** code + config + docs

**Naturaleza especial.** Cierre honesto del gap auditing de T4-L. Edward exigió "no hedge"; T4-L cortó scope al directorio sin grep amplio del pattern.

**Sitios cerrados:**

| Sitio                                                                               | Antes                                                                           | Después                                                                                                                                                                                                                                                                                                   | TTL canon                                                                  |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `apps/api/src/ai/orchestrator.ts:52` (`private cache: Map<...>`)                    | TTL ad-hoc 5min ms, naive `JSON.stringify` key, single `clearCache()` clear-all | CachePort con SHA-256 hash key + version tokens (PROMPT_TEMPLATE_VERSION, modelId), multi-tag (`ai`, `ai:task:<type>`, `ai:model:<id>`), TTL default **1h** (3600s), `clearCache()` → `invalidateByTag("ai")`, `getCacheStats()` ahora `{ hitRate }` (drop `size` field — era info engañosa per-instance) | Helicone, Anthropic prompt cache, AWS LLM caching                          |
| `apps/api/src/analytics/realtimeAnalytics.ts:55` (`private metricsCache: Map<...>`) | per-instance Map, `metricsCache.clear()` en shutdown                            | CachePort con TTL **24h** (failover-window cap), key prefix `realtime-metrics:`, NO `getOrSet` (canon: keyed state, no cache-aside semantics), shutdown NO clear (let TTL handle — clear() afectaría otros pods)                                                                                          | Confluent KTable, Apache Flink keyed state, AWS stream enrichment patterns |

**Cambios laterales:**

- `apps/api/src/ai/aiService.ts`: constructor recibe `cache: CachePort`; `getAdminOrchestrator` pasa al `createFromEnv`; `clearCache()` ahora await.
- `apps/api/src/ai/AiRequestService.ts`: constructor recibe `cache: CachePort`; los 2 sitios donde construye orchestrator pasan cache.
- `apps/api/src/infrastructure/container/setupServices.ts`: factories de AIService + AiRequestService resuelven `TOKENS.CachePort`.
- `apps/api/src/ai/orchestrator.ts`: helper inline `stableStringify` (10 LOC, sort keys recursive) evita dep nueva.
- `apps/api/tests/unit/aiOrchestrator.helpers.ts`, `aiOrchestrator.cache.test.ts`, `aiService.test.ts`, `realtimeAnalytics.test.ts`: actualizados para inyectar `InMemoryCacheAdapter`. TTL test ajustado de 100ms→1000ms (CachePort floor = 1s para sub-second TTLs).
- `CLAUDE.md` §Automated Compliance Checks: agregado **grep #14** con threat description (OWASP A07:2021 cache coherence).
- `.github/workflows/fitness.yml`: agregado **step #14** mirroring exact, summary count "13" → "14".
- `CLAUDE.md` §Caching línea 451: claim "CI fitness grep blocks the pattern" ahora **verdadera** (refs grep #14 explícitamente).

**Canon-driven decisiones (research del 2026-05-01):**

- **SHA-256 key + version tokens**: amitkoth, AWS LLM caching, Brenndoerfer. Naive `JSON.stringify` rompe en whitespace/property-order changes.
- **Multi-tag canon**: Brenndoerfer, oneuptime — single `"ai"` tag es nuclear-only; targeted invalidation (model upgrade, account opt-out) requiere `ai:model:<id>` y `ai:account:<id>`.
- **TTL 1h default for AI**: Helicone "1h for stable content", Anthropic 5m+1h tiers. LLM responses son deterministas modulo temperature.
- **TTL 24h for delta buffer**: Confluent KTable + Apache Flink keyed state — NOT TTL-bounded; bounded by key space + explicit deletion. 1h sería insuficiente (60 missed cycles wipes state).
- **Drop `size` field from getCacheStats**: per-instance Map size era info engañosa en multi-pod. Cluster-wide stats vía `RedisCacheManager.getStats()` Prometheus metrics.
- **Async migration accepted**: V8 v7.2+ await on resolved promise = 1 microtick (nanoseconds). BentoCache, cache-manager v6, Cacheable: todos async-only by design. No `tryGetSync` fast-path.
- **Semantic caching deferred**: GPTCache + embeddings = higher hit-rate ceiling pero separate PR. Canon: exact-match → CachePort first, semantic on top later.

**Observation laterral**: `RealtimeAnalyticsService` no está wireado en DI — orphan code. La migración aplica igual (fitness grep pasaría) y deja signature lista para cuando se wire. Documentado, no DELETE per "three questions before delete" sin tres-preguntas-cleared.

**Root cause real.**

T4-L audit cortó scope a directorios visibles (`auth/`, `orchestration/`, `content/`) + 2 application UCs sin grep amplio del pattern. Edward exigió "no hedge"; aún así limité scope sin justificación arquitectónica. PR-32 cierra honestamente.

**Cuándo revisar.**

N/A — RESUELTO. La fitness grep #14 garantiza que no regresará.

**Estado:** RESUELTO ✅ (2026-05-01)

---

### PR-33 — Direct `this.redis.*` usage bypassing `CachePort` (24 files / 65 usages)

**Fecha de surfacing:** 2026-05-01 (audit post-PR-32)
**Severidad:** medio — viola CLAUDE.md §Caching ("All cross-pod cached state MUST go through `TOKENS.CachePort`"); fitness #14 no lo cubre porque el pattern es distinto al `private *Cache = new Map()`
**Tipo:** code refactor + posible fitness extension

**Contexto.** Sweep post-PR-32 con `grep this.redis.(setex|get|set|del)` en `apps/api/src` arroja **65 usages en 24 files**. T4-L y PR-32 cubrieron el patrón `private *Cache = new Map()`; direct `this.redis.*` es un patrón paralelo que también bypassa el port.

**Categorización por naturaleza** (audit en código real, no por nombre):

| Categoría                        | Files (ejemplos confirmados)                                                                                                                                                                                                                                         | Verdict                 | Razón                                                                                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cache-aside (claro anti-pattern) | `apps/api/src/analytics/engagementPredictor.ts:318` (`setex(cacheKey, 3600, JSON.stringify(context))`), `analytics/performanceComparison/index.ts:455`, `analytics/crossPlatform/index.ts:147`, `analytics/threadAnalytics.ts:183`, `analytics/roiCalculator.ts:340` | **MIGRATE** a CachePort | Patrón canónico cache-aside con TTL — exactly what CachePort.set + get cubre. Mismo cross-pod coherence concern que motivó T4-L.                                         |
| Rate limiters / counters         | `monitoring/rateLimitingDashboard.ts`, `auth/enhancedOAuthProvider.ts` (sliding window via Redis sorted sets)                                                                                                                                                        | **KEEP**                | Sorted sets / atomic counters — distinct concern. No es cache, port abstraction sería overkill. Documentar como exception justificada en `docs/architecture/caching.md`. |
| Sessions / connection state      | `orchestration/ProviderDependencyManager.ts`, `auth/...`                                                                                                                                                                                                             | **AUDIT**               | Mixed — algunos pueden ser cache (con port), otros session storage (Redis directo justified). Requiere caso-por-caso.                                                    |
| Pub/sub / distributed locks      | `content/SyncEngineImpl.ts` (channel notifications), `realtimeAnalytics.ts` (subscribe/publish)                                                                                                                                                                      | **KEEP**                | Pub/sub + locks no son cache. Distinct ports si surge necesidad (`PubSubPort`, `DistributedLockPort`); por ahora directo justified.                                      |

**5 sitios cache-aside confirmados** (claros, no ambiguos):

- `analytics/engagementPredictor.ts:318` — predictions cache, TTL 1h.
- `analytics/performanceComparison/index.ts:455` — comparison results cache.
- `analytics/crossPlatform/index.ts:147` — cross-platform aggregations cache.
- `analytics/threadAnalytics.ts:183` — thread metrics cache.
- `analytics/roiCalculator.ts:340` — ROI computation results cache.

Adicional: `cqrs/CQRSBus.ts:353` usa `JSON.stringify(result)` para `cacheData` — verificar si va por CachePort o redis directo (read del file requerido).

**Por qué no se cerró en T4-L/PR-32.** T4-L scope era `private *Cache = new Map` consolidación. PR-32 cerró el audit gap del MISMO patrón. Direct `this.redis.*` es un patrón **paralelo distinto** que requiere su propio batch + diferenciación caso-por-caso (no todo `redis.setex` es cache).

**Plan estructurado.**

1. **Trigger** — abrir cuando: (a) cualquier reporte de cross-pod cache inconsistency en analytics, (b) priorización por completitud arquitectónica, (c) métricas Prometheus muestran cache hit rate < 80% en analytics endpoints.

2. **Sub-batches sugeridos:**
   - **33-A** (HIGH PRIORITY, ~2-3h, AUTO): Migrar las 5 analytics cache-aside a CachePort. Inject `cache: CachePort` + `cache.getOrSet`. Tags: `analytics:engagement`, `analytics:performance`, etc. para invalidación targeted.
   - **33-B** (MEDIUM, ~1-2h): Audit completo de los otros 19 files. Tabla con verdict por sitio (MIGRATE / KEEP-rate-limiter / KEEP-session / KEEP-pubsub).
   - **33-C** (variable scope): Migrar los KEEPs justificados a backlog comments + caching.md exceptions section. Migrar los MIGRATE.
   - **33-D** (deferred / opcional): evaluar fitness #15 para "non-rate-limiter direct redis.setex". Alta false-positive risk; viable con allowlist de archivos rate-limiter.

3. **Bloqueado por.** Solo prioritization decision. 33-A es AUTO sin decisiones bloqueantes.

**Cuándo revisar.**

Cuando se prioritice un batch dedicado a "cache port coverage finalization", o cuando aparezca un report de cross-pod inconsistency en analytics dashboards.

**Estado:** PENDING (surfaced del PR-32 audit 2026-05-01).

---

### PR-34 — `RealtimeAnalyticsService` orphan code decision (wire / deprecate / DELETE)

**Fecha de surfacing:** 2026-05-01 (audit post-PR-32)
**Severidad:** bajo — código inactivo, no causa bugs en producción, pero ocupa mantenimiento
**Tipo:** decision NEEDS_EDWARD

**Contexto.** Audit post-PR-32 con `grep -rn RealtimeAnalyticsService apps/ --include="*.ts" --include="*.tsx"` repo-wide arroja **0 usages fuera de su propio file y tests** (`apps/api/src/analytics/realtimeAnalytics.ts` + `apps/api/tests/unit/realtimeAnalytics.test.ts`). Completamente orphan en runtime.

PR-32 migró su `metricsCache: Map<>` a CachePort por consistencia con la fitness rule, pero el service NO está wireado en DI ni instanciado por ninguna route/worker/entry point. Tests lo construyen manualmente para verificar `calculateEngagementRate` (utility function pura).

**Tres preguntas (CLAUDE.md feedback rule):**

1. **Origen.** ¿Por qué se añadió? Probable feature WebSocket realtime planeada para dashboards live (analytics/inbox/notifications). Indicios: el archivo tiene 660 LOC con setup de WebSocket routes (`registerWebSocketRoutes`, `handleWebSocketConnection`), JWT auth via `jsonwebtoken`, broadcast updates pattern. No es speculative scaffold — implementación bastante completa.
2. **Propósito.** Provee analytics realtime via WebSocket: subscribe a posts → cada cycle (~30s) recibe metrics + deltas vs previous reading. Backend para dashboards live update.
3. **Duplicación.** No hay equivalente activo: otros analytics services trabajan con polling/cron + REST endpoints (no WebSocket). Si se DELETE, no hay alternativa equivalente — perdemos la capability futura.

Veredicto tres-preguntas: **scope grande, NO clearly DELETE-able**. Necesita Edward decision.

**Opciones (por presentar a Edward):**

- **Opción A: WIRE** — registrar en DI, exponer ruta WebSocket en index.ts, escribir tests integration. Requiere: feature roadmap entry (cuándo se cobra esta capability) + frontend dashboard wiring (Storybook, hooks). Esfuerzo HEAVY (~8-12h total). Razón: feature genuinely valuable para realtime dashboards.
- **Opción B: DEPRECATE** — agregar `@deprecated` con TODO/issue ID para wire-up. Mantener el código, fitness pasa, tests verifican utilities. Esfuerzo TRIVIAL (~30min). Razón: si feature está pospuesta pero no descartada.
- **Opción C: DELETE** — eliminar archivo + tests + cualquier referencia. Esfuerzo QUICK (~1h). Razón: si feature realmente abandonada, evita mantener 660 LOC fantasma.

Mi recomendación tentativa: **Opción B (DEPRECATE)** — el código está bien estructurado, no causa drag operacional, y delete elimina opcionalidad. Pero solo Edward sabe el roadmap real para realtime dashboards.

**Por qué no se cerró en PR-32.** PR-32 era cache anti-pattern fix, no decision sobre orphan code. La migración del cache se aplicó porque la fitness grep #14 es uniforme (no excluye orphan files); el decision sobre el archivo es scope distinto.

**Plan estructurado.**

1. **Trigger** — Edward decision durante una sesión de roadmap planning.
2. **Investigación previa requerida**:
   - Verificar si hay un old plan / Linear ticket que mencione realtime analytics dashboard.
   - Revisar `git log --follow apps/api/src/analytics/realtimeAnalytics.ts` para historial.
   - Buscar issues open con keyword "realtime" o "websocket".
3. **Por opción**:
   - A (WIRE): roadmap entry + DI registration + frontend hook + integration tests.
   - B (DEPRECATE): `@deprecated` JSDoc + comment con razón + backlog issue.
   - C (DELETE): rm file + rm test + git commit con mensaje "feat: drop unused RealtimeAnalyticsService".

**Bloqueado por.** Edward decision.

**Cuándo revisar.**

Próxima sesión de roadmap planning, o cuando aparezca user demand de realtime analytics dashboards.

**Estado:** PENDING — NEEDS_EDWARD (surfaced del PR-32 audit 2026-05-01).

---

### PR-35 — `extractUserId` → `Actor` discriminator refactor + auth shape consolidation

**Fecha de surfacing:** 2026-05-01 (deferred from T4-R)
**Severidad:** bajo — el extractUserId actual es funcional y canon-aligned (explicit param-passing prioritized). Refactor a discriminator es mejora deseable, no requerimiento.
**Tipo:** refactor

**Contexto.** T4-R implementó `extractUserId(req)` retornando `req.auth?.user?.id ?? req.user?.id` (admin → regular fallback) y declaró `request.auth?` en `fastify.d.ts` para eliminar casts. Esto resuelve L-27 (audit logs ahora tienen userId real). Quedan dos mejoras canon-recomendadas pero out-of-scope T4-R.

**Mejora 1: Actor discriminator pattern**

Canon (OWASP Logging Cheat Sheet, microservices.io audit-logging, sonar): `actor: { type: "user" | "admin" | "system" | "service"; id: string | null }` beats bare `userId: string | undefined`. Razón: bare null/undefined es ambiguo — ¿anonymous? ¿cron job? ¿retry worker? El discriminator field elimina la ambigüedad.

Cambio sugerido:

```typescript
type Actor =
  | { type: "user"; id: string }
  | { type: "admin"; id: string }
  | { type: "system"; id: string };

private extractActor(req: FastifyRequest): Actor | null {
  if (req.auth?.user?.id) return { type: "admin", id: req.auth.user.id };
  if (req.user?.id) return { type: "user", id: req.user.id };
  return null;  // anonymous request
}
```

Impactos: `AuditEvent.userId?: string` → `AuditEvent.actor?: Actor`. Migration de schema `auditLog.userId` (string?) → `auditLog.actorType` + `auditLog.actorId` (split fields). Requiere data migration retroactiva.

**Mejora 2: Auth shape consolidación**

Canon (`@fastify/auth` multi-strategy pattern): one shape, multiple strategies. Nuestro split `request.user` (regular) vs `request.auth.user` (admin) es non-canon technical debt. Canon: ambos deberían populate `request.auth.user` (o `request.user`) con `request.auth.scope: "user" | "admin"` discriminator.

Migration HEAVY:

- Refactor `adminAuthMiddleware` para set `request.auth = { user, scope: "admin", sessionId, deviceId }`.
- Refactor regular auth middleware (busca por `request.user` setter en código) para set `request.auth = { user, scope: "user" }`.
- Delete `request.user` augmentation.
- Update todos los callers que leen `request.user.id` → `request.auth.user.id`.

**Mejora 3: AsyncLocalStorage user context (opcional)**

Canon (`@fastify/request-context`): para deep call chains donde threading param es impractical. No es nuestro caso actual (audit logger recibe `FastifyRequest` directly), pero si surge un caller deep-stack podría aplicar.

**Por qué no se cerró en T4-R.**

T4-R alcance era "implementar L-27 stub fix + L-526 CSV bypass". Las 3 mejoras arriba son **canon-recommended pero no canon-required** — el extractUserId actual es funcional y canon-aligned (explicit param-passing es la primera línea, reflection-on-request es fallback). Discriminator + consolidación son scope mayor (data migration, breaking change para callers, decisión arquitectónica).

**Plan estructurado.**

1. **Trigger** — abrir cuando: (a) GDPR/audit compliance review pida actor.type explicit field, (b) priorización de auth architecture finalization, (c) bug donde anonymous-vs-system no se distinguen en audit logs.

2. **Sub-batches sugeridos:**
   - **35-A** (MEDIUM, ~3-4h): Actor discriminator. Schema migration `auditLog.userId` → `actorType + actorId`. Retro data migration con default `actorType: "user"` si `userId IS NOT NULL`. Refactor `extractUserId` → `extractActor`. Update callers.
   - **35-B** (HEAVY, ~6-10h): Auth shape consolidation. Refactor `adminAuthMiddleware` + regular auth setter. Update todos los callers de `request.user.id` y `request.auth.user.id` a single shape. Delete uno de los augmentations.
   - **35-C** (opcional, ~2-3h): `@fastify/request-context` plugin si aparece caller deep-stack que justifica AsyncLocalStorage.

3. **Bloqueado por.** Solo prioritization decision. 35-A es AUTO sin decisiones bloqueantes. 35-B requiere acuerdo sobre nombre canonical de la shape consolidada.

**Cuándo revisar.**

Cuando se prioritice un batch dedicado a "auth architecture finalization" o cuando GDPR/SOC2 audit pida explicit actor.type discrimination.

**Estado:** PENDING (surfaced del T4-R 2026-05-01).

---

### PR-36 — FK gap decisions repo-wide (~20 sites, expanded scope)

**Fecha de surfacing:** 2026-05-01 (deferred + expanded post-T4-T)
**Severidad:** medio (revised up from "bajo" — expanded scope)
**Tipo:** decision per-site + mass mechanical refactor

**Honest scoping note.** T4-T cerró 4 de 6 findings y deferí los 2 que el roadmap nombró (ConsentRecord + DataBreachReport). **Audit estricto post-batch reveló que el patrón "id-shaped string sin @relation" es ~20 sitios repo-wide, no 2.** El roadmap entry name (`L-539 DataBreachReport` + `L-540 ConsentRecord`) era FLOOR, no ceiling — pattern grep amplio identifica significativamente más. Esto es exactamente el método-de-audit failure documentado en `feedback_audit_method_pattern_not_instance.md`.

**Audit method (broad-pattern, transparent):**

```python
# Pattern: *Id String? fields not appearing in any @relation fields:[...]
# Filters applied (per-name justification):
#   EXTERNAL_HINTS = ['stripe','gateway','tweet','provideraccount','jwt',
#                     'session','device','event','message','consumer',
#                     'aggregate','correlation','dedupe','idempotency',
#                     'webhook','tracking','origin','remote','external',
#                     'samlentity','oidc']
#   Models excluded as audit-trail-by-design:
#     OutboxEvent, AuditLog, BillingEvent, SocialMessage,
#     SocialConversation, OutboxInbox, OutboxDeadLetter,
#     AdminLoginAttempt, SamlConfiguration, OidcConfiguration,
#     WebhookEvent, SagaInstance
```

Raw count after filters: **~20 sitios**. Verificación per-site requerida antes de fix.

**Sitios identificados (3 grupos por confidence):**

**Grupo A — High confidence FK gap (mecánico, target tabla evidente):**

- `NotificationPreference.memberId String` → `TeamMember`
- `ApprovalWorkflowLevel.assigneeId String?` → `TeamMember`
- `Task.postId String?` → `Post`
- `TrackedLink.campaignId String?` → `Campaign`
- `InstagramStory.storyProjectId String` → `InstagramStoryProject`
- `WebhookEvent.channelId String?` → `Channel` (verify si está en exclusion list válida)
- `TemplateVersion.templateId String` → `Template`
- `TemplateUsageEvent.templateId String` → `Template`
- `AnalyticsDailySummary.postId String?` → `Post`
- `AnalyticsDailySummary.channelId String` → `Channel`
- `AnalyticsMonthlySummary.postId String?` → `Post`
- `AnalyticsMonthlySummary.channelId String` → `Channel`
- `ScheduledReport.projectId String` → `Project`
- `RecurringPost.templatePostId String` → `Post`
- `CustomReport.createdById String` → `TeamMember`
- `SamlSession.accountId String` → `Account`
- `Referral.referredAccountId String?` → `Account`
- `StoredEvent.streamId String` → ? (event-sourcing aggregate stream — could be loose by design, verify)
- `EventSnapshot.streamId String` → idem

**Grupo B — Polymorphic / ambiguous (necesita decision):**

- `Notification.resourceId String?` — polymorphic (resource type varies); likely loose-by-design.
- `Notification.actorId String?` — could FK to TeamMember/CustomerUser/AdminUser; ambiguous.
- `InstagramAnalytics.contentId String` — what's contentId? likely Post or media — verify.
- `TemplateCollaboration.userId String` — TeamMember? CustomerUser? AdminUser?

**Grupo C — Originally-named (T4-T scope, deferred):**

- `ConsentRecord.userId String?` — same userId-ambiguity (TeamMember/CustomerUser/AdminUser)
- `ConsentRecord.accountId String?` → `Account` (mecánico, parallel a DsarRequest)
- `DataBreachReport.reportedBy String` — `AdminUser` or loose audit-trail?
- `DataBreachReport.notificationSentBy String?` — idem

**Sub-batches sugeridos:**

- **36-A** ✅ RESUELTO 2026-05-01: 12 real DB FK gaps closed (final scope, smaller than initially scoped 14-16; 4 alleged sites already had Prisma-implicit FKs in DB — verified via `pg_constraint` query). Migration `20260502010535_pr36a_fk_relations_grupo_a` added 12 ADD FOREIGN KEY constraints; orphan-row data audit returned 0 across all 12 sites pre-apply; post-apply DB verification confirms 12/12 HAS_FK ✓.
- **36-B** (MEDIUM, NEEDS_EDWARD): Grupo B + Grupo C. Per-site Edward decision: WIRE+FK / DELETE-orphan / loose-by-design + JSDoc.
- **36-C** (deferred): re-audit after migration to verify 0 unintended new gaps.

**Por qué no se cerró en T4-T.**

T4-T scope was the L-\* entry names (2 sites). Strict pattern audit shows ~20. Per the new method-of-audit feedback rule, scope-lock requires broad-pattern grep upfront — T4-T failed that.

**Estado:** PENDING — partial-NEEDS_EDWARD (Grupo A AUTO, Grupos B+C decision-required). Surfaced del T4-T 2026-05-01.

---

### PR-37 — `sentimentScore` Decimal precision verification (0 callers)

**Fecha de surfacing:** 2026-05-01 (deferred from T4-T)
**Severidad:** trivial
**Tipo:** decision NEEDS_EDWARD (low priority)

**Contexto.** T4-T standardizó 8 de 9 Decimal sites. El 9no, `sentimentScore? @db.Decimal(3, 2)` (RepurposeProposal model línea 2126), tiene 0 callers en `apps/` y `packages/`. Sin callers la scale no es verificable (¿0-1 normalized? ¿-1 to +1 polarity? ¿0-100 percentage?).

**Por qué no se cerró en T4-T.** Cambiar precision sin saber scale puede romper future wiring. Per strict mandate "verify caller behavior, not file description" — no callers means no verifiable behavior.

**Plan**: cuando feature wire-up suceda → determine scale → apply canon precision + range CHECK.

**Estado:** PENDING — low priority (surfaced del T4-T 2026-05-01).

---

### PR-38 — Float → Decimal migration repo-wide (8 sites + L-538 already in T4-U)

**Fecha de surfacing:** 2026-05-01 (post-T4-T audit, pattern-grep amplio)
**Severidad:** medio (money loss + rate precision)
**Tipo:** code refactor + raw SQL data migration

**Honest scoping note.** T4-T only addressed `L-541 Decimal precision inconsistency` (existing Decimal fields). My initial Decimal audit used keyword-grep `(amount|price|fee|cost|...)` and found 5 hits. **Pattern-grep amplio (`Float` repo-wide) finds 10 hits — 5 missed by my keyword filter** (`success/avg/performance/rating/engagement` aren't in my hand-picked list). Same audit-method failure documented in `feedback_audit_method_pattern_not_instance.md`.

**Audit method (broad-pattern, transparent):**

```bash
grep -nE "Float\??\s*$|Float\s+@" infra/prisma/schema.prisma
# Raw count: 10
# Filter: storageGb (bytes count, not money/rate) → out of scope
# In-scope: 9 (1 money new + 7 rates new + 2 money already in L-538/T4-U)
```

**Sitios identificados (3 grupos):**

**Grupo A — Money as Float (3 sites; canon: `Decimal(19,4)`):**

- `Invoice.amountDue Float` (línea 2890) — already L-538 (T4-U scope, BLOCKED_BY T0-A originally; clarification 2026-05-01: T0-A is procedural-defensive gate, not technical block).
- `Invoice.amountPaid Float @default(0)` (línea 2891) — same as above (L-538).
- `TemplateAnalytics.revenueGenerated Float?` (línea 1969) — **NEW finding**, missed by T4-T scope. Same anti-pattern as L-538 in different table.

**Grupo B — Rates/scores as Float (7 sites; canon: `Decimal(10,6)` for rates / `Decimal(5,2)` for percentages 0-100):**

- `RepurposeProposal.completion_rate Float?` (línea 1398) — Reels completion rate (probably 0-1).
- `RepurposeProposal.successRate Float?` (línea 1452) — success rate.
- `RepurposeProposal.avgPerformance Float?` (línea 1453) — performance metric.
- `TemplateAnalytics.successRate Float @default(0.0)` (línea 1963) — success rate.
- `TemplateAnalytics.avgRating Float?` (línea 1964) — rating (scale unknown without spec).
- `TemplateAnalytics.avgEngagement Float?` (línea 1967) — engagement rate.
- `TemplateAnalytics.conversionRate Float?` (línea 1968) — conversion rate (0-1 or 0-100?).

**Grupo C — Acceptable Float (1 site, kept as-is):**

- `AccountSubscription.storageGb Float @default(0)` (línea 2414) — bytes/GB count, integer-with-fractional-precision pattern is reasonable for storage metering. Document in `schema-conventions.md` if confirmed.

**Plan estructurado:**

- **38-A** (QUICK, ~2h, AUTO): TemplateAnalytics.revenueGenerated → `Decimal(19,4)`. Single-field migration (the model is currently dead but the schema bug persists).
- **38-B** (MEDIUM, NEEDS_EDWARD per scale): 7 rate/score fields. Each needs scale verification (0-1, 0-100, ratio?) — without callers the canonical precision is unknowable. Same NEEDS_EDWARD pattern as PR-37.
- **38-C** (verify): document `storageGb` Float decision in `schema-conventions.md`.

**Bloqueado por.** Grupo A.NEW (revenueGenerated) is AUTO, can fast-track. Grupos B+C need product decision (or callers wire-up to verify scale).

**Por qué no se cerró en T4-T.**

My L-541 Decimal audit was keyword-filtered (`amount|price|fee|cost|...`) — missed `success/avg/performance/rating/engagement` Float fields. Per the new method-of-audit feedback, broad-pattern grep (just `Float`) is the correct first pass; keyword filters are post-hoc data-shopping.

**Estado:** PENDING — Grupo A AUTO, Grupo B partial-NEEDS_EDWARD (surfaced del T4-T 2026-05-01).

---

### PR-39 — Test suite flakiness under Turbo parallel execution (Redis contention)

**Fecha de surfacing:** 2026-05-02 (descubierto durante audit toolkit setup)
**Severidad:** medio — false-confidence systémico durante batches anteriores
**Tipo:** test infrastructure fix

**Contexto.** Durante el setup del audit toolkit, Edward preguntó "por qué no se está usando Turborepo" — surfaced que mi flujo bypaseba Turbo cache (corría `pnpm --filter @apps/api test` directo). Cuando finalmente corrí `pnpm test` (= `turbo run test`), descubrí que `@adapters/dead-letter-queue` falla **consistentemente bajo turbo run** pero **passes cuando se ejecuta aislado**. Tests aparecen como `skipped` (no failing) por timeout — `tests/mutation-killing-part2.test.ts (29 tests | 29 skipped) 18689ms`.

**Causa probable**: tests de `@adapters/dead-letter-queue` usan BullMQ + Redis. Múltiples packages corriendo en paralelo (`@apps/api`, `@adapters/queue-bullmq`, etc.) compiten por el mismo Redis instance → conexiones se quedan stuck → timeout → tests skipped.

**Por qué importa**: durante batches T0-T4 yo corría `pnpm --filter @apps/api test` aislado. Esto daba **false confidence** — el `apps/api` testaba bajo condiciones distintas a las que la suite full ejecutaría. El revisitado del roadmap debe usar `pnpm test` (turbo) para detectar este tipo de regresiones.

**Plan estructurado.**

1. **Trigger** — abrir cuando se ejecute revisitado de batches que tocan BullMQ/Redis (T4-H QueuePort, T4-I workers retry, T4-L cache, etc.) o cuando un PR rompa el tree por flakiness.

2. **Investigación**:
   - Reproducir consistentemente: `pnpm test --concurrency=1` (debe pasar) vs `pnpm test` (default concurrency, falla).
   - Vitest config audit: cada package que use Redis debería tener un namespace prefix único (e.g., `redis:dlq:test:`).
   - BullMQ test setup: cada test suite debería tener `keyPrefix` único.

3. **Fix opciones**:
   - **A** (workaround): `turbo run test --concurrency=1` en CI. Slower (~60s vs 17s) pero confiable.
   - **B** (proper): namespace Redis prefixes per package en tests. Permite parallel sin contention.
   - **C** (proper +): vitest pool isolation a nivel package, separate Redis client per worker.

**Bloqueado por.** Solo prioritization. AUTO scope — fix técnico, no decision.

**Cuándo revisar.**

Inmediatamente después del revisitado del roadmap (necesario para confiar en green-checkmark de batches que tocan Redis). Posiblemente promovido a CI gate via audit workflow.

**Estado:** PENDING (surfaced 2026-05-02 durante audit toolkit setup).

---

### PR-40 — Provider adapters constructor injection (eliminar `process.env` reads en `packages/providers/*`)

**Fecha de surfacing:** 2026-05-02 (T0-A-bis revisitado)
**Severidad:** medio — 25 CWE-798 violations + violación arquitectura hexagonal
**Tipo:** library refactor (constructor injection)

**Contexto.** T0-A-bis cerró 22 CWE-798 fallbacks en `apps/api/src` y wireó fitness checks #15 + #16 que bloquean nuevos. Pero el regex inicial scoped a `apps/*` solamente: `packages/providers/*` aún tiene **25 occurrences** del patrón `process.env.X || "placeholder"`:

| Provider    | File                                                              | Sites                                                                              |
| ----------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Telegram    | `packages/providers/telegram/src/TelegramAdapter.ts`              | 1 (BOT_TOKEN)                                                                      |
| YouTube     | `packages/providers/youtube/src/YouTubeAdapter.ts`                | 2 (CLIENT_SECRET, REFRESH_TOKEN)                                                   |
| X (Twitter) | `packages/providers/x/src/XAdapter.ts`                            | 5 (API_KEY, SECRET, ACCESS_TOKEN, TOKEN_SECRET, BEARER)                            |
| Pinterest   | `packages/providers/pinterest/src/PinterestAdapter.ts`            | 2 (ACCESS_TOKEN, REFRESH_TOKEN)                                                    |
| Snapchat    | `packages/providers/snapchat/src/SnapchatAdapter.ts`              | 3 (CLIENT_SECRET, ACCESS, REFRESH)                                                 |
| Facebook    | `packages/providers/facebook/src/FacebookAdapter.ts`              | 2 (ACCESS_TOKEN, APP_SECRET)                                                       |
| TikTok      | `packages/providers/tiktok/src/TikTokAdapter.ts` + `apiClient.ts` | 6 (CLIENT_KEY, CLIENT_SECRET, ACCESS_TOKEN, RESEARCH_API_KEY×2, ANALYTICS_API_KEY) |
| Instagram   | `packages/providers/instagram/src/InstagramAdapter.ts`            | 1 (ACCESS_TOKEN)                                                                   |
| LinkedIn    | `packages/providers/linkedin/src/LinkedInAdapter.ts`              | 2 (ACCESS_TOKEN, REFRESH_TOKEN)                                                    |

**Por qué T0-A-bis no lo cierra:** la fix correcta NO es importar `env` desde `apps/api/src/config/env.ts` — eso violaría hexagonal (libraries dependen de la app). La fix correcta es **constructor injection**: cada provider adapter recibe sus credentials como parámetros del constructor; la app's composition root (DI container) las pasa desde `env`. Eso es un refactor más amplio que el scope de T0-A-bis y toca:

- 9+ provider adapters (cambiar signature del constructor)
- DI container registrations (`setupServices.ts` o equivalente — pasar env values al construir cada adapter)
- Provider tests (que probablemente mockean process.env hoy)

**Plan estructurado.**

1. **Trigger** — antes de touch de provider adapters por otra razón, o cuando se ramp el fitness check #15 a `packages/providers/*`.

2. **Investigación**:
   - Audit: ¿qué provider adapters ya aceptan config via constructor (e.g. Bluesky)? Esos son la referencia de patrón.
   - Audit: ¿dónde se construyen los providers actualmente? (`packages/providers/registry.ts`? DI container? por feature?).
   - Identificar si hay `IConfig` / `ProviderConfig` interfaces compartidas reutilizables.

3. **Implementation per provider**:
   - Constructor signature: `constructor(config: { accessToken: string; refreshToken?: string; ... })`
   - Eliminar todos los `process.env.X` reads internos.
   - Update construction sites (DI registration o factory) para pasar config.
   - Update tests (no más `process.env.X = ...`; pasar config directamente).

4. **Wire fitness check #15 expand a `packages/`**:
   - Cuando los 25 sites estén a 0, expandir el grep scope a `packages/providers/*`.

**Bloqueado por.** Solo prioritization. Es scope claro pero amplio (~1-2 días).

**Cuándo revisar.**

- Cuando se haga refactor de provider system (registry, factory).
- Cuando un provider new se agregue (oportunidad para introducir el patrón canonical).
- Cuando se quiera fortalecer fitness check #15 a alcance completo.

**Estado:** PENDING (surfaced 2026-05-02 durante T0-A-bis revisitado del roadmap).

---

## Meta

### PR-41 — Knip dead-code reduction sweep (426 findings) + ci.yml triggers en refactor/\*\*

**Fecha de surfacing:** 2026-05-02 (T1-E revisitado canon)
**Severidad:** medio — gate canónico configurado pero no enforced en branch refactor/\*\*
**Tipo:** scope grande — barrido de dead-code module-level con filtro 3-preguntas

**Contexto.** T1-E original (2026-04-22) cerró 5 findings variable-level (L-120..L-502) y exit criteria pasan (`pnpm lint --max-warnings 0` → 0 unused). Knip ya está instalado (`v6.1.0` con `knip.json` comprehensive) y wireado en CI vía `ci.yml > code-quality > pnpm check:dead-code` — **pero ese workflow no se dispara en `refactor/**`branches** (solo`main`/`omni-post-cc`), así que el gate nunca se ejerció en esta branch.

Baseline local 2026-05-02:

| Knip finding type      | Count    |
| ---------------------- | -------- |
| Unused files           | 32       |
| Unused dependencies    | 12       |
| Unused devDependencies | 6        |
| Unlisted dependencies  | 17       |
| Unlisted binaries      | 5        |
| Unused exports         | 47       |
| Unused exported types  | 300      |
| Duplicate exports      | 7        |
| **Total**              | **~426** |

**Por qué no fue cerrado en T1-E revisitado.** Cada finding requiere aplicación del filtro de 3 preguntas (`feedback_three_questions_before_delete.md`):

1. Origen: ¿alguien lo creó con intención válida?
2. Propósito: ¿scaffolding (wiring incompleto) o reemplazo histórico (deuda)?
3. Duplicación: ¿hay equivalente en otro lado?

426 findings × 3 preguntas + verificación = batch propio (~6-12h). El L-42 EventSnapshots case study advierte explícitamente contra "cero callers → DELETE" sin investigación.

**Plan estructurado.**

1. **Trigger** — abrir cuando se quiera fortalecer el gate de dead-code o cuando un PR vaya a tocar archivos flagged.

2. **Investigación**:
   - Audit de los 32 unused files: clasificar como (a) scaffolding intencional → IMPLEMENT/WIRE, (b) reemplazo histórico → DELETE, (c) entry/binary que knip no reconoce → ajustar `knip.json` config.
   - Audit de los 47 unused exports + 300 unused types: muchos pueden ser intencional API surface (port interfaces, DTO definitions) — ajustar config para reconocer entry points.
   - Audit de 12 unused dependencies + 17 unlisted: limpieza directa en package.json.

3. **Implementation**:
   - Rondas iterativas: cada finding pasa el filtro 3-preguntas, se decide DELETE / IMPLEMENT / IGNORE-IN-CONFIG.
   - Se aprovecha para configurar `knip.json` con entry-points explícitos (CLI scripts como `generateEncryptionKey.ts`, etc.).

4. **Wire ci.yml en `refactor/**`\*\* + cualquier branch protection una vez baseline = 0:
   - Extender `on: push.branches` a `[main, omni-post-cc, "refactor/**"]`.
   - Lock-in hard-zero gate.

**Bloqueado por.** Solo prioritization + tiempo. Es scope claro pero amplio.

**Cuándo revisar.**

- Cuando un PR toque archivos flagged como unused (oportunidad de incluir audit).
- Cuando se merge la rama actual a `main` (ci.yml correrá, baseline visible).
- Cuando se quiera empezar la entrega/rollout del proyecto (limpieza pre-launch).

**Estado:** PENDING (surfaced 2026-05-02 durante T1-E revisitado canon).

---

**Visibilidad.** Este archivo se lee al comienzo de cada batch del roadmap para identificar si un fix paliativo vigente afecta al scope actual.

**Cierre.** Un entry se marca como `REVIEWED` cuando Edward lo revisa al final del roadmap. Se marca como `FIXED` cuando el fix de raíz se aplicó. Se marca como `WONT_FIX` si Edward decide que el paliativo es suficiente a largo plazo (en cuyo caso la razón debe documentarse).

**Protección contra acumulación infinita.** Si este archivo supera ~20 entries, es señal de que el roadmap está dejando demasiada deuda paliativa — pausar y revisar antes de continuar.
