#!/usr/bin/env bash
# Run the API's node:test integration suites. This is the integration collector
# and nothing else: Vitest collects the unit tier (tests/unit/**, tests/eval/**)
# from the tree on its own (vitest.config.ts, `pnpm test`), and this script never
# starts it, so no unit test runs twice and no Vitest verdict is folded into this
# one. `pnpm test:all` runs the two in sequence.
#
# The integration and flow suites (tests/**, outside tests/unit and tests/eval)
# stay on node:test because they depend on real services (PostgreSQL, Redis, and
# for the live tier a running API and its workers). Their file name says which
# tier runs them, and each tier is COLLECTED by its suffix, so a new suite runs
# without anyone editing this file: the services tier is every
# `*.integration.test.ts` under tests/ (`collect integration`), the live tier
# every `*.live.test.ts` (`collect live`), and the runner probes the API and the
# workers before each live file (`probe_live`). `--list` prints the inventory
# without running anything, and paths narrow a run to those suites. No test total
# appears here on purpose — a count in a comment rots.

# select_files fills the tier arrays through a nameref (`local -n`), which bash 4.3
# introduced. An older bash would read the quarantine and then fail on that line
# with a message naming neither the version nor the fix, so the version is checked
# before anything else runs.
if [ "${BASH_VERSINFO[0]:-0}" -lt 4 ] || { [ "${BASH_VERSINFO[0]}" -eq 4 ] && [ "${BASH_VERSINFO[1]}" -lt 3 ]; }; then
  echo "run-tests.sh: needs bash 4.3 or later (select_files uses local -n); this is bash ${BASH_VERSION:-unknown}." >&2
  exit 2
fi

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
# The last file run_file ran, the record of a live-tier readiness probe that
# failed, which names the file it stopped before and that last one, and what that
# probe printed, which the final summary repeats beside the record.
LAST_RAN=""
ENV_UNREADY=""
PROBE_ERROR=""

# TIER selects which tiers run, so CI can split them across steps:
#   (unset)          local default — the services tier, then the live tier,
#                    without the skip and zero-collection guards, which are
#                    tier-only.
#   pr-integration   the services tier only (no live API server needed).
#   live-integration the live tier only, against an API and workers already
#                    running.
# CI runs pr-integration BEFORE it starts the API and the workers, and
# live-integration after: a running API advances every tenant's sagas from its
# own retry scan, so a services suite that shares the database with one races a
# second engine it never booted. The services tier talks to Postgres/Redis
# directly; the live tier needs a running API, which the runner probes at
# TEST_API_URL, and the workers that answer TEST_WORKERS_READY_URL.
TIER="${TIER:-}"
case "$TIER" in
  "" | pr-integration | live-integration) ;;
  *)
    echo "Unknown TIER='$TIER' (expected: unset, pr-integration, live-integration)" >&2
    exit 2
    ;;
esac

# Returns success when the current TIER runs the services tier.
run_services_tier() {
  [ -z "$TIER" ] || [ "$TIER" = "pr-integration" ]
}

# Returns success when the current TIER runs the live tier.
run_live_tier() {
  [ -z "$TIER" ] || [ "$TIER" = "live-integration" ]
}

# TEST_ORDER=reverse runs each collected tier in reverse byte order, so a suite
# that only passes after another one has run shows up as a red. TEST_ORDER=random
# runs each tier in an order drawn from TEST_SEED (order_by_seed), which catches a
# suite that only passes after any other one, wherever that one sorts.
TEST_ORDER="${TEST_ORDER:-}"
case "$TEST_ORDER" in
  "" | forward | reverse | random) ;;
  *)
    echo "Unknown TEST_ORDER='$TEST_ORDER' (expected: unset, forward, reverse, random)" >&2
    exit 2
    ;;
esac

