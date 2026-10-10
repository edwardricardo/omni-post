#!/usr/bin/env bash
# Run the API's node:test integration suites. This is the integration collector
# and nothing else: Vitest collects the unit tier (tests/unit/**, tests/eval/**)
# from the tree on its own (vitest.config.ts, `pnpm test`), and this script never
# starts it, so no unit test runs twice and no Vitest verdict is folded into this
# one. `pnpm test:all` runs the two in sequence.
#
# The integration and flow suites (tests/**, outside tests/unit and tests/eval)
# stay on node:test because they depend on real services (PostgreSQL, Redis, and
# for the live tier a running API). Their file name says which tier runs them:
# the services tier is COLLECTED by its suffix, every `*.integration.test.ts`
# under tests/ (`collect integration`), so a new suite runs without anyone
# editing this file. The live tier is still the hand-listed live-API batches at
# the end, until it is collected by its own suffix too (WU-1.8); a
# `*.live.test.ts` no live batch names runs nowhere, and fitness #30 counts it.
# Before each file of those batches the runner probes the API and the workers
# (`probe_live`). `--list` prints the inventory without running anything. No test
# total appears here on purpose — a count in a comment rots.

set -e
export NODE_ENV=test

TOTAL_TESTS=0
TOTAL_PASS=0
TOTAL_FAIL=0
TOTAL_CANCEL=0
TOTAL_SKIP=0
FAILED_BATCHES=""
# One line per failed file, "<path>: <reasons>", printed under the failed batches.
FAILED_FILES=""
# The last file run_file ran, and the record of a live-tier readiness probe that
# failed, which names the file it stopped before and that last one.
LAST_RAN=""
ENV_UNREADY=""

# TIER selects which slice of the node:test inventory runs, so CI can split it
# across jobs:
#   (unset)          local default — the services tier and the live-API batches,
#                    without the skip and zero-collection guards, which are
#                    tier-only.
#   pr-integration   the services tier only (no live API server needed).
#   full-integration the services tier, then the live-API batches.
# The services tier talks to Postgres/Redis directly; the live-API batches need a
# running API, which the runner probes at TEST_API_URL, and the workers that
# answer TEST_WORKERS_READY_URL.
TIER="${TIER:-}"
case "$TIER" in
  "" | pr-integration | full-integration) ;;
  *)
    echo "Unknown TIER='$TIER' (expected: unset, pr-integration, full-integration)" >&2
    exit 2
    ;;
esac

# TEST_ORDER=reverse runs the collected services tier in reverse byte order, so a
# suite that only passes after another one has run shows up as a red.
TEST_ORDER="${TEST_ORDER:-}"
case "$TEST_ORDER" in
  "" | forward | reverse) ;;
  *)
    echo "Unknown TEST_ORDER='$TEST_ORDER' (expected: unset, forward, reverse)" >&2
    exit 2
    ;;
esac

# The only argument is `--list`; anything else is refused rather than ignored, so
# a path handed to the runner is never mistaken for a filter it does not have.
LIST_ONLY=""
case "$*" in
  "") ;;
  --list) LIST_ONLY=1 ;;
  *)
    echo "run-tests.sh: unknown arguments '$*' (expected none, or --list)" >&2
    exit 2
    ;;
esac

RUNNER_PATH="${BASH_SOURCE[0]}"
# The quarantine is shared with the reach engine of packages/test-contracts. The
# variable exists for the runner's own behaviour suite, which points it at a
# fixture; no workflow sets it.
QUARANTINE_FILE="${QUARANTINE_FILE:-$(dirname "$RUNNER_PATH")/../../../packages/test-contracts/quarantine.json}"

# Prints every `*.<suffix>.test.ts` under tests/, outside tests/unit (the unit
# tier, collected elsewhere), one per line in byte order, or in reverse byte
# order under TEST_ORDER=reverse.
collect() {
  local suffix="$1" order=""
  case "$TEST_ORDER" in
    reverse) order="-r" ;;
  esac
  find tests -path tests/unit -prune -o -type f -name "*.$suffix.test.ts" -print | LC_ALL=C sort $order
}

