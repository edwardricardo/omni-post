# OmniPost — Referencia del Stack Tecnico

> Este documento describe el stack tecnologico completo utilizado en el desarrollo de OmniPost. Esta dirigido a desarrolladores que evaluan el proyecto o que se incorporan al equipo.

> **Vigencia de las versiones.** Las versiones siguientes se midieron el 2026-10-03 contra `pnpm-lock.yaml`. Una fila se actualiza en el mismo cambio que trabaja su dependencia, o en cualquier cambio que la toque. El lockfile y `pnpm-workspace.yaml` siguen siendo la fuente de verdad.

---

## Estructura del Repositorio

### Monorepo

| Herramienta | Version | Proposito                                                |
| ----------- | ------- | -------------------------------------------------------- |
| pnpm        | 12.6.0  | Gestor de paquetes con soporte de workspaces             |
| Turbo       | 2.9.16  | Orquestacion de builds en monorepo con cache inteligente |
| Node.js     | 24      | Runtime (ultima version LTS)                             |
| TypeScript  | 6.0.3   | Lenguaje — modo estricto en toda la base de codigo       |

### Vista General de Workspaces

| Workspace              | Proposito                                                    |
| ---------------------- | ------------------------------------------------------------ |
| apps/api               | Backend Fastify — toda la logica de negocio, 709 archivos TS |
| apps/client            | Producto para clientes en Next.js — 45 paginas               |
| apps/admin             | Portal de administracion en Next.js — 13 paginas             |
| apps/workers           | Workers de jobs en segundo plano con BullMQ — 6 activos      |
| packages/ports         | Definiciones de interfaces libres de tecnologia              |
| packages/shared        | Tipos compartidos, eventos, primitivas CQRS                  |
| packages/adapters/\*   | Adaptadores de infraestructura (10 paquetes)                 |
| packages/providers/\*  | 10 adaptadores de plataformas sociales + compartido          |
| packages/ui            | Componentes React compartidos                                |
| packages/core          | Funcionalidades transversales (engine, threading)            |
| packages/monitoring    | Circuit breaker, health checks                               |
| packages/observability | Logger, instrumentacion OpenTelemetry                        |
| packages/api-common    | Utilidades compartidas de rutas, exportacion CSV             |
| infra/prisma           | Esquema de base de datos, migraciones, cliente               |

---

## Backend (apps/api)

### Framework Principal

| Paquete                       | Version | Proposito                    | Razon de Eleccion                                                  |
| ----------------------------- | ------- | ---------------------------- | ------------------------------------------------------------------ |
| fastify                       | 5.12.5  | Servidor HTTP                | 2x el throughput de Express, TypeScript nativo, rutas schema-first |
| fastify-plugin                | 5.0.1   | Sistema de plugins           |                                                                    |
| fastify-type-provider-zod     | 6.1.0   | Integracion con esquemas Zod | Validacion type-safe de request/response                           |
| @fastify/cors                 | 11.1.0  | Middleware CORS              |                                                                    |
| @fastify/cookie               | 11.0.2  | Manejo de cookies            | Cookies httpOnly para sesiones de autenticacion                    |
| @fastify/helmet               | 13.0.1  | Headers de seguridad         |                                                                    |
| @fastify/swagger              | 9.7.0   | Generacion de spec OpenAPI   |                                                                    |
| @fastify/websocket            | 11.2.0  | Soporte WebSocket            | Notificaciones SSE                                                 |
| @fastify/rate-limit           | 10.3.0  | Rate limiting                | Configurable por ruta                                              |
| @scalar/fastify-api-reference | 1.49.5  | UI de documentacion API      | Documentacion interactiva con Scalar                               |

### Arquitectura

**Patron:** Arquitectura Hexagonal (Puertos y Adaptadores) + DDD + CQRS + Saga + Outbox

La capa de dominio no importa nada externo — ni Prisma, ni Fastify, ni Redis. Los casos de uso de la capa de aplicacion dependen unicamente de interfaces de puertos. Los adaptadores de infraestructura implementan esos puertos. Esto significa que agregar, reemplazar o eliminar un proveedor social no requiere ningun cambio en la logica de negocio. El agregado Post no sabe si esta publicando en X o en Bluesky.

