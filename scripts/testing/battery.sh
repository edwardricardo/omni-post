#!/usr/bin/env bash
# The full local battery: every local gate, run on one commit, with the verdict
# written where a hook can read it. A line on stdout cannot be checked once it
# has scrolled by, so the verdict goes to
#   <main repository>/.claude/state/battery/<full sha>.json
# through scripts/testing/battery-state.mjs, so that the decision to push can
# rest on the verdict for the exact commit being pushed.
#
# Usage: scripts/testing/battery.sh [--static] [--list] [<worktree>]
#   <worktree>        repository to certify; default: the one holding the
#                     current directory. The steps are always this script's own.
#   --static          run the static steps alone and certify nothing (below).
#   --list            print the names of the steps the chosen mode would run,
#                     one per line, in order, and run nothing; it needs neither
#                     a clean tree nor the environment file.
#   BATTERY_ENV_FILE  environment for the database and queue steps of a full
#                     run; default: .env.test in the MAIN repository root,
#                     because a linked worktree has none of its own.
#   BATTERY_OUT       log directory of a full run; default:
#                     .claude/state/battery-logs/<sha> in the main repository
#                     root.
#   BATTERY_STEP_TIMEOUT  seconds one gate may run; default 3600. A gate that
#                     exceeds it is killed and recorded as a failing step (exit
#                     124), so a hung gate turns the verdict RED instead of
#                     leaving the battery waiting with no verdict at all.
#
# Exit codes: 0 GREEN, 1 RED, 2 the battery refused to start.
#
# Every step is declared once, below, with its kind: `static` when it needs no
# test environment (no database, no Redis, no browser) and runs no product test
# suite, `suite` otherwise. A full run runs every step. `--static` runs the
# static steps alone, each with the command the full run gives it and in the
# full run's order, so that a red static gate costs minutes before a full
# battery is spent on it. A static run certifies nothing:
#   - it neither requires nor reads the environment file;
#   - it accepts a dirty tree, and says how many paths differ, because jsdoc,
#     record-coverage and floors read commits and see only what is committed;
#   - its logs go to .claude/state/battery-static-logs/<sha> in the main
#     repository root, never to BATTERY_OUT or a full run's directory;
#   - it writes no verdict: battery-state.mjs is never called;
#   - battery-static.mjs judges its logs by the full verdict's own rules
#     (battery-verdict.mjs) and writes nothing either: the run is GREEN only
#     when every static step is recorded with exit 0 and its log, as many steps
#     are recorded as are declared static, and no log holds a warning line; on
#     RED it prints each warning line with its log and line.
# So a static GREEN predicts the static steps' part of the full verdict: their
# exit codes and the warning rule. It predicts nothing about the nine suite
# steps, what the verdict derives from them (the api runs' reports and their
# unhandled errors), or a tree changed during the run, which it does not check.
# Its last line is `STATIC GREEN` or `STATIC RED`, with the number of steps and,
# on RED, the failing steps and the logs that hold warning lines. Exit codes: 0
# GREEN, 1 RED, 2 the run refused to start.
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
PLANNED_STEPS=34

USAGE="usage: scripts/testing/battery.sh [--static] [--list] [<worktree>]"
usage() {
  echo "$USAGE" >&2
  exit 2
}
STATIC=0
LIST=0
HAS_WORKTREE=0
WORKTREE=
for arg in "$@"; do
  case "$arg" in
    --static)
      [ "$STATIC" -eq 0 ] || usage
      STATIC=1
      ;;
    --list)
      [ "$LIST" -eq 0 ] || usage
      LIST=1
      ;;
    -*)
      echo "battery: unknown flag: $arg" >&2
      usage
      ;;
    *)
      [ "$HAS_WORKTREE" -eq 0 ] || usage
      HAS_WORKTREE=1
      WORKTREE=$arg
      ;;
  esac
done

