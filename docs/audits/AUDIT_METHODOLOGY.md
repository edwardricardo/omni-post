---
title: Full-repo audit methodology
description: Metodología aplicada en la auditoría F5 del 2026-05-10/11. Inventario estructurado de 1477 archivos en 5 surfaces paralelos con plantilla uniforme y reglas de detección reproducibles.
generated: 2026-05-11
auditor: claude-code
---

# Full-repo audit methodology

> Documento metodológico **reutilizable** de auditoría full-repo (plantilla + 6 reglas de veredicto + workflow A-E). Captura **cómo se hace** una auditoría — no los resultados. (Los outputs de la corrida F5 de 2026-05-11 — INVENTORY_SUMMARY, \_AUDIT_FINDINGS, inventory-\* — fueron retirados tras absorción en `docs/product/MASTER_PLAN_ES.md`; este doc queda como la metodología para re-auditar.)
>
> Este documento debe permitir a un auditor futuro (humano o agente) repetir el ejercicio sobre una versión posterior del repo y obtener resultados comparables.

---

## 1. Contexto y motivación

OmniPost arrancó con `admin` y `client` como una sola aplicación. Posteriormente se hizo separación arquitectónica en dos apps Next.js distintas, pero no se confirmó formalmente que:

- Las dobles implementaciones se hubieran corregido.
- No quedara código muerto residual de la separación.
- Las features desarrolladas durante la transición hubieran sido mapeadas (no-mapeadas → posible duplicación o features fantasma).

A esto se sumó deuda heredada: 4 apps + ~13 sub-packages + 11 social providers + ~250 DI tokens + 70+ endpoints REST + sagas + workers. La pregunta operacional concreta del usuario fue: **¿qué hay realmente en el repo, qué hace, qué está duplicado, qué está muerto, qué está implementado pero no expuesto?**

La auditoría F5 responde esa pregunta como **inventario evidencia-primero**, no como sweep de fixes. No toca código fuente. Solo lee + clasifica + escribe documentos de salida.

## 2. Principios rectores

1. **Evidencia primero, juicio después.** Cada hallazgo se ancla en un path + línea, no en intuición. Cada veredicto va con la regla que lo activó.
2. **Plantilla uniforme cross-surface.** Los inventarios de las 5 surfaces (`api`, `workers`, `admin`, `client`, `packages`) usan el mismo formato per-archivo, lo que permite consolidación mecánica posterior.
3. **Paralelismo cuando posible.** 4 inventarios corren simultáneamente en background después de validar formato con uno foreground. Reduce wall-clock de ~110 min secuencial a ~25 min paralelo real.
4. **Default conservador.** Veredicto por defecto es `VÁLIDO`. Solo se marca DEAD / REDUNDANTE / FORGOTTEN-FEATURE / MISMATCH cuando hay evidencia mecánica clara.
5. **Memoria histórica preservada.** Antes de borrar documentación obsoleta (REMEDIATION_ROADMAP, POST_BACKLOG, 130 reportes de sprint cerrados), se capturan los hechos no-obvios en memoria persistente del asistente para que la auditoría no re-clasifique como dead-code lo que es scaffolding intencional, deletions reversibles, features monetizables-en-vuelo, o dependencias declinadas explícitamente por el usuario.
6. **Iteración por surface.** Un surface se inventaría completamente antes de pasar al siguiente. Evita context-switching y permite cross-validar reglas a medida que se aplican.

## 3. Pre-requisitos antes de arrancar

Antes del primer inventario, ejecutar en orden:

1. **Limpieza de documentación obsoleta.** Generar `docs/_DOCS_INVENTORY.md` clasificando cada `.md` bajo `docs/`. Eliminar los marcados `ARCHIVE` + `DELETE`. Esto evita que la auditoría tenga que cruzar contra documentos cuya autoridad ya caducó.
2. **Captura de contexto histórico.** Leer los documentos maestros que se van a borrar (en este caso REMEDIATION_ROADMAP.md + POST_REMEDIATION_BACKLOG.md) en su totalidad y extraer **hechos no-obvios** que no se pueden derivar leyendo el código:
   - Scaffolding intencional (ej. `packages/providers/_template/`)
   - Deletions reversibles por diseño
   - Domain naming gotchas (ej. `Project` ≈ "subcuenta")
   - Dependencias declinadas explícitamente por el usuario
   - Features monetizables en vuelo (ej. `EventSnapshot` tier-gated)
   - Decisiones tomadas en sesiones pasadas que afectan interpretación del código

   Estos hechos se guardan a memoria persistente del asistente (`memory/project_historical_context.md`). Luego se borran los docs originales.

