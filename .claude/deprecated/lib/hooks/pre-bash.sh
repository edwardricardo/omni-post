#!/usr/bin/env bash
# PreToolUse hook para Bash (v4)
# Cambios vs v3:
#   - Bloquea creación/touch de archivos .approved (anti-self-approval)
#   - rm/git rm requieren deletion justification aprobada

set -euo pipefail
HOOK_NAME="pre-bash"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

require_jq
read_input

TOOL_NAME=$(get_field '.tool_name')
CMD=$(get_field '.tool_input.command')

[[ "$TOOL_NAME" == "Bash" ]] || allow "not bash (tool=$TOOL_NAME)"

log "inspecting cmd: $CMD"

# ─────────────────────────────────────────────────────────────────────
# Anti self-approval: CC no puede crear ni tocar archivos .approved
# ─────────────────────────────────────────────────────────────────────
if is_self_approval_attempt "$CMD"; then
  block "CC no puede crear/modificar archivos .approved. Las aprobaciones son exclusivas de Edward vía 'omnipost-approve plan|deletion'."
fi

# ─────────────────────────────────────────────────────────────────────
# Op-1: CC nunca pushea
# ─────────────────────────────────────────────────────────────────────
if [[ "$CMD" =~ git[[:space:]]+push ]]; then
  block "Op-1: 'git push' está prohibido para CC. Edward ejecuta los push manualmente."
fi

# ─────────────────────────────────────────────────────────────────────
# Regla 7 + Regla 8 + Op-1 sobre commits
# ─────────────────────────────────────────────────────────────────────
if [[ "$CMD" =~ git[[:space:]]+commit ]]; then
  if echo "$CMD" | grep -qiE 'co-authored-by:[[:space:]]*claude'; then
    block "Regla 7: trailer 'Co-Authored-By: Claude' prohibido. Removelo y reintentá."
  fi

  if ! on_allowed_branch; then
    current=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "?")
    block "Regla 8: branch actual '$current' no acepta commits. Solo refactor/remediation-v2.1*."
  fi

  if [[ "${EDWARD_AUTHORIZED_COMMIT:-no}" != "yes" ]]; then
    block "Op-1: commit no autorizado. Edward debe setear EDWARD_AUTHORIZED_COMMIT=yes para este commit puntual."
  fi
fi

# ─────────────────────────────────────────────────────────────────────
# Convención: pnpm only
# ─────────────────────────────────────────────────────────────────────
if [[ "$CMD" =~ (^|[[:space:]])(npm|yarn)[[:space:]]+(install|i|add|ci|run|exec|update|upgrade) ]]; then
  block "Convención OmniPost: usar pnpm, nunca npm/yarn. Reescribí el comando con 'pnpm'."
fi

# ─────────────────────────────────────────────────────────────────────
# Eliminación vía rm/git rm: requiere deletion justification aprobada
# ─────────────────────────────────────────────────────────────────────
if [[ "$CMD" =~ (^|[[:space:]])(rm[[:space:]]+(-[a-zA-Z]*[[:space:]]+)?[^[:space:]]) ]] || \
   [[ "$CMD" =~ git[[:space:]]+rm ]]; then

  # Excepción: rm de archivos en /tmp, en /home/claude (sandbox), o en node_modules
  # son operaciones seguras y no requieren justification
  if [[ "$CMD" =~ /tmp/ ]] || [[ "$CMD" =~ node_modules ]] || [[ "$CMD" =~ \.next/ ]] || \
     [[ "$CMD" =~ dist/ ]] || [[ "$CMD" =~ \.cache ]]; then
    log "rm safe path, allowing: $CMD"
  else
    if ! deletion_justification_valid; then
      block "Eliminación vía '$CMD' detectada. Requiere deletion justification aprobada. Producí .claude/current-deletion-justification.yml respondiendo las 3 preguntas y pedile a Edward que ejecute 'omnipost-approve deletion'."
    fi
    log "rm with valid justification: $CMD"
  fi
fi

# ─────────────────────────────────────────────────────────────────────
# Defensa contra borrados destructivos masivos
# ─────────────────────────────────────────────────────────────────────
if [[ "$CMD" =~ rm[[:space:]]+-rf[[:space:]]+/ ]] || \
   [[ "$CMD" =~ git[[:space:]]+clean[[:space:]]+.*-[a-z]*f ]] || \
   [[ "$CMD" =~ git[[:space:]]+reset[[:space:]]+--hard ]]; then
  if [[ "${EDWARD_AUTHORIZED_DESTRUCTIVE:-no}" != "yes" ]]; then
    block "Acción destructiva detectada. Requiere EDWARD_AUTHORIZED_DESTRUCTIVE=yes. Comando: $CMD"
  fi
fi

allow "bash command passed gates"
