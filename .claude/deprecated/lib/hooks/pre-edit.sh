#!/usr/bin/env bash
# PreToolUse hook para Edit/Write/MultiEdit/NotebookEdit (v4)
# Gates en orden:
#   1. Bypass autorizado por Edward
#   2. Canon recientemente consultado (regla 5)
#   3. Plan activo (regla 1)
#   4. Plan aprobado por Edward (refuerzo nuevo)
#   5. Si es eliminación: justification existe y aprobada (refuerzo nuevo)
#   6. Path no es sensible (o autorización presente)

set -euo pipefail
HOOK_NAME="pre-edit"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

require_jq
read_input

TOOL_NAME=$(get_field '.tool_name')
TARGET_PATH=$(get_field '.tool_input.file_path')

case "$TOOL_NAME" in
  Edit|Write|MultiEdit|NotebookEdit) ;;
  *) allow "tool $TOOL_NAME not gated by pre-edit" ;;
esac

# Gate 1: Bypass
if [[ "${CLAUDE_BATCH_BYPASS:-no}" == "yes" ]]; then
  allow "bypass authorized by Edward"
fi

# Gate 2: Canon consultado (movido ANTES del plan según refuerzo 1)
if ! canon_recently_consulted; then
  block "Regla 5: canon FIRST. Antes de cualquier edición, leé/actualizá canon_research_index.md con las entries relevantes para este batch. Esta regla aplica INCLUSO antes de producir el plan."
fi

# Gate 3: Plan existe
if ! plan_is_active; then
  block "Regla 1: no hay plan activo. Producí .claude/current-batch-plan.md con el preflight YAML antes de modificar código."
fi

# Gate 4: Plan aprobado por Edward
if ! plan_is_approved; then
  if [[ ! -f "$REPO_ROOT/.claude/current-batch-plan.approved" ]]; then
    block "Plan no aprobado. Edward debe ejecutar 'omnipost-approve plan' después de revisar .claude/current-batch-plan.md. CC NO puede crear este archivo (pre-bash bloquea)."
  fi
  if [[ "$REPO_ROOT/.claude/current-batch-plan.md" -nt "$REPO_ROOT/.claude/current-batch-plan.approved" ]]; then
    block "Aprobación del plan inválida: el plan fue modificado DESPUÉS de la aprobación. Edward debe re-aprobar con 'omnipost-approve plan'."
  fi
  block "Aprobación del plan vencida (>2h). Abrí un sub-batch nuevo: editá el plan y pedí re-aprobación."
fi

# Gate 5: Si es eliminación, exigir justification aprobada
if is_deletion_operation; then
  log "deletion detected on $TARGET_PATH (tool=$TOOL_NAME)"

  if ! deletion_justification_valid; then
    if [[ ! -f "$REPO_ROOT/.claude/current-deletion-justification.yml" ]]; then
      block "Eliminación detectada en $TARGET_PATH. ANTES de proceder debés:
  1. Producir .claude/current-deletion-justification.yml respondiendo las 3 preguntas:
     - question_1_what: ¿Qué es?
     - question_2_what_does_it_do: ¿Qué hace o se supone que hace?
     - question_3_existing_replacement: ¿Existe ya algo que haga lo mismo? (con grep_evidence)
  2. Pedirle a Edward que ejecute 'omnipost-approve deletion'
  3. Reintentar la operación dentro de 30 min de la aprobación

Ver .claude/templates/deletion-justification-example.yml para el formato."
    fi
    if [[ "$REPO_ROOT/.claude/current-deletion-justification.yml" -nt "$REPO_ROOT/.claude/current-deletion-justification.approved" ]]; then
      block "Justification de eliminación inválida: el YAML fue modificado después de la aprobación. Edward debe re-aprobar con 'omnipost-approve deletion'."
    fi
    block "Aprobación de eliminación vencida (>30 min). Re-aprobar con 'omnipost-approve deletion'."
  fi

  log "deletion justification valid for $TARGET_PATH"
fi

# Gate 6: Paths sensibles
SENSITIVE_PATHS=(
  ".env"
  "apps/api/src/config/encryption"
  "prisma/schema.prisma"
  "prisma/migrations"
)

for sensitive in "${SENSITIVE_PATHS[@]}"; do
  if [[ "$TARGET_PATH" == *"$sensitive"* ]]; then
    if [[ "${EDWARD_AUTHORIZED_SENSITIVE:-no}" != "yes" ]]; then
      block "Path sensible: '$sensitive' requiere EDWARD_AUTHORIZED_SENSITIVE=yes."
    fi
    log "sensitive path edit authorized: $TARGET_PATH"
  fi
done

allow "edit gates passed for $TARGET_PATH"
