# OmniPost — Plan Maestro de Auditoría Pre-Producción

> **Documento guía.** Actualizar en su lugar conforme se avance.
> **Iniciado:** 2026-04-17
> **Owner:** Edward
> **Driver:** Tranquilidad personal. Sin deadline externo.
> **Meta:** Conocer el estado del codebase con evidencia, en dimensiones definidas, con criterios de "done" objetivos por dimensión.

---

## 0. Regla fundamental

Este plan **no cubre todo el codebase**. Cubre **ocho dimensiones específicas**, cada una con scope limitado, criterios objetivos de done, y deliverable propio. Cuando todas las dimensiones estén cerradas, la auditoría termina — aunque se pudiera seguir auditando más.

Esto protege contra el riesgo de auditoría infinita. La tranquilidad no viene de cobertura total; viene de saber el estado de dimensiones bien definidas.

---

## 1. Estado inicial

### 1.1 Trabajo previo consolidado

El siguiente trabajo ya está hecho y se incorpora como **baseline** al Plan Maestro. No se rehace.

| Trabajo                                  | Resultado                                          | Documento                               |
| ---------------------------------------- | -------------------------------------------------- | --------------------------------------- |
| Inventario de endpoints (466 en Fastify) | Consolidado                                        | `docs/audits/ENDPOINT_AUDIT.md`         |
| Eliminación de dead code de Integrations | 12 endpoints borrados + 10 archivos                | `docs/audits/ENDPOINT_AUDIT.md` §4b.3   |
| Auth en los 7 endpoints Saga             | Aplicado con `SYSTEM_CONFIGURE` / `SYSTEM_MONITOR` | `docs/audits/ENDPOINT_AUDIT.md` §4b.4   |
| Auditoría de `apps/client/lib/hooks/`    | 3 DEAD_CODE + 2 LEGACY_WORKING identificados       | `docs/audits/CLIENT_LIB_HOOKS_AUDIT.md` |

### 1.2 Prerrequisitos antes de arrancar el Plan

Dos tareas pequeñas que dejan el estado inicial limpio:

- **PRE-1: Check de asignación de permisos `SYSTEM_CONFIGURE` y `SYSTEM_MONITOR`.** Sin esto, el cierre de Saga es frágil (endpoints seguros pero potencialmente inaccesibles).
- **PRE-2: Cleanup de 3 DEAD_CODE hooks** (`useABTests`, `useTemplates`, `useTemplateVersions`). 541 líneas, cero riesgo.

Después de PRE-1 y PRE-2, el Plan arranca desde la Dimensión 0.

---

## 2. Dimensiones

Ocho dimensiones en orden de ejecución. Cada una construye sobre las anteriores.

---

### **D0 — Inventario Maestro Inmutable**

**Pregunta que responde:** ¿Qué existe en este codebase? Lista autoritativa de todo lo que las otras dimensiones van a auditar.

**Scope:**

- Endpoints backend (reutiliza ENDPOINT_AUDIT)
- Tablas de DB + esquema Prisma
- Enums + types compartidos
- Permissions definidas en RBAC
- Roles definidos
- Componentes React exportados
- Hooks (en todas las carpetas)
- Archivos de configuración relevantes (`next.config`, `vitest.config`, `stryker.config`, etc.)

**Deliverable:** `docs/audits/D0_INVENTORY.md` — un solo documento con secciones por tipo de entidad. Tablas exhaustivas, no resúmenes.

**Criterios de done:**

- [ ] Toda entidad extraída del código con path + línea + definición
- [ ] Conteos totales por categoría
- [ ] Cero estimaciones con "~" o "probablemente"
- [ ] Documento legible por un agente para alimentar D1-D7

**Por qué primero:** Las otras 7 dimensiones necesitan este inventario como input. Sin él, cada dimensión gasta tiempo re-inventariando y los números no cuadran entre dimensiones.

**Esfuerzo estimado:** 2-3 horas agente + 30 min revisión tuya.

---

### **D1 — Mapeo Endpoint ↔ UI**

**Pregunta que responde:** ¿Cada endpoint del backend tiene un consumidor en el frontend correcto, o está justificado que no lo tenga?

**Scope:**

- Cruce endpoint (backend) ↔ hooks/fetches (frontend)
- Clasificación por categoría: `public-ui` / `admin-ui` / `webhook` / `health` / `internal`
- Identificación de: huérfanos (sin UI), WRONG_APP (UI en app incorrecta), reverse orphans (frontend → endpoint inexistente)

**Deliverable:** `docs/audits/D1_ENDPOINT_UI_MAPPING.md` (evolución del `ENDPOINT_AUDIT.md` actual, consolidado y exhaustivo).

**Criterios de done:**

- [ ] Matriz row-per-endpoint completa (todos los 466, no muestra)
- [ ] Cero `NEEDS_DECISION` sin resolver
- [ ] Cada huérfano con acción recomendada (implementar UI / borrar endpoint / justificar)
- [ ] Reverse orphans (frontend → nada) verificados contra Next.js rewrites

**Por qué segundo:** Es la dimensión que destapa más problemas visibles al usuario final. Además, su output (lista definitiva de qué endpoint pertenece a qué audiencia) alimenta D4 (conformidad funcional) y D5 (seguridad).

