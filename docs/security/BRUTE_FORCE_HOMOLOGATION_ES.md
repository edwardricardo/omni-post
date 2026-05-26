# Homologación de Brute-Force Protection (admin + customer) — workstream BF-HOMOLOG

> **Estado:** diseño capturado (NO implementado). Surgió durante B2 del maratón prisma→DI (#21) al auditar el
> consumidor huérfano `auth/bruteForceProtection.ts`. Ejecutar al cerrar el maratón o cuando se priorice.
> Backlog: SMELL-35. Canon: ver `canon_research_index.md` (OWASP Auth Cheat Sheet + NIST SP 800-63B-4).

## Problema

Existen **tres enfoques divergentes** de protección contra fuerza bruta / credential stuffing, ninguno completo,
y el de customer es el más débil:

|                                           | Keying             | Throttle/delay   | Lockout (auto-expiry)       | IP                 | CAPTCHA                 | Anomaly               | Persistencia                            | Cableado                        |
| ----------------------------------------- | ------------------ | ---------------- | --------------------------- | ------------------ | ----------------------- | --------------------- | --------------------------------------- | ------------------------------- |
| `admin/auth/BruteForceProtection.ts`      | per-userId         | ✗                | ✓ (`adminUser.lockedUntil`) | ✗                  | señaliza (threat≥60/80) | ✗                     | Prisma (`adminLoginAttempt` + columnas) | **SÍ** (AdminAuthService.login) |
| `auth/bruteForceProtection.ts` (huérfano) | per-email **+ IP** | ✓ exp. (1s→300s) | ✓ (Redis, 30min)            | ✓ block (50→60min) | ✓ (≥3)                  | ✓ (rapid/distributed) | Redis (efímero)                         | **NO** (nunca cableado)         |
| Customer (`LoginCustomerUseCase`)         | —                  | ✗                | ✗                           | ✗                  | ✗                       | ✗                     | —                                       | rate-limit de ruta 5/15min      |

**Gap de seguridad:** customer login solo tiene rate-limit de ruta (5/15min) — sin lockout de cuenta, sin
protección a emails inexistentes, sin anomaly. Un atacante rotando IPs contra una cuenta evade el límite por-IP.

## Canon (investigado 2026-05-24)

- **NIST SP 800-63B-4** (SHALL): el verificador DEBE implementar rate-limiting que limite los intentos fallidos
  por cuenta. Prefiere **throttling** sobre lockout duro (umbral alto ~100 + delays progresivos + IP throttle +
  CAPTCHA), para no facilitar DoS.
- **OWASP Authentication Cheat Sheet** (clave):
  - El contador de fallos se asocia a la **CUENTA, no a la IP** ("to prevent an attacker from making login
    attempts from a large number of different IP addresses"). IP solo como throttle **supletorio** (ojo NAT/IP
    compartida; los atacantes rotan IPs).
  - Lockout con **auto-expiry** o **duración exponencial** (1s doblando), consciente de **DoS** (atacar la cuenta
    de otro no debe bloquearla indefinidamente; permitir **forgot-password** aun bloqueado).
  - **CAPTCHA** tras unos pocos fallos (no desde el primero); defense-in-depth, no preventivo.
  - **MFA** = la defensa más fuerte (99.9% per Microsoft); implementar donde se pueda.

### Veredicto de alineación

- **Huérfano**: el más canon-completo. Ajustes pendientes: (a) el _lockout por IP_ (umbral 50→block) debe ser
  solo throttle supletorio, no un lockout equivalente al de cuenta; (b) falta bypass de forgot-password; (c)
  `redis.keys()` O(N) en `getProtectionStats`/`detectSuspiciousActivity` (perf a escala); (d) Redis-only
  (lockout efímero) y fail-open ante error de Redis (decisión consciente vs DoS).
- **Admin**: account-based ✓ + durable ✓, pero sin delay progresivo, sin throttle a emails inexistentes
  (per-userId → solo cuentas existentes; permite enumeración + no cubre el "spray" de emails), sin anomaly.
- **Customer**: por debajo del canon account-based.

## Diseño objetivo (a implementar)

Un **único servicio canon** detrás de un `BruteForceProtectionPort` (packages/ports o domain), inyectado en
**AdminAuthService.login** y **LoginCustomerUseCase** (composition root) — el huérfano es la base.

Superficie del port (canon): `checkLoginAttempt(identifier, ip, ua)` → `{allowed, delaySeconds, captchaRequired,
lockoutExpiresAt?}`; `recordFailedAttempt(...)`; `recordSuccessfulAttempt(...)`; `unlock(identifier, byAdminId)`;
`getStats()`.

Ajustes canon sobre el huérfano:

1. Lockout/throttle **primario por cuenta** (email/identifier); IP solo como throttle supletorio (umbral alto).
2. Lockout exponencial o auto-expiry consciente de DoS; bypass de forgot-password.
3. CAPTCHA tras N (ya lo hace, umbral 3).
4. Eliminar `redis.keys()` O(N) (usar índices/contadores).
5. Decidir fail-open vs fail-closed ante caída de Redis (documentar la elección).
6. Audit vía `AuditService` inyectado (ya DI-ready tras B2).

Reconciliación de persistencia:

- **Admin**: conserva su analítica durable (`adminLoginAttempt` + columnas `adminUser.lockedUntil/...`). El
  servicio unificado escribe throttle en Redis + analítica en DB (o vía audit). No perder el dashboard admin.
- **Customer**: decidir si el lockout necesita persistencia durable (columnas en `CustomerUser`/`Account`) o
  Redis basta.

Otros:

- Wiring: resolver el port desde DI en ambos logins; pasar `ip`/`userAgent` desde la request.
- **MFA para customer**: hoy customer no tiene MFA (admin sí, vía `MfaService`). Evaluar como tarea aparte
  (MFA es la defensa #1 del canon).
- Tests: contract test del port + integration de ambos logins (lockout, delay, captcha-signal, unlock) +
  appsec review (DoS, enumeración, NAT).

## Resultado esperado

Un solo enfoque canon-alineado para admin y customer; cierra el gap de seguridad de customer-auth; elimina la
divergencia de tres implementaciones.