# The seed is the only record of the order a random run took, printed before the
# first file so a red replays with TEST_SEED=<seed> instead of being hunted for.
# Unset, it is drawn here. It is held to the range node's --test-random-seed takes,
# because the same seed is meant to drive that flag inside each file, and to one
# spelling, because order_by_seed keys on its text, so 007 would not replay 7. A
# seed with no random order to drive is refused rather than ignored: the run would
# go in byte order and still read as the replay.
TEST_SEED="${TEST_SEED:-}"
SEED_PATTERN='^(0|[1-9][0-9]{0,9})$'
if [ "$TEST_ORDER" = "random" ]; then
  if [ -z "$TEST_SEED" ]; then
    # Three 15-bit draws give 45 bits; keeping the low 32 is uniform over exactly the
    # range accepted below, so an unseeded run can land on any seed a replay can name.
    TEST_SEED=$((((RANDOM << 30) | (RANDOM << 15) | RANDOM) & 0xFFFFFFFF))
  elif ! [[ "$TEST_SEED" =~ $SEED_PATTERN ]] || [ "$TEST_SEED" -gt 4294967295 ]; then
    echo "run-tests.sh: TEST_SEED='$TEST_SEED' is not an integer from 0 to 4294967295 written without leading zeros, the seeds node's --test-random-seed takes." >&2
    exit 2
  fi
  if ! command -v sha256sum >/dev/null; then
    echo "run-tests.sh: TEST_ORDER=random orders the suites with sha256sum, which is not on PATH." >&2
    exit 2
  fi
elif [ -n "$TEST_SEED" ]; then
  echo "run-tests.sh: TEST_SEED='$TEST_SEED' is set, but only TEST_ORDER=random reads a seed (TEST_ORDER='$TEST_ORDER'); set TEST_ORDER=random to replay it." >&2
  exit 2
fi

# The arguments are `--list` alone, or the paths, from apps/api, of the suites a
# run is narrowed to (`bash scripts/run-tests.sh tests/a.integration.test.ts`):
# each runs in its own tier, in the collection's order. Anything else is refused
# rather than ignored, a path once the collection is known (check_filter below):
# a path the run would not execute would run nothing and read as a pass.
LIST_ONLY=""
FILTER=""
for arg in "$@"; do
  if [ "$arg" = "--list" ]; then
    LIST_ONLY=1
  elif [[ "$arg" == -* ]]; then
    echo "run-tests.sh: unknown option '$arg' (expected --list, or the paths of suites to run)" >&2
    exit 2
  else
    FILTER="$FILTER${arg#./}"$'\n'
  fi
done
if [ -n "$LIST_ONLY" ] && [ "$#" -gt 1 ]; then
  echo "run-tests.sh: --list takes no other argument" >&2
  exit 2
fi

RUNNER_PATH="${BASH_SOURCE[0]}"
# The quarantine is shared with the reach engine of packages/test-contracts. The
# variable exists for the runner's own behaviour suite, which points it at a
# fixture; no workflow sets it.
QUARANTINE_FILE="${QUARANTINE_FILE:-$(dirname "$RUNNER_PATH")/../../../packages/test-contracts/quarantine.json}"

# The node:test reporter run_file reads its verdict from, handed to node as an
# absolute path: node takes a value with no leading `./` or `/` for a package
# name, and the runner may be called from any directory.
SUMMARY_REPORTER="$(CDPATH='' cd -- "$(dirname "$RUNNER_PATH")/../../.." && pwd)/scripts/testing/node-summary-reporter.mjs"
# The one line of the reporter's output run_file reads, matched whole.
SUMMARY_LINE='^@@SUMMARY tests=([0-9]+) pass=([0-9]+) fail=([0-9]+) cancelled=([0-9]+) skipped=([0-9]+) todo=([0-9]+)$'

# Prints every `*.<suffix>.test.ts` under tests/, outside tests/unit (the unit
# tier, collected elsewhere), one per line in byte order, in reverse byte order
# under TEST_ORDER=reverse, or in TEST_SEED's order under TEST_ORDER=random. The
# order reaches `sort` as an array, so the forward order passes it no argument
# rather than an empty word.
collect() {
  local suffix="$1"
  local -a sort_args=()
  case "$TEST_ORDER" in
    reverse) sort_args=(-r) ;;
  esac
  find tests -path tests/unit -prune -o -type f -name "*.$suffix.test.ts" -print | LC_ALL=C sort "${sort_args[@]}" | order_by_seed
}

# Under TEST_ORDER=random, prints the paths it reads ascending by the sha256 of
# "<TEST_SEED>\n<path>", so the order is a function of the seed and the paths
# alone: the same seed gives the same order on any machine, and no clock, process
# id or shuffling tool has a say. Any other order passes the paths through as
# they came.
order_by_seed() {
  local path digest
  if [ "$TEST_ORDER" != "random" ]; then
    cat
    return
  fi
  while IFS= read -r path; do
    digest=$(printf '%s\n%s' "$TEST_SEED" "$path" | sha256sum)
    printf '%s %s\n' "${digest%% *}" "$path"
  done | LC_ALL=C sort | cut -d ' ' -f 2-
}

