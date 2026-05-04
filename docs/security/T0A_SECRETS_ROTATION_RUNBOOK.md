# T0-A — Secrets Rotation Runbook

> **Propósito.** Guía paso a paso para que Edward rote todos los secrets expuestos como resultado del finding L-591 (`.env` tracked en repo público).
>
> **Scope.** Este documento NO ejecuta rotación — describe CÓMO hacerla fuera del plan T0-A. La parte ejecutada en código es: untrack de `.env`, regeneración de `.env.example`, y este runbook.
>
> **Audiencia.** Edward (dueño del repo / operador).
>
> **Fecha creación.** 2026-04-21.
>
> **Criterio de éxito.** `git log --all --oneline -- .env` retorna 0 líneas + todos los servicios externos corriendo con nuevos secrets + apps redeployadas verde.

---

## §1. Contexto del incidente

### Finding origen

**L-591** — `.env` tracked en git con secrets reales. Documentado en:

- [`docs/audits/LATERAL_FINDINGS.md`](../audits/LATERAL_FINDINGS.md) entry L-591
- [`docs/audits/D0v4_8_INFRASTRUCTURE_REPORT.md`](../audits/D0v4_8_INFRASTRUCTURE_REPORT.md) §15.4 item 9 (CRITICAL)
- [`docs/audits/REMEDIATION_ROADMAP.md`](../audits/REMEDIATION_ROADMAP.md) §5.0 T0-A

### Corrección de scope (descubierta 2026-04-21 en exploración T0-A)

El finding original describió `apps/api/.env` como el archivo tracked. La realidad:

- **Root `.env`** (no `apps/api/.env`) es el archivo tracked en git.
- `apps/api/.env` nunca estuvo tracked (gitignored correctamente desde el inicio).
- L-591 se mantiene CRITICAL — solo cambia el archivo afectado.

### Exposición

- **Repo:** `https://github.com/edwardricardo/omni-post.git` — **PÚBLICO en GitHub**
- **Primer commit con `.env`:** `5603d6b` (2026-03-08)
- **Tiempo de exposición activa:** ~44 días
- **Commits afectados:** 6 (historia completa del archivo)

### Qué se considera comprometido

Todo valor presente en root `.env` durante los últimos 44 días. Verificar contra commits:

```bash
git log --all --oneline -- .env
# Para cada commit SHA, inspeccionar:
git show <SHA>:.env
```

**⚠️ Asumir comprometidos** todos los secrets documentados en §2 hasta que se rotan, aunque el diff histórico muestre cambios parciales.

---

## §2. Lista completa de secrets a rotar

Tabla agrupada por dominio. **43+ variables** entre root `.env` + `apps/api/.env`.

### §2.1 Database (PostgreSQL)

| Key                   | Servicio                                                  | Acción                                                             | Prioridad |
| --------------------- | --------------------------------------------------------- | ------------------------------------------------------------------ | --------- |
| `DATABASE_URL`        | PostgreSQL managed (Railway/Supabase/AWS RDS — confirmar) | Crear nuevo usuario DB + nueva password + update connection string | CRÍTICA   |
| `SHADOW_DATABASE_URL` | PostgreSQL managed                                        | Idem — puede reusar misma instancia con nuevo password             | ALTA      |

**Procedure:**

1. Log in al panel del DB provider.
2. Crear nuevo role/user con misma permisos (`CREATE USER new_user WITH PASSWORD '...' ;`).
3. `GRANT ALL PRIVILEGES ON DATABASE omnipostdb TO new_user;`
4. Revoke al user antiguo (o deshabilitar login): `ALTER USER old_user NOLOGIN;`
5. Construir nueva `DATABASE_URL` y `SHADOW_DATABASE_URL`.
6. Update `.env` local + deploy platform.

### §2.2 Auth / JWT