# step <kind> [-C <dir>] <name> <command...>
# Runs one gate with its output in <log dir>/<name>.log, records its exit code
# in steps.tsv, and echoes it. The command runs in a subshell, so `-C` moves
# only the gate, never the battery. `timeout` bounds the gate: on expiry it
# signals the gate's whole process group (TERM, then KILL 30 seconds later) and
# the step is recorded with exit 124, so the remaining gates still run.
# <kind> is `static` or `suite` (see the header) and is required, so a step
# cannot be added without saying which modes run it. A static run skips a suite
# step, and a listing prints the step's name instead of running it.
step() {
  local kind=$1
  shift
  case "$kind" in
    static | suite) ;;
    *)
      echo "battery: a step declaration starts with '$kind'; each step declares 'static' or 'suite' before its name" >&2
      exit 2
      ;;
  esac
  local dir=.
  if [ "$1" = "-C" ]; then
    dir=$2
    shift 2
  fi
  local name=$1
  shift
  if [ "$STATIC" -eq 1 ] && [ "$kind" = suite ]; then
    return 0
  fi
  if [ "$LIST" -eq 1 ]; then
    echo "$name"
    return 0
  fi
  (cd "$dir" && timeout --kill-after=30 "$STEP_TIMEOUT" "$@") >"$OUT/$name.log" 2>&1
  local code=$?
  printf '%s\t%s\n' "$name" "$code" >>"$OUT/steps.tsv"
  if [ "$code" -eq 124 ]; then
    echo "$name exit=$code (timed out after ${STEP_TIMEOUT}s)"
  else
    echo "$name exit=$code"
  fi
}

# The battery's steps, in order: the one place each step and its command are
# written, for every mode.
battery_steps() {
  step static install pnpm install --frozen-lockfile --offline
  step static hooks python3 -m unittest discover -s .claude/hooks-py/tests -t .claude/hooks-py
  step static audit pnpm audit --audit-level moderate
  step static holds node scripts/testing/holds-gate.mjs
  # Fitness #48: every patched dependency has its record, its patch file and its ADR, and every
  # file under patches/ is named by a record. Offline; the registry half runs on its own schedule.
  step static patched-deps node scripts/testing/patched-dependencies-gate.mjs --check
  step static engines node scripts/testing/engines-node-gate.mjs
  step static lint pnpm lint --max-warnings 0
  step static format pnpm format:check
  # The typecheck CI runs: every package and the four apps. A build of the root
  # project references alone covers six packages and none of the apps. One task
  # at a time, because the api typecheck needs about 6 GB of heap on its own and
  # two such compilers side by side exhaust a 9 GB machine; turbo hands
  # NODE_OPTIONS to its tasks in strict environment mode.
  step static typecheck env NODE_OPTIONS=--max-old-space-size=6144 pnpm exec turbo run typecheck --concurrency=1
  step static syncpack pnpm dlx syncpack@15.3.3 lint --dependency-types prod,dev,peer,overrides
  # The dedupe gate of CI's Dependency Consistency job: without it only CI sees a
  # flattenable duplicate, after a push (measured on pull request #408). It runs at
  # error level: a resolution prints pnpm's deprecation and peer notices as warnings,
  # which the frozen install never shows; a failing check still prints its duplicates.
  step static dedupe pnpm dedupe --check --loglevel=error
  step static knip node scripts/knip-ratchet.mjs
  # The duplicate-code gate of CI's code-quality job: it fails a new clone and a
  # stale baseline entry, and without it here only CI would see either.
  step static duplicates pnpm check:duplicates
  # The story gate of the same job: each component root's count of components
  # without a sibling story must equal its committed baseline, so a new component
  # without a story fails it and so does a baseline left above the tree.
  step static stories-gate pnpm check:stories
  # The JSDoc gate (fitness #47 in CI): every in-scope file this branch adds or modifies against
  # its merge base with origin/main ends with zero violations of eslint.jsdoc.config.ts.
  step static jsdoc pnpm check:jsdoc
  # Fitness #45: every legal inventory page is current and every row classified.
  step static legal pnpm check:legal
  # Every support page current, every doc on the template, every tree candidate classified.
  step static support pnpm check:support
  # The dependency-usage record is current, every owner decision is well formed and still applies,
  # and the pending count equals its baseline.
  step static deps-ledger pnpm check:deps-ledger
  # Fitness #51: every portal's catalogs match the locales its routing declares, every leaf is a
  # string that parses as ICU, and every locale carries the default locale's keys and argument names.
  step static i18n pnpm check:i18n
  # The architecture gate of audit.yml: dependency-cruiser's layer rules and its
  # `no-circular` cycle check over one resolved import graph. Its `warn`-severity
  # rules print `warn` lines, which this battery reads as RED.
  step static architecture pnpm check:architecture
  # Fitness #37: no coverage floor of apps/api/vitest.config.ts descends against origin/main unless
  # a canon-exception marker of its own covers the descent, and a decorative-demolition marker names
  # a slice the committed ledger records as deleted with that descent. CI runs it on pull_request
  # only, so without this step a lowered floor was first seen on the pull request.
  step static floors node scripts/testing/coverage-floor-gate.mjs
  # Fitness #54: every test block this branch deletes or rewrites against origin/main is moved, a
  # node:test block, a behaviour change, or covered by a committed mutation-diff record. CI runs it
  # on pull_request only, so without this step a missing record was first seen on the pull request.
  # --retire-check also holds the gate's counted classes to the real ledger: a class no row carries
  # any more fails the step with "delete it", so the gate sheds a class once its population is gone.
  step static record-coverage node scripts/testing/record-coverage-gate.mjs --retire-check
  # Fitness #52: the committed test ledger and its page are what the tree yields, and every
  # overlay entry and slice assignment applies.
  step static ledger pnpm check:ledger
  # Fitness #53: per tracked file, its Spanish lines and its personal-name mentions equal
  # scripts/testing/artifact-language-baseline.json in both directions. It reads git's listing only.
  step static artifact-language pnpm check:artifact-language
  # Every client story as a vitest browser test in headless Chromium: it renders,
  # its play function runs, and axe at `error` and the console contract can fail it.
  # The preflight turns a missing browser into a one-line verdict instead of a
  # Playwright stack trace deep in the run; nothing is downloaded either way.
  # Quoting, outside in: the step runs `bash -c "<double-quoted>"`, which expands
  # STORIES_PREFLIGHT once; node then receives the single-quoted JavaScript whole.
  # The probe's own error (an ENOENT naming the missing binary) stays on stderr,
  # followed by the remedy, so an unrelated failure is never mislabelled.
  local STORIES_PREFLIGHT='require("fs").accessSync(require("playwright").chromium.executablePath())'
  step suite stories bash -c "pnpm --filter @apps/client exec node -e '$STORIES_PREFLIGHT' || { echo 'stories: the Playwright Chromium probe failed (see the error above); if the browser is missing, run: pnpm --filter @apps/client exec playwright install chromium' >&2; exit 1; }; exec pnpm --filter @apps/client test:stories"
  step suite scripts pnpm --filter @apps/api exec vitest run tests/unit/scripts/
  step suite api-common pnpm --filter @packages/api-common test
  step suite workers pnpm --filter @apps/workers test
  # The two portals' unit suites (vitest + jsdom), the commands of CI's Frontend
  # Tests job in its order: admin, then client. Without them a commit this battery
  # certifies GREEN had run neither portal's unit tests, only their stories.
  step suite admin pnpm --filter @apps/admin test
  step suite client pnpm --filter @apps/client test
  # The api suite runs twice in a row: a test that passes once and fails once is a
  # failure, and only a second run can see it.
  for n in 1 2; do
    step suite -C apps/api "api-$n" env NODE_OPTIONS=--max-old-space-size=4096 \
      pnpm exec vitest run --reporter=default --reporter=json --outputFile.json="$OUT/api-$n.json"
  done
  step suite -C apps/api tier env TIER=pr-integration bash scripts/run-tests.sh
  # Shows the tier's totals to the reader; it is not a gate. The gate is the tier
  # step's exit code above, and apps/api/scripts/run-tests.sh already fails on its
  # own when a tier collects zero tests. Only a full run has run the tier step.
  if [ "$LIST" -eq 0 ] && [ "$STATIC" -eq 0 ]; then
    grep '^TOTAL' "$OUT/tier.log" || echo "tier: tier.log carries no TOTAL line to show; the tier step's exit code above is its result"
  fi
  step static audit-end pnpm audit --audit-level low
}

