# OmniPost Account Model Completeness Audit

Date: 2026-03-29

---

## Account Model Completeness

| Aspect                 | Status   | Evidence                                                                                                                                                                    |
| ---------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant identity fields | COMPLETE | email, name, createdAt, updatedAt, deletedAt                                                                                                                                |
| Subscription/billing   | COMPLETE | subscription (BASIC/PRO/ENTERPRISE), isOnTrial, trialStartDate/EndDate, billingCycle, stripeCustomerId, stripeSubscriptionId, autoRenewal, lastBillingDate, nextBillingDate |
| Resource limits        | PARTIAL  | maxProjects ✅, TIER_LIMITS in domain entity (maxChannelsPerProject, maxPostsPerDay) ✅. Falta: maxTeamMembers, maxStorage                                                  |
| Owner user reference   | MISSING  | NO hay relación Account → User. AdminUser NO tiene accountId. TeamMember tiene accountId pero NO tiene passwordHash                                                         |

---

## Q1: Tenant Identity Fields

| Field                    | Present?   | Evidence                                                                                                                               |
| ------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| name / company name      | ✅         | `name String` en Prisma schema                                                                                                         |
| subdomain or unique slug | ❌         | No existe — necesario para URLs tipo `acme.omnipost.app`                                                                               |
| plan / tier              | ✅         | `subscription SubscriptionTier` (BASIC/PRO/ENTERPRISE)                                                                                 |
| billing status           | ✅         | `isOnTrial Boolean`, tier activo implica paid                                                                                          |
| trial end date           | ✅         | `trialEndDate DateTime?`                                                                                                               |
| created date             | ✅         | `createdAt DateTime`                                                                                                                   |
| owner contact email      | ✅         | `email String @unique`                                                                                                                 |
| owner contact phone      | ❌         | No existe                                                                                                                              |
| timezone                 | ❌         | No existe en Account (AdminUser sí lo tiene)                                                                                           |
| locale/language          | ❌         | No existe en Account (AdminUser sí lo tiene)                                                                                           |
| logo / branding          | ❌ parcial | BrandKit es modelo separado con `logoUrl`, no campo directo en Account                                                                 |
| feature flags / limits   | ✅ parcial | `maxProjects Int`, domain entity tiene `TIER_LIMITS` con maxChannelsPerProject y maxPostsPerDay. Falta maxTeamMembers, maxStorageBytes |

---

## Q2: Account Connected to Owner User

**NO.** Account y AdminUser son tablas completamente independientes.

- `AdminUser` NO tiene campo `accountId` — no apunta a ningún Account
- `Account` NO tiene campo `ownerId` o `adminUserId` — no apunta a ningún user
- `TeamMember` SÍ tiene `accountId` + `email` + `name` + `role` (OWNER/MANAGER/MEMBER/VIEWER) — pero NO tiene `passwordHash`, no puede autenticarse

**Conexión actual:** Si un "cliente" se logea, lo hace como `AdminUser` via `POST /auth/login`. No hay forma técnica de conectar ese login a un Account específico. El `accountId` llega al request solo si se pasa explícitamente en el body/query — no se deriva del token JWT.

---

## Q3: Subscription/Billing Data

**COMPLETO para MVP.**

| Campo              | Presente | Detalle                                                                  |
| ------------------ | -------- | ------------------------------------------------------------------------ |
| Plan name / tier   | ✅       | `subscription SubscriptionTier` (BASIC/PRO/ENTERPRISE)                   |
| Billing cycle      | ✅       | `billingCycle String` ("monthly" / "yearly")                             |
| Trial management   | ✅       | `isOnTrial`, `trialStartDate`, `trialEndDate`                            |
| Auto renewal       | ✅       | `autoRenewal Boolean`                                                    |
| Stripe integration | ✅       | `stripeCustomerId String?`, `stripeSubscriptionId String?`               |
| Billing dates      | ✅       | `lastBillingDate DateTime?`, `nextBillingDate DateTime?`                 |
| Price per plan     | ❌       | No existe tabla de Plan/Pricing — tiers están hardcoded en domain entity |

Domain entity (`Account.ts`) tiene métodos reales:

- `upgradeTo(tier)` — con validación de tier ordering
- `downgradeTo(tier)` — con validación de project count vs new limits
- `convertToPaid(stripeCustomerId, stripeSubscriptionId)`
- `extendTrial(additionalDays)`
- `isTrialExpired`, `trialDaysRemaining`, `isActive` (computed getters)

---

