# `.env` Backup & Restore Runbook

> **Why this exists**: On 2026-05-08 the root `.env` file was discovered missing on the local development machine. Only long-running node processes (started days earlier) still had the env values in JS memory; any restart of the API/workers would have made the project unbootable. The full recovery cost: wipe DB, regenerate 12 secrets, re-register 8 OAuth provider apps. This runbook prevents recurrence.

## Scope

This runbook covers the **local development `.env` file** at the repo root (`/home/edward/projects/omni-post/.env`). It does NOT cover production secrets — those follow `docs/security/SECRETS.md` and `docs/security/T0A_SECRETS_ROTATION_RUNBOOK.md`.

## Risk model

The `.env` file contains:

- **6 auth secrets** (JWT × 5, cookie × 1) — losing them invalidates all sessions
- **2 encryption keys** (`PLATFORM_ENCRYPTION_KEY`, `OAUTH_ENCRYPTION_KEY`) — losing them makes encrypted-at-rest data (channel OAuth tokens, OIDC client secrets, hashed admin sessions) **permanently unreadable**
- **4 service passwords** (Postgres, MinIO, Grafana, admin seed) — losing them locks out infra
- **24 provider OAuth credentials** (8 providers × 3 fields) — losing them requires re-registering apps in each provider's developer console

`.env` is git-ignored by design (`feedback_no_defer_in_dev`, CWE-798 mitigation). It must NEVER be committed. Backups are kept locally + optionally in a secret manager.

## Backup procedure

Three options ranked by safety:

### 1. Recommended: encrypted local backup via `gpg` (automated)

```bash
pnpm env:backup
```

This invokes `scripts/env-backup.sh`, which:

- Encrypts `.env` with AES256 symmetric (passphrase you choose)
- Writes to `~/.config/omnipost/env.bak.<timestamp>.gpg`
- Stores SHA-256 checksum alongside for integrity verification on restore
- Updates `~/.config/omnipost/env.bak.latest.gpg` symlink
- Prints reminders to save the passphrase off-machine

**Save the passphrase in 1Password / Bitwarden / pass under entry name `omni-post:env`.** Without the passphrase the backup is useless.

### 2. Alternative: manual export to a secret manager

For paranoid scenarios where local-disk backups are insufficient:

- 1Password: create a new "Secure Note" with the entire `.env` content + tag `omni-post:env`
- Bitwarden: same pattern
- `pass` (Linux password store): `pass insert -m omni-post/env < .env`
- Restic / Borg / Duplicity over the encrypted local backup for off-machine redundancy

### 3. Minimum: encrypted local copy

If neither tool above is available, at minimum:

```bash
gpg --symmetric --cipher-algo AES256 --output ~/.config/omnipost/env.bak.gpg .env
```

This is functionally identical to option 1 but without the wrapper script's safety features (timestamp, checksum, symlink, restore verification).

## Restore procedure

```bash
pnpm env:restore
```

This invokes `scripts/env-restore.sh`, which:

1. Reads from `~/.config/omnipost/env.bak.latest.gpg` (or a path you pass as arg)
2. Prompts for the passphrase
3. Decrypts to a temporary file
4. Verifies SHA-256 checksum if available
5. Moves the verified content to `.env` with `chmod 600`
6. **Refuses to overwrite an existing `.env`** unless `--force` is passed (prevents accidental clobber)

After restore:

```bash
# 1. Verify required vars are present
grep -cE '^(JWT_|PLATFORM_|OAUTH_|POSTGRES_PASSWORD)=.' .env  # → ≥9

# 2. If POSTGRES_PASSWORD or MINIO_ROOT_PASSWORD differ from running containers,
#    you'll get auth failures. Resolution:
docker compose down && pnpm db:up

# 3. Restart dev environment
pnpm dev
```

## Rotation cadence

For local dev, rotate when:

- A secret has been exposed (committed accidentally, leaked in logs, shared in chat)
- Using a stale machine after >6 months
- Joining/leaving a team member with `.env` access

For production rotation see `docs/security/T0A_SECRETS_ROTATION_RUNBOOK.md` (canon).

## Reconstruction (no backup available)

If a backup is unavailable, see `docs/development/getting-started.md` Phase 0 for the full `.env.example` → `.env` reconstruction flow:

1. Generate 12 secrets via `openssl rand` per `.env.example` markers
2. `docker compose down -v` (wipes DB + all volumes)
3. `pnpm db:up && pnpm db:migrate dev && pnpm db:seed`
4. Re-register each provider OAuth app in its developer console
5. `pnpm dev` boot smoke

This is what was executed on 2026-05-08. **The reconstruction wipes all DB data**.

## Verification

After backup or restore, verify integrity:

```bash
# Backup integrity (compares decrypted output against original)
gpg --decrypt ~/.config/omnipost/env.bak.latest.gpg | diff - .env
# (no output expected = identical)

# Required vars present
test "$(grep -cE '^(JWT_|PLATFORM_|OAUTH_|POSTGRES_PASSWORD)=.' .env)" -ge 9 \
  && echo "OK" || echo "MISSING REQUIRED VARS"

# Boot smoke
pnpm dev:api &
sleep 15
curl -s http://localhost:3000/health | grep -q '"status":"healthy"' \
  && echo "API healthy" || echo "API UNHEALTHY"
```

## File locations

| Path                                            | Purpose                                |
| ----------------------------------------------- | -------------------------------------- |
| `/.env`                                         | Active env (git-ignored)               |
| `/.env.example`                                 | Template (committed)                   |
| `~/.config/omnipost/env.bak.<ts>.gpg`           | Timestamped backup                     |
| `~/.config/omnipost/env.bak.<ts>.sha256`        | Integrity checksum                     |
| `~/.config/omnipost/env.bak.latest.gpg`         | Symlink to most recent backup          |
| `scripts/env-backup.sh`                         | Automation: backup                     |
| `scripts/env-restore.sh`                        | Automation: restore                    |
| `docs/security/SECRETS.md`                      | Production secret catalogue (canon)    |
| `docs/security/T0A_SECRETS_ROTATION_RUNBOOK.md` | Production rotation procedures (canon) |

## Related canon

- `feedback_no_defer_in_dev` — pre-prod aggressive: fix root cause, not patches
- `feedback_verify_canon_for_literal_parameters` — JWT/CSP/cookie literals require canon-verified parameters
- `docs/architecture/secrets-and-env.md` — threat model + Zod boot-time validation pattern
- `apps/api/src/config/env.ts` — Zod schema validating 48+ env vars at boot
