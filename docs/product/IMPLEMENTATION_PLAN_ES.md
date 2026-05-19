# Plan de Implementación — OmniPost (roadmap de gaps)

> Derivado de [FEATURE_TRACE_MATRIX_ES.md](FEATURE_TRACE_MATRIX_ES.md) §8.4 (orden) y §9 (canon 2026). Solo cubre **gaps** (🟡/📐/💬/⛔); lo ✅ no entra. Orden macro: **Bloqueantes compartidos → Fase 0 → Fase 1 → Fase 2 → Fase 3**.

## Cómo se trackea

- Estado por tarea en el checkbox: `[ ]` pendiente · `[~]` en progreso · `[x]` hecho · `[!]` bloqueado.
- **ID** estable por tarea: `<FASE>-<APP>-<n>` (no renumerar; las tareas nuevas usan el siguiente número libre).
- **Tamaño**: `[S]` ≤1 día · `[M]` 2-3 días. No hay `[L]`: si algo es más grande, se parte.
- **Dependencias**: `🔗 dep:<ID>` (no empezar hasta que esa esté `[x]`). `⛔ bloquea:<área>` marca un ítem cuya demora frena a otros — va aislado en su propia iteración.
- **DoD** = "Hecho cuando": criterio objetivo y verificable. Sin DoD cumplido no se marca `[x]`.
- App tags: **API** `apps/api` · **WRK** `apps/workers` · **CLI** `apps/client` · **ADM** `apps/admin`.
- Regla de orden intra-feature: **datos primero (WRK/API) → superficie después (CLI/ADM)**.
- Toda tarea con código respeta CLAUDE.md (UoW, Result, hexagonal, tests + JSDoc en el mismo sprint).

## Dashboard de progreso

| Bloque                       | Tareas | Hechas | Estado |
| ---------------------------- | ------ | ------ | ------ |
| Bloqueantes compartidos (B)  | 5      | 4      | 🟦     |
| Fase 0 — Funciones autónomas | 11     | 0      | ⬜     |
| Fase 1 — Necesarias          | 16     | 0      | ⬜     |
| Fase 2 — Bueno tenerla       | 21     | 0      | ⬜     |
| Fase 3 — Interesantes        | 14     | 0      | ⬜     |
| **Total**                    | **67** | **4**  | **6%** |

> Actualizar esta tabla al cerrar cada tarea. `Estado`: ⬜ no iniciado · 🟦 en progreso · ✅ completo.

---

## Bloque B — Bloqueantes compartidos (hacer primero, cada uno aislado)

> Estos 5 son independientes **entre sí** y cada uno desbloquea un set distinto. Pueden ejecutarse en paralelo en 5 tracks separados. Ninguna fase posterior arranca sin su bloqueante.

- [x] **B1** `[M]` **Decisión + spike orquestación de agentes (LangGraph vs propio)** — ⛔ bloquea: Fase 0 completa. Spike de LangGraph (grafo con estado, ReAct, evals de trayectoria) sobre 1 caso (repurpose). **DoD:** ADR en `docs/technical/` con decisión, PoC mínimo que ejecuta un grafo plan→act→reflect y un eval de trayectoria en CI.
- [x] **B2** `[M]` **Migración BullMQ repeatable jobs → Job Schedulers (`upsert`)** (API+WRK) — ⛔ bloquea: RSS, recycling, scheduled reports, scheduling tz. Repeatable deprecado desde 5.16.0. **DoD:** cero usos de `repeat:` legacy; todos los recurrentes vía Job Scheduler; tests verdes; sin jobs duplicados tras deploy.
- [x] **B3** `[M]` **Sustrato OAuth 2.1 + PKCE compartido** (API) — ⛔ bloquea: Canva, MCP, hardening connect. Helper único Auth Code + PKCE (S256), state server-side, refresh token rotation, tokens cifrados at-rest. **DoD:** módulo reutilizable + tests; redirect exact-match; un proveedor piloto migrado.
- [x] **B4** `[S]` **Decisión de producto: alcance multi-idioma** — ⛔ bloquea: Fase 1 multi-idioma. Decisión de negocio (locales objetivo LATAM, ¿UI + generación IA?). **DoD:** decisión registrada en `docs/product/` con locales y alcance (UI / contenido IA / ambos). → [MULTILINGUAL_SCOPE_ES.md](MULTILINGUAL_SCOPE_ES.md) (es/en, default es, alcance UI+IA, extensible).
- [ ] **B5** `[M]` **Semantic layer mínimo (métricas/dims gobernadas)** (API) — ⛔ bloquea: custom report builder, Looker connector. Definición única de métricas (engagement rate, alcance…) que compila queries. **DoD:** capa con ≥10 métricas core, una métrica = una definición; consumida por al menos un reporte existente.