**CQRS:** Los comandos (mutaciones) retornan `Result<T, Error>`, pasan por UnitOfWork y despachan eventos de dominio. Las queries retornan DTOs directamente desde repositorios optimizados para lectura. Cada camino puede escalarse de forma independiente.

**Patron Saga:** Coordina la publicacion multi-paso a traves de distintas plataformas. Cada paso es una transaccion local con acciones de compensacion.

**Patron Outbox:** Los eventos de dominio se escriben en el outbox dentro de la misma transaccion de base de datos que el guardado del agregado. Un proceso de relay los despacha hacia las colas de BullMQ.

### Base de Datos

| Paquete        | Version     | Proposito                   | Razon de Eleccion                            |
| -------------- | ----------- | --------------------------- | -------------------------------------------- |
| @prisma/client | 7.9.1       | Cliente de queries generado | Queries type-safe generadas desde el esquema |
| prisma         | 7.9.1       | ORM + migraciones           | Herramientas de migracion e introspeccion    |
| postgresql     | 16 (Docker) | Base de datos principal     | ACID, soporte JSON, ecosistema maduro        |

**Tamanio del esquema:** 98 modelos. Esto refleja la complejidad real del negocio: publicacion de posts en 10 proveedores con aprobaciones, campanas, programacion recurrente, ingesta de analiticas, sincronizacion de inbox, enriquecimiento con IA, facturacion y referidos.

### Autenticacion

| Paquete              | Version | Proposito                         |
| -------------------- | ------- | --------------------------------- |
| jsonwebtoken         | 9.0.2   | Firma y verificacion de JWT       |
| argon2               | 0.44.0  | Hashing de passwords (argon2id)   |
| @node-saml/node-saml | 5.1.0   | SSO con SAML 2.0                  |
| openid-client        | 6.8.2   | OpenID Connect (PKCE)             |
| otplib               | 12.0.1  | MFA con TOTP                      |
| qrcode               | 1.5.4   | Generacion de codigos QR para MFA |

**Dos sistemas de autenticacion separados:**

- `AdminUser` — portal del propietario (roles SUPER_ADMIN, ADMIN, SUPPORT). JWT secret separado, cookie `admin-session`.
- `CustomerUser` — producto del cliente (roles OWNER, MANAGER, MEMBER, VIEWER). JWT secret separado, cookie `customer-session`.
  Un token de cliente no puede acceder a rutas de administracion por diseno — separacion criptografica, no solo separacion de rutas.

### Colas / Jobs en Segundo Plano

| Paquete | Version | Proposito     | Razon de Eleccion                                                           |
| ------- | ------- | ------------- | --------------------------------------------------------------------------- |
| bullmq  | 5.58.9  | Cola de jobs  | Respaldada por Redis, nativa en TypeScript, fiabilidad de nivel empresarial |
| ioredis | 5.11.1  | Cliente Redis | Requerido por BullMQ                                                        |

**14 colas activas:**

| Cola                  | Proposito                                                   |
| --------------------- | ----------------------------------------------------------- |
| PUBLISH               | Entrega de posts a APIs de proveedores                      |
| WEBHOOK_PROCESSING    | Procesamiento de eventos webhook entrantes                  |
| WEBHOOK_DEAD_LETTER   | Almacenamiento permanente de webhooks fallidos              |
| DEAD_LETTER_QUEUE     | Operaciones fallidas generales                              |
| INTEGRATION_EVENTS    | Despacho de eventos de dominio CQRS                         |
| FAILED_OPERATIONS_DLQ | Fallos del circuit breaker                                  |
| ANALYTICS_AGGREGATION | Ingesta de datos de analiticas (cada 6h)                    |
| REPORT_GENERATION     | Generacion de reportes programados                          |
| RECURRING_POSTS       | Creacion de posts recurrentes desde plantillas              |
| INBOX_SYNC            | Polling de mensajes desde proveedores (cada 30min)          |
| DETECT_REPURPOSE      | Deteccion autonoma de contenido de alto rendimiento         |
| GENERATE_REPURPOSE    | Generacion de variantes con IA para reutilizacion           |
| TRIAGE_INBOX          | Clasificacion de mensajes y sugerencia de respuestas con IA |
| TREND_RADAR           | Obtencion de temas en tendencia y puntuacion de relevancia  |

### IA / LLM

