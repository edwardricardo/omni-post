#!/usr/bin/env bash
# Stop hook (v3)

set -euo pipefail
HOOK_NAME="stop"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

require_jq
read_input

# Anti-loop
STOP_HOOK_ACTIVE=$(get_field '.stop_hook_active')
if [[ "$STOP_HOOK_ACTIVE" == "true" ]]; then
  log "stop_hook_active=true, allowing to prevent loop"
  allow "loop prevention"
fi

if [[ "${CLAUDE_BATCH_BYPASS:-no}" == "yes" ]]; then
  allow "bypass mode, no closeout required"
fi

if ! plan_is_active; then
  allow "no active batch, nothing to closeout"
fi

CLOSEOUT="$REPO_ROOT/.claude/current-batch-closeout.yml"
BACKLOG="$REPO_ROOT/POST_REMEDIATION_BACKLOG.md"

if [[ ! -f "$CLOSEOUT" ]]; then
  block "Op-2: falta .claude/current-batch-closeout.yml. Producilo antes de cerrar — incluye rules_attestation, gaps_diferidos, backlog_audited."
fi

if [[ -n "$(find "$CLOSEOUT" -mmin +10 2>/dev/null)" ]]; then
  block "Closeout existe pero está obsoleto (>10 min). Refrescalo con el estado real del batch."
fi

REQUIRED_KEYS=(
  "files_modified:"
  "tests_added:"
  "jsdoc_blocks_added:"
  "rules_attestation:"
  "backlog_audited:"
  "gaps_diferidos:"
)

MISSING=()
for key in "${REQUIRED_KEYS[@]}"; do
  if ! grep -q "^[[:space:]]*$key" "$CLOSEOUT"; then
    MISSING+=("$key")
  fi
done

if [[ ${#MISSING[@]} -gt 0 ]]; then
  block "Closeout incompleto. Faltan claves: ${MISSING[*]}"
fi

if grep -q "backlog_audited:[[:space:]]*yes" "$CLOSEOUT"; then
  if [[ -f "$BACKLOG" ]]; then
    if [[ -n "$(find "$BACKLOG" -mmin +60 2>/dev/null)" ]] && \
       ! grep -q "backlog_entries_proposed:" "$CLOSEOUT"; then
      block "Op-2: closeout declara backlog auditado pero ni POST_REMEDIATION_BACKLOG.md fue tocado ni hay entries propuestas."
    fi
  fi
fi

if grep -E "r[0-9]+_.*:[[:space:]]*no" "$CLOSEOUT" >/dev/null 2>&1; then
  FAILED=$(grep -E "r[0-9]+_.*:[[:space:]]*no" "$CLOSEOUT")
  warn "Closeout declara reglas no cumplidas:"$'\n'"$FAILED"$'\n'"Edward debe revisar."
fi

allow "closeout valid, batch closed"