**Esfuerzo estimado:** 4-6 horas agente + 1-2 horas revisión.

---

### **D2 — Conformidad con Estándares**

**Pregunta que responde:** ¿Dónde viola el codebase sus propios estándares declarados?

**Scope (solo reglas con criterio objetivo):**

- `REACT_STANDARDS.md`: TanStack Query como único fetching, QueryKey conventions, `onSuccess`/`onError` en mutations, zero `any`, 200-line limit por componente
- `tsconfig` strict compliance: `any` implícitos, `@ts-ignore`, `@ts-expect-error`
- Convenciones de paths de endpoints (ya levantado en D1 §6 P3 del actual audit)
- Carpetas paralelas (`lib/hooks/` vs `hooks/api/` vs `lib/api/`)
- Console.logs, `TODO`/`FIXME`/`XXX` en producción

**Deliverable:** `docs/audits/D2_STANDARDS_COMPLIANCE.md` con lista de violaciones por regla.

**Criterios de done:**

- [ ] Todas las violaciones listadas con path + línea + regla violada
- [ ] Cero "interpretaciones" subjetivas (solo reglas objetivas)
- [ ] Para cada violación: clasificada como "fix trivial" / "fix medio" / "decisión de producto"
- [ ] Lista de decisiones de producto que requieren tu resolución

**Por qué tercero:** Antes de auditar funcionalidad (D4) o seguridad (D5), sabemos qué código ya sabemos que no cumple sus propias reglas. Además, barrer `any` implícitos y type safety da más confianza para la auditoría de tipos de D3.

**Esfuerzo estimado:** 3-4 horas agente + 1 hora revisión.

---

### **D3 — Integridad de Datos y Estado**

**Pregunta que responde:** ¿Los estados imposibles son imposibles?

**Scope:**

- Schema Prisma: foreign keys, nullable vs not null, unique constraints, cascadas
- Validaciones duplicadas entre frontend/backend: ¿coinciden las reglas (length, regex, requiredness)?
- Transacciones: operaciones multi-tabla que deberían ser atómicas y no lo son
- Enums: consistencia entre DB, código backend, código frontend
- Zod/TypeBox schemas vs Prisma models: ¿coinciden los campos?

**Deliverable:** `docs/audits/D3_DATA_INTEGRITY.md`

**Criterios de done:**

- [ ] Cada tabla de Prisma verificada contra su uso real en endpoints
- [ ] Lista de transacciones faltantes (operaciones multi-tabla sin `$transaction`)
- [ ] Lista de inconsistencias de validación frontend/backend
- [ ] Lista de enums desincronizados

**Por qué cuarto:** Depende de D0 (inventario de tablas/enums) y D1 (qué endpoints tocan qué datos). Los bugs de integridad son silenciosos pero letales en DD técnica.

**Esfuerzo estimado:** 5-8 horas agente + 2-3 horas revisión.

---

### **D4 — Conformidad Funcional (Contratos)**

**Pregunta que responde:** ¿Cada endpoint hace lo que su contrato dice que hace?

**Scope:**

- Para cada endpoint con UI: verificación de contrato input/output (schema declarado vs shape real)
- Tests con datos reales: no mocks, respuestas de la DB
- Manejo de errores: 400/401/403/404/500 en casos esperados
- Side effects verificados: si un POST crea, ¿realmente creó en DB? Si un DELETE borra, ¿borró lo correcto?

**Deliverable:** `docs/audits/D4_FUNCTIONAL_CONFORMITY.md`

**Criterios de done:**

- [ ] Cada endpoint del inventario tiene al menos un test de contrato ejecutado
- [ ] Cero discrepancias response-declarada vs response-real no documentadas
- [ ] Cada endpoint con side effects: efecto verificado en DB, no solo response 200
- [ ] Lista de endpoints que fallan el contrato → fix sprint

**Por qué quinto:** Es la más pesada en tiempo. Requiere D0, D1, y D3 como baseline (saber qué endpoints existen, quién los usa, qué datos tocan). Si se hace antes, se termina re-testeando después de cada fix.

**Esfuerzo estimado:** 8-15 horas (es la más larga). Pragmatismo: acotable a módulos críticos + endpoints con UI.

---

### **D5 — Seguridad Mínima de Producción**

**Pregunta que responde:** ¿Hay algo aquí que un pentester básico explotaría en 30 minutos?

**Scope:**

- Auth en todo endpoint (incluyendo los 108 actualmente sin `preHandler` explícito según ENDPOINT_AUDIT)
- Rate limiting en auth y endpoints costosos
- IDOR: ¿puede un customer acceder a recursos de otro cambiando un ID?
- Secretos en repo: API keys, credenciales, tokens en código o en git history
- CORS + headers de seguridad
- Logs que filtran PII o secretos
- Validación de input en todo endpoint que acepta payload (longitudes, shapes, sanitización)

**Deliverable:** `docs/audits/D5_SECURITY.md`

**Criterios de done:**