3. **CI verde (mínimo viable).** Antes de auditar, mergear o consolidar trabajo en curso para que la auditoría parta de un `main` estable. En esta sesión: merge PR #57 (saga canon retrofit + 14 fixes de seguridad CWE-639/862/863 + fix CI Prisma + cleanup docs).
4. **Branches paralelas cerradas.** No auditar mientras hay PRs abiertos del mismo equipo — el código se mueve bajo los pies. Cerrar / mergear / abandonar antes de auditar.

## 4. Estructura de surfaces

5 surfaces ortogonales que cubren el monorepo:

| Surface    | Path raíz           | Foco                                                                                     |
| ---------- | ------------------- | ---------------------------------------------------------------------------------------- |
| `api`      | `apps/api/src/`     | Backend Fastify: routes, use cases, domain, infra, CQRS, sagas, security, features       |
| `workers`  | `apps/workers/src/` | BullMQ workers, processors, recovery, metrics                                            |
| `admin`    | `apps/admin/`       | Next.js staff portal: páginas, componentes, hooks, lib                                   |
| `client`   | `apps/client/`      | Next.js tenant portal: páginas, componentes, hooks, lib                                  |
| `packages` | `packages/*/src/`   | Ports, providers (11), adapters, shared, ui, observability, monitoring, api-common, core |

Tests (`*.test.ts`, `tests/`) **NO** se inventariaron en esta auditoría. Pueden ser un sexto surface si se quiere validar cobertura.

## 5. Plantilla per-archivo (uniforme)

Cada archivo inventariado produce un bloque con esta forma:

```markdown
### audit-<SURFACE>-<NNN> — <título ≤8 palabras>

- **Path:** [path/file.ts](path/file.ts)
- **Surface:** api | workers | admin | client | packages
- **Tipo:** route · use-case · query-handler · command-handler · domain-entity · value-object · aggregate · domain-event · repository-port · repository-impl · saga-definition · saga-step · processor · middleware · DI-tokens · DI-container · security · provider · service · adapter · types · barrel · index · config · observability · page · layout · route-handler · component · hook · lib · store · provider · port-interface · adapter-impl · provider-adapter · provider-apiClient · ui-component · ui-hook · ui-primitive · logger-factory · scheduler · circuit-breaker · health-check · base-route
- **@layer declared:** domain · application · infrastructure · MISSING · INVALID:<value>
- **Propósito real:** <una oración — lo que hace el código, NO lo que dice el JSDoc>
- **Exports / endpoints / handlers:** <símbolos exportados, HTTP method+path, métodos públicos>
- **Imports significativos:** <solo cross-package / cross-app, no relativos>
- **API endpoints consumed (frontend only):** <lista de fetch / hook invocations que fan-out a endpoints>
- **Admin counterpart? (client only):** <path del equivalente en apps/admin/ si existe>
- **Wiring detected (backend only):** <registrado en Container? Route registrado en index.ts? Processor spawneado?>
- **Callers / Consumers:** <rg result capped at 5 lines, o "widely used">
- **Veredicto preliminar:** VÁLIDO · REDUNDANTE · DEAD · FORGOTTEN-FEATURE · MISMATCH · UNKNOWN
- **Notas:** <bullets cortos — duplicaciones, mismatches, broken imports, raw fetch, unused exports, anti-patterns>
```

Los campos `Wiring`, `API endpoints consumed`, `Admin counterpart` se activan según el surface.

## 6. Veredictos y reglas de detección

Cada veredicto se asigna SOLO si se cumple su regla. Sin evidencia → default `VÁLIDO` (o `UNKNOWN` si la duda persiste).

### 6.1 VÁLIDO

Tiene callers / wiring. No tiene smells obvios. JSDoc coherente con código.

### 6.2 REDUNDANTE

Existe otro archivo en el repo con propósito ≈ idéntico:

