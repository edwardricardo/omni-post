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

### 5.7 Metodología de greps para consumer-detection

Cuando una dimensión cuenta consumidores (endpoints, hooks, funciones, tipos), los greps deben usar `head_limit: 0` (sin límite) por default.

**Falsos negativos por truncación silenciosa son un modo de falla documentado** (ver `CLIENT_LIB_HOOKS_AUDIT.md` §11). Causó un falso negativo que llevó a clasificar incorrectamente 3 hooks como DEAD_CODE cuando tenían consumer live en `TemplateManagementDashboard.tsx`.

**Reglas:**

1. `head_limit: 0` por default en greps de consumer-detection. No optimizar prematuramente por volumen.
2. Cross-check con count-mode: ejecutar un grep en modo `count` antes o después del grep de contenido. Si `count > head_limit`, hay truncación silenciosa.
3. Si se usa un `head_limit` finito, verificar explícitamente que `results.length < head_limit`. Si es `===`, tratar como truncado y escalar.
4. Esta regla aplica a **todas las dimensiones D1-D7** cuando se busque "quién consume X" en el codebase.

---

## 6. Estado del plan

| Fase                                  | Estado                                                                                   | Fecha      |
| ------------------------------------- | ---------------------------------------------------------------------------------------- | ---------- |
| PRE-1 RBAC check                      | ✅ Ejecutado — Estado A (acceso funcional)                                               | 2026-04-17 |
| PRE-2 DEAD_CODE cleanup               | ✅ Ejecutado — BLOQUEADO, reclasificados 3 hooks DEAD_CODE → LEGACY_WORKING (ver PRE-3A) | 2026-04-17 |
| PRE-3A Verificación consumer live     | ✅ Ejecutado — Conclusión B (falso negativo metodológico por truncación silenciosa)      | 2026-04-17 |
| PRE-3B Housekeeping + seed fix        | ✅ Ejecutado — seed sincronizado, §5.7 añadido, D0 limpiado                              | 2026-04-17 |
| PRE-3C Re-verificación 45 huérfanos   | ✅ Ejecutado — 43.75% FN rate, §10 added to ENDPOINT_AUDIT                               | 2026-04-17 |
| D0 Inventario (v1)                    | ⚠️ Deprecated — contaminado por truncación silenciosa (ver PRE-3A/3C)                    | 2026-04-17 |
| D0-v2 Inventario limpio               | ✅ Ejecutado — §5.7 aplicada globalmente, 4 validation cases confirmados                 | 2026-04-18 |
| PATH_MISMATCH SSO fix                 | ✅ Ejecutado — Opción B (backend `/saml/*` y `/oidc/*` sin prefix `/api/`)               | 2026-04-18 |
| Reclasificación 18 endpoints content/ | ✅ Ejecutado — ORPHAN → PLANNED                                                          | 2026-04-18 |
| D1 Endpoint ↔ UI Mapping              | Pendiente (base en ENDPOINT_AUDIT.md)                                                    | —          |
| D2 Standards Compliance               | Pendiente                                                                                | —          |
| D3 Data Integrity                     | Pendiente                                                                                | —          |
| D4 Functional Conformity              | Pendiente                                                                                | —          |
| D5 Security                           | Pendiente                                                                                | —          |
| D6 Pre-Production Cleanup             | Pendiente                                                                                | —          |
| D7 Critical Tests Coverage            | Pendiente                                                                                | —          |
| Revisión hallazgos laterales          | Pendiente                                                                                | —          |

---

## 7. Notas de diseño (para que Edward recuerde el razonamiento)

- **Por qué 8 dimensiones y no más:** más dimensiones = más ramificaciones = más probabilidad de nunca terminar. Ocho es suficiente para cubrir lo que importa sin crecer a infinito.
- **Por qué no "audita todo el codebase":** ningún agente LLM mantiene foco útil sobre un codebase del tamaño de OmniPost en una sola pasada. Las auditorías por dimensión son cómo se hace esto con rigor.
- **Por qué conservar docs previos:** trabajo hecho con evidencia no se descarta — se consolida. El ENDPOINT_AUDIT y el CLIENT_LIB_HOOKS_AUDIT son entradas legítimas del Plan, no ruido.
- **Por qué criterios objetivos y no "completitud":** "completo" es subjetivo, se mueve, y genera ansiedad. Criterios objetivos son auditables y te dejan decir "hecho" con honestidad.
- **Por qué "tranquilidad personal" cambia el diseño:** sin deadline, el riesgo es la perfección paralizante. El plan tiene que forzar cierres explícitos. Sin esto, la tranquilidad nunca llega.