| Key                   | Servicio | Acción                 | Prioridad |
| --------------------- | -------- | ---------------------- | --------- |
| `ADMIN_JWT_SECRET`    | Interno  | `openssl rand -hex 64` | CRÍTICA   |
| `JWT_ACCESS_SECRET`   | Interno  | `openssl rand -hex 64` | CRÍTICA   |
| `JWT_REFRESH_SECRET`  | Interno  | `openssl rand -hex 64` | CRÍTICA   |
| `CUSTOMER_JWT_SECRET` | Interno  | `openssl rand -hex 64` | CRÍTICA   |

**Efecto secundario:** rotar estos secrets invalida **todas las sesiones activas**. Usuarios y admins deben re-login. Comunicar con anticipación o aceptar downtime.

**Procedure:**

```bash
for key in ADMIN_JWT_SECRET JWT_ACCESS_SECRET JWT_REFRESH_SECRET CUSTOMER_JWT_SECRET; do
  echo "$key=$(openssl rand -hex 64)"
done
# Copiar output al .env local + deploy platform
```

### §2.3 Admin bootstrap

| Key              | Servicio | Acción                                             | Prioridad |
| ---------------- | -------- | -------------------------------------------------- | --------- |
| `ADMIN_EMAIL`    | Interno  | Cambiar si email fue visible en commits públicos   | MEDIA     |
| `ADMIN_PASSWORD` | Interno  | Generar password fuerte: `openssl rand -base64 24` | CRÍTICA   |

**Nota:** L-546 (T4-V) implementará fail-fast si falta `ADMIN_PASSWORD`. Por ahora, asegurar que el valor en `.env` sea robusto.

### §2.4 AI Providers

| Key                  | Servicio         | URL rotación                                                     | Prioridad |
| -------------------- | ---------------- | ---------------------------------------------------------------- | --------- |
| `OPENAI_API_KEY`     | OpenAI           | <https://platform.openai.com/api-keys> → "Revoke" + "Create new" | CRÍTICA   |
| `PERPLEXITY_API_KEY` | Perplexity       | <https://www.perplexity.ai/settings/api> → rotate key            | CRÍTICA   |
| `GEMINI_API_KEY`     | Google AI Studio | <https://aistudio.google.com/apikey> → rotate                    | CRÍTICA   |

**Verificar:** después de revoke, monitor dashboards por 24h para detectar uso no autorizado con la key vieja.

### §2.5 Billing (Stripe)

| Key                     | Servicio | URL rotación                                                                       | Prioridad |
| ----------------------- | -------- | ---------------------------------------------------------------------------------- | --------- |
| `STRIPE_SECRET_KEY`     | Stripe   | <https://dashboard.stripe.com/apikeys> → rotate secret key                         | CRÍTICA   |
| `STRIPE_WEBHOOK_SECRET` | Stripe   | <https://dashboard.stripe.com/webhooks> → roll signing secret per webhook endpoint | CRÍTICA   |

**⚠️ Orden importante:**

1. Crear nueva secret key en Stripe (no revocar la vieja aún)
2. Update deploy platform con nueva key
3. Redeploy app (workers + api)
4. Verify health check (Stripe calls funcionando)
5. Revoke la vieja key
6. Repeat para webhook secret: update Stripe endpoint signing secret → deploy → verify → old secret rolls off automáticamente

### §2.6 Email (Resend)

| Key              | Servicio | URL rotación                                    | Prioridad |
| ---------------- | -------- | ----------------------------------------------- | --------- |
| `RESEND_API_KEY` | Resend   | <https://resend.com/api-keys> → delete + create | ALTA      |

### §2.7 URLs y config

| Key                                  | Acción                                     | Prioridad |
| ------------------------------------ | ------------------------------------------ | --------- |
| `APP_URL`, `CLIENT_URL`, `ADMIN_URL` | Sin acción salvo que el host haya cambiado | BAJA      |

### §2.8 Observability

| Key                           | Servicio       | Acción                                                | Prioridad |
| ----------------------------- | -------------- | ----------------------------------------------------- | --------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTel collector | Sin acción salvo que el endpoint sea privado expuesto | BAJA      |

### §2.9 Redis