---

## Fase 0 — Funciones autónomas (cerrar brecha pitch↔código) 🔴

> Se vende a inversores y devuelve `501`. Tres slices verticales **independientes entre sí** (repurpose / triage / trends): pueden ir en paralelo. Cada slice: WRK → API → CLI. Todas 🔗 dep:B1.

### Slice A — Repurposing

- [ ] **F0-WRK-1** `[M]` Worker consumidor de `DETECT_REPURPOSE`/`GENERATE_REPURPOSE` con grafo de agente (canon §9.1). 🔗 dep:B1. **DoD:** worker procesa un job real end-to-end con mock de LLM determinista; idempotente (inbox dedupe).
- [ ] **F0-API-1** `[S]` Retirar `501` de `repurposeRoutes.ts`, exponer endpoints + DTOs + UoW. 🔗 dep:F0-WRK-1. **DoD:** endpoint responde 2xx, encola job, integration test verde.
- [ ] **F0-CLI-1** `[M]` UI de control de repurpose en client. 🔗 dep:F0-API-1. **DoD:** usuario dispara/ve resultado; test de componente.

### Slice B — Inbox triage

- [ ] **F0-WRK-2** `[M]` Worker `TRIAGE_INBOX`: clasificación intent/sentimiento con **structured outputs** + few-shot (canon §9.1). 🔗 dep:B1. **DoD:** clasifica mensaje a schema fijo; eval set de consistencia en CI.
- [ ] **F0-API-2** `[S]` Endpoints de triage + persistencia (`priority`, `suggestedReplies`, `sentimentScore`). 🔗 dep:F0-WRK-2. **DoD:** integration test; campos poblados.
- [ ] **F0-CLI-2** `[M]` Vista de triage en la bandeja (prioridad/sentimiento/sugerencias). 🔗 dep:F0-API-2. **DoD:** bandeja muestra clasificación; test componente.

### Slice C — Trend radar

- [ ] **F0-WRK-3** `[M]` Worker `TREND_RADAR` (detección de tendencias del nicho). 🔗 dep:B1. **DoD:** genera trend report desde datos reales; idempotente.
- [ ] **F0-API-3** `[S]` Endpoints trend radar + DTOs. 🔗 dep:F0-WRK-3. **DoD:** integration test verde.
- [ ] **F0-CLI-3** `[M]` UI trend radar. 🔗 dep:F0-API-3. **DoD:** panel renderiza tendencias; test componente.

### Transversal de fase

- [ ] **F0-API-4** `[M]` Guardrails pre/post acción + telemetría de tasa-de-fallo (canon §9.1). 🔗 dep:F0-API-1. **DoD:** acción irreversible pasa por guardrail; métrica de fallo expuesta.
- [ ] **F0-API-5** `[S]` Evals de trayectoria en CI (mocks deterministas) para los 3 slices. 🔗 dep:F0-WRK-1,F0-WRK-2,F0-WRK-3. **DoD:** CI falla si la trayectoria/coste se degrada.

---

## Fase 1 — Necesarias (se pierden deals sin esto)

> Tracks independientes entre sí: Multi-idioma · Social listening · Bulk CSV · Canva · Mobile (decisión).

### Multi-idioma 🔗 dep:B4

- [ ] **F1-API-1** `[M]` Generación IA **nativa por locale** + RAG sobre glosario/style-guide (canon §9.1). 🔗 dep:B4. **DoD:** generación produce contenido nativo por locale objetivo; test por locale.
- [ ] **F1-CLI-1** `[M]` `next-intl` App Router: segmento `[locale]`, middleware, ICU MessageFormat (canon §9.5). 🔗 dep:B4. **DoD:** UI client conmuta locale; `generateStaticParams` por locale; sin strings concatenados.
- [ ] **F1-CLI-2** `[S]` Migrar catálogos de strings a ICU + revisar pluralización. 🔗 dep:F1-CLI-1. **DoD:** catálogos ICU-válidos; lint de i18n verde.

### Social listening (webhook-first)

- [ ] **F1-WRK-1** `[M]` Worker de ingesta fan-in (webhook + polling backfill), normalización a schema canónico (canon §9.2). **DoD:** menciones aterrizan normalizadas; idempotente; fetch-before-process.
- [ ] **F1-API-1b** `[M]` Modelo de menciones + queries de Share of Voice sobre read model. 🔗 dep:F1-WRK-1. **DoD:** SoV calculado desde corpus normalizado; test.
- [ ] **F1-CLI-3** `[M]` Dashboard de listening (menciones, sentimiento, SoV). 🔗 dep:F1-API-1b. **DoD:** dashboard renderiza datos reales; test componente.

