# OmniPost Backend & Auth Architecture Audit

Date: 2026-03-29

---

## Executive Summary

Ambas apps (admin y client) comparten el mismo backend Fastify en `localhost:3000` y ambas autentican contra la **misma tabla `AdminUser`**. No existe una tabla de "Customer User" separada. El sistema tiene dos niveles de auth (admin routes en `/admin/auth/*` y customer routes en `/auth/*`), pero ambos validan contra `AdminUser`. La tabla `Account` representa un tenant/cliente del SaaS, pero no tiene credenciales de login propias — los login se hacen via `AdminUser`. Para la separación correcta owner/customer, el backend necesita un modelo de auth de customer separado.

---

## Backend Architecture

### Shared or separate?

| App         | Backend URL                                      | Same API?            |
| ----------- | ------------------------------------------------ | -------------------- |
| apps/admin  | `process.env.API_URL \|\| http://localhost:3000` | YES — mismo servidor |
| apps/client | `process.env.API_URL \|\| http://localhost:3000` | YES — mismo servidor |

### Auth mechanism

| Aspect             | Admin                          | Client                                         |
| ------------------ | ------------------------------ | ---------------------------------------------- |
| Auth type          | JWT Bearer via cookie          | JWT Bearer via cookie                          |
| Login endpoint     | `POST /admin/auth/login`       | `POST /auth/login`                             |
| User table         | `AdminUser`                    | `AdminUser` (misma!)                           |
| Cookie name        | `admin-session` (24h)          | `session` (15m) + `client-refresh` (7d)        |
| Token in browser   | Sí (raw JWT en cookie)         | No (proxy lo extrae, nunca llega al browser)   |
| Proxy complexity   | Simple pass-through (65 lines) | Sofisticado con token interception (279 lines) |
| MFA support        | Sí (TOTP via authRoutes)       | No visible                                     |
| Session management | `AdminSession` table + Redis   | `AdminSession` table + Redis (misma!)          |

---

## Role Model

### Current roles in the system

**AdminRole** (tabla `AdminUser`):

- `SUPER_ADMIN` — Platform owner (Edward)
- `ADMIN` — Platform staff
- `SUPPORT` — Support role

**TeamRole** (tabla `TeamMember`, dentro de un `Account`):

- `OWNER` — Dueño del Account (cliente)
- `MANAGER` — Manager del equipo
- `MEMBER` — Miembro regular
- `VIEWER` — Solo lectura

### Is there an owner/superadmin concept?

**Sí** — `AdminUser` con `role = "SUPER_ADMIN"` es el dueño de la plataforma. Middleware `requireSuperAdmin` lo protege.

### Can the API distinguish owner from customer?

**Parcialmente.** El `authenticateMiddleware` general (para customer routes) y el `adminAuthMiddleware` (para admin routes) son middlewares separados. Pero ambos validan contra `AdminUser`. La separación es:

- Rutas `/admin/*` usan `requireAdmin` → solo ADMIN/SUPER_ADMIN pueden acceder
- Rutas regulares usan `authenticateMiddleware` → cualquier AdminUser autenticado puede acceder
- Datos se filtran por `accountId` en las queries

**El problema:** No hay tabla de "Customer User". Un cliente del SaaS se logea como `AdminUser` con cualquier role. No hay distinción técnica entre "Edward logueado en su admin" y "un cliente logueado en su dashboard".

---

## Multi-tenancy Security

### Current state

- Queries filtran por `accountId` correctamente en la mayoría de rutas
- `IntegrationApiKey` (Zapier/Make) adjunta `accountId` al request → scoped correctamente
- Admin routes (`/admin/*`) requieren role ADMIN/SUPER_ADMIN

### Gaps encontrados