| Key         | Servicio                             | Acción                                     | Prioridad |
| ----------- | ------------------------------------ | ------------------------------------------ | --------- |
| `REDIS_URL` | Redis managed (Upstash/Railway/etc.) | Rotate password si tiene auth; rebuild URL | ALTA      |

---

## §3. PLATFORM_ENCRYPTION_KEY — consideración especial

**Esta clave es diferente al resto.** Encripta valores en la tabla `PlatformCredential` (credentials OAuth de providers sociales de cada tenant almacenadas en DB).

### Si se rota la key

Los valores encriptados existentes **dejan de ser descifrables** con la nueva key. Consecuencias:

- Todos los canales conectados (Twitter, Instagram, Facebook, etc.) fallan al intentar publicar.
- Los tokens OAuth almacenados quedan inaccesibles.
- Usuarios deben re-conectar cada canal (re-OAuth flow).

### Opciones

**Opción A — Conservadora (recomendada por default):**

- **No rotar** `PLATFORM_ENCRYPTION_KEY` salvo evidencia específica de que esta key fue expuesta.
- Verificar en git history si esta key estuvo en root `.env`: `git log -p --all -S "PLATFORM_ENCRYPTION_KEY" .env`
- Si el grep muestra el valor en commits públicos → forzar **Opción B**.
- Si la key solo estaba en `apps/api/.env` (nunca tracked) → mantener.

**Opción B — Paranoid (si hay exposure confirmado):**

Plan de migración:

1. Generar nueva key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
2. Escribir script de migración: lee `PlatformCredential`, desencripta con key vieja, encripta con key nueva, guarda.
3. Parar workers (`publishWorker`, `analyticsIngestWorker`, `inboxSyncWorker`) durante migración.
4. Ejecutar script en DB prod (con backup hecho ANTES).
5. Swap key en `.env` + deploy.
6. Restart workers.
7. Verify: probar publicación en canal de prueba.

**Alternativa a Opción B — Forzar re-OAuth:**

- Truncate table `PlatformCredential` (o soft-delete registros).
- Notificar a tenants: "Tu canal debe reconectarse por razones de seguridad".
- Cada tenant re-autoriza cada canal → nuevos tokens se encriptan con key nueva.
- Impacto usuario mayor pero sin riesgo de data migration.

### Verificación de exposición de esta key específica

```bash
# Buscar PLATFORM_ENCRYPTION_KEY en git history
git log -p --all -S "PLATFORM_ENCRYPTION_KEY" -- .env
# Si muestra líneas con valor — exposed, Opción B
# Si muestra solo nombre de variable sin valor — no exposed, Opción A
```

---

## §4. Git history purge

**⚠️ Operación destructiva e irreversible desde el remote.** Ejecutar solo después de:

1. Todos los secrets nuevos generados y en deploy platform
2. Apps redeployadas con nuevos secrets y verificadas verde
3. Backup local del repo actual (off-site)
4. Comunicación a colaboradores (si aplica)

### Opción recomendada: git-filter-repo

```bash
# Instalar si no está
pip install git-filter-repo

# Ejecutar desde el root del repo (asegurarse de estar en rama correcta)
git filter-repo --invert-paths --path .env --force

# Esto reescribe TODA la historia — .env deja de existir en cualquier commit
```

### Alternativa: BFG Repo-Cleaner

```bash
# Más amigable pero requiere Java
wget https://repo1.maven.org/maven2/com/madgag/bfg/1.14.0/bfg-1.14.0.jar
java -jar bfg-1.14.0.jar --delete-files .env
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

### Force push al remote público

```bash
# Verify local state
git log --all --oneline -- .env   # debe retornar 0 líneas