- [ ] Cada endpoint del inventario: auth explícita o justificada
- [ ] Cada endpoint mutating con validación de input declarada
- [ ] Cero secretos en repo (verificado con scan de git history)
- [ ] IDOR testeado en al menos 5 flujos críticos (posts, inbox, billing, team, channels)
- [ ] Lista de hallazgos ordenada por severidad (crítico / alto / medio / bajo)

**Por qué sexto:** Requiere D0 (inventario), D1 (categorización), y D2 (type safety para analizar validaciones). Se hace antes de D6 y D7 porque los hallazgos de seguridad pueden reorientar prioridades.

**Esfuerzo estimado:** 6-10 horas agente + 2-3 horas revisión.

---

### **D6 — Cleanup Pre-Producción**

**Pregunta que responde:** ¿Qué hay que quitar antes de que un tercero vea este código?

**Scope:**

- Seed data + test data en DB
- Referencias personales (nombres, emails, etc.) en código y en seeds
- `console.log`, `debugger`, código comentado
- `TODO` / `FIXME` / `HACK` / `XXX` sin issue asociado
- Branding "OmniPost Admin" stale (ya mayormente resuelto, pero re-verificar)
- Archivos y directorios no versionados accidentalmente incluidos
- Credenciales de desarrollo hardcodeadas
- URLs hardcodeadas de localhost o dev

**Deliverable:** `docs/audits/D6_PRE_PRODUCTION_CLEANUP.md`

**Criterios de done:**

- [ ] Todo hallazgo con path + línea + acción
- [ ] Lista de cambios necesarios al seed de DB
- [ ] Cero `TODO`/`FIXME` sin ticket/issue asociado
- [ ] Verificación de `.gitignore` + archivos sensibles no versionados

**Por qué séptimo:** No tiene dependencias técnicas fuertes. Se deja casi al final porque varios hallazgos de D1-D5 pueden generar TODOs/FIXMEs legítimos que aquí se consolidan.

**Esfuerzo estimado:** 2-4 horas agente + 1 hora revisión.

---

### **D7 — Coverage de Tests en Módulos Críticos**

**Pregunta que responde:** ¿Los módulos críticos tienen tests que realmente verifican comportamiento?

**Scope:**

- Módulos críticos definidos: **auth + billing + scheduling + posts + webhooks de Stripe**
- Para cada módulo: tests existentes mapeados a endpoints/funciones
- Identificación de huecos: endpoint crítico sin tests, función con tests laxos (mutation testing con Stryker sobre ese subset)
- Verificación de que tests de integración corren con DB real o mock fiel

**Deliverable:** `docs/audits/D7_CRITICAL_TESTS_COVERAGE.md`

**Criterios de done:**

- [ ] Cada módulo crítico: tabla de endpoints → tests que lo cubren (o "SIN TESTS")
- [ ] Mutation score por módulo crítico (Stryker acotado, no 43K mutantes globales)
- [ ] Lista de tests a escribir o fortalecer para subir score a 80% en los críticos
- [ ] Cero mutation score <60% en módulos críticos

**Por qué último:** Tiene más sentido después de D2-D5 porque sabemos qué funcionalidad existe, qué tipos están bien, qué endpoints son los correctos. Mutation testing sobre un codebase que todavía está cambiando (D1-D5 trajeron fixes) es gasto de tiempo.

**Esfuerzo estimado:** Stryker corrida inicial 4-8 horas (máquina, no tuyas) + 3-5 horas triaging y prompts de kill mutants + tiempo de fix según cobertura encontrada.

---

## 3. Estructura de documentos

```
/docs/audits/
├── PLAN_MAESTRO.md                    # este documento
├── ENDPOINT_AUDIT.md                  # existente, se vuelve D1 al cerrar
├── CLIENT_LIB_HOOKS_AUDIT.md          # existente, se consume en D1/D2
├── D0_INVENTORY.md                    # a crear
├── D1_ENDPOINT_UI_MAPPING.md          # a crear (o evolución de ENDPOINT_AUDIT)
├── D2_STANDARDS_COMPLIANCE.md         # a crear
├── D3_DATA_INTEGRITY.md               # a crear
├── D4_FUNCTIONAL_CONFORMITY.md        # a crear
├── D5_SECURITY.md                     # a crear
├── D6_PRE_PRODUCTION_CLEANUP.md       # a crear
├── D7_CRITICAL_TESTS_COVERAGE.md      # a crear
└── LATERAL_FINDINGS.md                # registro de hallazgos fuera de scope
```

---

## 4. Registro de hallazgos laterales

Cuando un agente, ejecutando una dimensión, encuentra algo real pero **fuera del scope declarado de esa dimensión**, no lo ejecuta ni lo ignora: lo anota en `docs/audits/LATERAL_FINDINGS.md` con formato:

```
### <fecha> — <título corto>
**Encontrado durante:** D<n>
**Descripción:** …
**Severidad estimada:** crítico / alto / medio / bajo
**Acción:** pendiente de decisión por Edward
```

Al finalizar cada dimensión, Edward revisa los nuevos hallazgos laterales y decide caso por caso:

- **INCORPORAR**: añadir al scope de una dimensión futura (si aplica).
- **DIMENSIÓN PROPIA**: es suficientemente grande para merecer su propio slot post-D7.
- **BACKLOG**: no urgente, sprint normal lo resolverá.
- **DESCARTAR**: no amerita acción.

Esto protege la ejecución (no se desvía) sin perder información (nada se olvida).

---

## 5. Reglas de ejecución

### 5.1 Orden estricto

D0 → D1 → D2 → D3 → D4 → D5 → D6 → D7. Sin saltar.

### 5.2 Cierre por dimensión

Una dimensión se cierra cuando todos sus criterios de done están marcados. No se cierra una dimensión "al 90%" — o cumple criterios o no.

### 5.3 Fixes dentro vs entre dimensiones

- Los **hallazgos triviales** de una dimensión (ej: borrar 3 hooks muertos) se arreglan al cerrar la dimensión.
- Los **hallazgos complejos** (crear endpoints nuevos, refactors) generan sprints separados entre dimensiones. La dimensión cierra con los fixes triviales aplicados y los complejos en backlog con prompt listo.

### 5.4 Prompts se arman sobre la marcha

No se pre-arman prompts para todas las dimensiones. Al arrancar cada una, Claude arma el prompt específico con el contexto acumulado hasta ese punto. Esto evita prompts obsoletos cuando el estado del codebase haya cambiado.

### 5.5 Sin presión de tiempo

Este plan no tiene fecha de cierre. Se avanza al ritmo que Edward decida. El driver es tranquilidad, no velocidad.

### 5.6 Regla anti-desvío

Si en cualquier momento aparece la tentación de "hagamos una revisión adicional no planeada", la respuesta por defecto es **no**. Se anota como hallazgo lateral si aplica, y el slot de revisión de laterales al final del plan decide si amerita.

### 5.7 Metodología de greps para consumer-detection (REGLA OBLIGATORIA para D0-D7)

**Objetivo:** detectar TODOS los consumers de un endpoint/hook sin falsos negativos.

**Historia de versiones:**

- **v1** (D0 original): `head_limit: 60` causó truncación silenciosa → 43.75% FN en PRE-3C §10 (ver `CLIENT_LIB_HOOKS_AUDIT.md` §11, caso TemplateManagementDashboard).
- **v2** (D0-v2, 2026-04-18): `head_limit: 0` añadido. Corrigió truncación.
- **v3** (PRE-D1B, 2026-04-18): pattern de template literals añadido. Tras D1 Fase 1 detectar 9 FN en 23 AMBIGUOUS (39%) vía ``fetch(`${BASE}/${var}`)``, PRE-D1B re-verificó los ~82 ORPHAN y encontró 1 FN adicional (`/admin/audit/export` vía `logs/page.tsx:99`). v2 solo capturaba paths literales con comillas simples/dobles.

**Patterns obligatorios POR CADA endpoint/hook auditado:**

1. **Literal path** (cadenas comilladas — v1+):

   ```bash
   grep -rn --include="*.ts" --include="*.tsx" "<ruta>" apps/admin/ apps/client/ 2>/dev/null | grep -v "node_modules" | grep -v "\.test\."
   ```

2. **Template literal con interpolación** (backticks + `${}` — v3):

   ```bash
   grep -rn --include="*.ts" --include="*.tsx" -E "fetch\(\`[^\`]*<prefix_stable_de_la_ruta>" apps/admin/ apps/client/ 2>/dev/null
   ```

   `prefix_stable` = parte de la ruta antes del primer `:param`. Ejemplo: `/admin/accounts/:id/sessions` → `prefix_stable = /admin/accounts/`.

3. **Constantes BASE** (identificar consts que contengan el prefix, luego seguir sus usos — v3):

   ```bash
   grep -rn --include="*.ts" --include="*.tsx" -E "(const|let)\s+\w+\s*=\s*['\"\`][^'\"\`]*<prefix_stable>" apps/admin/ apps/client/ 2>/dev/null
   ```

4. **Count cross-check** (detectar truncación residual — v2):

   ```bash
   grep -rln --include="*.ts" --include="*.tsx" "<ruta o prefix>" apps/admin/ apps/client/ 2>/dev/null | wc -l
   ```

**Reglas:**

1. `head_limit: 0` por default. Si se usa finito, verificar `results.length < head_limit`; si `===`, tratar como truncado.
2. **Ejecutar queries 1 + 2 (+ 3 cuando aplique)** antes de concluir "sin consumer". Query 1 sola genera falsos negativos por template literals.
3. Si Query 3 identifica una constante BASE, seguir la pista: buscar usos de esa constante en template literals.
4. Si hits solo en Query 2/3 (template literal) y no en Query 1 → endpoint es CONSUMED vía template literal (no ORPHAN). Contar y reportar.
5. Si clasificación final no concilia entre queries → AMBIGUOUS, escalar.
6. Regla aplica a **todas las dimensiones D1-D7**.

**Signos de alarma — pausa obligatoria:**

- Tasa FN en muestra > 30% (trigger v2).
- Tasa FN_TEMPLATE > 15% en lote re-verificado (trigger v3).
- NEW_BLIND_SPOT: hit encontrado vía un pattern distinto a 1-3 (ej: axios custom wrapper, Ky) — investigar antes de seguir.