# The quarantine: suites known not to pass yet, each with the reason, the owner
# and the date it entered, printed on every run and run nowhere. The file serves
# this runner and the reach engine alike, so it has the engine's shape,
# `{ "entries": [{ "path", "reason", "owner", "since" }] }`, with paths from the
# repository root; this runner applies the entries under apps/api/tests/ and
# leaves the rest to their own collectors. A missing or malformed file, an entry
# with an empty field and an entry for a file that does not exist all stop the
# run before any suite starts: a quarantine that cannot be trusted must not decide
# what runs. QUARANTINE holds one `<path>\t<reason>` line each.
QUARANTINE=""
load_quarantine() {
  local path reason
  if ! jq -e '(.entries | type == "array") and all(.entries[]; [.path, .reason, .owner, .since] | all(type == "string" and length > 0))' "$QUARANTINE_FILE" >/dev/null 2>&1; then
    echo "run-tests.sh: the quarantine '$QUARANTINE_FILE' is missing, is not JSON, or has an entry without a non-empty path, reason, owner and since." >&2
    return 2
  fi
  QUARANTINE=$(jq -r '.entries[] | select(.path | startswith("apps/api/tests/")) | [(.path | ltrimstr("apps/api/")), .reason] | @tsv' "$QUARANTINE_FILE")
  while IFS=$'\t' read -r path reason; do
    if [ -n "$path" ] && [ ! -f "$path" ]; then
      echo "run-tests.sh: the quarantine names apps/api/$path, which does not exist; remove the entry." >&2
      return 2
    fi
  done <<< "$QUARANTINE"
}

# Succeeds when the quarantine holds `$1`.
is_quarantined() {
  printf '%s\n' "$QUARANTINE" | cut -f1 | grep -Fxq -- "$1"
}

# Succeeds when no path was given, or when `$1` is one of the paths given.
is_named() {
  [ -z "$FILTER" ] || printf '%s' "$FILTER" | grep -Fxq -- "$1"
}

# Fills the array named `$2` with the tier `collect $1` finds: every file it
# prints that the quarantine does not hold and, when paths were given, that they
# name. Fails when the collection found no file at all, which is a wrong working
# directory or a moved tests/ tree, and, on a run of the whole tier, when the
# quarantine holds every file it found: either is an empty pass, never a run.
select_files() {
  local suffix="$1" collected file
  local -n selected="$2"
  selected=()
  collected=$(collect "$suffix")
  if [ -z "$collected" ]; then
    echo "run-tests.sh: collect $suffix found no *.$suffix.test.ts to run under tests/ in $(pwd); run it from apps/api." >&2
    return 1
  fi
  while IFS= read -r file; do
    if ! is_quarantined "$file" && is_named "$file"; then
      selected+=("$file")
    fi
  done <<< "$collected"
  if [ -z "$LIST_ONLY" ] && [ -z "$FILTER" ] && [ "${#selected[@]}" -eq 0 ]; then
    echo "run-tests.sh: the quarantine holds every *.$suffix.test.ts that collect $suffix found, so the tier would pass running nothing." >&2
    return 1
  fi
}

# Succeeds when every path given is a suite this run executes. Otherwise it names
# why the path will not run, since each cause is put right a different way: a
# quarantined suite runs nowhere until its entry leaves the quarantine, a path
# that is not there was given from the wrong directory or misspelt, a suite of a
# tier this TIER does not run needs another TIER, and any other file is one no
# tier collects. Both collections are read once, above the loop, since telling a
# suite of a tier this TIER skips from a file no tier collects needs both, and a
# run given no path reads neither.
check_filter() {
  local path selected services live
  [ -n "$FILTER" ] || return 0
  selected=$(printf '%s\n' "${SERVICES_FILES[@]}" "${LIVE_FILES[@]}")
  services=$(collect integration)
  live=$(collect live)
  while IFS= read -r path; do
    if [ -z "$path" ] || printf '%s\n' "$selected" | grep -Fxq -- "$path"; then
      continue
    fi
    if is_quarantined "$path"; then
      echo "run-tests.sh: $path is quarantined, so it runs nowhere until its entry leaves $QUARANTINE_FILE." >&2
    elif [ ! -e "$path" ]; then
      echo "run-tests.sh: $path does not exist in $(pwd); give each path from apps/api, as tests/<dir>/<file>." >&2
    elif printf '%s\n' "$services" | grep -Fxq -- "$path"; then
      echo "run-tests.sh: $path is a services-tier suite, and TIER=$TIER does not run the services tier; run it under TIER=pr-integration or with TIER unset." >&2
    elif printf '%s\n' "$live" | grep -Fxq -- "$path"; then
      echo "run-tests.sh: $path is a live-tier suite, and TIER=$TIER does not run the live tier; run it under TIER=live-integration or with TIER unset." >&2
    else
      echo "run-tests.sh: $path exists, but no tier of this runner collects it: the services tier runs each *.integration.test.ts and the live tier each *.live.test.ts, under tests/ outside tests/unit." >&2
    fi
    return 2
  done <<< "$FILTER"
}