| Paquete               | Version | Proposito                | Razon de Eleccion                                       |
| --------------------- | ------- | ------------------------ | ------------------------------------------------------- |
| openai                | 6.33.0  | Cliente de la API OpenAI | GPT-4 para generacion de contenido, proveedor principal |
| @google/genai         | 1.20.0  | API de Google Gemini     | Fallback rapido, costo-eficiente para tareas simples    |
| (Perplexity via REST) | —       | Perplexity Sonar         | Predicciones con acceso web, no requiere SDK            |

**Enrutamiento de proveedores:** Seleccion automatica segun el tipo de tarea. La generacion de contenido se enruta a OpenAI. Las predicciones se enrutan a Perplexity. Las tareas rapidas se enrutan a Gemini. Rate limiting por proveedor con fallback inteligente al siguiente disponible.

### Email

| Paquete                 | Version | Proposito                                             |
| ----------------------- | ------- | ----------------------------------------------------- |
| @react-email/components | 1.0.10  | Componentes de plantillas de email (basados en React) |
| @react-email/render     | 2.0.4   | Renderizado HTML del lado del servidor                |
| (Resend via REST)       | —       | Envio de emails (fetch nativo, sin SDK)               |

### Pagos

| Paquete                 | Version | Proposito                                |
| ----------------------- | ------- | ---------------------------------------- |
| stripe                  | 21.0.1  | Adaptador de pagos con Stripe            |
| @paddle/paddle-node-sdk | 3.6.1   | Adaptador de Paddle (Merchant of Record) |

Ambos detras del puerto `IPaymentAdapter`. Cambiar de proveedor de pagos = una variable de entorno (`PAYMENT_PROVIDER=stripe` o `paddle`).

### Almacenamiento

| Paquete                       | Version  | Proposito                               |
| ----------------------------- | -------- | --------------------------------------- |
| @aws-sdk/client-s3            | 3.1091.0 | Almacenamiento compatible con S3        |
| @aws-sdk/s3-presigned-post    | 3.1091.0 | Presigning de uploads directos          |
| @aws-sdk/s3-request-presigner | 3.1091.0 | Presigning de URLs de descarga          |
| cloudinary                    | 2.10.0   | Adaptador de almacenamiento alternativo |

### Validacion

| Paquete              | Version  | Proposito                                                 |
| -------------------- | -------- | --------------------------------------------------------- |
| zod                  | 4.4.3    | Validacion de esquemas — nativo en TypeScript, componible |
| validator            | 13.15.35 | Utilidades de validacion de strings                       |
| isomorphic-dompurify | 4.4.0    | Sanitizacion de HTML                                      |

### Observabilidad

| Paquete                                 | Version | Proposito                                |
| --------------------------------------- | ------- | ---------------------------------------- |
| @opentelemetry/sdk-node                 | 0.219.0 | SDK de OpenTelemetry                     |
| @opentelemetry/api                      | 1.9.1   | API de tracing                           |
| @opentelemetry/instrumentation-fastify  | 0.57.0  | Auto-instrumentacion de Fastify          |
| @opentelemetry/instrumentation-http     | 0.219.0 | Auto-instrumentacion HTTP                |
| @opentelemetry/instrumentation-redis    | 0.67.0  | Auto-instrumentacion de Redis            |
| @opentelemetry/exporter-prometheus      | 0.219.0 | Exportacion de metricas a Prometheus     |
| @opentelemetry/exporter-trace-otlp-http | 0.219.0 | Exportacion de trazas OTLP               |
| pino                                    | 10.3.1  | Logging estructurado de alto rendimiento |
| prom-client                             | 15.1.3  | Cliente de metricas Prometheus           |

### Resiliencia

| Paquete | Version | Proposito       |
| ------- | ------- | --------------- |
| opossum | 9.0.0   | Circuit breaker |

---

## Frontend — Producto para Clientes (apps/client)

### Nucleo

| Paquete    | Version | Proposito                                       |
| ---------- | ------- | ----------------------------------------------- |
| next       | 16.3.8  | Framework React (App Router, server components) |
| react      | 19.2.7  | Biblioteca de UI                                |
| react-dom  | 19.2.7  | Renderizado DOM                                 |
| typescript | 6.0.3   | Lenguaje                                        |

### Obtencion de Datos y Estado