**Verificación de auditor:** si un agente reporta "0 hits" en un block-check, hacer al menos 1 spot-check manual sobre el mismo bloque antes de aceptar. Caso documentado PRE-D1B: agente reportó 0 FN_TEMPLATE en 82 ORPHAN; spot-check manual encontró 1 real. Métrica de confianza en el agente debe incluir verificación cruzada.

### 5.8 Principio de lectura directa (REGLA OBLIGATORIA para auditorías autoritativas)

**Cuando una auditoría requiere inventario o clasificación autoritativa, lectura directa del archivo es la fuente de verdad. Greps son instrumentos de localización o sanity cross-check, no sustitutos de lectura.**

**Contexto:** §5.7 v3 (greps) mantiene su validez para consumer-detection rápida. Pero §5.7 tiene blind spots documentados (multi-line, template literals, wrappers custom, etc.) que hacen que greps solos no sean suficientes para auditorías que afirman cosas como "todos los endpoints tienen auth" o "este archivo no contiene X".

**Regla operacional:**

- **Greps permitidos** para: localización inicial de archivos, sanity cross-checks (count vs iteración), búsqueda de nombres específicos en dominios acotados.
- **Greps NO permitidos** como verdad final para: clasificar endpoints, determinar si un middleware se ejecuta, contar endpoints por archivo, reportar "cero violaciones de X" sin haber leído todos los archivos.
- **Lectura directa obligatoria** cuando el reporte tiene que afirmar algo sobre el archivo entero (patrón de auth, schema de validación, registraciones, etc.).

**Aplicación:** D0-v4 piloto (backend routes, 2026-04-18) validó §5.8 con éxito. Lectura directa de 69 archivos reveló 3 hallazgos sustantivos que greps canónicos de §5.7 hubieran missed o mal clasificado.

### 5.9 Principio de validación de producto antes de DELETE

**Ningún agente puede clasificar código como DEAD_CODE sin validación explícita de Edward.**

La ausencia de consumers en el codebase no es evidencia suficiente de que el código sea dead. Código sofisticado construido con arquitectura coherente pero sin wire-up a UI puede ser:

- **PLANNED** — construido intencionalmente para feature futura (ej: `content/`, `CQRS`, `Analytics` aggregates según Edward 2026-04-18)
- **INFRASTRUCTURE_READY** — infraestructura esperando integración (ej: `RateLimitingDashboard`, patterns de observabilidad)
- **LEGACY** — tuvo consumers antes, se removieron, el código está ahí por migración gradual
- **DEAD_CODE** — genuinamente nunca llegó a usarse, sin plan de uso, **confirmado por Edward**

**Regla operacional:**

Los agentes reportan candidatos a DEAD_CODE con evidencia (zero consumers + análisis de arquitectura) pero **nunca ejecutan delete sin validación previa de Edward**.

Excepción — casos obvios que el agente puede marcar como DEAD_CODE sin validación previa (pero aún sin delete automático):

- Backups olvidados (`.bak`, `.bak2`, `.old`, `.baseline`)
- Scripts de debug one-off en `.claude/` o similar
- Archivos de configuración superseded (ej: `REACT_STANDARDS.md` post-v2)
- Commented-out code blocks con git history recuperable

Todo lo demás — clases, módulos, services, use cases, componentes, hooks, endpoints que aparezcan sin consumer — requiere validación explícita de Edward antes de cualquier acción destructiva.

**Lecciones que motivaron §5.9:**

1. **content/ (D1):** agente inicial clasificó como ORPHAN/DELETE 18 endpoints. Edward confirmó que es "Git for content + sync bidireccional multi-plataforma" — corazón estratégico del producto. Reclasificado a PLANNED.
2. **Approvals + ThreadAnalytics (D1 post-revisión):** patrón similar. 5+2 endpoints que el análisis mecánico habría eliminado.
3. **CQRS + Analytics (D0-v4 piloto):** agente clasificó como DEAD_CODE por zero instantiations. Edward confirmó que ambos "están completamente desarrollados pero no están wired-up, cuestión de crear la interfaz gráfica".
4. **RateLimitingDashboard (D0-v4 piloto):** mismo patrón. Agente clasificó BUILD_UI en D1 (incorrecto) → DEAD_CODE en D0-v4 piloto (también incorrecto). Realidad probable: INFRASTRUCTURE_READY.

**Aplicación transversal:** §5.9 aplica a TODAS las dimensiones del Plan Maestro (D1 ya cerrado; D2-D7 adelante) y a cualquier audit futuro. No es exclusivo de D0-v4.

---

## 6. Estado del plan