# Every mode first walks the declarations as a listing: --list prints that walk,
# and a run starts only once every declaration has named its kind, so a
# malformed one refuses the run before any gate has run. The walk expands each
# declaration's arguments without running them, and one names a file in the log
# directory, which no run has chosen yet.
OUT=
PLAN=$(
  LIST=1
  battery_steps
) || exit 2
if [ "$LIST" -eq 1 ]; then
  printf '%s\n' "$PLAN"
  exit 0
fi

# Every gate runs under `timeout`. It ships with GNU coreutils and is absent
# from a stock macOS, where every step would otherwise record exit 127 and the
# verdict would say nothing about why.
if ! command -v timeout >/dev/null 2>&1; then
  echo "battery: 'timeout' is not on PATH; every gate runs under it, so a hung gate is killed and recorded as a failing step instead of leaving the battery without a verdict" >&2
  echo "battery: it ships with GNU coreutils (on macOS, Homebrew's coreutils provides it in its libexec/gnubin directory)" >&2
  exit 2
fi
if [ "$HAS_WORKTREE" -eq 1 ]; then
  cd "$WORKTREE" || { echo "battery: cannot enter $WORKTREE" >&2; exit 2; }
fi
WT=$(git rev-parse --show-toplevel) || { echo "battery: $PWD is not inside a git repository" >&2; exit 2; }
cd "$WT" || exit 2

