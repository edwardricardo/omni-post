#!/usr/bin/env bash
# The full local battery: every local gate, run on one commit, with the verdict
# written where a hook can read it. A line on stdout cannot be checked once it
# has scrolled by, so the verdict goes to
#   <main repository>/.claude/state/battery/<full sha>.json
# through scripts/testing/battery-state.mjs, so that the decision to push can
# rest on the verdict for the exact commit being pushed.
#
# Usage: scripts/testing/battery.sh [<worktree>]
#   <worktree>        repository to certify; default: the one holding the
#                     current directory.
#   BATTERY_ENV_FILE  environment for the database and queue steps; default:
#                     .env.test in the MAIN repository root, because a linked
#                     worktree has none of its own.
#   BATTERY_OUT       log directory; default: .claude/state/battery-logs/<sha>
#                     in the main repository root.
#   BATTERY_STEP_TIMEOUT  seconds one gate may run; default 3600. A gate that
#                     exceeds it is killed and recorded as a failing step (exit
#                     124), so a hung gate turns the verdict RED instead of
#                     leaving the battery waiting with no verdict at all.
#
# Exit codes: 0 GREEN, 1 RED, 2 the battery refused to start.
#
# A warning anywhere in any log makes the verdict RED. There is no allowlist and
# no waiver: a warning is fixed, and the state file lists each one as evidence of
# why the verdict is RED.
#
# No `set -e`: a failing step must not stop the run, because the verdict needs
# every gate's result, not only the first failure.
#
# The battery installs offline and never downloads a browser. The stories step
# runs in Playwright's Chromium, a one-time prerequisite per machine:
#   pnpm --filter @apps/client exec playwright install chromium
# A missing browser fails that step loudly; it is never fetched mid-run.
set -uo pipefail

# The verdict refuses a steps.tsv holding any other number of rows, so a step
# added below without raising this number turns the battery RED, loudly.
PLANNED_STEPS=22

