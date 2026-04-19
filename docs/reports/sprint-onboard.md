# Sprint Report: ONBOARD — Onboarding & Communication

## Resumen

Tres gaps de onboarding cerrados:

1. Welcome email enviado a nuevos clientes al registrarse
2. Onboarding checklist en el dashboard del cliente con 4 pasos
3. Setup banner en admin dashboard cuando la plataforma no esta completamente configurada

---

## Schema

Nuevo modelo `AccountOnboarding`:

- Migracion: `20260415033511_add_account_onboarding` (via `prisma migrate dev`)
- Campos: connectedFirstProvider, createdFirstPost, invitedTeamMember, configuredBilling, completedAt, dismissedAt
- Relacion: Account (1:1, unique accountId)

---

## Archivos creados (5)

| Archivo                                                     | Lineas | Descripcion                                                          |
| ----------------------------------------------------------- | ------ | -------------------------------------------------------------------- |
| `apps/api/src/onboarding/onboardingRoutes.ts`               | 128    | 3 endpoints: GET progress, POST complete step, POST dismiss          |
| `apps/client/hooks/api/useOnboarding.ts`                    | 82     | Hooks: useOnboarding, useCompleteStep, useDismissOnboarding          |
| `apps/client/components/onboarding/OnboardingChecklist.tsx` | 117    | Checklist con progress bar, steps, links de accion, dismiss          |
| `apps/admin/components/dashboard/SetupBanner.tsx`           | 140    | Banner first-run con items no configurados, dismiss via localStorage |
| `apps/api/tests/unit/onboarding/onboarding.test.ts`         | 125    | 4 tests para welcome email en registration                           |

## Archivos modificados (6)

| Archivo                                                              | Cambio                                                      |
| -------------------------------------------------------------------- | ----------------------------------------------------------- |
| `infra/prisma/schema.prisma`                                         | +AccountOnboarding model, +relacion en Account              |
| `apps/api/src/application/notifications/emailTemplates.tsx`          | +welcomeEmail template (3 pasos + CTA)                      |
| `apps/api/src/application/customer-auth/RegisterCustomerUseCase.ts`  | +EmailPort, +PlatformCredentialService, +sendWelcomeEmail() |
| `apps/api/src/infrastructure/container/setupCustomerAuthUseCases.ts` | +resolver EmailPort y PlatformCredentialService             |
| `apps/api/src/index.ts`                                              | +import y registro de onboardingRoutes                      |
| `apps/client/app/dashboard/page.tsx`                                 | +OnboardingChecklist condicional                            |
| `apps/admin/app/(dashboard)/page.tsx`                                | +SetupBanner condicional                                    |

---

## Endpoints nuevos

```
GET  /api/onboarding                        — progress (crea si no existe)
POST /api/onboarding/step/:stepKey/complete  — marca step completado
POST /api/onboarding/dismiss                 — dismiss permanente
```

Auth: requireClientAuth en los tres.

---

## Detalle tecnico

### Welcome email

- Template `welcomeEmail` con BaseEmailLayout, 3 pasos, CTA "Get Started"
- Wire en `RegisterCustomerUseCase`: fire-and-forget (catch + log warn)
- Lee baseUrl y supportEmail de PlatformCredentialService.getGroup("PLATFORM")
- NUNCA bloquea registration si email falla
- Backward compatible: funciona sin EmailPort (params opcionales)

### Client OnboardingChecklist

- Progress bar visual (X/4 completados)
- 4 steps: Connect provider, Create post, Invite team, Configure billing
- Links de accion a rutas relevantes (/dashboard/channels, /posts/new, /team, /settings/billing)
- "Skip for now" y boton X → dismiss permanente via API
- Hidden cuando completedAt o dismissedAt no son null

### Admin SetupBanner

- Usa useSettingsStatus() para detectar grupos no configurados
- Muestra items: Payment gateway, Email provider, Platform details, AI providers
- Links a Settings tabs correspondientes
- Dismiss via localStorage (key: admin-setup-dismissed)
- Hidden cuando overallHealth === "healthy"

---

## Tests (4 passed)

- Envia welcome email despues de registration exitosa
- NO falla registration si email send falla
- Usa baseUrl de PLATFORM settings
- Funciona sin email port (backward compatible)

## Verificacion

- API build: 0 errores TS
- Admin build: 0 errores TS
- Client build: 0 errores TS
- Onboarding tests: 4/4 passed
- Migracion: 20260415033511_add_account_onboarding (via prisma migrate dev)