# The state lives in the MAIN repository root, shared by every linked worktree,
# so a verdict recorded from one worktree is visible from all of them.
COMMON_DIR=$(git rev-parse --path-format=absolute --git-common-dir) || exit 2
MAIN_ROOT=$(dirname "$COMMON_DIR")
STATE_DIR=$MAIN_ROOT/.claude/state

# A static run neither requires nor reads the environment file: no static step
# needs a database, a queue or a browser.
if [ "$STATIC" -eq 0 ]; then
  ENV_FILE=${BATTERY_ENV_FILE:-$MAIN_ROOT/.env.test}
  if [ ! -f "$ENV_FILE" ]; then
    echo "battery: environment file not found: $ENV_FILE" >&2
    echo "battery: it must define DATABASE_URL, MIGRATE_DATABASE_URL, SHADOW_DATABASE_URL and REDIS_URL; BATTERY_ENV_FILE names another file" >&2
    exit 2
  fi
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

# A battery certifies a commit, so it refuses a tree that is not that commit. A
# static run certifies nothing and also serves before a commit, so it only says
# what the steps that read commits will not see.
if ! START_STATUS=$(git status --porcelain); then
  echo "battery: git status failed in $WT" >&2
  exit 2
fi
if [ -n "$START_STATUS" ]; then
  if [ "$STATIC" -eq 0 ]; then
    echo "battery: the tree is not clean, and a battery certifies a commit:" >&2
    printf '%s\n' "$START_STATUS" >&2
    exit 2
  fi
  CHANGED_PATHS=$(printf '%s\n' "$START_STATUS" | wc -l)
  echo "battery: static run on a tree with $CHANGED_PATHS changed path(s); jsdoc, record-coverage and floors read commits and see only what is committed" >&2
fi
SHA=$(git rev-parse HEAD) || exit 2
TREE=$(git rev-parse 'HEAD^{tree}') || exit 2

if [ "$STATIC" -eq 0 ]; then
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE" || { echo "battery: $ENV_FILE could not be sourced" >&2; exit 2; }
  set +a
fi

# A static run never takes BATTERY_OUT: a caller-chosen directory could be a
# full run's, and a static run must neither overwrite a full run's evidence nor
# be mistaken for it.
if [ "$STATIC" -eq 1 ]; then
  OUT=$STATE_DIR/battery-static-logs/$SHA
else
  OUT=${BATTERY_OUT:-$STATE_DIR/battery-logs/$SHA}
fi
mkdir -p "$OUT" || { echo "battery: cannot create the log directory $OUT" >&2; exit 2; }
OUT=$(cd "$OUT" && pwd -P) || exit 2
# A previous run's logs must not leak into this verdict. Only the kinds of file
# this script writes are removed: BATTERY_OUT may name any directory, and a
# recursive delete of a caller-chosen path is never safe. The verdict reads no
# other kind, so the guarantee is the same.
rm -f -- "$OUT"/*.log "$OUT"/*.json "$OUT/steps.tsv"

STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
date -u
git rev-parse --short HEAD

battery_steps

# A static run ends here, before the verdict: it writes no state file, so
# nothing it reports can stand for a full run's certification. Its logs are
# judged by battery-static.mjs with evaluateBattery, the full verdict's own
# rules from the worktree's battery-verdict.mjs (the module a full run of this
# worktree would use), so a warning the full battery would refuse turns this
# run RED too. Neither module writes: the state file is battery-state.mjs's to
# write, and it is not called. The expected step count is the static plan's,
# and no tree-change check is passed, because a static run accepts a dirty tree.
if [ "$STATIC" -eq 1 ]; then
  date -u
  echo "static logs: $OUT"
  STATIC_PLANNED=$(printf '%s\n' "$PLAN" | wc -l)
  node scripts/testing/battery-static.mjs "$OUT" "$STATIC_PLANNED"
  STATIC_CODE=$?
  if [ "$STATIC_CODE" -gt 1 ]; then
    echo "STATIC RED: node exited $STATIC_CODE before it printed the static result; a static run certifies nothing"
    exit 1
  fi
  exit "$STATIC_CODE"
fi

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
