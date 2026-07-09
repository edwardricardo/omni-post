# Alcance Multi-idioma — Decisión de Producto

> Estado: **DECIDIDO** · Fecha: 2026-05-19 · Decisor: Edward
> Bloqueante **B4** del [MASTER_PLAN_ES.md](MASTER_PLAN_ES.md).
> Desbloquea Fase 1 — Multi-idioma (F1-API-1, F1-CLI-1, F1-CLI-2).

## Por qué esta decisión

OmniPost apunta a un ICP **LATAM** y la internacionalización es un requisito
de negocio (se pierden deals sin contenido y UI en el idioma del cliente).
Antes de implementar i18n (Fase 1) el producto necesita fijar **qué locales**
se soportan y **hasta dónde** llega el alcance (solo UI, solo contenido IA, o
ambos), para no construir sobre supuestos.

## Decisión

### 1. Locales soportados

| Locale  | Tag BCP-47                  | Rol                                          |
| ------- | --------------------------- | -------------------------------------------- |
| Inglés  | `en`                        | **Locale por defecto** (revisado 2026-05-22) |
| Español | `es` (ref. `es-419`, LATAM) | Locale first-class soportado (ICP LATAM)     |

- **`en` es el default** (revisado el 2026-05-22): se unificó el default en
  `en` para `apps/client` y `apps/admin` por consistencia operativa entre
  ambas apps. El default anterior era `es`.
- **Español sigue siendo first-class**: el ICP es LATAM y los materiales
  (investor, marketing) son ES-first; `es` está totalmente soportado y es
  conmutable por el usuario. Solo cambia el locale al que resuelve `/` sin
  prefijo.
- La variante de referencia del español es **`es-419`** (español de América
  Latina y el Caribe, región UN M49 419). El emparejamiento usa el algoritmo
  **best-fit** de `@formatjs/intl-localematcher` (no el `lookup` de RFC 4647),
  que resuelve correctamente variantes regionales (`es-419` ↔ `es`).
- **Por ahora solo `es` y `en`.** Otros locales (p. ej. `pt-BR`) quedan
  **fuera** hasta una nueva decisión de producto.

### 2. Alcance: **AMBOS** (UI + contenido IA)

1. **UI internacionalizada** (apps `admin` y `client`): todos los textos de
   interfaz vía catálogos por locale; sin strings concatenados.
2. **Contenido generado por IA nativo por locale**: la generación produce
   contenido **escrito originalmente en el locale objetivo** (no traducción
   post-hoc), con RAG sobre glosario / style-guide por locale para fidelidad
   de marca y terminología.

### 3. Arquitectura extensible (criterios para añadir un locale)

- Lista de locales **config-driven** con tags **BCP-47** — agregar un locale
  NO requiere re-arquitectura.
- Añadir un locale = **(a)** agregar el tag a la config de locales soportados,
  **(b)** agregar su catálogo de mensajes ICU, **(c)** agregar su glosario /
  style-guide para la generación IA. Sin cambios estructurales.
- **UI**: `next-intl` (App Router) — ya instalado en el monorepo. Patrón
  canónico **verificado para Next.js 16** (ver §Canon):
  - Segmento dinámico de nivel superior `[locale]`.
  - Config request-scoped en `src/i18n/request.ts` + `routing.ts`.
  - Negociación de locale en **`proxy.ts`** (en Next.js 16+; era
    `middleware.ts` hasta Next.js 15).
  - **ICU MessageFormat** para plurales/interpolación (sin concatenación).
  - `createNextIntlPlugin()` en `next.config`.
- **Orden de detección de locale** (modo prefix, canónico next-intl):
  1. Prefijo de locale en el pathname (`/es/...`, `/en/...`).
  2. Cookie con el locale previamente detectado (`NEXT_LOCALE`).
  3. Header `accept-language` (best-fit matcher).
  4. `defaultLocale` (`en`) como último recurso.

### 4. No-objetivos (explícito)

- Locales más allá de `es`/`en` (decisión de producto futura).
- RTL: no aplica (`es` y `en` son LTR).
- Traducción automática post-hoc del contenido IA (se genera nativo por
  locale, no se traduce).
- La **implementación** (wiring de `next-intl`, `[locale]`, catálogos ICU,
  generación IA por locale) — eso es **Fase 1** (F1-CLI-1/2, F1-API-1); B4
  solo fija la decisión.

## Canon (re-verificado en vivo 2026-05-19)

next-intl v4, doc oficial:
[getting-started/app-router](https://next-intl.dev/docs/getting-started/app-router)
· [routing/middleware](https://next-intl.dev/docs/routing/middleware).
Hallazgo: el archivo de middleware se llama **`proxy.ts` en Next.js 16+**
(`middleware.ts` hasta Next.js 15). El repo usa Next `16.2.6`, por lo que
F1-CLI-1 debe implementar `proxy.ts`. Detalle registrado en el índice de
canon ("Frontend · i18n · next-intl").
