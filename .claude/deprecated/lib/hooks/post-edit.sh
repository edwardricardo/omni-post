#!/usr/bin/env bash
# PostToolUse hook para Edit/Write/MultiEdit (v5)
# Cambios vs v4:
#   - Sprint T rule ahora usa detección de contenido (type-only vs runtime)
#   - Soporte para tests en apps/api/tests/unit/ (mirror de src/)

set -euo pipefail
HOOK_NAME="post-edit"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

require_jq
read_input

TOOL_NAME=$(get_field '.tool_name')
TARGET_PATH=$(get_field '.tool_input.file_path')

case "$TOOL_NAME" in
  Edit|Write|MultiEdit) ;;
  *) allow "tool $TOOL_NAME not gated by post-edit" ;;
esac

[[ -f "$TARGET_PATH" ]] || allow "no file to inspect"

VIOLATIONS=()

# ─────────────────────────────────────────────────────────────────────
# Regla 6: comentarios sin historia/migración
# ─────────────────────────────────────────────────────────────────────
if [[ "$TARGET_PATH" =~ \.(ts|tsx|js|jsx)$ ]]; then
  if grep -nE '^\s*(//|\*).*\b(was |previously|migrated from|antes era|legacy:|deprecated:|TODO migrate|used to be)\b' "$TARGET_PATH" >/dev/null 2>&1; then
    OFFENDING=$(grep -nE '^\s*(//|\*).*\b(was |previously|migrated from|antes era|legacy:|deprecated:|TODO migrate|used to be)\b' "$TARGET_PATH" | head -3)
    VIOLATIONS+=("Regla 6: comentarios con historia/migración en $TARGET_PATH:"$'\n'"$OFFENDING")
  fi
fi

# ─────────────────────────────────────────────────────────────────────
# secretlint
# ─────────────────────────────────────────────────────────────────────
if command -v secretlint >/dev/null 2>&1 && [[ -f "$REPO_ROOT/.secretlintrc.json" ]]; then
  if ! secretlint --secretlintrc "$REPO_ROOT/.secretlintrc.json" "$TARGET_PATH" >/dev/null 2>&1; then
    OUT=$(secretlint --secretlintrc "$REPO_ROOT/.secretlintrc.json" "$TARGET_PATH" 2>&1 || true)
    VIOLATIONS+=("secretlint detectó posible secreto:"$'\n'"$OUT")
  fi
fi

# ─────────────────────────────────────────────────────────────────────
# Semgrep custom OmniPost
# ─────────────────────────────────────────────────────────────────────
if command -v semgrep >/dev/null 2>&1 && [[ -f "$REPO_ROOT/.semgrep/omnipost.yml" ]]; then
  if [[ "$TARGET_PATH" =~ \.(ts|tsx|js|jsx)$ ]]; then
    SEMGREP_OUT=$(semgrep --config "$REPO_ROOT/.semgrep/omnipost.yml" --quiet --error "$TARGET_PATH" 2>&1 || true)
    if [[ -n "$SEMGREP_OUT" ]] && echo "$SEMGREP_OUT" | grep -q "ERROR\|✘\|finding"; then
      VIOLATIONS+=("Semgrep custom rules:"$'\n'"$SEMGREP_OUT")
    fi
  fi
fi