| Fase                                              | Estado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Fecha              |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| PRE-1 RBAC check                                  | ✅ Ejecutado — Estado A (acceso funcional)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 2026-04-17         |
| PRE-2 DEAD_CODE cleanup                           | ✅ Ejecutado — BLOQUEADO, reclasificados 3 hooks DEAD_CODE → LEGACY_WORKING (ver PRE-3A)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 2026-04-17         |
| PRE-3A Verificación consumer live                 | ✅ Ejecutado — Conclusión B (falso negativo metodológico por truncación silenciosa)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 2026-04-17         |
| PRE-3B Housekeeping + seed fix                    | ✅ Ejecutado — seed sincronizado, §5.7 añadido, D0 limpiado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 2026-04-17         |
| PRE-3C Re-verificación 45 huérfanos               | ✅ Ejecutado — 43.75% FN rate, §10 added to ENDPOINT_AUDIT                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 2026-04-17         |
| D0 Inventario (v1)                                | ⚠️ Deprecated — contaminado por truncación silenciosa (ver PRE-3A/3C)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 2026-04-17         |
| D0-v2 Inventario limpio                           | ✅ Ejecutado — §5.7 aplicada globalmente, 4 validation cases confirmados                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 2026-04-18         |
| PATH_MISMATCH SSO fix                             | ✅ Ejecutado — Opción B (backend `/saml/*` y `/oidc/*` sin prefix `/api/`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 2026-04-18         |
| Reclasificación 18 endpoints content/             | ✅ Ejecutado — ORPHAN → PLANNED                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 2026-04-18         |
| PRE-D1B re-scan ORPHAN + §5.7 v3                  | ✅ Ejecutado — 1 FN_TEMPLATE reclasificado, §5.7 v3 con template literals                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 2026-04-18         |
| D1 Endpoint ↔ UI Mapping                          | ✅ Ejecutado — 104 decisiones sobre ORPHAN (revisado 2026-04-18: 42 BUILD_UI, 10 DELETE, 40 KEEP, 12 PLANNED, 0 INVESTIGATE) + 1 nuevo PATH_MISMATCH `/trends/radar` → `D1_DECISIONS.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 2026-04-18         |
| D0-v4 Piloto (backend routes §5.8)                | ✅ Ejecutado — 🟢 VERDE (3 sustantivos, 0 auth críticos). §5.8 demostrada viable. Ver `D0_v4_PILOT_BACKEND_ROUTES.md`. Decisión §8 `/api/` prefix pendiente antes de D2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 2026-04-18         |
| **D0-v4 Completo** (9 sprints, Camino 1 aprobado) | 🔄 En planificación. Ver §9 estructura                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Inicio: 2026-04-XX |
| D0v4-0 Rename endpoints (α)                       | ✅ Ejecutado — 141 endpoints renombrados (30 backend + 18 frontend, 6 commits). CQRS (9) pendiente §5.9 en D0v4-2. Ver `D0v4_0_RENAME_REPORT.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 2026-04-18         |
| D0v4-1 Backend services/use cases/repos           | ✅ Ejecutado — ~395 archivos auditados (8 batches + 4 checkpoints). 24 hallazgos laterales, 6 duplicaciones, 5 acoplamientos. Ver `D0v4_1_BACKEND_SERVICES_REPORT.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 2026-04-20         |
| D0v4-2 Backend middlewares/DI/infra               | ✅ Ejecutado — 91 archivos auditados (4 batches). CQRS §5.9 = PLANNED. 27 hallazgos laterales (L-25..L-51), 8+ duplicaciones, 5 handlers NO-OP, 4 tokens DI orfanados. Ver `D0v4_2_MIDDLEWARES_DI_INFRA_REPORT.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 2026-04-20         |
| D0v4-3 Workers                                    | ✅ Ejecutado — 18 archivos auditados (2 batches). Mapa maestro 16 queues: 4 ACTIVE + 1 inline + 2 BROKEN + 2 ORPHAN_CONSUMER + 1 PLANNED + 6 PLANNED sin consumer. 16 hallazgos laterales (L-52..L-67) con 5 críticos. Ver `D0v4_3_WORKERS_REPORT.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 2026-04-20         |
| D0v4-4 Frontend client pages/components           | ✅ Ejecutado — 249 archivos auditados (5 batches). 5 paths data fetching paralelos. 14 CLIENT-REVERSE-ORPHAN-404, 4 BROKEN, 8+ SILENT-NO-OP. Publishing subsystem DEAD_CODE (~2,711 LOC). 6 fake-AI individuales. 87% pages over-clientized. 70 files >200 LOC. 137 hallazgos laterales (L-68..L-204). Ver `D0v4_4_FRONTEND_CLIENT_PAGES_COMPONENTS_REPORT.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 2026-04-20         |
| D0v4-5 Frontend client hooks                      | ✅ Ejecutado — 54 hooks (4 carpetas + 9 colocated) + 2 wrappers + QueryClient config auditados (3 batches + CP0 deep-dive). 5 LEGACY URL-por-URL: 7/18 broken (39%). TanStack v5 compliance: R1-R4+R6+R7+R9+R10+R12 pass. R11 23 size viol. R13 strict 123 raw fetches. 20+ `any`. 4 paths `useProviders` + 3 paths auth. 62 hallazgos laterales (L-205..L-266). Migration plan ~270h. Ver `D0v4_5_FRONTEND_CLIENT_HOOKS_REPORT.md`                                                                                                                                                                                                                                                                                                                                                                                                    | 2026-04-20         |
| D0v4-6 Frontend admin                             | ✅ Ejecutado — 141 archivos (app 30, components 62, hooks 29, providers 4, lib 9, types 3, colocated 1, extras 3). 5 batches + CP0 con NO deep-dive LEGACY confirmado. 83 findings nuevos L-267..L-349. Raw fetch catalog 102 entries. TanStack v5 matrix 29 hooks. QueryClient + apiClient deep-dive. Orphan cemetery individual (13-15 archivos). Cross-ref D0v4-4/5 con 6 sub-sections. Ver `D0v4_6_FRONTEND_ADMIN_REPORT.md`                                                                                                                                                                                                                                                                                                                                                                                                       | 2026-04-20         |
| D0v4-7 Packages compartidos                       | ✅ Ejecutado 2026-04-20 — 36 packages / 235 source + 74 tests / 53,880 LOC src / 88,970 LOC con tests. 5 batches + CP0 saga deep-dive. **14 CRITICAL escalados** (L-63 REAL saga + L-362 RepoPort GOD_INTERFACE + L-363 queue-bullmq + L-364/L-483 Fastify boundary leaks + L-365 cloudinary runtime + L-384/L-385/L-386 provider architecture + L-442/L-443/L-444/L-446 UI orphans + L-463 tailwind safelist + L-473 monitor dead). ~178 findings nuevos L-350..L-527. Extensions a L-14/L-260/L-298/L-368. Package boundary analysis hexagonal. Consumer mapping bidireccional. L-14/L-60/L-61/L-63 resolutions explícitas. Scaffolding precursor confirmed NO existe (`shared-frontend` + `browser-logger`). Plan consolidación ~436h (Fase 1 crítico 164h + Fase 2 arch 142h + Fase 3 style 130h). Ver `D0v4_7_PACKAGES_REPORT.md` | 2026-04-20         |
| D0v4-8 Infraestructura                            | ✅ Ejecutado 2026-04-20 — ~145 archivos / ~12K LOC / 5 batches + CP0 EventStore deep-dive. **13 CRITICAL** escalados D0v4-8 (L-41 + L-42 + L-528 + L-538 + L-545 + L-546 + L-591 + L-616 + L-622 + L-623 + L-630 + L-640 + L-647). ~120 findings nuevos L-528..L-647. Extensions a L-14/L-260/L-298-RESOLVED/L-368/L-600. EventStore schema divergence REAL + DEAD_PATH confirmados (§3 reporte). CLAUDE.md fitness functions ejecutadas (7 PASS / 3 FAIL-soft). §15 síntesis D0-v4 narrativa completa + recomendación **Opción (c) Híbrido** CRITICAL cleanup Week 1 + D2 paralelo absorbe REMEDIATION-3..7. Reporte `docs/audits/D0v4_8_INFRASTRUCTURE_REPORT.md`                                                                                                                                                                    | 2026-04-20         |
| **D2 Standards Compliance**                       | 🟢 Desbloqueado post-D0-v4 — pendiente decisión Edward REMEDIATION Week 1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | —                  |
| D3 Data Integrity                                 | Pendiente                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | —                  |
| D4 Functional Conformity                          | Pendiente                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | —                  |
| D5 Security                                       | Pendiente                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | —                  |
| D6 Pre-Production Cleanup                         | Pendiente                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | —                  |
| D7 Critical Tests Coverage                        | Pendiente                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | —                  |
| Revisión hallazgos laterales                      | Pendiente                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | —                  |

---

## ✅ TRAMO D0-v4 CERRADO 2026-04-20

**9 sprints ejecutados:** D0v4-0..8
**Total archivos auditados:** ~985
**Total LOC auditado:** ~179K
**Total lateral findings:** ~647 (L-1..L-647)
**CRITICAL escalados:** 13 (L-16, L-41, L-42, L-63, L-528, L-538, L-545, L-546, L-591, L-616, L-622, L-623, L-640) + L-647 fitness (14 con L-647 contado separadamente)
**Composites finales:** L-14, L-260, L-298 RESOLVED D0v4-8, L-368, L-600 → L-623, L-616 nuevo composite
**Producción-readiness honest:** 40-50% (dev excellent en hexagonal+DI+CQRS+UoW; ops/security deficitario en CI placebo + secrets + Docker + EventStore 40% wired)
**Recomendación cierre:** Opción (c) Híbrido — REMEDIATION-1 Security + REMEDIATION-2 CI/CD Week 1 (5 días), luego D2 paralelo absorbe REMEDIATION-3..7 como sprints in-sprint
**Next step:** Edward decide en sesión dedicada post-D0v4-8 si ejecutar REMEDIATION Week 1 o estructura alternativa (Opciones a/b discutidas en reporte D0v4-8 §15.8)

**Reporte síntesis completa:** `docs/audits/D0v4_8_INFRASTRUCTURE_REPORT.md` §15

---

## 7. Notas de diseño (para que Edward recuerde el razonamiento)

- **Por qué 8 dimensiones y no más:** más dimensiones = más ramificaciones = más probabilidad de nunca terminar. Ocho es suficiente para cubrir lo que importa sin crecer a infinito.
- **Por qué no "audita todo el codebase":** ningún agente LLM mantiene foco útil sobre un codebase del tamaño de OmniPost en una sola pasada. Las auditorías por dimensión son cómo se hace esto con rigor.
- **Por qué conservar docs previos:** trabajo hecho con evidencia no se descarta — se consolida. El ENDPOINT_AUDIT y el CLIENT_LIB_HOOKS_AUDIT son entradas legítimas del Plan, no ruido.
- **Por qué criterios objetivos y no "completitud":** "completo" es subjetivo, se mueve, y genera ansiedad. Criterios objetivos son auditables y te dejan decir "hecho" con honestidad.
- **Por qué "tranquilidad personal" cambia el diseño:** sin deadline, el riesgo es la perfección paralizante. El plan tiene que forzar cierres explícitos. Sin esto, la tranquilidad nunca llega.

---

## 9. D0-v4 Estructura de Sprints

**Contexto:** el piloto D0-v4 (backend routes, 2026-04-18) validó §5.8 como metodología viable pero cubrió solo ~3-5% del codebase. El resto requiere lectura directa equivalente para construir un inventario autoritativo antes de D2-D7.

**Decisión de Edward 2026-04-18:** Camino 1 — D0-v4 completo como prerrequisito de D2. Estructura secuencial de 9 sprints con review obligatoria entre cada uno.

### 9.1 Estructura de sprints

| #      | Sprint                                              | Scope                                                                                                  |            Archivos estimados | Tiempo calendario |
| ------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------: | ----------------- |
| D0v4-0 | Rename 159 endpoints (Opción α)                     | Rename `/api/` prefix en 26 archivos backend + actualizar todas las llamadas frontend correspondientes | ~26 backend + ~40-60 frontend | 3-5 días          |
| D0v4-1 | Backend services + use cases + repositories         | Lógica de negocio principal (dominio con máxima densidad)                                              |                        80-150 | 5-7 días          |
| D0v4-2 | Backend middlewares + DI container + infrastructure | Patterns transversales + identificar "built-not-wired"                                                 |                         40-70 | 3-4 días          |
| D0v4-3 | Workers                                             | BullMQ jobs, adapters, idempotencia, retries                                                           |                         15-30 | 3 días            |
| D0v4-4 | Frontend client — pages + layouts + components      | App Router + componentes principales                                                                   |                       ~80-120 | 5-7 días          |
| D0v4-5 | Frontend client — hooks consolidation               | 5 carpetas paralelas + TanStack v5 migration readiness                                                 |                         40-80 | 3-4 días          |
| D0v4-6 | Frontend admin                                      | Pages + layouts + components + hooks                                                                   |                           ~90 | 4-5 días          |
| D0v4-7 | Packages compartidos                                | shared, ui, observability, adapters, core, ports                                                       |                       ~60-100 | 3-4 días          |
| D0v4-8 | Infraestructura                                     | Prisma schema + migrations + configs + tsconfig cross-check                                            |                        ~20-40 | 2-3 días          |

**Total estimado:** 31-42 días calendario = **5-8 semanas** con revisiones entre sprints.

### 9.2 Reglas que rigen todos los sprints D0-v4

1. **§5.8 vigente:** lectura directa, greps solo como localizadores
2. **§5.9 vigente:** ningún DELETE sin validación Edward
3. **Review obligatoria entre sprints:** Edward valida el reporte del sprint N antes de que arranque el sprint N+1
4. **Checkpoints intermedios dentro de sprints largos** (>5 días): agente detiene después del primer ~30% para validar dirección
5. **No modificar código** salvo en Sprint D0v4-0 (que es mecánico, rename puro) y excepciones explícitas autorizadas por Edward
6. **Clasificaciones DEAD_CODE requieren validación Edward** antes de cualquier acción (§5.9)
7. **Hallazgos fuera de scope D0-v4** (bugs, security, performance) van a LATERAL_FINDINGS con severidad
8. **Cada sprint produce un doc `D0v4_N_<dominio>_REPORT.md`** en `docs/audits/`
9. **Al final de cada sprint, PLAN_MAESTRO §6 se actualiza** con status del sprint
10. **Principio de paso sostenible:** 1 sprint cada 5-7 días es el paso realista. No apurar.

### 9.3 Dependencia entre sprints

- **D0v4-0 debe terminar antes que D0v4-1 arranque** (codebase uniforme antes de auditoría profunda)
- **D0v4-4 y D0v4-5 pueden paralelizarse** si Edward lo decide (requieren dos agentes)
- **D0v4-7 (packages) se beneficia de haberse hecho D0v4-1,2,3,4,5,6 primero** (packages son consumidos, contexto de consumidores importa)
- **D0v4-8 (infraestructura) al final** porque beneficia del contexto completo

### 9.4 Criterio de cierre de D0-v4

Cuando los 9 sprints estén completos:

- Inventario integral de todo el código no-trivial
- Clasificación rigurosa de DEAD_CODE vs PLANNED vs INFRASTRUCTURE_READY vs LEGACY
- Identificación completa de duplicaciones, drift, patterns inconsistentes
- LATERAL_FINDINGS poblado con hallazgos fuera de scope D2-D7
- Base sólida para arrancar D2 (Standards Compliance) con confianza

**Solo después de D0-v4 cerrado arranca D2.**
