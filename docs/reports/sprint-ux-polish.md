# Sprint Report: UX-POLISH — User Experience Improvements

## Resumen

6 mejoras de calidad de vida implementadas:

1. Session timeout ahora lee de SecuritySettings en DB (antes hardcoded 15min)
2. Team invitation email enviado al invitar miembros
3. Avatar URL agregado a AdminUser y CustomerUser
4. Profile update endpoint para timezone, locale, avatarUrl
5. System announcements CRUD + public endpoint + banners en client
6. Empty state component reutilizable para client app

---

## Schema

Migracion: `20260415040000_ux_polish_avatar_invite_announcements`

Cambios:

- `AdminUser`: +`avatarUrl String?`
- `CustomerUser`: +`avatarUrl String?`
- `TeamMember`: +`inviteToken String? @unique`, +`inviteTokenExpiry DateTime?`
- Nuevo modelo `SystemAnnouncement` con enum `AnnouncementType`

---

## Archivos creados (4)

| Archivo                                                       | Lineas | Descripcion                                                       |
| ------------------------------------------------------------- | ------ | ----------------------------------------------------------------- |
| `apps/api/src/announcements/announcementRoutes.ts`            | 142    | CRUD admin + public endpoint sin auth                             |
| `apps/admin/app/(dashboard)/announcements/page.tsx`           | 258    | CRUD page con Dialog form                                         |
| `apps/client/components/announcements/AnnouncementBanner.tsx` | 93     | Banners dismissibles por tipo (info/warning/maintenance/critical) |
| `apps/client/components/shared/EmptyState.tsx`                | 48     | Componente reutilizable con icon, title, description, CTA         |

## Archivos modificados (11)

| Archivo                                                      | Cambio                                                    |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| `infra/prisma/schema.prisma`                                 | +avatarUrl, +inviteToken, +SystemAnnouncement model       |
| `apps/api/src/admin/auth/TokenService.ts`                    | +sessionTimeoutMinutes param en generateAccessToken       |
| `apps/api/src/admin/auth/AdminAuthService.ts`                | +leer SecuritySettings.sessionTimeoutMinutes en refresh   |
| `apps/api/src/admin/auth/SessionManager.ts`                  | +leer SecuritySettings.sessionTimeoutMinutes en login     |
| `apps/api/src/admin/auth/adminAuthRoutes.ts`                 | +PUT /admin/auth/profile (timezone, locale, avatarUrl)    |
| `apps/api/src/application/notifications/emailTemplates.tsx`  | +teamInvitationEmail template                             |
| `apps/api/src/application/team/InviteTeamMemberUseCase.ts`   | +EmailPort, +PlatformCredentialService, +invitation email |
| `apps/api/src/infrastructure/container/setupTeamUseCases.ts` | +resolver EmailPort, PlatformCredentialService            |
| `apps/api/src/index.ts`                                      | +registrar announcementRoutes                             |
| `apps/admin/components/shared/SidebarNav.tsx`                | +Announcements nav item en operations                     |
| `apps/client/app/dashboard/layout.tsx`                       | +AnnouncementBanner en main content                       |

---

## Endpoints nuevos

```
PUT  /admin/auth/profile                — update own timezone, locale, avatarUrl
GET  /api/announcements/active          — public, no auth, active announcements
GET  /api/admin/announcements           — admin, list all
POST /api/admin/announcements           — admin, create
PUT  /api/admin/announcements/:id       — admin, update
DELETE /api/admin/announcements/:id     — admin, delete
```

---

## Detalle tecnico

### Session timeout

- `TokenService.generateAccessToken()` acepta `sessionTimeoutMinutes` (default 15)
- `SessionManager` y `AdminAuthService` leen de `SecuritySettings.sessionTimeoutMinutes` en DB
- Cambio toma efecto en nuevos tokens (existentes mantienen su expiry)

### Team invitation email

- Template `teamInvitationEmail` con nombre del invitador, account, rol, y CTA
- Fire-and-forget (catch + log warn)
- EmailPort + PlatformCredentialService agregados al constructor via DI

### Profile update

- `PUT /admin/auth/profile` permite actualizar timezone, locale, avatarUrl del propio perfil
- Usa requireAdminAuth — solo el propio usuario

### Announcements

- Modelo con type (INFO/WARNING/MAINTENANCE/CRITICAL), startsAt, endsAt, isActive
- Public endpoint filtra: isActive=true, startsAt<=now, endsAt>=now or null
- Client banner dismissible via localStorage (per-announcement ID)
- Admin page con Dialog CRUD y confirmacion de delete

### Empty state

- Componente `EmptyState` reutilizable: icon, title, description, actionLabel, actionHref

## Verificacion

- API build: 0 errores TS
- Admin build: 0 errores TS
- Client build: 0 errores TS
- Migracion aplicada correctamente