# Force push — invalidates clones
git push --force origin --all
git push --force origin --tags
```

### Checklist pre-force-push

- [ ] Todos los secrets nuevos confirmados activos en servicios externos
- [ ] Deploy platforms (Vercel + backend) ya corriendo con nuevos secrets
- [ ] Health checks verdes en `/health` y endpoints críticos
- [ ] Webhook de Stripe confirmado recibiendo con nuevo secret
- [ ] Backup del repo actual: `git clone --bare <repo> backup-pre-purge.git` guardado off-site
- [ ] Comunicación a colaboradores (si hay) — deben re-clone después
- [ ] PR/merges en flight manejadas (cerrar/postpone antes del purge)

### Post-purge

```bash
# Verificar que el remote público ya no contiene .env
git clone https://github.com/edwardricardo/omni-post.git /tmp/verify-clone
cd /tmp/verify-clone
git log --all --oneline -- .env   # debe retornar 0 líneas
```

---

## §5. Deploy target update

### Frontend (admin + client) — Vercel

Confirmado en repo: `apps/admin/vercel.json` y `apps/client/vercel.json` existen.

**Procedure:**

1. Log in: <https://vercel.com/dashboard>
2. Seleccionar proyecto `omnipost-admin` → Settings → Environment Variables
3. Update cada variable con nuevo valor
4. Triggers: Production, Preview, Development (según aplique)
5. Save
6. Deployments → Redeploy (latest commit) → Production
7. Verify: visitar URL → pantalla de login carga → no errores console
8. Repetir para `omnipost-client`

### Backend — plataforma pendiente confirmar

**⚠️ No hay `fly.toml`, `railway.json`, `render.yaml` en el repo.**

**Edward: confirma aquí el backend platform:**

```
BACKEND_DEPLOY_PLATFORM: <COMPLETAR — Railway / Fly.io / Render / Heroku / Kubernetes / VPS / otro>
BACKEND_PROJECT_URL: <URL del dashboard>
```

### Steps genéricos por plataforma

**Railway:**

1. <https://railway.app/dashboard> → proyecto
2. Service → Variables → Update cada key
3. Service se redeploya automáticamente
4. Logs → verify no errores env missing

**Fly.io:**

```bash
fly secrets set DATABASE_URL="..." -a <app-name>
fly secrets set JWT_ACCESS_SECRET="..." -a <app-name>
# ... etc para cada key
fly deploy -a <app-name>
```

**Render:**

1. <https://dashboard.render.com> → service
2. Environment → Update each
3. Save Changes → auto redeploy

**VPS / self-hosted:**

1. SSH al server
2. Update `.env` file (con nuevos valores, CUIDADO: no commitear)
3. `pm2 reload <app>` o `systemctl restart <service>`
4. Check logs

### Verificar post-deploy

```bash
curl https://<your-api-host>/health
# Expected: {"status":"ok", ...}
```

---

## §6. Verification checklist post-rotation

### Secret hygiene

```bash
# Ningún .env tracked en git
git ls-files | grep -E "\.env$"   # → vacío

# Historia purga
git log --all --oneline -- .env   # → vacío

# .env.example sin valores reales
grep -E "=.+[a-zA-Z0-9]{20,}" .env.example apps/api/.env.example | \
  grep -v "CHANGE_ME\|localhost\|your"   # → vacío (solo matches en placeholders)
```

### Servicio funcionando

```bash
# Health check API
curl -s https://<host>/health | jq .

# Admin loads
curl -s -o /dev/null -w "%{http_code}" https://<admin-url>/login   # → 200

# Client loads
curl -s -o /dev/null -w "%{http_code}" https://<client-url>   # → 200