# ─────────────────────────────────────────────────────────────────────
# Sprint T enforcement: test paralelo para archivos con runtime logic
# Detección por contenido (opción A): un archivo es "type-only" si no
# contiene function declarations, class declarations, arrow functions,
# ni asignaciones const con expresión runtime.
# ─────────────────────────────────────────────────────────────────────
is_type_only_file() {
  local f="$1"

  # Si contiene 'function ' → runtime
  grep -qE '^\s*(export\s+)?(async\s+)?function\s+\w' "$f" 2>/dev/null && return 1

  # Si contiene 'class ' → runtime
  grep -qE '^\s*(export\s+)?(abstract\s+)?class\s+\w' "$f" 2>/dev/null && return 1

  # Si contiene arrow function fuera de comentarios → runtime
  # (Heurística: '=>' en línea no comentada que no sea solo en una signature de tipo)
  if grep -vE '^\s*(//|\*|/\*)' "$f" 2>/dev/null | grep -qE '=>' ; then
    # Refinamiento: '=>' en signature de tipo (ej. `type Fn = (x: number) => string`)
    # tiene `type ` o `interface ` cerca. Si TODOS los '=>' son en líneas con type/interface, es type-only.
    local non_type_arrow
    non_type_arrow=$(grep -vE '^\s*(//|\*|/\*)' "$f" 2>/dev/null | grep -E '=>' | grep -vE '^\s*(export\s+)?(type|interface)\s' || true)
    [[ -n "$non_type_arrow" ]] && return 1
  fi

  # Si contiene 'const X = expr' con expr de runtime → runtime
  # Excluye: const con tipo solo (`const X: Type` sin `=`), const re-exports.
  if grep -qE '^\s*(export\s+)?const\s+\w+\s*=\s*[^;]' "$f" 2>/dev/null; then
    return 1
  fi

  # Si contiene 'let' o 'var' con asignación → runtime
  if grep -qE '^\s*(export\s+)?(let|var)\s+\w+\s*=' "$f" 2>/dev/null; then
    return 1
  fi

  # Llegamos acá: no encontramos runtime — es type-only
  return 0
}

if [[ "$TARGET_PATH" =~ ^.*apps/api/src/.+\.ts$ ]] && \
   [[ ! "$TARGET_PATH" =~ \.test\.ts$ ]] && \
   [[ ! "$TARGET_PATH" =~ \.d\.ts$ ]] && \
   [[ ! "$TARGET_PATH" =~ /types/ ]] && \
   [[ ! "$TARGET_PATH" =~ /index\.ts$ ]]; then

  if is_type_only_file "$TARGET_PATH"; then
    log "Sprint T: skip $TARGET_PATH (type-only file, no runtime logic)"
  else
    # Buscar test paralelo en cuatro ubicaciones posibles
    TEST_FILE_1="${TARGET_PATH%.ts}.test.ts"                                              # paralelo directo
    TEST_FILE_2="$(dirname "$TARGET_PATH")/__tests__/$(basename "${TARGET_PATH%.ts}").test.ts"  # __tests__ subdirectory
    TEST_FILE_3="${TARGET_PATH/apps\/api\/src/apps/api/tests/unit}"                       # mirror en tests/unit/
    TEST_FILE_3="${TEST_FILE_3%.ts}.test.ts"
    TEST_FILE_4="${TARGET_PATH/apps\/api\/src/apps/api/tests}"                            # mirror en tests/ (sin /unit/)
    TEST_FILE_4="${TEST_FILE_4%.ts}.test.ts"

    if [[ ! -f "$TEST_FILE_1" ]] && [[ ! -f "$TEST_FILE_2" ]] && \
       [[ ! -f "$TEST_FILE_3" ]] && [[ ! -f "$TEST_FILE_4" ]]; then
      VIOLATIONS+=("Sprint T rule: $TARGET_PATH tiene runtime logic pero no tiene test paralelo. Esperado en alguna de:
  - $TEST_FILE_1
  - $TEST_FILE_2
  - $TEST_FILE_3
  - $TEST_FILE_4")
    fi
  fi
fi

# ─────────────────────────────────────────────────────────────────────
# Resultado consolidado
# ─────────────────────────────────────────────────────────────────────
if [[ ${#VIOLATIONS[@]} -gt 0 ]]; then
  {
    echo "Post-edit detectó ${#VIOLATIONS[@]} problema(s) en $TARGET_PATH:"
    echo
    for v in "${VIOLATIONS[@]}"; do
      echo "─── $v"
      echo
    done
    echo "Corregí los problemas y reintentá. Estos gates también corren en pre-commit y CI."
  } >&2
  log "${#VIOLATIONS[@]} violations in $TARGET_PATH"
  exit 2
fi

allow "post-edit clean: $TARGET_PATH"
