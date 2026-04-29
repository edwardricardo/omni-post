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

**Estado:** APLICADO (2026-04-22)

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

Fuente canon consultada: https://nextjs.org/docs/app/getting-started/server-and-client-components — _"React context is not supported in Server Components"_; Client Components son necesarios para `useState`, event handlers, browser APIs.

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

**Estado:** APLICADO (deuda documentada — cada app sigue funcionando con su ApiError local; no hay riesgo runtime).

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

## Meta

**Visibilidad.** Este archivo se lee al comienzo de cada batch del roadmap para identificar si un fix paliativo vigente afecta al scope actual.

**Cierre.** Un entry se marca como `REVIEWED` cuando Edward lo revisa al final del roadmap. Se marca como `FIXED` cuando el fix de raíz se aplicó. Se marca como `WONT_FIX` si Edward decide que el paliativo es suficiente a largo plazo (en cuyo caso la razón debe documentarse).

**Protección contra acumulación infinita.** Si este archivo supera ~20 entries, es señal de que el roadmap está dejando demasiada deuda paliativa — pausar y revisar antes de continuar.