# The quarantine and the collection are settled before anything starts, from the
# tree and the quarantine alone, so `--list` below needs no database, and a
# quarantine that cannot be trusted or a collection that found nothing ends the
# run without running a single suite. Each tier is collected wherever it would
# run, and for `--list` whatever TIER says.
SERVICES_FILES=()
LIVE_FILES=()
load_quarantine || exit 2
if [ -n "$LIST_ONLY" ] || run_services_tier; then
  select_files integration SERVICES_FILES || exit 1
fi
if [ -n "$LIST_ONLY" ] || run_live_tier; then
  select_files live LIVE_FILES || exit 1
fi
check_filter || exit 2

# --list prints the inventory and runs nothing: one `<kind>\t<path>` line per file
# this runner owns — `integration` for the services tier and `live` for the live
# tier, from the same collection a run executes, and `quarantined` for each
# quarantine entry it applies. It sits above the database refusal, so it needs no
# DATABASE_URL, and TIER does not change it. A file under tests/ it does not print
# as `integration` or `live` is one nothing here runs: fitness #30 counts those.
if [ -n "$LIST_ONLY" ]; then
  for file in "${SERVICES_FILES[@]}"; do
    printf 'integration\t%s\n' "$file"
  done
  for file in "${LIVE_FILES[@]}"; do
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

# The live tier reads where the API and the workers answer from its caller, as the
# runner reads the database: CI exports both URLs. A run that reaches the live
# tier without them stops here, instead of failing its first readiness probe after
# the whole services tier has run.
if run_live_tier && { [ -z "${TEST_API_URL:-}" ] || [ -z "${TEST_WORKERS_READY_URL:-}" ]; }; then
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
# bounds a probe of a server that accepts the connection and never answers, and
# `--connect-timeout` ends sooner a probe of a host that drops the connection. The
# worst case before a live file is the two `--max-time` in a row, 20 s, and the
# first probe that fails stops the tier, so that wait is paid once. curl's error,
# on stderr, is what run_batch captures and prints with the record, its first
# PROBE_ERROR_LINES lines of it.
# shellcheck disable=SC2317 # run_batch calls it through BATCH_PROBE, which shellcheck cannot follow
probe_live() {
  curl -fsS --connect-timeout 3 --max-time 10 -o /dev/null "$TEST_API_URL/health" &&
    curl -fsS --connect-timeout 3 --max-time 10 -o /dev/null "$TEST_WORKERS_READY_URL"
}

# The most lines of a failed probe's output that the record and the final summary
# keep. A probe that prints a long body before it fails would otherwise flood
# both; the lines past the limit are counted, not printed.
PROBE_ERROR_LINES=20

# Prints the first `$1` lines of `$2` and, when `$2` holds more, one line counting
# the ones it left out. It reads `$2` whole rather than piping it into `head`, so no
# writer is cut off mid-line and no broken-pipe error reaches the run's output.
first_lines() {
  local limit="$1" line total=0
  while IFS= read -r line; do
    total=$((total + 1))
    if [ "$total" -le "$limit" ]; then
      printf '%s\n' "$line"
    fi
  done <<< "$2"
  if [ "$total" -gt "$limit" ]; then
    printf '… %d more lines\n' "$((total - limit))"
  fi
}

