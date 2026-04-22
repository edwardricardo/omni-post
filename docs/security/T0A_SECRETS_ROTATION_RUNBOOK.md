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