# Prints the files the live-API batches at the end of this script name, once each
# and in their order, read from this script's own text. Until the live tier is
# collected by its suffix (WU-1.8), those batches ARE the live tier, and they still
# hold some `*.integration.test.ts` suites: the services tier leaves those to them,
# so no file runs twice. Comment lines are skipped. Exits 3 when the section's
# opening or closing line is missing, so a rewrite of it cannot turn this list
# silently empty.
live_section_files() {
  awk '
    /^if run_live_api_batches; then$/ { inside = 1; opened = 1; next }
    /^fi [#] run_live_api_batches$/ { inside = 0; closed = 1; next }
    inside && $1 !~ /^[#]/ {
      for (i = 1; i <= NF; i++) if ($i ~ /^tests\/.*\.test\.ts$/ && !seen[$i]++) print $i
    }
    END { if (!opened || !closed) exit 3 }
  ' "$RUNNER_PATH"
}

# The quarantine: suites known not to pass yet, each with the reason, the owner
# and the date it entered, printed on every run and run nowhere. The file serves
# this runner and the reach engine alike, so it has the engine's shape,
# `{ "entries": [{ "path", "reason", "owner", "since" }] }`, with paths from the
# repository root; this runner applies the entries under apps/api/tests/ and
# leaves the rest to their own collectors. A missing or malformed file, an entry
# with an empty field, an entry for a file that does not exist, and an entry for a
# file a live-API batch names (those batches read no quarantine before WU-1.8)
# all stop the run before any suite starts: a quarantine that cannot be trusted
# must not decide what runs. QUARANTINE holds one `<path>\t<reason>` line each.
QUARANTINE=""
load_quarantine() {
  local live path reason
  if ! jq -e '(.entries | type == "array") and all(.entries[]; [.path, .reason, .owner, .since] | all(type == "string" and length > 0))' "$QUARANTINE_FILE" >/dev/null 2>&1; then
    echo "run-tests.sh: the quarantine '$QUARANTINE_FILE' is missing, is not JSON, or has an entry without a non-empty path, reason, owner and since." >&2
    return 2
  fi
  QUARANTINE=$(jq -r '.entries[] | select(.path | startswith("apps/api/tests/")) | [(.path | ltrimstr("apps/api/")), .reason] | @tsv' "$QUARANTINE_FILE")
  if ! live=$(live_section_files); then
    echo "run-tests.sh: the live-API section of $RUNNER_PATH cannot be read, so the quarantine cannot be checked against it." >&2
    return 2
  fi
  while IFS=$'\t' read -r path reason; do
    if [ -z "$path" ]; then
      continue
    fi
    if [ ! -f "$path" ]; then
      echo "run-tests.sh: the quarantine names apps/api/$path, which does not exist; remove the entry." >&2
      return 2
    fi
    if printf '%s\n' "$live" | grep -Fxq -- "$path"; then
      echo "run-tests.sh: the quarantine names apps/api/$path, which a live-API batch runs; those batches read no quarantine yet." >&2
      return 2
    fi
  done <<< "$QUARANTINE"
}

# Succeeds when the quarantine holds `$1`.
is_quarantined() {
  printf '%s\n' "$QUARANTINE" | cut -f1 | grep -Fxq -- "$1"
}

# Fills SERVICES_FILES with the services tier: every file `collect integration`
# prints, except the ones a live-API batch still names and the quarantined ones.
# Fails when that leaves nothing: a collection that found no suite is a wrong
# working directory or a moved tests/ tree, never an empty pass.
SERVICES_FILES=()
resolve_services_files() {
  local live file
  if ! live=$(live_section_files); then
    return 1
  fi
  SERVICES_FILES=()
  while IFS= read -r file; do
    if [ -z "$file" ] || printf '%s\n' "$live" | grep -Fxq -- "$file" || is_quarantined "$file"; then
      continue
    fi
    SERVICES_FILES+=("$file")
  done < <(collect integration)
  [ "${#SERVICES_FILES[@]}" -gt 0 ]
}

# What both modes print when the services collection comes back empty.
NO_SERVICES_MESSAGE="run-tests.sh: collect integration found no *.integration.test.ts to run under tests/ in $(pwd); run it from apps/api."

# --list prints the inventory and runs nothing: one `<kind>\t<path>` line per file
# this runner owns — `integration` for the services tier, `live` for the files the
# live-API batches name, `quarantined` for each quarantine entry it applies. It
# reads only the tree, this script and the quarantine, so it sits above the
# database refusal and needs no DATABASE_URL, and TIER does not change it. A file
# under tests/ it does not print as `integration` or `live` is one nothing here
# runs: fitness #30 counts those.
if [ -n "$LIST_ONLY" ]; then
  load_quarantine || exit 2
  if ! resolve_services_files; then
    echo "$NO_SERVICES_MESSAGE" >&2
    exit 1
  fi
  printf 'integration\t%s\n' "${SERVICES_FILES[@]}"
  live_section_files | while IFS= read -r file; do
    printf 'live\t%s\n' "$file"
  done
  printf '%s\n' "$QUARANTINE" | while IFS=$'\t' read -r file reason; do
    if [ -n "$file" ]; then
      printf 'quarantined\t%s\n' "$file"
    fi
  done
  exit 0
fi

# The database is never guessed. The suites write to the database and Redis they
# reach, and some delete rows or flush keys there, while the repository root also
# holds `.env`, the development environment, whose services other checkouts
# share. So this script reads no environment file: the caller exports the test
# environment (CI in the job's env block, the local battery from .env.test, a
# developer by hand), and an empty DATABASE_URL stops the run before any suite
# starts. TIER unset is no exception, since a local run has as much to lose.
if [ -z "${DATABASE_URL:-}" ]; then
  {
    echo "run-tests.sh: DATABASE_URL is empty, so there is no test database to run the integration suites against."
    echo "  Export the test environment first, from the repository root:"
    echo "    set -a; . ./.env.test; set +a"
    echo "  .env.test is untracked (a linked worktree uses the main checkout's): copy it from"
    echo "  .env.test.example and point it at a test database, or write it with"
    echo "  scripts/ci-setup-test-env.sh from an exported DATABASE_URL and REDIS_URL."
  } >&2
  exit 2
fi

# The quarantine and the services collection are settled before anything starts,
# so a quarantine that cannot be trusted or a collection that found nothing ends
# the run without running a single suite.
load_quarantine || exit 2
if ! resolve_services_files; then
  echo "$NO_SERVICES_MESSAGE" >&2
  exit 1
fi

# Returns success when the services tier should run for the current TIER: always.
run_services_tier() {
  [ -z "$TIER" ] || [ "$TIER" = "pr-integration" ] || [ "$TIER" = "full-integration" ]
}

# Returns success when live-API node:test batches should run for the current TIER.
run_live_api_batches() {
  [ -z "$TIER" ] || [ "$TIER" = "full-integration" ]
}

# The live tier reads where the API and the workers answer from its caller, as the
# runner reads the database: CI exports both URLs. A run that reaches the live
# tier without them stops here, instead of failing its first readiness probe after
# the whole services tier has run.
if run_live_api_batches && { [ -z "${TEST_API_URL:-}" ] || [ -z "${TEST_WORKERS_READY_URL:-}" ]; }; then
  {
    echo "run-tests.sh: TEST_API_URL or TEST_WORKERS_READY_URL is empty, so the live tier has no API or workers to probe."
    echo "  Export both (a local stack answers at http://localhost:3000 and"
    echo "  http://localhost:3300/health/ready), or set TIER=pr-integration to run the services tier alone."
  } >&2
  exit 2
fi

# Succeeds when the API answers its health route and the workers report ready,
# which their health server does only once a consumer is registered on the publish
# queue. One attempt each, no retry: `-f` fails on any status from 400 up, a 429
# from a rate-limit window the previous file left closed included, so a file that
# leaves the environment unready is the one that must restore it. `--max-time`
# bounds a probe of a server that accepts the connection and never answers.
probe_live() {
  curl -fsS --max-time 10 -o /dev/null "$TEST_API_URL/health" &&
    curl -fsS --max-time 10 -o /dev/null "$TEST_WORKERS_READY_URL"
}

# Runs ONE suite file in its own node:test process and gives it its own verdict,
# so every guard reads one file's summary and a red names the file. Handed a
# whole batch at once, node read back one summary: a file that collected nothing
# hid behind its siblings' counts, and a listed path that no longer existed was
# dropped without a word (SMELL-74). Its verdict goes back to run_batch in FILE_*.
run_file() {
  local file="$1"
  # The per-test budget node:test applies to every test and hook. It is the only time
  # bound a batch has; a suite that needs longer passes `{ timeout }` to its own tests
  # and hooks, which overrides it (a `describe` option does not).
  local timeout="${TIMEOUT:-30000}"

  local extra_flags="${EXTRA_FLAGS:-}"

  local result
  # The runner's own exit code is CAPTURED, not discarded. A batch can end
  # non-zero while reporting "# fail 0" — a crash after the summary, an
  # unhandled rejection, a failed hook whose subtests are cancelled — and a gate
  # that reads only the counts calls all of those green.
  local runner_exit=0
  # Pin the TAP reporter: the summary parser below greps "# tests N" (TAP
  # format). Node's default reporter is version/TTY-dependent (spec emits
  # "ℹ tests N"), which silently parses as 0 tests.
  # --conditions development: opt into the `development`->src export branch so
  # bare workspace specifiers resolve from src against an unbuilt tree (the flag
  # is on the command, NOT NODE_OPTIONS — GitHub Actions restricts NODE_OPTIONS
  # from GITHUB_ENV). See change dev-prod-resolution-model.
  # --test-concurrency=1: the process holds one file, and a batch's files run
  # one after another, so no two suites ever share the database at once.
  result=$(node --conditions development --import tsx --test --test-reporter=tap --test-reporter-destination=stdout --test-force-exit --test-concurrency=1 --test-timeout="$timeout" $extra_flags "$file" 2>&1) || runner_exit=$?

  local tests=$(echo "$result" | grep "^# tests " | tail -1 | awk '{print $3}')
  local pass=$(echo "$result" | grep "^# pass " | tail -1 | awk '{print $3}')
  local fail=$(echo "$result" | grep "^# fail " | tail -1 | awk '{print $3}')
  local cancel=$(echo "$result" | grep "^# cancelled " | tail -1 | awk '{print $3}')
  local skip=$(echo "$result" | grep "^# skipped " | tail -1 | awk '{print $3}')
  tests=${tests:-0}; pass=${pass:-0}; fail=${fail:-0}; cancel=${cancel:-0}; skip=${skip:-0}

  # node:test reports a file that registers no test at all as ONE passing test
  # named by the file's own path, so an emptied suite reads "# tests 1". Only a
  # one-file run can tell that test from a real one.
  if [ "$tests" -eq 1 ] && [ "$pass" -eq 1 ] && echo "$result" | grep -Fxq "ok 1 - $file"; then
    tests=0
    pass=0
  fi

  TOTAL_TESTS=$((TOTAL_TESTS + tests))
  TOTAL_PASS=$((TOTAL_PASS + pass))
  TOTAL_FAIL=$((TOTAL_FAIL + fail))
  TOTAL_CANCEL=$((TOTAL_CANCEL + cancel))
  TOTAL_SKIP=$((TOTAL_SKIP + skip))

  # Each guard adds its reason, so the verdict line names every one that fired.
  local reasons=""
  if [ "$fail" -gt 0 ]; then reasons="${reasons:+$reasons, }$fail failed"; fi
  # A CANCELLED test is a test that did not run, and Node reports a broken
  # `before` hook as cancelled subtests with "# fail 0" — so a batch whose whole
  # setup collapsed used to print OK. A gate that cannot go red on its own setup
  # gates nothing, which matters most for the batches called merge-blocking.
  if [ "$cancel" -gt 0 ]; then reasons="${reasons:+$reasons, }$cancel cancelled"; fi
  # A SKIPPED test is a test that did not run either, and the reason it did not
  # run in a tier-driven batch is almost always a service the tier was supposed
  # to provide. The counts stay clean, so without this term the batch prints OK
  # and the run exits zero over tests nobody executed — the same class the cancel
  # and zero-collect terms already close, one term short. Tier-scoped like the
  # zero-collect term below: a developer trimming a batch locally is exercising
  # their own choice, not a missing service.
  if [ -n "${TIER:-}" ] && [ "$skip" -gt 0 ]; then reasons="${reasons:+$reasons, }$skip skipped under TIER"; fi
  # A file that collected NOTHING is a failure too. Every path below names a
  # suite, so zero collected means a suite stopped being found: a
  # renamed path the list still carries, an emptied file, a suite-wide skip, or a
  # collection error --test-force-exit swallowed. The file already dumps its
  # output for this case; without this it dumped and still reported OK. Scoped to
  # tier-driven runs so a developer trimming a batch list locally is not blocked.
  if [ -n "${TIER:-}" ] && [ "$tests" -eq 0 ]; then reasons="${reasons:+$reasons, }zero tests"; fi
  if [ "$runner_exit" -ne 0 ]; then reasons="${reasons:+$reasons, }exit $runner_exit"; fi

  FILE_EXIT=$runner_exit FILE_REASONS=$reasons
  if [ -z "$reasons" ]; then
    FILE_VERDICT="OK"
    printf "    ✓ %s (%s tests)\n" "$file" "$tests"
  else
    FILE_VERDICT="FAIL"
    printf "    ✗ %s: %s\n" "$file" "$reasons"
  fi

  # A failing (or zero-collected) file must never be silent — dump the runner
  # output so CI logs show WHY, not just the count.
  if [ "$FILE_VERDICT" = "FAIL" ] || [ "$tests" -eq 0 ]; then
    # Name every failure FIRST. The tail window alone cannot: when a later
    # green suite floods the last 200 lines, the failing test scrolls out and
    # the log reports "fail 1" without ever naming it — the 'production'
    # batch produced two consecutive red CI runs whose logs never said which
    # test failed. Each top-level or nested 'not ok' line is printed with its
    # TAP YAML detail block (up to its closing '...'), bounded per failure so
    # a pathological block cannot flood the log. Anchored to line start:
    # a test NAME containing "not ok" (they exist in this suite) sits after
    # "ok N - " and must not trigger the printer.
    echo "── failures in '$file' (every 'not ok' + its detail block) ──"
    echo "$result" | awk '
      /^[[:space:]]*not ok / { printing = 1; budget = 40 }
      printing { print; budget-- }
      printing && (/^[[:space:]]*\.\.\.$/ || budget <= 0) { printing = 0 }
    '
    echo "── output of '$file' (last 200 lines) ──"
    echo "$result" | tail -200
    echo "── end of '$file' output ──"
  fi
}

# Runs each file a batch lists through run_file and prints one summary row: its
# counts are what its files added to the totals. The batch is recorded failed
# when any of its files is. A caller that sets BATCH_PROBE names a readiness check
# run before each file; the first one that fails stops the batch there.
run_batch() {
  local name="$1"
  shift
  local tests0=$TOTAL_TESTS pass0=$TOTAL_PASS fail0=$TOTAL_FAIL cancel0=$TOTAL_CANCEL skip0=$TOTAL_SKIP
  # The first non-zero runner exit among the files; each one's is on its own line.
  local runner_exit=0 failed_files=0 file
  # After a failed readiness probe no probed file runs, here or in a later batch.
  if [ -n "${BATCH_PROBE:-}" ] && [ -n "$ENV_UNREADY" ]; then
    return 0
  fi

  for file in "$@"; do
    # A failed probe names the file it stops before and the last file run: that
    # one left the environment unready, or it went down while that one ran. The
    # files after it would only fail for the same reason, so none of them runs.
    if [ -n "${BATCH_PROBE:-}" ] && ! "$BATCH_PROBE"; then
      ENV_UNREADY="env-unready-before: $file (last ran: ${LAST_RAN:-none})"
      printf "    ✗ %s\n" "$ENV_UNREADY"
      failed_files=$((failed_files + 1))
      FAILED_FILES="$FAILED_FILES
  $ENV_UNREADY"
      break
    fi
    # Reset before each call: should run_file ever run in a subshell (a pipe or
    # `$( )` around it), its verdict never arrives, and the file then fails for
    # want of one instead of passing on the previous file's.
    FILE_VERDICT="" FILE_REASONS="no verdict reached run_batch" FILE_EXIT=0
    run_file "$file"
    LAST_RAN=$file
    if [ "$runner_exit" -eq 0 ]; then runner_exit=$FILE_EXIT; fi
    if [ "$FILE_VERDICT" != "OK" ]; then
      failed_files=$((failed_files + 1))
      FAILED_FILES="$FAILED_FILES
  $file: $FILE_REASONS"
    fi
  done

  local status="OK"
  if [ "$failed_files" -gt 0 ]; then
    status="FAIL"
    FAILED_BATCHES="$FAILED_BATCHES $name"
  fi

  printf "  %-25s %4s tests  %4s pass  %s fail  %s cancel  %s skip  exit %s  [%s]\n" \
    "$name" "$((TOTAL_TESTS - tests0))" "$((TOTAL_PASS - pass0))" "$((TOTAL_FAIL - fail0))" \
    "$((TOTAL_CANCEL - cancel0))" "$((TOTAL_SKIP - skip0))" "$runner_exit" "$status"
}

echo "Running API integration tests..."
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# Integration tests via node:test (real DB + Redis; the live batches add an API)
# ─────────────────────────────────────────────────────────────────────────────
echo "── Integration tests (node:test) ──"

# The services tier: every collected `*.integration.test.ts` (resolve_services_files
# above), each in its own node:test process through run_batch, in byte order or in
# reverse under TEST_ORDER=reverse. The files run one after another, so no two
# suites share the database at once: the suites that race one credential on
# purpose, or park a row lock while polling for it, measure only their own
# interleaving. The quarantined ones are printed and not run.
if run_services_tier; then
  printf '%s\n' "$QUARANTINE" | while IFS=$'\t' read -r file reason; do
    if [ -n "$file" ]; then
      printf "  QUARANTINED (not run): %s — %s\n" "$file" "$reason"
    fi
  done
  run_batch "integration" "${SERVICES_FILES[@]}"
fi

# Live-API batches: these need a running API and its workers alongside the
# DB/Redis services. Each runs with probe_live before each of its files, so a file
# that leaves the API or the workers unready for the next one is named by the
# probe that follows it, rather than by the failures of every file after it.
if run_live_api_batches; then

BATCH_PROBE=probe_live run_batch "integration:routes" \
  tests/integration/crisisRoutes.live.test.ts tests/integration/linkRoutes.live.test.ts \
  tests/integration/security-endpoints.live.test.ts

BATCH_PROBE=probe_live run_batch "integration:flows" \
  tests/auth.integration.test.ts tests/audit.integration.test.ts tests/cache.integration.test.ts \
  tests/security.live.test.ts \
  tests/integration/publishing/failedWrite.smoke.integration.test.ts

# Saga customer flow against the live API. Listed here to close a blind spot:
# this suite existed on disk but belonged to no batch, so `test:all` never ran
# it.
BATCH_PROBE=probe_live run_batch "integration:saga-live" \
  tests/integration/sagaCustomerFlow.live.test.ts

BATCH_PROBE=probe_live run_batch "flow" \
  tests/publish.flow.integration.test.ts tests/analytics.flow.integration.test.ts tests/media.flow.integration.test.ts tests/schedule.flow.integration.test.ts

BATCH_PROBE=probe_live run_batch "remaining" \
  tests/accountLifecycle.integration.test.ts tests/trialPeriod.integration.test.ts \
  tests/mfa.integration.test.ts tests/rbac.integration.test.ts \
  tests/threading.canonical.integration.test.ts tests/threading.planner.integration.test.ts \
  tests/threading.xprovider.integration.test.ts tests/planPublication.integration.test.ts tests/adapters.integration.test.ts \
  tests/schemaUtils.integration.test.ts

BATCH_PROBE=probe_live run_batch "production" \
  tests/production.live.test.ts tests/multiproject.flow.live.test.ts tests/providerRegistry.live.test.ts

fi # run_live_api_batches

echo ""
echo "========================================"
printf "TOTAL: %d tests, %d pass, %d fail, %d cancel, %d skip\n" \
  "$TOTAL_TESTS" "$TOTAL_PASS" "$TOTAL_FAIL" "$TOTAL_CANCEL" "$TOTAL_SKIP"
echo "========================================"

# FAILED_BATCHES is the source of failure truth: a batch lands there on a parsed
# failure, on a cancellation, on a zero collection, on a non-zero runner exit AND
# on a failed readiness probe, so its non-emptiness is what makes the per-batch
# capture reach the gate. Without that term a batch could print [FAIL], dump its
# output, be named in the failed list — and the run still exit zero, which is
# worse than never noticing, because everything downstream believes the gate.
#
# The three count terms are therefore REDUNDANT today (every path that raises them
# also appends a batch name), and they are kept deliberately: they are the
# defence-in-depth half. Should a future edit narrow run_batch's append condition,
# a run with real failures must still go red on the counts alone. Do not "simplify"
# the disjunction back to one term — the static suite pins all four for this
# reason. The skip term is tier-scoped for the same reason run_file's is.
if [ "$TOTAL_FAIL" -gt 0 ] || [ "$TOTAL_CANCEL" -gt 0 ] || { [ -n "${TIER:-}" ] && [ "$TOTAL_SKIP" -gt 0 ]; } || [ -n "$FAILED_BATCHES" ]; then
  echo "FAILED batches:$FAILED_BATCHES"
  if [ -n "$FAILED_FILES" ]; then
    echo "FAILED files:$FAILED_FILES"
  fi
  if [ -n "$ENV_UNREADY" ]; then
    echo "ERROR: the live tier stopped at $ENV_UNREADY. The readiness"
    echo "       probe failed before that file, and its curl error is printed above: the"
    echo "       file that ran last left the API or the workers unready, or one of them"
    echo "       went down while it ran. The live files after it did not run."
  elif [ -n "${TIER:-}" ] && [ "$TOTAL_SKIP" -gt 0 ] && [ "$TOTAL_FAIL" -eq 0 ] && [ "$TOTAL_CANCEL" -eq 0 ]; then
    echo "ERROR: $TOTAL_SKIP test(s) were SKIPPED — a skipped test never ran, and in"
    echo "       a TIER-driven run the reason is a service the tier was supposed to"
    echo "       provide. Start the service the batch names; do not skip past it."
    echo "       A batch runner may ALSO have exited non-zero here — read the 'exit'"
    echo "       column and the dumped output before concluding skips were the whole"
    echo "       story."
  elif [ "$TOTAL_FAIL" -eq 0 ] && [ "$TOTAL_CANCEL" -eq 0 ]; then
    echo "ERROR: every test that ran reported passing, yet a file's runner exited"
    echo "       non-zero, or a file collected nothing. A crash after the summary,"
    echo "       an unhandled rejection, or a listed path that no longer exists all"
    echo "       end this way — with nothing in the counts to show for it."
    echo "       See the FAILED files lines above for each file and its reasons;"
    echo "       its dumped output follows its verdict line."
  elif [ "$TOTAL_FAIL" -eq 0 ]; then
    echo "ERROR: $TOTAL_CANCEL test(s) were CANCELLED — a cancelled test never ran."
    echo "       Node reports a broken before/after hook this way, with '# fail 0'."
  fi
  exit 1
fi

# A crashed node:test process yields a 0/0/0 summary that would otherwise pass
# silently. In CI tiers this script is a load-bearing gate, so zero collected
# tests is a failure, never a green.
if [ -n "${TIER:-}" ] && [ "$TOTAL_TESTS" -eq 0 ]; then
  echo "ERROR: TIER=$TIER collected 0 tests — refusing to pass a vacuous run."
  exit 1
fi

exit 0