# Prints each line of `$2` behind the indent `$1`.
print_indented() {
  local line
  while IFS= read -r line; do
    printf '%s%s\n' "$1" "$line"
  done <<< "$2"
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

  # EXTRA_FLAGS holds node flags separated by spaces. Read into an array, each flag
  # reaches node as one word, and none is expanded as a file-name pattern.
  local -a extra_flags=()
  read -r -a extra_flags <<< "${EXTRA_FLAGS:-}"

  local result
  # The runner's own exit code is CAPTURED, not discarded. A batch can end
  # non-zero while reporting no failure — a crash after the summary, an
  # unhandled rejection, a failed hook whose subtests are cancelled — and a gate
  # that reads only the counts calls all of those green.
  local runner_exit=0
  # The summary reporter (scripts/testing/node-summary-reporter.mjs) reads the
  # documented test events and prints one anchored line of counts, after every
  # failure with its detail. Node declares its own reporters' text unstable and
  # ships no JSON reporter, so no formatted report is parsed here. The reporter
  # also leaves out the one passing test node:test reports, named by the file's
  # path, for a file that registers no test, so an emptied suite counts zero.
  # --conditions development: opt into the `development`->src export branch so
  # bare workspace specifiers resolve from src against an unbuilt tree (the flag
  # is on the command, NOT NODE_OPTIONS — GitHub Actions restricts NODE_OPTIONS
  # from GITHUB_ENV). See change dev-prod-resolution-model.
  # --test-concurrency=1: the process holds one file, and a batch's files run
  # one after another, so no two suites ever share the database at once.
  result=$(node --conditions development --import tsx --test --test-reporter="$SUMMARY_REPORTER" --test-reporter-destination=stdout --test-force-exit --test-concurrency=1 --test-timeout="$timeout" "${extra_flags[@]}" "$file" 2>&1) || runner_exit=$?

  # The counts are read from the last @@SUMMARY line, and only when the whole
  # pattern matches it. A run with none — the reporter did not load, or the
  # process died before the end of its run — has no counts to read, and fails
  # below instead of reading as zero.
  local tests=0 pass=0 fail=0 cancel=0 skip=0
  # summary_read is the one signal that tells a missing summary from a legitimate
  # zero: it is set only when the whole pattern matched the line.
  local summary summary_read=""
  summary=$(printf '%s\n' "$result" | grep '^@@SUMMARY ' | tail -1)
  if [[ "$summary" =~ $SUMMARY_LINE ]]; then
    tests=${BASH_REMATCH[1]} pass=${BASH_REMATCH[2]} fail=${BASH_REMATCH[3]}
    cancel=${BASH_REMATCH[4]} skip=${BASH_REMATCH[5]}
    summary_read=1
  fi

  TOTAL_TESTS=$((TOTAL_TESTS + tests))
  TOTAL_PASS=$((TOTAL_PASS + pass))
  TOTAL_FAIL=$((TOTAL_FAIL + fail))
  TOTAL_CANCEL=$((TOTAL_CANCEL + cancel))
  TOTAL_SKIP=$((TOTAL_SKIP + skip))

  # Each guard adds its reason, so the verdict line names every one that fired.
  local reasons=""
  if [ -z "$summary_read" ]; then reasons="no @@SUMMARY line"; fi
  if [ "$fail" -gt 0 ]; then reasons="${reasons:+$reasons, }$fail failed"; fi
  # A CANCELLED test is a test that did not run, and Node reports a broken
  # `before` hook as cancelled subtests with no failure — so a batch whose whole
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
    # test failed. The reporter prefixes EVERY line it relays (each line a
    # suite printed to stdout or stderr, and each diagnostic) with '# ', so
    # nothing a suite printed reaches this section. What `grep -v` keeps is the
    # reporter's own account — each failing test or suite with its error, its
    # cause and its first stack frames, bounded per failure; each skip and
    # todo; the summary — and whatever node itself wrote to stderr outside the
    # test events, such as a warning at startup.
    echo "── failures in '$file' (each failing test or suite with its detail, each skip, the summary) ──"
    printf '%s\n' "$result" | grep -v '^# ' || true
    echo "── output of '$file' (last 200 lines) ──"
    printf '%s\n' "$result" | tail -200
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
  local runner_exit=0 failed_files=0 file probe_output
  # After a failed readiness probe no probed file runs, here or in a later batch.
  if [ -n "${BATCH_PROBE:-}" ] && [ -n "$ENV_UNREADY" ]; then
    return 0
  fi

  for file in "$@"; do
    # A failed probe names the file it stops before and the last file run: that
    # one left the environment unready, or it went down while that one ran. The
    # files after it would only fail for the same reason, so none of them runs.
    # What the probe printed, up to PROBE_ERROR_LINES lines, is kept and printed
    # under the record, here and in the final summary, so the cause sits beside the
    # verdict on the stream that has it.
    if [ -n "${BATCH_PROBE:-}" ] && ! probe_output=$("$BATCH_PROBE" 2>&1); then
      ENV_UNREADY="env-unready-before: $file (last ran: ${LAST_RAN:-none})"
      PROBE_ERROR=$(first_lines "$PROBE_ERROR_LINES" "${probe_output:-the probe failed and printed nothing}")
      printf "    ✗ %s\n" "$ENV_UNREADY"
      print_indented "      " "$PROBE_ERROR"
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
# Integration tests via node:test (real DB + Redis; the live tier adds an API)
# ─────────────────────────────────────────────────────────────────────────────
echo "── Integration tests (node:test) ──"

# The one line a random run is replayed from, before its first file runs.
if [ "$TEST_ORDER" = "random" ]; then
  echo "TEST_ORDER=random TEST_SEED=$TEST_SEED"
fi

# The quarantined suites of both tiers are printed on every run, whichever tier
# it runs, and run nowhere.
printf '%s\n' "$QUARANTINE" | while IFS=$'\t' read -r file reason; do
  if [ -n "$file" ]; then
    printf "  QUARANTINED (not run): %s — %s\n" "$file" "$reason"
  fi
done

# The services tier: every collected `*.integration.test.ts` (select_files above),
# each in its own node:test process through run_batch, in the order collect
# gives: byte order, or the one TEST_ORDER names. The files run one after
# another, so no two suites share the database at once: the suites that race one
# credential on purpose, or park a row lock while polling for it, measure only
# their own interleaving.
if run_services_tier; then
  run_batch "integration" "${SERVICES_FILES[@]}"
fi

# The live tier: every collected `*.live.test.ts`, in the same order and the same
# way, after the services tier, with probe_live before each file. A file that
# leaves the API or the workers unready for the next one is named by the probe
# that follows it, rather than by the failures of every file after it.
if run_live_tier; then
  BATCH_PROBE=probe_live run_batch "live" "${LIVE_FILES[@]}"
fi

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
    echo "       probe failed before that file with this error:"
    print_indented "         " "$PROBE_ERROR"
    echo "       The file that ran last left the API or the workers unready, or one of"
    echo "       them went down while it ran. The live files after it did not run."
  elif [ -n "${TIER:-}" ] && [ "$TOTAL_SKIP" -gt 0 ] && [ "$TOTAL_FAIL" -eq 0 ] && [ "$TOTAL_CANCEL" -eq 0 ]; then
    echo "ERROR: $TOTAL_SKIP test(s) were SKIPPED — a skipped test never ran, and in"
    echo "       a TIER-driven run the reason is a service the tier was supposed to"
    echo "       provide. Start the service the batch names; do not skip past it."
    echo "       A batch runner may ALSO have exited non-zero here — read the 'exit'"
    echo "       column and the dumped output before concluding skips were the whole"
    echo "       story."
  elif [ "$TOTAL_FAIL" -eq 0 ] && [ "$TOTAL_CANCEL" -eq 0 ]; then
    echo "ERROR: every test that ran reported passing, yet a file's runner exited"
    echo "       non-zero, a file collected nothing, or its run printed no summary."
    echo "       A crash, an unhandled rejection or an emptied suite all end this"
    echo "       way, with nothing in the counts to show for it."
    echo "       See the FAILED files lines above for each file and its reasons;"
    echo "       its dumped output follows its verdict line."
  elif [ "$TOTAL_FAIL" -eq 0 ]; then
    echo "ERROR: $TOTAL_CANCEL test(s) were CANCELLED — a cancelled test never ran."
    echo "       Node reports a broken before/after hook this way, with no failed test."
  fi
  exit 1
fi

# A tier whose files counted zero tests between them ran nothing, and would
# otherwise pass silently. In CI tiers this script is a load-bearing gate, so zero
# collected tests is a failure, never a green.
if [ -n "${TIER:-}" ] && [ "$TOTAL_TESTS" -eq 0 ]; then
  echo "ERROR: TIER=$TIER collected 0 tests — refusing to pass a vacuous run."
  exit 1
fi

exit 0