| Paquete                        | Version | Proposito                                                        |
| ------------------------------ | ------- | ---------------------------------------------------------------- |
| @tanstack/react-query          | 5.101.0 | Gestion de estado del servidor (cache, refetch en segundo plano) |
| @tanstack/react-query-devtools | 5.95.0  | DevTools para depuracion de queries                              |
| zustand                        | 5.0.14  | Estado del cliente (store de notificaciones)                     |

### Componentes de UI

| Paquete                  | Version | Proposito                                         |
| ------------------------ | ------- | ------------------------------------------------- |
| tailwindcss              | 4.3.0   | Framework de CSS utilitario                       |
| lucide-react             | 1.7.0   | Biblioteca de iconos                              |
| radix-ui                 | 1.4.3   | Primitivas de componentes accesibles              |
| class-variance-authority | 0.7.1   | Gestion de variantes de componentes               |
| recharts                 | 3.8.1   | Visualizacion de datos (dashboards de analiticas) |
| @emoji-mart/react        | 1.1.1   | Selector de emojis                                |
| fuse.js                  | 7.0.0   | Busqueda difusa del lado del cliente              |

### Editor de Texto Enriquecido

| Paquete                           | Version | Proposito                                |
| --------------------------------- | ------- | ---------------------------------------- |
| @tiptap/core                      | 3.30.5  | Framework de editor de texto enriquecido |
| @tiptap/react                     | 3.30.5  | Integracion con React                    |
| @tiptap/starter-kit               | 3.30.5  | Funcionalidades basicas del editor       |
| @tiptap/extension-character-count | 3.30.5  | Conteo de caracteres                     |
| @tiptap/extension-color           | 3.30.5  | Color de texto                           |
| @tiptap/extension-highlight       | 3.30.5  | Resaltado de texto                       |
| @tiptap/extension-link            | 3.30.5  | Manejo de enlaces                        |
| @tiptap/extension-placeholder     | 3.30.5  | Texto placeholder                        |
| @tiptap/extension-text-style      | 3.30.5  | Estilizado de texto                      |
| @tiptap/extension-typography      | 3.30.5  | Tipografia inteligente                   |

### Utilidades

| Paquete              | Version | Proposito                                |
| -------------------- | ------- | ---------------------------------------- |
| date-fns             | 4.1.0   | Manipulacion de fechas                   |
| cronstrue            | 3.13.0  | Expresiones cron legibles por humanos    |
| papaparse            | 5.5.3   | Parseo de CSV (carga masiva)             |
| @monaco-editor/react | 4.6.0   | Editor de codigo (edicion de plantillas) |

---

## Frontend — Portal de Administracion (apps/admin)

Mismo stack base que apps/client (Next.js 16.3.8, React 19.2.7, Tailwind, Recharts). 13 paginas enfocadas en la administracion de la plataforma: cuentas, suscripciones, precios, seguridad, cumplimiento, logs de auditoria, webhooks, dashboard ejecutivo.

---

## Workers en Segundo Plano (apps/workers)

6 workers activos procesando 14 colas:

| Worker                | Cola(s)                              | Concurrencia | Programacion                     |
| --------------------- | ------------------------------------ | ------------ | -------------------------------- |
| publishWorker         | PUBLISH                              | 5            | Bajo demanda                     |
| analyticsIngestWorker | ANALYTICS_AGGREGATION                | 5            | Cada 6 horas                     |
| inboxSyncWorker       | INBOX_SYNC                           | 5            | Cada 30 minutos                  |
| repurposeWorker       | DETECT_REPURPOSE, GENERATE_REPURPOSE | 3/2          | Despues de ingesta de analiticas |
| inboxTriageWorker     | TRIAGE_INBOX                         | 5            | Despues de ingesta de mensajes   |
| trendRadarWorker      | TREND_RADAR                          | 3            | Cada 2 horas                     |

---

## Adaptadores de Plataformas Sociales (packages/providers)

Cada plataforma es un paquete workspace separado que implementa `IProviderAdapter` desde `packages/ports`. Agregar la plataforma numero 11 requiere un paquete nuevo — cero cambios en la logica de negocio central.