- En la misma surface (e.g., dos repositorios para la misma entidad).
- Cross-surface (e.g., `apps/admin/lib/X.ts` ↔ `apps/client/lib/X.ts` con misma firma y ≥80% diff overlap).

Para confirmar cross-surface, ejecutar `ls apps/<otra>/<mismo-path>` o `find apps -name "<filename>"`. Si aparece counterpart, hacer `diff` para confirmar similitud antes de marcar.

### 6.3 DEAD

Exportado pero **ningún caller** en el repo:

- `rg -t ts "import.*\b<symbol>\b" apps packages` → 0 resultados (excluyendo el propio archivo y tests).
- Para routes: NO está registrado en `apps/api/src/index.ts` ni en algún router feature.
- Para processors: NO se spawneā via `new Worker(queueName, processor)` en `apps/workers/src/index.ts`.
- Para DI bindings: no aparece en `Container.ts`.

### 6.4 FORGOTTEN-FEATURE

La implementación existe + funciona localmente, pero un eslabón intermedio falta:

- Use case implementado y tested, pero ninguna route lo expone.
- Route exists pero ninguna UI la consume.
- UI implementada que llama a endpoint que devuelve 501 / no existe.
- Worker implementado pero el Dockerfile CMD no lo arranca → jobs encolados sin consumer.
- Cron task implementada pero no registrada en `BackgroundTaskScheduler`.
- Feature flag wired pero permanentemente `false`.

Es distinto de DEAD: el código está completo pero **algo aguas-arriba o aguas-abajo bloquea su uso**.

### 6.5 MISMATCH

Contradicción interna detectable mecánicamente:

- Frontend llama `fetch("/api/X")` y `/api/X` no existe en el route table.
- Frontend llama un endpoint admin (`/admin/...`) desde surface customer-facing (auth falla deterministicamente).
- Repository impl exists pero el port binding apunta a otra clase.
- `@layer` header dice `application` pero el path es `apps/api/src/infrastructure/...`.
- Tipo TypeScript exportado para una API response no coincide con lo que el handler retorna.
- Worker espera payload shape `X` pero el producer envía shape `Y`.

### 6.6 UNKNOWN

Se usa **con moderación**. Reservado para:

- Archivos que parecen vivos pero no se puede verificar wiring (DI factory dispatched, dynamic imports, callback patterns que tree-sitter no resuelve).
- Implementaciones cuya integración requiere lectura profunda de >3 archivos cruzados.

Default agresivo a UNKNOWN diluye la auditoría. Si dudas, prefiere VÁLIDO + nota en `Notas:` explicando la duda.

## 7. Workflow operacional

### Fase A — Inventario (foreground + paralelo)

1. **Surface piloto en foreground.** Elegir el surface más informativo (en esta sesión: `admin`, por ser el centro de la preocupación del usuario sobre duplicación). Ejecutar un agente con la plantilla completa y los criterios. Revisar el output formal: ¿está completa la enumeración? ¿son razonables los veredictos? ¿hay un balance entre VÁLIDO y los otros? Si algo está off, ajustar plantilla antes de lanzar los demás.
2. **4 surfaces restantes en paralelo (background).** Lanzar en una sola response, con `run_in_background: true`. Cada agente:
   - Recibe la plantilla idéntica
   - Recibe los criterios de detección idénticos
   - Recibe las **memory references** específicas a su surface (cosas que NO debe marcar como dead)
   - Escribe a `docs/audits/inventory-<surface>.md`
   - Reporta al final un resumen ≤200 palabras
3. **Notificación automática.** A medida que cada uno termina, llega una task-notification. Se va comunicando progreso al usuario sin polling activo.

### Fase B — Cross-surface mapping (mecánico)

Cruzar los 5 inventarios para detectar relaciones que ningún single-surface agente puede ver:

- **UI → endpoint:** para cada `fetch("/api/X")` en client/admin, verificar que `/api/X` existe en `inventory-api.md`. Lo que no existe → MISMATCH / FORGOTTEN-FEATURE.
- **Use case → route:** para cada use case en `inventory-api.md` con veredicto VÁLIDO, verificar que algún route lo invoca. Use case sin route invocador → potencial FORGOTTEN-FEATURE.
- **Route → use case:** routes que importan use case nunca registrado en DI → MISMATCH.
- **Port → adapter:** ports sin adapter implementador → FORGOTTEN-FEATURE.
- **Adapter → port:** adapters sin port binding → DEAD o MISMATCH.
- **Worker queue → producer:** cada queue declarada debe tener un producer en `apps/api` o en otro worker. Queues huérfanas → DEAD.
- **Duplicación admin↔client:** mismo nombre de archivo en ambos apps → candidato a consolidar a `packages/`.