1. **No hay tabla Customer User** — Todos logean contra `AdminUser`. Un "cliente" ES un AdminUser.
2. **Un AdminUser con role ADMIN puede ver datos de cualquier account** — no hay filtro de account en admin routes
3. **Las rutas de customer (posts, inbox, etc.) dependen de `accountId` en el request** — pero si no se provee, algunas rutas fallan silenciosamente o usan el `userId` como fallback
4. **No hay aislamiento de sesión entre admin y client** — el mismo JWT funciona en ambas apps porque es el mismo `AdminUser`

---

## What Needs to Change

### Para separación correcta owner/customer

| Cambio                                                           | Dónde                        | Esfuerzo | Prioridad |
| ---------------------------------------------------------------- | ---------------------------- | -------- | --------- |
| Crear tabla `CustomerUser` (o `User`) para login de clientes     | Prisma schema + auth service | M        | CRÍTICO   |
| Crear auth flow separado para customers (`/auth/customer/login`) | Backend auth routes          | M        | CRÍTICO   |
| Customer sessions separadas (cookie diferente, tabla diferente)  | Auth service + Redis         | S        | CRÍTICO   |
| Admin routes verifican que el user ES AdminUser, no CustomerUser | Middleware                   | S        | ALTO      |
| Customer routes verifican accountId scope en TODAS las queries   | Route handlers               | M        | ALTO      |
| Client app usa nuevo auth flow de customer                       | Client server actions        | S        | ALTO      |
| Admin app mantiene auth flow existente de AdminUser              | Sin cambio                   | —        | —         |

### Minimum viable changes antes de migración

1. **Crear modelo `CustomerUser`** con: email, passwordHash, accountId, role (TeamRole), isActive
2. **Crear `/auth/customer/login`** endpoint que valide contra `CustomerUser`
3. **Crear `customerAuthMiddleware`** que valide tokens de customer y adjunte `accountId`
4. **Actualizar client app** para usar el nuevo endpoint y cookie separada
5. **Mantener admin app** como está — `AdminUser` sigue siendo para staff

---

## Migration Recommendation

**Dado el auth architecture:**

**Recommendation cambiada a: Option C modificado**

Option C (rename admin→client, build new admin) sigue siendo viable PERO requiere resolver el auth primero:

1. **Sprint 0 (auth separation):** Crear CustomerUser + auth flow separado
2. **Después:** Renombrar admin→client (las 26 páginas ya tienen los components correctos)
3. **Después:** Extraer las 11 páginas admin a nuevo admin limpio
4. **Después:** Client usa CustomerUser auth, Admin usa AdminUser auth

**Sin este Sprint 0, la migración no funciona** porque ambas apps compartirían el mismo user pool y no habría forma de distinguir quién es quién.

### Pre-migration requirements

1. Modelo `CustomerUser` en Prisma (M effort)
2. Endpoint `POST /auth/customer/login` + `POST /auth/customer/register` (M effort)
3. Middleware `customerAuthMiddleware` que scope por accountId (S effort)
4. Cookie separada para customer sessions (S effort)
5. Migrar client app a usar nuevo auth (S effort)

---

## Honest Assessment

Creo que el auth architecture actual es el resultado de un patrón común: se construyó el admin primero como la única app, y cuando se creó el client app, se reutilizó el mismo auth porque era lo más rápido. `AdminUser` se convirtió en "la tabla de todos los usuarios" por conveniencia.

Lo que veo es un sistema que funciona correctamente para un single-tenant (Edward es el único usuario), pero no está preparado para multi-tenant real. Si Edward invita a un cliente a usar OmniPost, ese cliente se logearía como `AdminUser` — lo cual le daría potencialmente acceso a rutas admin si conoce las URLs.

En mi opinión, la prioridad #1 antes de cualquier migración de código es separar el auth. Sin eso, mover páginas de admin a client es cosmético — el problema real es que no hay distinción entre "dueño de la plataforma" y "cliente de la plataforma" a nivel de autenticación.

El esfuerzo de auth separation es ~2-3 días de trabajo (nuevo modelo, nuevos endpoints, nuevo middleware). No es un refactor masivo. Pero es bloqueante para todo lo demás.