| Plataforma  | SDK/Biblioteca                                                                              | Capacidades                                         |
| ----------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| X (Twitter) | twitter-api-v2 1.27.0                                                                       | Publicacion, analiticas, inbox, hilos               |
| Instagram   | API directa (fetch)                                                                         | Publicacion, stories, analiticas, inbox, carrusel   |
| Facebook    | API directa (fetch)                                                                         | Publicacion, analiticas, inbox                      |
| YouTube     | @googleapis/youtube 39.0.1, @googleapis/youtubeanalytics 11.0.1, google-auth-library 11.1.0 | Publicacion, analiticas                             |
| TikTok      | axios 1.20.0                                                                                | Publicacion, analiticas, descubrimiento de hashtags |
| LinkedIn    | API directa (fetch)                                                                         | Publicacion, analiticas, inbox                      |
| Pinterest   | API directa (fetch)                                                                         | Publicacion, analiticas                             |
| Snapchat    | API directa (fetch)                                                                         | Publicacion, analiticas                             |
| Telegram    | API directa (fetch)                                                                         | Publicacion, inbox                                  |
| Bluesky     | @atproto/api 0.13.28                                                                        | Publicacion, protocolo AT                           |

---

## Paquetes Compartidos

### packages/ports

Definiciones de interfaces libres de tecnologia. Sin dependencias en runtime.

Puertos definidos: `IProviderAdapter`, `IPaymentAdapter`, `IEmailAdapter`, `ICrmAdapter`, `IStorageAdapter`, `IQueuePort`, `ICachePort`

### packages/shared

Dependencias: date-fns 4.1.0, handlebars 4.7.9

Contiene: Tipos Result (`ok()`, `err()`), definiciones de eventos de dominio, primitivas CQRS, tipos de saga, enums compartidos, configuracion de proveedores.

### packages/ui

Componentes React compartidos: Button, Dialog, Input, Label, Textarea, Tabs, Badge, Alert, Toast, Tooltip, Progress, Select, Switch, Slider, Checkbox, ScrollArea, Separator, Card, DropdownMenu, Avatar. Tambien incluye el editor de contenido TipTap y el selector de emojis.

Construido con: radix-ui 1.4.3, class-variance-authority 0.7.1, clsx 2.1.1, tailwind-merge 2.6.0.

---

## Testing

### Stack

| Paquete                   | Version | Proposito                                |
| ------------------------- | ------- | ---------------------------------------- |
| vitest                    | 4.1.11  | Test runner (basado en Vite, ESM nativo) |
| @vitest/coverage-v8       | 4.1.11  | Proveedor de cobertura                   |
| @testing-library/react    | 16.3.3  | Testing de componentes                   |
| @testing-library/dom      | 10.4.2  | Utilidades DOM                           |
| @testing-library/jest-dom | 7.0.1   | Matchers personalizados                  |
| jsdom                     | 30.1.1  | Simulacion de entorno de navegador       |
| @playwright/test          | 1.63.0  | Testing E2E                              |
| @faker-js/faker           | 10.6.0  | Generacion de datos de prueba            |

### Metricas

| Metrica               | Valor                                   |
| --------------------- | --------------------------------------- |
| Archivos de test      | 351                                     |
| Total de tests        | 7,159                                   |
| Fallos en tests       | 0                                       |
| Umbrales de cobertura | Lineas 55%, Funciones 55%, Branches 45% |

### Estrategia

**Tests unitarios** (mayoria): Repositorios en memoria, adaptadores mockeados. Cada caso de uso se prueba de forma independiente.

**Tests de componentes**: React Testing Library para UI critica de seguridad (visibilidad basada en roles en TeamMemberRow).

**Tests E2E**: Playwright para flujos de autenticacion y recorridos criticos de usuario.

**Tests de limites de arquitectura**: 7 fitness functions basadas en grep ejecutadas en CI que aseguran que no haya violaciones entre capas.

---

## Calidad de Codigo

| Herramienta | Version | Proposito                             |
| ----------- | ------- | ------------------------------------- |
| eslint      | 9.39.5  | Analisis estatico (flat config, v9)   |
| prettier    | 3.9.9   | Formateo de codigo                    |
| husky       | 9.1.7   | Git hooks                             |
| lint-staged | 17.6.0  | Linting de archivos staged pre-commit |
| knip        | 6.38.0  | Deteccion de codigo muerto            |
| madge       | 8.0.0   | Deteccion de dependencias circulares  |
| jscpd       | 5.3.2   | Deteccion de codigo duplicado         |

