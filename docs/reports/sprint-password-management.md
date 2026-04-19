# Sprint Report: Password Management en Admin Users

## Resumen

Se movio el formulario de cambio de password desde la pagina de Security a la tabla de Admin Users, con logica dual segun el usuario:

- **Tu propia fila** — Dialog de cambio de password (current + new + confirm)
- **Otro usuario** — Envio de email con link de reset protegido por Turnstile + rate limiting

Se agrego columna visual "You" a la tabla, iconos para deactivate/activate, y pagina publica `/reset-password` para confirmar el token recibido por email.

Las variables de configuracion (ADMIN_URL, TURNSTILE keys) se migraron a la base de datos via Settings > Platform.

---

## Archivos creados (4)

| Archivo                                                | Lineas | Descripcion                                                                         |
| ------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------- |
| `apps/admin/components/users/ChangePasswordDialog.tsx` | 187    | Dialog para cambiar tu propio password con validacion (12 chars, uppercase, number) |
| `apps/admin/hooks/api/useAdminPasswordReset.ts`        | 30     | Hook mutation para enviar reset email a otro admin                                  |
| `apps/admin/hooks/api/usePublicSettings.ts`            | 41     | Hook para obtener settings publicos de plataforma sin auth                          |
| `apps/admin/app/reset-password/page.tsx`               | 205    | Pagina publica con Turnstile captcha cargado desde API                              |

## Archivos modificados (14)

### Frontend

| Archivo                                        | Cambio                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `apps/admin/providers/AuthProvider.tsx`        | +`userId` en context para identificar "soy yo" en la tabla                                             |
| `apps/admin/app/(dashboard)/layout.tsx`        | Pasa `userId={user.id}` al AuthProvider                                                                |
| `apps/admin/app/(dashboard)/users/page.tsx`    | Badge "You", icono KeyRound (password), iconos UserX/UserCheck (deactivate/activate), 2 dialogs nuevos |
| `apps/admin/app/(dashboard)/security/page.tsx` | Eliminada `ChangePasswordSection` (294 a 170 lineas)                                                   |
| `apps/admin/components/settings/constants.ts`  | +`adminUrl`, `turnstileSiteKey`, `turnstileSecretKey` en grupo PLATFORM                                |
| `apps/admin/messages/en.json`                  | +traducciones para password, reset, Turnstile, settings fields                                         |
| `apps/admin/messages/es.json`                  | +traducciones ES correspondientes                                                                      |

### Backend

| Archivo                                                     | Cambio                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| `apps/api/src/admin/adminUserRoutes.ts`                     | +endpoint `POST /admin/users/:id/password-reset` con email delivery       |
| `apps/api/src/admin/auth/adminAuthRoutes.ts`                | +Turnstile validation (desde DB) + rate limiting 5/15min en reset confirm |
| `apps/api/src/admin/auth/adminAuthSchemas.ts`               | +campo `turnstileToken` opcional en schema de reset confirm               |
| `apps/api/src/application/notifications/emailTemplates.tsx` | +template `passwordResetEmail` con React Email                            |
| `apps/api/src/settings/credentialKeys.ts`                   | +`adminUrl`, `turnstileSiteKey`, `turnstileSecretKey` en PLATFORM         |
| `apps/api/src/settings/SettingsService.ts`                  | +`getPublicPlatformSettings()` — retorna solo valores non-secret          |
| `apps/api/src/settings/settingsRoutes.ts`                   | +`GET /api/settings/public` — endpoint sin auth                           |
| `apps/api/tests/unit/settings/SettingsService.test.ts`      | +5 tests para `getPublicPlatformSettings`                                 |

---

## Endpoints nuevos

### Password reset (autenticado)

```
POST /admin/users/:id/password-reset
Auth: requireAdminAuth + requirePermission(USER_MANAGE)
```

Genera token de reset, construye URL con `adminUrl` de Settings, envia email via EmailPort (Resend).
Previene self-reset (usa el flujo de change-password en su lugar).

### Public platform settings (sin auth)

```
GET /api/settings/public
Auth: ninguna — endpoint publico intencionalmente
```

Retorna solo valores non-secret del grupo PLATFORM (name, baseUrl, adminUrl, turnstileSiteKey, etc.).
Nunca retorna `turnstileSecretKey` ni otros valores secretos.

---

## Variables migradas a Settings

| Variable env anterior            | Ubicacion en Settings           | Tipo                                                           |
| -------------------------------- | ------------------------------- | -------------------------------------------------------------- |
| `ADMIN_URL`                      | PLATFORM > `adminUrl`           | Non-secret (visible)                                           |
| `TURNSTILE_SECRET_KEY`           | PLATFORM > `turnstileSecretKey` | Secret (masked)                                                |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | PLATFORM > `turnstileSiteKey`   | Non-secret (cargado via `GET /api/settings/public` en runtime) |

Todas las variables se configuran en **Settings > Platform**. No se requiere `.env` para ninguna de ellas.
La pagina `/reset-password` obtiene `turnstileSiteKey` del endpoint publico en runtime.

---

## Flujo completo

1. Admin ve tabla de users con badge "You" en su fila
2. Click en icono KeyRound de **su propia fila** — abre ChangePasswordDialog
3. Click en icono KeyRound de **otro usuario** — ConfirmDialog pregunta si enviar email de reset
4. Backend genera token (1hr expiry), construye URL con `adminUrl` de Settings, envia email via Resend
5. Usuario recibe email, click en link — pagina `/reset-password?token=...`
6. Pagina muestra form + Turnstile captcha (si configurado)
7. Backend valida Turnstile (si secret key configurado en PLATFORM), aplica rate limit (5/15min), confirma reset
8. Success — redirect a `/login`

---

## Proteccion de seguridad

- **Turnstile (Cloudflare)**: Widget managed en la pagina de reset. Valida server-side contra `challenges.cloudflare.com/turnstile/v0/siteverify`. Se activa solo si `turnstileSecretKey` esta configurado en Settings.
- **Rate limiting**: 5 intentos cada 15 minutos por IP en el endpoint `POST /admin/auth/password/reset/confirm`.
- **Token expiry**: Reset tokens expiran en 1 hora.
- **Self-reset prevention**: El endpoint `POST /admin/users/:id/password-reset` rechaza si el target es el mismo usuario autenticado.

---

## Bugs corregidos durante review

1. **`body: emailContent.subject`** en `adminUserRoutes.ts` — El campo `body` del email recibia el subject en vez del contenido. Corregido a texto plano con la URL de reset.
2. **`<Suspense>` sin fallback** en `reset-password/page.tsx` — Agregado `fallback={null}`.

---

## Tests

- `SettingsService.test.ts`: 37 tests (5 nuevos para `getPublicPlatformSettings`)
  - Retorna solo NON_SECRET_KEYS del grupo PLATFORM
  - Nunca retorna `turnstileSecretKey`
  - Retorna objeto vacio si PLATFORM no configurado
  - Omite valores null/vacios
  - Retorna DATABASE_ERROR si credential service falla

## Verificacion

- Admin build: 0 errores TS
- API build: 0 errores TS
- SettingsService tests: 37/37 passed
- Users page: 713 lineas (bajo limite de 800)
- Security page: 170 lineas (reducida de 294)
- `NEXT_PUBLIC_TURNSTILE` no referenciado en ningun archivo frontend
- Todas las traducciones EN/ES verificadas
