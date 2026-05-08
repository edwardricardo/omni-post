#!/usr/bin/env bash
#
# env-restore.sh — Decrypt a backup blob into root `.env`.
#
# Usage: ./scripts/env-restore.sh [backup_file]
#        pnpm env:restore
#
# If no backup file is provided, the script uses the `env.bak.latest.gpg` symlink
# created by env-backup.sh.
#
# The script REFUSES to overwrite an existing `.env` unless --force is passed.
# This protects against accidental restore of stale creds over a working setup.
#
# Reference: docs/development/ENV_BACKUP.md

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"
BACKUP_DIR="${HOME}/.config/omnipost"
DEFAULT_BACKUP="${BACKUP_DIR}/env.bak.latest.gpg"

FORCE=0
BACKUP_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force) FORCE=1; shift ;;
    -h|--help)
      echo "Usage: $0 [--force] [backup_file]"
      echo ""
      echo "Decrypt a backup blob into root .env."
      echo "If [backup_file] is omitted, uses ${DEFAULT_BACKUP}."
      echo "--force allows overwriting an existing .env."
      exit 0
      ;;
    *) BACKUP_FILE="$1"; shift ;;
  esac
done

BACKUP_FILE="${BACKUP_FILE:-${DEFAULT_BACKUP}}"

if ! command -v gpg >/dev/null 2>&1; then
  echo "ERROR: gpg not found in PATH. Install it (e.g. apt install gnupg) and retry." >&2
  exit 1
fi

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "ERROR: backup file not found: ${BACKUP_FILE}" >&2
  echo "Available backups in ${BACKUP_DIR}:" >&2
  ls -lh "${BACKUP_DIR}/" 2>/dev/null | grep "env.bak\." | head -10 >&2 || echo "  (none)" >&2
  exit 1
fi

if [[ -f "${ENV_FILE}" && "${FORCE}" -ne 1 ]]; then
  echo "ERROR: ${ENV_FILE} already exists. Use --force to overwrite." >&2
  echo "       Or move the existing .env aside first: mv .env .env.before-restore" >&2
  exit 1
fi

echo ">> Decrypting ${BACKUP_FILE} into ${ENV_FILE} (you will be prompted for the passphrase)"
gpg --decrypt --output "${ENV_FILE}.tmp" "${BACKUP_FILE}"

# Verify checksum if matching .sha256 file exists
CHECKSUM_FILE="${BACKUP_FILE%.gpg}.sha256"
if [[ -f "${CHECKSUM_FILE}" ]]; then
  EXPECTED="$(cat "${CHECKSUM_FILE}")"
  ACTUAL="$(sha256sum "${ENV_FILE}.tmp" | awk '{print $1}')"
  if [[ "${EXPECTED}" != "${ACTUAL}" ]]; then
    rm -f "${ENV_FILE}.tmp"
    echo "ERROR: checksum mismatch — backup may be corrupted." >&2
    echo "  expected: ${EXPECTED}" >&2
    echo "  actual:   ${ACTUAL}" >&2
    exit 1
  fi
  echo ">> Checksum verified: ${ACTUAL}"
fi

mv "${ENV_FILE}.tmp" "${ENV_FILE}"
chmod 600 "${ENV_FILE}"

echo ""
echo "Restore complete:"
echo "  ${ENV_FILE} ($(wc -l < "${ENV_FILE}") lines, $(wc -c < "${ENV_FILE}") bytes)"
echo ""
echo "Next steps:"
echo "  1. Verify required vars: grep -cE '^(JWT_|PLATFORM_|OAUTH_|POSTGRES_PASSWORD)=.' .env"
echo "  2. If service passwords (POSTGRES, MINIO) differ from running containers,"
echo "     restart containers: docker compose down && pnpm db:up"
echo "  3. Restart dev: pnpm dev"