### Bulk / CSV scheduling (completar 🟡)

- [ ] **F1-API-2** `[S]` Parser CSV + validación Zod por fila. **DoD:** CSV inválido reporta errores por fila; tests.
- [ ] **F1-API-3** `[M]` FlowProducer parent+children con `continueParentOnFailure: true` + DLQ (canon §9.3). 🔗 dep:F1-API-2. **DoD:** una fila mala no aborta el batch; manifiesto por fila.
- [ ] **F1-CLI-4** `[M]` UI de carga CSV + reporte de resultado por fila. 🔗 dep:F1-API-3. **DoD:** usuario sube CSV y ve outcome por fila; test componente.

### Canva 🔗 dep:B3

- [ ] **F1-API-4** `[M]` Integración Canva Connect (OAuth backend, tokens cifrados, refresh rotation) reusando B3. 🔗 dep:B3. **DoD:** flujo OAuth completo server-side; test.
- [ ] **F1-CLI-5** `[M]` Embed de Canva en el composer. 🔗 dep:F1-API-4. **DoD:** usuario crea/edita visual sin salir; test componente.

### Mobile (solo decisión en esta fase)

- [ ] **F1-DEC-1** `[S]` Decisión + spike: Expo (RN universal) vs PWA (canon §9.5). **DoD:** ADR en `docs/technical/` con decisión y alcance; build no se compromete hasta cerrar Fase 1. _(Candidato a diferir post-Fase 1.)_

---

## Fase 2 — Bueno tenerla (objeciones de agencia)

> Tracks independientes: Reseñas · White-label · Recycling · Moderación · Colisión · Completar-parciales.

### Gestión de reseñas

- [ ] **F2-WRK-1** `[M]` Adaptadores Google Business Profile / Yelp / Trustpilot, polling rate-limit-aware, upsert idempotente `(source,externalReviewId)` (canon §9.2). **DoD:** reseñas se ingieren sin duplicar; evento `ReviewIngested`.
- [ ] **F2-API-1** `[S]` Modelo de reseñas + alertas low-star desde el evento. 🔗 dep:F2-WRK-1. **DoD:** alerta dispara por evento, no por poll; test.
- [ ] **F2-CLI-1** `[M]` Bandeja de reseñas + respuesta. 🔗 dep:F2-API-1. **DoD:** responder reseña desde UI; test componente.

### White-label de plataforma

- [ ] **F2-API-2** `[M]` Resolución tenant por hostname en middleware + branding por tenant (canon §9.5). **DoD:** request mapea a tenant por host; lookup cacheado; test.
- [ ] **F2-ADM-1** `[S]` Config de branding/dominio por tenant en admin. 🔗 dep:F2-API-2. **DoD:** admin define logo/colores/dominio; persistido.
- [ ] **F2-CLI-2** `[M]` Theming runtime por CSS custom properties. 🔗 dep:F2-API-2. **DoD:** un deploy sirve N marcas; sin build por tenant; test visual.

### Recycling / evergreen 🔗 dep:B2

- [ ] **F2-API-3** `[S]` Modelo de recurrencia + guard "tiempo mínimo de reciclaje". 🔗 dep:B2. **DoD:** entidad de rotación con cooldown; test.
- [ ] **F2-WRK-2** `[M]` Re-encolado en evento `completed` con slot recalculado (canon §9.3). 🔗 dep:F2-API-3. **DoD:** post evergreen rota sin repeatable estático; test.
- [ ] **F2-CLI-3** `[S]` UI de colas evergreen por categoría. 🔗 dep:F2-API-3. **DoD:** usuario gestiona cola; test componente.

### Reglas de moderación

- [ ] **F2-API-4** `[M]` Engine en cascada: reglas deterministas → LLM juez policy-as-prompt (canon §9.2). **DoD:** reglas configurables como datos; LLM solo en escalación; test.
- [ ] **F2-WRK-3** `[S]` Aplicar moderación en el sync de inbox. 🔗 dep:F2-API-4. **DoD:** mensaje moderado en ingesta; auditado.
- [ ] **F2-CLI-4** `[S]` UI de configuración de reglas. 🔗 dep:F2-API-4. **DoD:** admin/usuario edita reglas; test.

### Detección de colisión

- [ ] **F2-API-5** `[M]` Lease corto-TTL por conversación + chequeo de concurrencia optimista en el send (canon §9.2). **DoD:** segundo send con versión stale es rechazado; test.
- [ ] **F2-CLI-5** `[S]` Indicador de presence "Agente X respondiendo" (WebSocket). 🔗 dep:F2-API-5. **DoD:** UI muestra presence; test componente.