### Fase C — Findings consolidados (item-por-item)

Tomar todos los hallazgos non-VÁLIDO de los 5 inventarios + de la fase B y catalogarlos en un solo documento (`_AUDIT_FINDINGS.md`). Cada item:

```markdown
### audit-FN-NN — <título>

- **Categoría:** dead-code / forgotten-feature / duplication / mismatch / drift / superseded / canon-deviation
- **Surface(s):** ...
- **Evidencia:** <paths + grep results>
- **Recomendación honesta del auditor:** DELETE-NOW / WIRE-BACKEND / WIRE-UI / CONSOLIDATE-TO-PACKAGE / DECIDE / FIX-NOW
- **Acción candidata:** <pasos concretos>
- **NEEDS_EDWARD:** yes/no (¿requiere decisión de producto?)
- **Bloqueado por:** <otros audit-FN-NN si aplica>
```

### Fase D — Visita punto-por-punto con el usuario

El usuario revisa cada `audit-FN-NN`. Marca:

- ✅ APPROVE — ejecutar la acción candidata
- ❌ REJECT — el hallazgo es falso positivo, se documenta por qué
- 🔄 CHANGE-ACTION — la acción candidata no es la correcta, se documenta la alternativa
- ⏸️ DEFER — válido pero no ahora; se agenda

Output de Fase D: lista de acciones APPROVED ordenadas por bloqueador. Esa lista es el plan de ejecución.

### Fase E — Ejecución

Cada acción APPROVED se ejecuta como un commit cohesivo. Branch strategy según volumen.

## 8. Tooling utilizado

| Tool                                                                 | Para qué                                                                                  |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `find <path> -type f -name "*.ts" -not -path "*/node_modules/*" ...` | Enumeración de archivos por surface                                                       |
| `head -25 <file>`                                                    | Lectura del JSDoc header + primeros imports (>90% de los archivos se clasifican con esto) |
| `head -80 <file>`                                                    | Cuando los primeros 25 no revelan propósito                                               |
| `rg -t ts "import.*<symbol>" apps packages \| head -10`              | Detección de callers (capped)                                                             |
| `rg -t ts "from \"@<package>/<name>\"" apps packages`                | Detección de consumers cross-package                                                      |
| `gh run view <id> --log-failed`                                      | Para auditorías paralelas de CI                                                           |
| `git diff --stat <branch1>..<branch2>`                               | Para confirmar cambios entre PRs antes de mergear                                         |
| `git ls-files --error-unmatch <file>`                                | Validar que archivos a borrar están tracked antes de `git rm`                             |

## 9. Time budgets por surface

Empíricos en esta sesión (overhead promedio de un agente general-purpose):

| Surface                       |    Files | Tiempo      |
| ----------------------------- | -------: | ----------- |
| `admin` (foreground piloto)   |      180 | ~10 min     |
| `workers`                     |       13 | ~5 min      |
| `client`                      |      226 | ~10 min     |
| `api`                         |      823 | ~17 min     |
| `packages`                    |      235 | ~8 min      |
| **Total wall-clock paralelo** | **1477** | **~25 min** |
| Total secuencial estimado     |        — | ~50 min     |

Output total: ~5 archivos `inventory-<surface>.md`, ~5000-6000 líneas markdown agregadas.

## 10. Memoria histórica — cómo no clasificar mal

Antes de ejecutar la auditoría, los siguientes hechos se cargaron a memoria persistente para evitar falsos positivos. Cualquier auditoría futura debe revisar `memory/project_historical_context.md` o equivalente antes de empezar:

| Categoría                      | Ejemplos                                                                                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scaffolding intencional        | `packages/providers/_template/` — env reads + raw pino son intencionales para enseñar el patrón. Fitness checks #15/#19 excluyen explícitamente este path.                    |
| Deletions reversibles          | `apps/admin/providers/ProjectProvider.tsx` (T3-M 2026-04-29). Un futuro `ClientProjectsView` con SUPER_ADMIN gate sería entidad distinta — no revivir éste.                   |
| Domain naming                  | `Project` entity = "subcuenta" en modelo mental del usuario. Renombrar `Project → Subaccount` es deuda.                                                                       |
| Dependencias declinadas        | `reg-suit` (2026-05-04 y 2026-05-07), `clinic.js` permanente (2026-05-07). NO proponer reinstalar.                                                                            |
| Features monetizables en vuelo | `EventSnapshot` tier-gated (basic 30d / pro 90d / ent 180d+); permiso `CONTENT_SNAPSHOT_MANAGE`. NO marcar como dead.                                                         |
| Reescrituras recientes         | `apps/client/app/dashboard/channels/page.tsx` reescrita 2026-05-07 (PR-16). Acciones "Test"/"Settings" deshabilitadas eliminadas intencionalmente.                            |
| Deuda conocida documentada     | `apps/client/components/ai/AITemplateSelector.tsx` — campos engagement/readability/virality wireados sin backend (PR-53/54/55). Marcar FORGOTTEN-FEATURE con nota explícita.  |
| Reservado para migración       | Archivos en `apps/client/components/publishing/` pueden estar reservados para T6-D selective rescue (`ContentPreviewSystem`, `provider-previews`). NO blanket-flag como dead. |

## 11. Output estructural

```
docs/audits/
  AUDIT_METHODOLOGY.md       ← este documento
  INVENTORY_SUMMARY.md       ← resumen agregado de los 5 inventarios
  _AUDIT_FINDINGS.md         ← findings consolidados item-por-item con recomendación
  inventory-api.md           ← 992 líneas, 823 archivos
  inventory-admin.md         ← 180 archivos
  inventory-client.md        ← 226 archivos
  inventory-workers.md       ← 13 archivos
  inventory-packages.md      ← 235 archivos
```

Los 5 `inventory-*.md` son **inputs**. El `INVENTORY_SUMMARY.md` es **digest**. El `_AUDIT_FINDINGS.md` es **workbench** para la fase D (visita punto-por-punto).

## 12. Caveats y falsos-positivos conocidos

1. **Tree-sitter es ciego a dispatch dinámico.** Si un símbolo se resuelve via DI factory, dynamic `import()`, callback registry, o switch-by-string, `rg` no lo detecta como caller. Pueden surgir DEAD falsos. Mitigación: cap UNKNOWN para casos donde DI factory dispatch es plausible (especialmente CRM adapters, storage adapters).
2. **Re-exports propagan ruido.** Un export en un barrel `index.ts` puede tener 50 callers pero ninguno toca el archivo original. Si el barrel cuenta como caller, el archivo no es DEAD aunque conceptualmente nadie lo use directamente. Solución: cuando un archivo solo tiene barrel-callers, marcar VÁLIDO pero documentar en notas.
3. **Tests pueden ocultar uso real.** Una clase usada solo en tests NO es VÁLIDA en producción — es FORGOTTEN-FEATURE o DEAD. Filtra `rg` con `--type-not test` cuando importa.
4. **Worker queues pueden tener producers en sagas.** No solo en routes. Verifica también `apps/api/src/saga/**` cuando un queue parece huérfana.
5. **Feature flags activan/desactivan callers.** Un caller envuelto en `if (env.FEATURE_X)` puede estar dormant. Esto requiere revisar `apps/api/src/config/env.ts` para featue flag values en cada deployment.

## 13. Reproducibilidad

Para repetir esta auditoría en una versión futura del repo:

1. Verificar branch limpio (`git status` → 0 uncommitted).
2. Leer `docs/audits/AUDIT_METHODOLOGY.md` (este documento) y `memory/project_historical_context.md`.
3. Re-generar `docs/_DOCS_INVENTORY.md` con la metodología documentada arriba.
4. Ejecutar 5 inventarios (1 foreground piloto + 4 paralelos background) con las plantillas y reglas de §5-§6.
5. Generar nuevo `INVENTORY_SUMMARY.md` y `_AUDIT_FINDINGS.md`.
6. Comparar contra los anteriores. Las diferencias son la evolución del repo entre auditorías.

Auditorías periódicas (cada 3-6 meses) detectan deriva.
