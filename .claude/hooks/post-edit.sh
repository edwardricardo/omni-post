#!/usr/bin/env bash
# PostToolUse hook para Edit/Write/MultiEdit (v3)

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

# Regla 6
if [[ "$TARGET_PATH" =~ \.(ts|tsx|js|jsx)$ ]]; then
  if grep -nE '^\s*(//|\*).*\b(was |previously|migrated from|antes era|legacy:|deprecated:|TODO migrate|used to be)\b' "$TARGET_PATH" >/dev/null 2>&1; then
    OFFENDING=$(grep -nE '^\s*(//|\*).*\b(was |previously|migrated from|antes era|legacy:|deprecated:|TODO migrate|used to be)\b' "$TARGET_PATH" | head -3)
    VIOLATIONS+=("Regla 6: comentarios con historia/migración en $TARGET_PATH:"$'\n'"$OFFENDING")
  fi
fi

# secretlint
if command -v secretlint >/dev/null 2>&1 && [[ -f "$REPO_ROOT/.secretlintrc.json" ]]; then
  if ! secretlint --secretlintrc "$REPO_ROOT/.secretlintrc.json" "$TARGET_PATH" >/dev/null 2>&1; then
    OUT=$(secretlint --secretlintrc "$REPO_ROOT/.secretlintrc.json" "$TARGET_PATH" 2>&1 || true)
    VIOLATIONS+=("secretlint detectó posible secreto:"$'\n'"$OUT")
  fi
fi

# Semgrep custom
if command -v semgrep >/dev/null 2>&1 && [[ -f "$REPO_ROOT/.semgrep/omnipost.yml" ]]; then
  if [[ "$TARGET_PATH" =~ \.(ts|tsx|js|jsx)$ ]]; then
    SEMGREP_OUT=$(semgrep --config "$REPO_ROOT/.semgrep/omnipost.yml" --quiet --error "$TARGET_PATH" 2>&1 || true)
    if [[ -n "$SEMGREP_OUT" ]] && echo "$SEMGREP_OUT" | grep -q "ERROR\|✘\|finding"; then
      VIOLATIONS+=("Semgrep custom rules:"$'\n'"$SEMGREP_OUT")
    fi
  fi
fi

# Sprint T enforcement
if [[ "$TARGET_PATH" =~ ^.*apps/api/src/.+\.ts$ ]] && \
   [[ ! "$TARGET_PATH" =~ \.test\.ts$ ]] && \
   [[ ! "$TARGET_PATH" =~ \.d\.ts$ ]] && \
   [[ ! "$TARGET_PATH" =~ /types/ ]] && \
   [[ ! "$TARGET_PATH" =~ /index\.ts$ ]]; then

  TEST_FILE="${TARGET_PATH%.ts}.test.ts"
  TEST_FILE_ALT="$(dirname "$TARGET_PATH")/__tests__/$(basename "${TARGET_PATH%.ts}").test.ts"

  if [[ ! -f "$TEST_FILE" ]] && [[ ! -f "$TEST_FILE_ALT" ]]; then
    VIOLATIONS+=("Sprint T rule: $TARGET_PATH no tiene test paralelo. Esperado en $TEST_FILE o $TEST_FILE_ALT.")
  fi
fi

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
