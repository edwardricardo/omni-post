#!/usr/bin/env bash
# Helpers compartidos — v4
# Cambios vs v3:
#   - plan_is_approved(): verifica .approved con ventana de 2h y posterioridad al .md
#   - is_deletion_operation(): detecta eliminación según threshold medio
#   - deletion_justification_valid(): verifica YAML aprobado
#   - canon_completed_in_plan(): verifica que el plan declara canon_research_completed_at

REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
HOOK_LOG="$REPO_ROOT/.claude/hooks.log"

HOOK_INPUT_JSON=""

read_input() {
  if [[ -z "$HOOK_INPUT_JSON" ]]; then
    HOOK_INPUT_JSON=$(cat)
  fi
}

get_field() {
  if [[ -z "$HOOK_INPUT_JSON" ]]; then
    echo ""
    return 0
  fi
  local result
  result=$(echo "$HOOK_INPUT_JSON" | jq -r "${1:-.}" 2>/dev/null) || result=""
  [[ "$result" == "null" ]] && result=""
  echo "$result"
}

log() {
  printf '[%s] [%s] %s\n' "$(date -Iseconds)" "${HOOK_NAME:-?}" "$*" >> "$HOOK_LOG" 2>/dev/null || true
}

block() {
  echo "❌ BLOCKED [$HOOK_NAME]: $*" >&2
  log "BLOCK: $*"
  exit 2
}

warn() {
  echo "⚠️  [$HOOK_NAME]: $*" >&2
  log "WARN: $*"
}

allow() {
  log "ALLOW: ${1:-ok}"
  exit 0
}

require_jq() {
  if ! command -v jq >/dev/null 2>&1; then
    echo "❌ [$HOOK_NAME]: jq no instalado. sudo apt install jq" >&2
    exit 2
  fi
}

# ─────────────────────────────────────────────────────────────────────
# Branch & timing
# ─────────────────────────────────────────────────────────────────────
on_allowed_branch() {
  local branch
  branch=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
  [[ "$branch" == refactor/remediation-v2.1* ]]
}

plan_is_active() {
  local plan="$REPO_ROOT/.claude/current-batch-plan.md"
  local max_age_min="${PLAN_MAX_AGE_MIN:-120}"
  [[ -f "$plan" ]] || return 1
  [[ -z "$(find "$plan" -mmin +"$max_age_min" 2>/dev/null)" ]]
}

canon_recently_consulted() {
  local index="$REPO_ROOT/canon_research_index.md"
  [[ -f "$index" ]] || return 1
  [[ -z "$(find "$index" -mmin +30 2>/dev/null)" ]]
}

# ─────────────────────────────────────────────────────────────────────
# Plan approval
# Verifica:
#   1. Existe .claude/current-batch-plan.approved
#   2. .approved es POSTERIOR a .md (es decir, aprobaste DESPUÉS de la última edición)
#   3. .approved está dentro de la ventana de validez del plan (2h)
# ─────────────────────────────────────────────────────────────────────
plan_is_approved() {
  local plan="$REPO_ROOT/.claude/current-batch-plan.md"
  local approved="$REPO_ROOT/.claude/current-batch-plan.approved"
  local max_age_min="${PLAN_MAX_AGE_MIN:-120}"

  [[ -f "$plan" ]] || return 1
  [[ -f "$approved" ]] || return 1

  # Si el plan fue modificado DESPUÉS de la aprobación, la aprobación es inválida.
  # Esto implementa la regla "invalidar aprobación tras cualquier edit al plan".
  if [[ "$plan" -nt "$approved" ]]; then
    return 1
  fi

  # La aprobación tiene la misma ventana de 2h que el plan.
  [[ -z "$(find "$approved" -mmin +"$max_age_min" 2>/dev/null)" ]]
}