if [ $# -gt 1 ]; then
  echo "usage: scripts/testing/battery.sh [<worktree>]" >&2
  exit 2
fi
# Every gate runs under `timeout`. It ships with GNU coreutils and is absent
# from a stock macOS, where every step would otherwise record exit 127 and the
# verdict would say nothing about why.
if ! command -v timeout >/dev/null 2>&1; then
  echo "battery: 'timeout' is not on PATH; every gate runs under it, so a hung gate is killed and recorded as a failing step instead of leaving the battery without a verdict" >&2
  echo "battery: it ships with GNU coreutils (on macOS, Homebrew's coreutils provides it in its libexec/gnubin directory)" >&2
  exit 2
fi
if [ $# -eq 1 ]; then
  cd "$1" || { echo "battery: cannot enter $1" >&2; exit 2; }
fi
WT=$(git rev-parse --show-toplevel) || { echo "battery: $PWD is not inside a git repository" >&2; exit 2; }
cd "$WT" || exit 2

# The state lives in the MAIN repository root, shared by every linked worktree,
# so a verdict recorded from one worktree is visible from all of them.
COMMON_DIR=$(git rev-parse --path-format=absolute --git-common-dir) || exit 2
MAIN_ROOT=$(dirname "$COMMON_DIR")
STATE_DIR=$MAIN_ROOT/.claude/state

ENV_FILE=${BATTERY_ENV_FILE:-$MAIN_ROOT/.env.test}
if [ ! -f "$ENV_FILE" ]; then
  echo "battery: environment file not found: $ENV_FILE" >&2
  echo "battery: it must define DATABASE_URL, MIGRATE_DATABASE_URL, SHADOW_DATABASE_URL and REDIS_URL; BATTERY_ENV_FILE names another file" >&2
  exit 2
fi

# Digits only, and greater than zero once read as decimal: `timeout` takes a
# zero duration (`0`, `00`, …) as "no limit", which would switch the bound off
# while looking like a setting.
STEP_TIMEOUT=${BATTERY_STEP_TIMEOUT:-3600}
case "$STEP_TIMEOUT" in
  '' | *[!0-9]*)
    echo "battery: BATTERY_STEP_TIMEOUT must be a positive number of seconds, got '$STEP_TIMEOUT'" >&2
    exit 2
    ;;
esac
if [ "$((10#$STEP_TIMEOUT))" -le 0 ]; then
  echo "battery: BATTERY_STEP_TIMEOUT must be a positive number of seconds, got '$STEP_TIMEOUT'" >&2
  exit 2
fi
STEP_TIMEOUT=$((10#$STEP_TIMEOUT))

# A battery certifies a commit, so it refuses a tree that is not that commit.
if ! START_STATUS=$(git status --porcelain); then
  echo "battery: git status failed in $WT" >&2
  exit 2
fi
if [ -n "$START_STATUS" ]; then
  echo "battery: the tree is not clean, and a battery certifies a commit:" >&2
  printf '%s\n' "$START_STATUS" >&2
  exit 2
fi
SHA=$(git rev-parse HEAD) || exit 2
TREE=$(git rev-parse 'HEAD^{tree}') || exit 2

set -a
# shellcheck source=/dev/null
source "$ENV_FILE" || { echo "battery: $ENV_FILE could not be sourced" >&2; exit 2; }
set +a

OUT=${BATTERY_OUT:-$STATE_DIR/battery-logs/$SHA}
mkdir -p "$OUT" || { echo "battery: cannot create the log directory $OUT" >&2; exit 2; }
OUT=$(cd "$OUT" && pwd -P) || exit 2
# A previous run's logs must not leak into this verdict. Only the kinds of file
# this script writes are removed: BATTERY_OUT may name any directory, and a
# recursive delete of a caller-chosen path is never safe. The verdict reads no
# other kind, so the guarantee is the same.
rm -f -- "$OUT"/*.log "$OUT"/*.json "$OUT/steps.tsv"

# step [-C <dir>] <name> <command...>
# Runs one gate with its output in <log dir>/<name>.log, records its exit code
# in steps.tsv, and echoes it. The command runs in a subshell, so `-C` moves
# only the gate, never the battery. `timeout` bounds the gate: on expiry it
# signals the gate's whole process group (TERM, then KILL 30 seconds later) and
# the step is recorded with exit 124, so the remaining gates still run.
step() {
  local dir=.
  if [ "$1" = "-C" ]; then
    dir=$2
    shift 2
  fi
  local name=$1
  shift
  (cd "$dir" && timeout --kill-after=30 "$STEP_TIMEOUT" "$@") >"$OUT/$name.log" 2>&1
  local code=$?
  printf '%s\t%s\n' "$name" "$code" >>"$OUT/steps.tsv"
  if [ "$code" -eq 124 ]; then
    echo "$name exit=$code (timed out after ${STEP_TIMEOUT}s)"
  else
    echo "$name exit=$code"
  fi
}

STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
date -u
git rev-parse --short HEAD

step install pnpm install --frozen-lockfile --offline
step hooks python3 -m unittest discover -s .claude/hooks-py/tests -t .claude/hooks-py
step audit pnpm audit --audit-level moderate
step holds node scripts/testing/holds-gate.mjs
step engines node scripts/testing/engines-node-gate.mjs
step lint pnpm lint --max-warnings 0
step format pnpm format:check
# The typecheck CI runs: every package and the four apps. A build of the root
# project references alone covers six packages and none of the apps. One task
# at a time, because the api typecheck needs about 6 GB of heap on its own and
# two such compilers side by side exhaust a 9 GB machine; turbo hands
# NODE_OPTIONS to its tasks in strict environment mode.
step typecheck env NODE_OPTIONS=--max-old-space-size=6144 pnpm exec turbo run typecheck --concurrency=1
step syncpack pnpm dlx syncpack@15.3.3 lint --dependency-types prod,dev,peer,overrides
# The dedupe gate of CI's Dependency Consistency job: without it only CI sees a
# flattenable duplicate, after a push (measured on pull request #408). It runs at
# error level: a resolution prints pnpm's deprecation and peer notices as warnings,
# which the frozen install never shows; a failing check still prints its duplicates.
step dedupe pnpm dedupe --check --loglevel=error
step knip node scripts/knip-ratchet.mjs
# The duplicate-code gate of CI's code-quality job: it fails a new clone and a
# stale baseline entry, and without it here only CI would see either.
step duplicates pnpm check:duplicates
# The architecture gate of audit.yml: dependency-cruiser's layer rules and its
# `no-circular` cycle check over one resolved import graph. Its `warn`-severity
# rules print `warn` lines, which this battery reads as RED.
step architecture pnpm check:architecture
step metrics node scripts/testing/metrics.mjs --all --offline
# Every client story as a vitest browser test in headless Chromium: it renders,
# its play function runs, and axe at `error` and the console contract can fail it.
step stories pnpm --filter @apps/client test:stories
step scripts pnpm --filter @apps/api exec vitest run tests/unit/scripts/
step api-common pnpm --filter @packages/api-common test
step workers pnpm --filter @apps/workers test
# The api suite runs twice in a row: a test that passes once and fails once is a
# failure, and only a second run can see it.
for n in 1 2; do
  step -C apps/api "api-$n" env NODE_OPTIONS=--max-old-space-size=4096 \
    pnpm exec vitest run --reporter=default --reporter=json --outputFile.json="$OUT/api-$n.json"
done
step -C apps/api tier env TIER=pr-integration bash scripts/run-tests.sh
# Shows the tier's totals to the reader; it is not a gate. The gate is the tier
# step's exit code above, and apps/api/scripts/run-tests.sh already fails on its
# own when a tier collects zero tests.
grep '^TOTAL' "$OUT/tier.log" || echo "tier: tier.log carries no TOTAL line to show; the tier step's exit code above is its result"
step audit-end pnpm audit --audit-level low

# The verdict certifies the commit only if no step changed the tree or moved
# HEAD; either is reported to the verdict, which turns RED on it.
DIRTY_AT_END=0
if ! END_STATUS=$(git status --porcelain); then
  echo "battery: git status failed after the last step" >&2
  DIRTY_AT_END=1
elif [ -n "$END_STATUS" ]; then
  echo "battery: the tree changed during the battery:" >&2
  printf '%s\n' "$END_STATUS" >&2
  DIRTY_AT_END=1
fi
END_SHA=$(git rev-parse HEAD) || END_SHA=""
if [ "$END_SHA" != "$SHA" ]; then
  echo "battery: HEAD moved from $SHA to ${END_SHA:-an unreadable commit} during the battery" >&2
  DIRTY_AT_END=1
fi

date -u
node scripts/testing/battery-state.mjs \
  --out "$OUT" \
  --sha "$SHA" \
  --tree "$TREE" \
  --state-dir "$STATE_DIR" \
  --expected-steps "$PLANNED_STEPS" \
  --started-at "$STARTED_AT" \
  --dirty-at-end "$DIRTY_AT_END"
exit $?