## Q4: Account Creation Flow

**Tres flujos desconectados:**

1. **`POST /accounts`** (accountRoutes.ts) — crea un Account directamente con Prisma. Requiere `authenticateMiddleware`. NO crea usuario. NO crea TeamMember. El Account queda huérfano (nadie puede logearse "como" ese account).

2. **`POST /admin/accounts`** (accountLifecycleRoutes.ts) — crea un `AdminUser` (staff de plataforma), NO un Account. Requiere `requireAdmin` middleware.

3. **`POST /auth/register`** (authRoutes.ts) — crea un `AdminUser` con `registerAdmin(email, password, name, role)`. NO crea un Account. NO crea un TeamMember.

**Conclusión:** No existe un flujo de "self-service signup" que cree un Account + un User que pueda logear en ese Account. Los tres flujos crean entidades independientes que no se conectan entre sí.

---

## Q5: Resource Limits

| Límite                   | Presente   | Dónde                                                                        |
| ------------------------ | ---------- | ---------------------------------------------------------------------------- |
| Max projects             | ✅         | `maxProjects Int` en Prisma + `TIER_LIMITS` en domain entity                 |
| Max channels per project | ✅         | Domain entity `TIER_LIMITS`: BASIC=3, PRO=10, ENTERPRISE=unlimited           |
| Max posts per day        | ✅         | Domain entity `TIER_LIMITS`: BASIC=10, PRO=100, ENTERPRISE=unlimited         |
| Max team members         | ❌         | No existe — cualquier plan puede tener infinitos TeamMembers                 |
| Max storage (media)      | ❌         | No existe — no hay tracking de storage usado por account                     |
| Max API keys             | ✅ parcial | IntegrationApiKey limita a 5 activas por account (en use case, no en schema) |
| Max recurring posts      | ❌         | No existe                                                                    |

---

## Q6: What's Missing for Complete Tenant Model

### Campos faltantes en Account

| Campo                             | Propósito                                    | Prioridad |
| --------------------------------- | -------------------------------------------- | --------- |
| `slug String? @unique`            | URLs tipo `acme.omnipost.app`                | MEDIUM    |
| `timezone String @default("UTC")` | Scheduling y reports en timezone del cliente | HIGH      |
| `locale String @default("en")`    | Idioma de la interfaz del cliente            | MEDIUM    |
| `phone String?`                   | Contacto del owner                           | LOW       |
| `maxTeamMembers Int`              | Límite de miembros por tier                  | HIGH      |
| `maxStorageBytes BigInt`          | Límite de almacenamiento                     | MEDIUM    |
| `maxRecurringPosts Int`           | Límite de posts recurrentes                  | LOW       |

### Relación faltante: Account ↔ User que puede autenticarse

**Opción A — Extender TeamMember (recomendada):**

TeamMember ya tiene `accountId`, `email`, `name`, `role` (OWNER/MANAGER/MEMBER/VIEWER). Agregar:

- `passwordHash String?` — null para miembros invitados que aún no activaron
- `lastLoginAt DateTime?`
- `mfaEnabled Boolean @default(false)`
- `mfaSecret String?`
- `isEmailVerified Boolean @default(false)`

Ventaja: no se crea tabla nueva, TeamMember pasa de "contacto" a "usuario autenticable".

**Opción B — Crear tabla CustomerUser:**

Nueva tabla con `accountId`, `teamMemberId?`, `email`, `passwordHash`, `role`, `isActive`. FK a Account y opcionalmente a TeamMember.

Ventaja: separación limpia de concerns (TeamMember = rol en el equipo, CustomerUser = credenciales).

---

## Ready for CustomerUser Auth

**NO.**

### Gaps a cerrar:

1. **Account no tiene "dueño"** — necesita al menos un TeamMember con role OWNER + passwordHash, o un CustomerUser nuevo
2. **No hay flujo de signup que conecte Account + User** — el registro actual crea AdminUser, no Account
3. **JWT no incluye accountId obligatoriamente** — el token de AdminUser no tiene accountId porque AdminUser no pertenece a un Account
4. **Middleware no enforce accountId scope** — `authenticateMiddleware` no requiere que el request tenga accountId
5. **TeamMember no puede autenticarse** — no tiene passwordHash

### Estimado de esfuerzo

- Si se extiende TeamMember con auth fields: **S** (1 migration + auth endpoint + middleware)
- Si se crea CustomerUser tabla nueva: **M** (nuevo modelo + migration + auth service + DI + middleware + tests)
