#!/usr/bin/env bash
# stryker-full.sh — Full mutation run including static mutants
# Run with: bash scripts/stryker-full.sh
# Monitor with: tail -f logs/stryker-full.log

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$ROOT/logs"
LOG_FILE="$LOG_DIR/stryker-full.log"
PID_FILE="$LOG_DIR/stryker-full.pid"

mkdir -p "$LOG_DIR"

# Create a temporary config that overrides ignoreStatic back to false
FULL_CONFIG="$LOG_DIR/stryker-full.config.mjs"
cat > "$FULL_CONFIG" << 'CONF'
import baseConfig from '../stryker.config.mjs';

/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  ...baseConfig,
  ignoreStatic: false,
};
CONF

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting full Stryker run (ignoreStatic=false)" | tee -a "$LOG_FILE"

cd "$ROOT"
nohup pnpm exec stryker run "$FULL_CONFIG" \
  >> "$LOG_FILE" 2>&1 &

echo $! > "$PID_FILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] PID: $(cat "$PID_FILE")" | tee -a "$LOG_FILE"
echo ""
echo "  Monitoring:"
echo "    tail -f $LOG_FILE"
echo ""
echo "  Kill if needed:"
echo "    kill \$(cat $PID_FILE)"
