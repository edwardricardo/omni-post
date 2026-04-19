#!/usr/bin/env bash
# Run Stryker mutation testing with output logging.
# Usage: ./run-stryker.sh
#
# Progress: tail -f /tmp/stryker-run.log
# HTML report: apps/api/reports/mutation/mutation.html

set -euo pipefail
cd "$(dirname "$0")"

LOG="/tmp/stryker-run.log"
echo "=== Stryker mutation run started at $(date) ===" | tee "$LOG"
echo "Progress: tail -f $LOG"
echo ""

# Run Stryker, stream to both terminal and log file
pnpm exec stryker run 2>&1 | tee -a "$LOG"

echo "" | tee -a "$LOG"
echo "=== Stryker completed at $(date) ===" | tee -a "$LOG"