# Stripe webhook acepta signed requests (desde dashboard Stripe → "Send test webhook")
# → 200 en logs del backend
```

### Integridad de datos

- [ ] Login admin funciona (JWT secrets funcionales)
- [ ] Login cliente funciona
- [ ] Publicar post en canal de prueba (verifica providers API keys + PLATFORM_ENCRYPTION_KEY)
- [ ] Billing: crear suscripción de prueba (verifica Stripe keys)
- [ ] Email: trigger password reset (verifica Resend)

### Git local

```bash
git status
# Expected:
#   .env sigue en disk (gitignored)
#   .env.example committed
#   apps/api/.env.example committed
#   docs/security/T0A_SECRETS_ROTATION_RUNBOOK.md committed
```

### Observación final

Si toda la checklist pasa: **L-591 CERRADO**. Actualizar `docs/audits/LATERAL_FINDINGS.md` entry L-591 con `→ RESUELTO en T0-A (2026-04-XX)` y fecha real.

---

## §7. Cryptoperiods canónicos (NIST SP 800-57 Part 1 Rev 5)

Período de validez recomendado por NIST por clase de clave criptográfica.
**Operational target** = lo que aplicamos en este repo (suele ser más conservador que el NIST upper bound).

| Secret class                                                                                                  | NIST originator usage | NIST recipient usage | Operational target          | Rationale                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------- | --------------------- | -------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **JWT signing keys** (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CUSTOMER_JWT_SECRET`, `ADMIN_JWT_*_SECRET`) | ≤ 2 years             | ≤ 3 years            | **90 days**                 | Access tokens TTL ≤ 15min; rotation bounds blast radius if signing key compromised. Dual-key window ≥ 24h covers max access-token validity.                                            |
| **Cookie signing** (`COOKIE_SECRET`)                                                                          | ≤ 2 years             | ≤ 3 years            | **90 days**                 | Same logic as JWT. Sessions invalidate gracefully on rotation since cookie verification is stateless.                                                                                  |
| **API keys** (`STRIPE_SECRET_KEY`, `OPENAI_API_KEY`, `RESEND_API_KEY`, etc.)                                  | —                     | ≤ 2 years            | **1 year**                  | OAuth client secrets often appear in CI logs, third-party support tickets; tighter than NIST upper bound.                                                                              |
| **Encryption keys** (`PLATFORM_ENCRYPTION_KEY`, `OAUTH_ENCRYPTION_KEY`)                                       | ≤ 2 years             | indefinite           | **1 year** + key versioning | Encrypted-at-rest data must be readable across rotations; version column on every encrypted row enables zero-downtime rotation. Old key kept for decrypt-only until re-wrap completes. |
| **Database passwords** (`DATABASE_URL`, `POSTGRES_PASSWORD`)                                                  | —                     | —                    | **1 year**                  | App restart required for rotation; coordinate with DB admin for grace window if connection pooling is hot.                                                                             |
| **Service account / infrastructure** (`MINIO_ROOT_PASSWORD`, `GF_SECURITY_ADMIN_PASSWORD`)                    | —                     | —                    | **1 year**                  | Single-instance dev today; in prod migrate to IAM roles where possible to avoid static credentials entirely.                                                                           |
| **HMAC webhook signing secrets**                                                                              | ≤ 2 years             | ≤ 2 years            | **1 year**                  | Per-customer-rotated when supported by the integration provider.                                                                                                                       |

### Dual-key validity windows (zero-downtime rotation)

| Secret type      | Window length                                  | Why                                                                                                                         |
| ---------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| JWT signing keys | 24 hours                                       | Covers max access-token TTL (15 min) + max refresh-token TTL (7 days needs longer window — see below) + buffer.             |
| Refresh tokens   | 7 days                                         | Refresh-token TTL = 7 days; old key must verify until last issued refresh expires.                                          |
| Encryption KEKs  | 7 days minimum, until re-wrap script completes | Re-wrap may take hours on large datasets; old key must decrypt until every row re-encrypted with new KEK + version flipped. |
| Cookie signing   | 7 days                                         | Cookie max-age + buffer.                                                                                                    |
| API keys         | N/A                                            | Hard cutover; provider rotation is atomic.                                                                                  |

### Schedule template

Recommended cadence for ops team to track in calendar:

- **Quarterly (every 90 days)**: rotate JWT signing keys + cookie secret. Use dual-key window.
- **Annually (every 12 months)**: rotate API keys, DB password, encryption KEKs (with re-wrap window).
- **On security incident**: immediately rotate every secret in the affected blast radius regardless of cadence.
- **On personnel change**: rotate any credential that the departing engineer had access to (DB passwords, OAuth client secrets they configured).

NIST source: <https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final> (Recommendation for Key Management, Part 1: General).

---