# ─────────────────────────────────────────────────────────────────────
# Detección de eliminación — threshold MEDIO
# Retorna 0 (true) si la operación califica como eliminación significativa.
# Asume que HOOK_INPUT_JSON ya fue leído (read_input).
# ─────────────────────────────────────────────────────────────────────
is_deletion_operation() {
  local tool_name
  tool_name=$(get_field '.tool_name')

  case "$tool_name" in
    Edit)
      local old_str new_str
      old_str=$(get_field '.tool_input.old_string')
      new_str=$(get_field '.tool_input.new_string')

      # Caso 1: new_string completamente vacío con old_string no vacío = eliminación
      if [[ -n "$old_str" ]] && [[ -z "$new_str" ]]; then
        return 0
      fi

      # Caso 2: reducción de líneas >= 30 (threshold medio)
      local old_lines new_lines diff
      old_lines=$(echo -n "$old_str" | wc -l)
      new_lines=$(echo -n "$new_str" | wc -l)
      diff=$((old_lines - new_lines))
      if [[ $diff -ge 30 ]]; then
        return 0
      fi

      return 1
      ;;

    MultiEdit)
      # Para MultiEdit, sumamos las reducciones de cada edit
      local total_reduction=0
      local edit_count
      edit_count=$(echo "$HOOK_INPUT_JSON" | jq '.tool_input.edits | length' 2>/dev/null || echo 0)

      local i=0
      while [[ $i -lt $edit_count ]]; do
        local old_e new_e ol nl
        old_e=$(echo "$HOOK_INPUT_JSON" | jq -r ".tool_input.edits[$i].old_string" 2>/dev/null)
        new_e=$(echo "$HOOK_INPUT_JSON" | jq -r ".tool_input.edits[$i].new_string" 2>/dev/null)

        # Caso vacío
        if [[ -n "$old_e" ]] && [[ "$new_e" == "null" || -z "$new_e" ]]; then
          return 0
        fi

        ol=$(echo -n "$old_e" | wc -l)
        nl=$(echo -n "$new_e" | wc -l)
        total_reduction=$((total_reduction + ol - nl))

        i=$((i + 1))
      done

      [[ $total_reduction -ge 30 ]] && return 0
      return 1
      ;;

    Write)
      # Si el archivo destino existe y el contenido nuevo es ≥50% más corto, es eliminación
      local target new_content old_size new_size
      target=$(get_field '.tool_input.file_path')
      new_content=$(get_field '.tool_input.content')

      [[ -f "$target" ]] || return 1

      old_size=$(wc -c < "$target")
      new_size=$(echo -n "$new_content" | wc -c)

      if [[ $old_size -gt 0 ]]; then
        # threshold: nueva ≤ 50% del original
        local half=$((old_size / 2))
        [[ $new_size -le $half ]] && return 0
      fi

      return 1
      ;;

    *)
      return 1
      ;;
  esac
}

# ─────────────────────────────────────────────────────────────────────
# Validez de la justification de eliminación
# Verifica:
#   1. Existe current-deletion-justification.yml
#   2. Existe current-deletion-justification.approved
#   3. .approved es posterior al .yml
#   4. .approved está dentro de ventana de 30 min (las justifications son de uso único)
# ─────────────────────────────────────────────────────────────────────
deletion_justification_valid() {
  local just="$REPO_ROOT/.claude/current-deletion-justification.yml"
  local approved="$REPO_ROOT/.claude/current-deletion-justification.approved"

  [[ -f "$just" ]] || return 1
  [[ -f "$approved" ]] || return 1

  if [[ "$just" -nt "$approved" ]]; then
    return 1
  fi

  # Ventana corta: 30 min para forzar a CC a justificar cada eliminación recientemente
  [[ -z "$(find "$approved" -mmin +30 2>/dev/null)" ]]
}

# ─────────────────────────────────────────────────────────────────────
# Detecta intentos de auto-aprobación por parte de CC
# Bloquea cualquier touch/echo/cat sobre archivos .approved
# ─────────────────────────────────────────────────────────────────────
is_self_approval_attempt() {
  local cmd="$1"
  if [[ "$cmd" =~ \.claude/.*\.approved ]]; then
    if [[ "$cmd" =~ (touch|echo|cat[[:space:]]*\>|tee|cp|mv) ]]; then
      return 0
    fi
  fi
  return 1
}