### Estandares

- TypeScript estricto (`strict: true`, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`)
- Cero `any` en codigo de produccion
- Todos los casos de uso retornan `Result<T, E>` — sin excepciones no manejadas
- Versionado exacto — sin `^` ni `~` en ningun package.json
- Limites de arquitectura reforzados por fitness functions en CI

---

## DevOps / Infraestructura

### Servicios de Docker Compose

| Servicio   | Imagen                      | Puerto     | Proposito                                                          |
| ---------- | --------------------------- | ---------- | ------------------------------------------------------------------ |
| PostgreSQL | pgvector/pgvector:pg16      | 5432       | Base de datos principal                                            |
| Redis      | redis:7                     | 6379       | Colas BullMQ + cache                                               |
| Grafana    | grafana/grafana:11.2.2      | 3001       | Dashboards de metricas                                             |
| Prometheus | prom/prometheus:v2.48.1     | 9090       | Recoleccion de metricas                                            |
| Jaeger     | jaegertracing/jaeger:latest | 16686      | Tracing distribuido                                                |
| MinIO      | minio/minio:latest          | 9000, 9001 | Almacenamiento de medios compatible con S3 (API, consola)          |
| MinIO init | minio/mc:latest             | —          | Crea el bucket `omni-post-media` cuando MinIO está listo y termina |

### Workflows de GitHub Actions (13)

1. **ci.yml** — CI principal: lint, test, build, seguridad, tests de proveedores, tests de frontend
2. **security-testing.yml** — SAST (CodeQL), DAST, escaneo de dependencias (diario a las 2 AM UTC)
3. **performance.yml** — Tests de rendimiento: estres de base de datos y memoria (`perf:db`, `perf:memory`) y un test de carga con k6
4. **nightly.yml** — Builds nocturnos
5. **production-ci.yml** — Verificaciones de despliegue a produccion
6. **dependency-updates.yml** — Gestion automatizada de dependencias
7. **cleanup.yml** — Tareas de limpieza
8. **audit.yml** — Auditoría previa al merge: un job por herramienta en cada push y PR, con SARIF a Code Scanning cuando la herramienta lo admite (también diario a las 3 AM UTC)
9. **fitness.yml** — Funciones de fitness de arquitectura: los greps de CLAUDE.md §Automated Compliance Checks
10. **eval.yml** — Evals de trayectoria de IA para los slices de repurpose, triage y trends; una regresión bloquea el merge
11. **chaos.yml** — Escenarios de caos de saga y outbox, cada noche (3:30 AM UTC), con el mismo runner de tests que usa CI
12. **cache-divergence.yml** — Sonda diaria de un acierto de caché de Turborepo que repite artefactos no construidos desde el commit (4:17 AM UTC)
13. **maturity-reminder.yml** — Abre, o comenta, el issue de cada revisión de la lista de madurez que vence ese día (1 PM, 5 PM y 9 PM UTC), y arrastra cada día, en el mismo issue, una revisión que sigue sin registrarse después de su día, reabriéndolo si se cerró un día anterior

### Servicios Externos Requeridos

| Servicio        | Consumido Por | Proposito                              |
| --------------- | ------------- | -------------------------------------- |
| PostgreSQL      | API           | Base de datos principal                |
| Redis           | API + Workers | Colas BullMQ + cache                   |
| S3-compatible   | API           | Almacenamiento de medios               |
| Resend          | API           | Email transaccional                    |
| Stripe o Paddle | API           | Procesamiento de pagos                 |
| OpenAI          | API           | Generacion de contenido con IA (GPT-4) |
| Google Gemini   | API           | Proveedor de IA de respaldo            |
| Perplexity      | API           | Predicciones de IA con acceso web      |

### Registros Requeridos en Plataformas Sociales

X Developer Portal, Meta (Instagram + Facebook), Google (YouTube), TikTok for Developers, LinkedIn Developer, Pinterest Developers, Snapchat for Business, Telegram Bot API, Bluesky AT Protocol.

---

## Decisiones de Arquitectura (ADR)

### Por que Arquitectura Hexagonal?

La plataforma integra 10 adaptadores de proveedores sociales, cada uno con APIs completamente diferentes entre si. La arquitectura hexagonal garantiza que agregar, reemplazar o eliminar cualquier proveedor no requiera modificar ni una sola linea de logica de negocio. El agregado Post desconoce por completo si esta publicando en X, en Bluesky o en cualquier otra red social. En la practica, esto significa que agregar la plataforma numero 11 requiere aproximadamente 200 lineas de codigo en un paquete adaptador nuevo, sin tocar nada mas.

Esta separacion tambien facilita el testing: toda la logica de dominio y de casos de uso se prueba con repositorios en memoria, sin necesidad de levantar infraestructura real.

### Por que CQRS?

Los modelos de lectura se optimizan de forma independiente a los modelos de escritura. Las queries de analiticas no recorren el mismo camino que los comandos de publicacion. Cada lado puede escalarse por separado segun la carga. Las queries esquivan la capa de dominio por completo y retornan DTOs directamente desde repositorios optimizados para lectura.

En un sistema donde las lecturas (dashboards de analiticas, listados de posts, reportes) superan ampliamente a las escrituras (publicacion, edicion de contenido), esta separacion permite optimizar cada camino para su patron de uso real.

### Por que BullMQ en lugar de alternativas mas simples?

Publicar un post en 10 plataformas simultaneamente, con reintentos configurables, dead letter queues y rate limiting por proveedor, requiere infraestructura de colas de nivel empresarial. Los cron jobs fallan silenciosamente y no ofrecen visibilidad sobre el estado de los jobs. BullMQ proporciona fiabilidad respaldada por Redis con soporte nativo de TypeScript, reintentos exponenciales, prioridades de jobs y un dashboard de monitoreo.

Ademas, el patron outbox del proyecto depende de una cola confiable para garantizar que los eventos de dominio se despachen exactamente una vez, incluso ante fallos de red o reinicios del servidor.

### Por que CustomerUser y AdminUser son entidades separadas?

El propietario de la plataforma (Edward) y los clientes son tipos de usuario fundamentalmente distintos: tienen permisos diferentes, acceden a datos diferentes y tienen requisitos de seguridad diferentes. La separacion es criptografica — JWT secrets distintos, middleware distinto, cookies de sesion distintas. Un token de cliente no puede acceder a rutas de administracion por diseno, no por convencion.

Esta decision elimina toda una categoria de vulnerabilidades de escalacion de privilegios que surgirian si ambos tipos de usuario compartieran el mismo sistema de autenticacion.

### Por que pricing por proveedor+cuenta en lugar de por asientos?

Los usuarios no compran asientos — compran acceso a plataformas sociales. El modelo de precios se alinea con el valor entregado, no con la cantidad de personas en el equipo. Una agencia de 50 personas con 1 cuenta social paga lo mismo que un equipo de 2 personas con 1 cuenta. Los descuentos por volumen premian el crecimiento del uso, no el crecimiento del equipo.

Este modelo es mas justo para equipos pequenos que manejan muchas cuentas y mas atractivo para agencias grandes que necesitan muchos colaboradores en pocas cuentas.

### Por que 98 modelos en Prisma?

La publicacion de posts a traves de 10 proveedores con aprobaciones multinivel, campanas, programacion recurrente, ingesta de analiticas, sincronizacion de inbox, enriquecimiento con IA, facturacion, referidos y funcionalidades autonomas no es una aplicacion CRUD simple. Los modelos de dominio reflejan la complejidad real del negocio.

El trade-off es claro: mayor ceremonia inicial al modelar el dominio, pero acoplamiento significativamente menor a largo plazo. Cada modelo tiene una razon de existir y esta respaldado por al menos un caso de uso.

---

## Configuracion del Entorno de Desarrollo

### Prerrequisitos

- Node.js 24
- pnpm 12.6.0+
- Docker (para PostgreSQL + Redis)

### Inicio Rapido

```bash
git clone <repo>
cd omnipost
pnpm install
cp apps/api/.env.example apps/api/.env
# Completar las variables de entorno requeridas
docker-compose up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
```

### Puertos de las Aplicaciones

| Aplicacion | Puerto |
| ---------- | ------ |
| API        | 3000   |
| Admin      | 3100   |
| Client     | 3200   |
| Grafana    | 3001   |
| Prometheus | 9090   |
| Jaeger     | 16686  |