## §8. Password hashing canon (Argon2id)

Argon2id is the canonical algorithm for password / API-key / backup-code
hashing. Centralised helper: `apps/api/src/auth/passwordHashing.ts`
(`hashPassword` / `verifyPassword` / `needsRehash`). Direct `argon2.hash` /
`argon2.verify` calls outside this module are blocked by fitness check #18.

Parameters (`ARGON2_PARAMS`):

| Parameter     | Value          | OWASP min      | RFC 9106 (2nd) | Rationale                                                                                                                                                                                                                                                                                                         |
| ------------- | -------------- | -------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`        | `argon2id`     | `argon2id`     | `argon2id`     | Resists side-channel (argon2i) + GPU/ASIC (argon2d) attacks.                                                                                                                                                                                                                                                      |
| `memoryCost`  | 65536 (64 MiB) | 19456 (19 MiB) | 65536 (64 MiB) | RFC second-recommended; ASIC-resistant; ~250ms on a typical login server.                                                                                                                                                                                                                                         |
| `timeCost`    | 3              | 2              | 3              | RFC second-recommended; matches login UX (~240ms).                                                                                                                                                                                                                                                                |
| `parallelism` | 4              | 1              | 4              | RFC 9106 endorses `p=4` (lanes). OWASP later tightened to `p=1` because most libs serialise lanes; we follow RFC because (a) `node-argon2` lib defaults match RFC exactly so explicit params and lib defaults stay aligned, (b) the cost difference is negligible on server-side single-user-per-request hashing. |
| `hashLength`  | 32             | 32             | 32             | 256-bit output.                                                                                                                                                                                                                                                                                                   |

**Transparent rehash on login.** When `ARGON2_PARAMS` is bumped (server-side
cost increase, e.g. CPU upgrade allows higher `memoryCost`), `needsRehash`
returns `true` for any existing hash that uses the previous params. The
login flow (`authServiceCore.authenticate` for admin, `LoginCustomerUseCase`
for customer) re-hashes silently while the plaintext is still on the stack,
then writes the new hash back. Users never see a forced password reset.

**Sources**:

- OWASP 2025: <https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html>
- RFC 9106 (IETF Argon2 spec): <https://datatracker.ietf.org/doc/html/rfc9106>
- node-argon2 library defaults: <https://github.com/ranisalt/node-argon2>

---

## §9. Decryption audit trail

Every call to `EncryptionService.decrypt()` (and the parallel
`enhancedOAuthProvider.decryptToken()`) emits an audit event via
`AuditService.logCredentialDecrypt()`. The row is persisted to the
`AuditLog` table with `action="CREDENTIAL_DECRYPTED"` and the following
shape:

```json
{
  "action": "CREDENTIAL_DECRYPTED",
  "resource": "<fieldName, e.g. Channel.credentials>",
  "resourceId": "<recordId, e.g. ch-123>",
  "userId": "<from request auth tier, when in request scope>",
  "ipAddress": "<from request, when in request scope>",
  "userAgent": "<from request, when in request scope>",
  "success": true,
  "details": {
    "fieldName": "<same as resource>",
    "caller": "<service.method, optional>",
    "correlationId": "<req.id from Fastify>"
  }
}
```

The plaintext NEVER appears in the audit row (OWASP ASVS V16.2.5).

### Encryption context (KMS canon — AAD binding)

`EncryptionService.encrypt()` and `.decrypt()` REQUIRE an
`EncryptionContext { fieldName, recordId, caller? }`. The
`(fieldName, recordId)` pair is bound as **AAD** (Additional Authenticated
Data) in AES-GCM via `cipher.setAAD(canonicaliseContext(ctx))`. This
provides two independent guarantees:

1. **Tamper-resistance** — a ciphertext stored as
   `Channel.credentials/<id>` cannot be replayed as
   `OidcConfiguration.clientSecret/<id>` (or any other field/record). The
   auth tag is computed over the canonicalised context bytes, so a
   mismatch fails the decrypt loud (no silent data swap).
2. **Audit categorisation** — the same context flows into the AuditLog
   row, enabling per-field / per-record queries.

Mirrors AWS KMS's `EncryptionContext` parameter pattern. The `caller`
field is audit metadata only; it is NOT included in the AAD bytes so
that refactoring caller names doesn't invalidate stored ciphertexts.

### Request-scoped enrichment (AsyncLocalStorage)

`apps/api/src/security/decryptAuditContext.ts` exposes a request-scoped
`AsyncLocalStorage<RequestAuditContext>` that holds `userId`, `ipAddress`,
`userAgent`, `correlationId`. The Fastify `onRequest` hook (in
`apps/api/src/index.ts`) populates it from the request; auth middleware
fills in `userId` post-authentication via `setAuthenticatedUserId()`.
Workers / cron / background jobs run outside any request scope —
their audit rows carry only `fieldName/recordId/caller`, which is the
honest representation of "system-initiated decrypt".

### Compliance mapping

- **OWASP ASVS V16.3.2** (L3): "logging when sensitive data is accessed
  (without logging the sensitive data itself)".
- **OWASP ASVS V16.2.5** (L2): credentials must not be logged in plain.
- **AWS KMS EncryptionContext** (industry canon): caller-supplied,
  non-secret, AAD-bound + audit-logged.
- **SOC 2 CC6.1, ISO 27001 A.12.4.1**: every access to sensitive data
  must be auditable. By emitting at the decryption boundary rather than
  at the read site, we capture access regardless of which code path
  triggered it.

---

## §10. Re-encryption procedure (when AAD changes)

The encryption context bytes are bound to the auth tag at encrypt time.
Any change to the canonicalisation (currently `${fieldName}\x1f${recordId}`)
or to a row's `fieldName` / `recordId` invalidates that row's auth tag —
decrypt will fail.

When this happens (rare — only via deliberate refactor):

1. **Identify affected rows**: `SELECT * FROM "<Table>" WHERE
"<KeyVersionColumn>" = <oldVersion>` (re-encryption is implicit on
   write — every save() rotates to the active key version).
2. **Re-encrypt with the new context**: load the row, decrypt with the
   OLD context, encrypt with the NEW context, persist.
3. **Verification**: assert `decrypt(row) === plaintext` for a sample.

For dev / test environments: the simplest path is `TRUNCATE <Table>
CASCADE` followed by `pnpm db:seed`. The seed already binds the correct
AAD per row.

For production with non-trivial data: write a one-off backfill script
(`apps/api/scripts/reencryptChannelCredentials.ts` etc.) that reads each
row, decrypts with the legacy context, re-encrypts with the new context,
and writes back. Run inside a single transaction per row to bound rollback
scope. Audit emission is suppressed for backfills via a dedicated
`caller="backfill"` value so the AuditLog is not flooded.

---

## Anexo A — Contacto emergencia

Si durante la rotación algo falla catastróficamente (DB inaccesible, servicio prod caído):

1. **No hacer force-push** hasta que la situación esté estable.
2. Rollback al deploy anterior (Vercel: previous deployment; backend: deploy previous commit).
3. Diagnosticar con logs antes de continuar.

## Anexo B — Cross-references

- [`docs/audits/REMEDIATION_ROADMAP.md`](../audits/REMEDIATION_ROADMAP.md) §5.0 — batch T0-A
- [`docs/audits/REMEDIATION_ROADMAP.md`](../audits/REMEDIATION_ROADMAP.md) §5.4 T4-V — RBAC + seeds split (incluye fix ADMIN_PASSWORD weak L-546)
- [`docs/audits/REMEDIATION_ROADMAP.md`](../audits/REMEDIATION_ROADMAP.md) §5.2 T2-F — CI workflows urgentes (incluye L-623 password123 en workflows)
- [`docs/audits/LATERAL_FINDINGS.md`](../audits/LATERAL_FINDINGS.md) L-591, L-586, L-583, L-584
- CLAUDE.md — "Automated Compliance Checks" (fitness functions pendientes wire en T4-P)
