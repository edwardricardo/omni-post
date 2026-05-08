#!/usr/bin/env bash
#
# env-backup.sh — Encrypt root `.env` to a local backup using GPG symmetric encryption.
#
# Usage: ./scripts/env-backup.sh
#        pnpm env:backup
#
# Output: ~/.config/omnipost/env.bak.<timestamp>.gpg
#         ~/.config/omnipost/env.bak.<timestamp>.sha256
#
# The script does NOT version the backup in git. The encrypted blob lives only on
# the local machine. For redundancy, copy the resulting file to a secret manager
# (1Password, Bitwarden, pass) or external encrypted storage.
#
# Reference: docs/development/ENV_BACKUP.md

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"
BACKUP_DIR="${HOME}/.config/omnipost"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: ${ENV_FILE} does not exist. Cannot back up." >&2
  exit 1
fi

if ! command -v gpg >/dev/null 2>&1; then
  echo "ERROR: gpg not found in PATH. Install it (e.g. apt install gnupg) and retry." >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="${BACKUP_DIR}/env.bak.${TIMESTAMP}.gpg"
CHECKSUM_FILE="${BACKUP_DIR}/env.bak.${TIMESTAMP}.sha256"

echo ">> Encrypting ${ENV_FILE} (you will be prompted for a passphrase)"
gpg --symmetric --cipher-algo AES256 --output "${OUT_FILE}" "${ENV_FILE}"
chmod 600 "${OUT_FILE}"

sha256sum "${ENV_FILE}" | awk '{print $1}' > "${CHECKSUM_FILE}"
chmod 600 "${CHECKSUM_FILE}"

# Maintain a stable "latest" symlink for env-restore.sh convenience.
ln -sfn "${OUT_FILE}" "${BACKUP_DIR}/env.bak.latest.gpg"
ln -sfn "${CHECKSUM_FILE}" "${BACKUP_DIR}/env.bak.latest.sha256"

echo ""
echo "Backup created:"
echo "  encrypted:  ${OUT_FILE}"
echo "  checksum:   ${CHECKSUM_FILE}"
echo "  latest -> ${OUT_FILE}"
echo ""
echo "REMINDERS:"
echo "  1. Save the passphrase you used in your secret manager (1Password / Bitwarden / pass)."
echo "     Without it, this backup is unrecoverable."
echo "  2. Optionally copy ${OUT_FILE} to off-machine storage for disaster-recovery redundancy."
echo "  3. Pruning: backups accumulate. Old ones can be removed manually after the next clean run is verified."