### Completar parciales

- [ ] **F2-API-6** `[S]` Completar benchmarking de competidores (set versionado por tenant). **DoD:** SoV histórico comparable; test.
- [ ] **F2-API-7** `[S]` Completar link-in-bio (página pública). **DoD:** página live con links; test.
- [ ] **F2-API-8** `[M]` Carruseles IA (generación multi-slide estilo consistente). 🔗 dep:F0-API-1. **DoD:** genera carrusel coherente; test.
- [ ] **F2-API-9** `[M]` MCP server stateless sobre el REST API (canon §9.5). 🔗 dep:B3. **DoD:** server MCP read-only sirve tools; `.well-known`; test.
- [ ] **F2-API-10** `[S]` Looker Studio Community Connector sobre semantic layer. 🔗 dep:B5. **DoD:** connector lee métricas gobernadas vía API; smoke test.
- [ ] **F2-API-11** `[S]` Custom report builder sobre semantic layer. 🔗 dep:B5. **DoD:** template de usuario compila vía semantic layer; test.

---

## Fase 3 — Interesantes (diferenciación, tras cerrar gaps)

> No iniciar mientras queden tareas Fase 1 abiertas (regla §8.5).

- [ ] **F3-API-1** `[M]` Triage IA full: completar sugerencias multi-tono (1 llamada, array tono-etiquetado) + self-correction (canon §9.1). 🔗 dep:F0-API-2. **DoD:** 3 tonos en una llamada; loop de auto-corrección; test.
- [ ] **F3-WRK-1** `[M]` Pipeline video IA real (text-to-video, job async + webhook, modelo con audio nativo; no Sora 2) (canon §9.1/§9.4). **DoD:** genera video vía job async; artefacto a object storage + signed URL.
- [ ] **F3-API-2** `[S]` Endpoints video IA. 🔗 dep:F3-WRK-1. **DoD:** integration test.
- [ ] **F3-CLI-1** `[M]` UI generación de video. 🔗 dep:F3-API-2. **DoD:** usuario genera/previsualiza; test componente.
- [ ] **F3-API-3** `[M]` Content discovery (feeds por tópico/keyword). **DoD:** feed de descubrimiento por nicho; test.
- [ ] **F3-WRK-2** `[S]` Worker de discovery (ingesta de fuentes). 🔗 dep:F3-API-3. **DoD:** fuentes ingieren; idempotente.
- [ ] **F3-CLI-2** `[S]` UI de content discovery + curación. 🔗 dep:F3-API-3. **DoD:** curar→distribuir; test componente.
- [ ] **F3-WRK-3** `[M]` RSS auto-posting (Job Scheduler + conditional GET ETag, dedupe GUID) (canon §9.3). 🔗 dep:B2. **DoD:** 304 = no-op; sin reposts; test.
- [ ] **F3-API-4** `[S]` Config de feeds RSS por cuenta. 🔗 dep:F3-WRK-3. **DoD:** alta/baja de feed; test.
- [ ] **F3-CLI-3** `[S]` UI gestión de feeds RSS. 🔗 dep:F3-API-4. **DoD:** test componente.
- [ ] **F3-API-5** `[S]` Image-to-caption (LLM multimodal, grounding de marca) (canon §9.1). 🔗 dep:F0-API-1. **DoD:** caption desde imagen + persona; test.
- [ ] **F3-API-6** `[S]` AI alt-text generation. 🔗 dep:F0-API-1. **DoD:** alt-text accesible auto; test.
- [ ] **F3-API-7** `[M]` Analytics de ads pagados (conectores Meta/Google al star schema; persistir ventana atribución) (canon §9.4). **DoD:** métricas paid junto a orgánico; test.
- [ ] **F3-API-8** `[S]` Audience targeting / sponsoring desde la herramienta. **DoD:** segmentación/boost básico; test.

---

## Nunca (salvo pivot de ICP)

`AI voiceover` · `meme generator` · `influencer marketing` · `blog→video` · `e-commerce product→post`. Bloat confirmado en §6 — sin tareas.

---

_Plan derivado de [FEATURE_TRACE_MATRIX_ES.md](FEATURE_TRACE_MATRIX_ES.md) (rastreo + canon mayo 2026). Estimaciones S/M son tamaño de iteración, no compromiso de fecha. Reverificar canon §9 antes de cada track (modelos/APIs cambian rápido). Actualizar el Dashboard de progreso al cerrar cada tarea._
