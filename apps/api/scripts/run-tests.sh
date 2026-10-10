#!/usr/bin/env bash
# Run the API's node:test integration suites. This is the integration collector
# and nothing else: Vitest collects the unit tier (tests/unit/**, tests/eval/**)
# from the tree on its own (vitest.config.ts, `pnpm test`), and this script never
# starts it, so no unit test runs twice and no Vitest verdict is folded into this
# one. `pnpm test:all` runs the two in sequence.
#
# The integration and flow suites (tests/*.test.ts, tests/integration/,
# tests/chaos/) stay on node:test because they depend on real services
# (PostgreSQL, Redis, a running API), and they are selected here by EXPLICIT file
# list. The batch lists below are therefore the node:test inventory, and it is a
# HAND-MAINTAINED one with a measured hole: a suite no batch names never runs
# (SMELL-75). It is tracked in docs/reports/roadmap-detected-smells-backlog.md
# with its current count; treat the lists as the inventory, never as proof of
# coverage. No test total appears here on purpose — a count in a comment rots.

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

# TIER selects which slice of the node:test inventory runs, so CI can split it
# across jobs:
#   (unset)          local default — every batch (DB-only + live-API), without
#                    the skip and zero-collection guards, which are tier-only.
#   pr-integration   DB-only batches (no live API server needed).
#   full-integration every batch (DB-only + live-API).
# DB-only batches talk to Postgres/Redis directly; live-API batches fetch
# http://localhost:3000 and require a running API server.
TIER="${TIER:-}"
case "$TIER" in
  "" | pr-integration | full-integration) ;;
  *)
    echo "Unknown TIER='$TIER' (expected: unset, pr-integration, full-integration)" >&2
    exit 2
    ;;
esac

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

# Returns success when DB-only node:test batches should run for the current TIER.
run_db_batches() {
  [ -z "$TIER" ] || [ "$TIER" = "pr-integration" ] || [ "$TIER" = "full-integration" ]
}

# Returns success when live-API node:test batches should run for the current TIER.
run_live_api_batches() {
  [ -z "$TIER" ] || [ "$TIER" = "full-integration" ]
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
# when any of its files is.
run_batch() {
  local name="$1"
  shift
  local tests0=$TOTAL_TESTS pass0=$TOTAL_PASS fail0=$TOTAL_FAIL cancel0=$TOTAL_CANCEL skip0=$TOTAL_SKIP
  # The first non-zero runner exit among the files; each one's is on its own line.
  local runner_exit=0 failed_files=0 file

  for file in "$@"; do
    # Reset before each call: should run_file ever run in a subshell (a pipe or
    # `$( )` around it), its verdict never arrives, and the file then fails for
    # want of one instead of passing on the previous file's.
    FILE_VERDICT="" FILE_REASONS="no verdict reached run_batch" FILE_EXIT=0
    run_file "$file"
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

# DB-only batches: Prisma against the real DB, no live API server required.
if run_db_batches; then

# Repository + data-migration integration tests (Prisma against real DB, no live API).
# backfillAdminMfaBackupCodes drives the migration script's injected-Prisma exports
# against Postgres — DB-only, so it belongs here (not a live-API batch). Files run
# one at a time, so its whole-table runBackfill/runCleanup cannot race a sibling.
run_batch "integration:repositories" \
  tests/integration/repositories/UserRepository.integration.test.ts \
  tests/integration/repositories/AccountQueryRepository.integration.test.ts \
  tests/integration/repositories/ProjectRepository.integration.test.ts \
  tests/integration/repositories/PrismaPostRepository.integration.test.ts \
  tests/integration/repositories/AnalyticsRepository.basic.integration.test.ts \
  tests/integration/repositories/AnalyticsRepository.channel.integration.test.ts \
  tests/integration/repositories/AnalyticsRepository.timeseries.integration.test.ts \
  tests/integration/repositories/ConversionRepository.integration.test.ts \
  tests/integration/backfillAdminMfaBackupCodes.integration.test.ts \
  tests/integration/postHardDeleteCascade.integration.test.ts

# Retention-floor sweep. DB-only, and deliberately its OWN batch: it holds a second
# PrismaClient opened on a hostile session time zone, so folding it into a batch that
# shares the singleton would make which client a failure belongs to ambiguous.
run_batch "integration:retention" \
  tests/integration/deletionRecordRetentionFloor.integration.test.ts \
  tests/integration/deletionRecordDegradation.integration.test.ts

# Serializable hard-delete race. Its OWN batch for the same reason as the retention
# sweep, and one more: it holds TWO PrismaClients and deliberately parks one of them
# on a row lock while polling `pg_blocking_pids`. Sharing a batch would let a sibling
# suite's lock wait satisfy that poll, and the interleaving the proof depends on would
# stop being the one under test. Files run one at a time, which is not optional here.
run_batch "integration:hard-delete-race" \
  tests/integration/hardDeleteSerializableRace.integration.test.ts

run_batch "integration:sync" \
  tests/integration/syncEngine/syncEngine.init.integration.test.ts \
  tests/integration/syncEngine/syncEngine.sync.integration.test.ts \
  tests/integration/syncEngine/syncEngine.conflicts.integration.test.ts \
  tests/integration/syncEngine/syncEngine.monitoring.integration.test.ts

run_batch "integration:outbox" \
  tests/integration/outbox/OutboxRelay.integration.test.ts \
  tests/integration/bulkScheduleOutboxSmoke.integration.test.ts \
  tests/integration/bulkScheduling.integration.test.ts

run_batch "integration:consumers" \
  tests/integration/consumers/workerConnection.integration.test.ts

# Chaos scenarios. They drive the saga engine against in-memory doubles, so no
# service is required, but they are node:test files and therefore belong to a
# batch — a suite that no batch lists is a suite that never runs.
run_batch "chaos" \
  tests/chaos/saga-step-retry-recovery.integration.test.ts \
  tests/chaos/sagaWaitAmplification.integration.test.ts

# Two-tenant isolation proofs for the tenant-guard rollout. Each suite seeds
# two tenants against the real DB and drives the guarded client / in-process
# routes (app.inject — no live server), so this is a DB-only batch. Bundled
# here because these MERGE-BLOCKING suites were previously unlisted in any
# batch and therefore never executed under test:all / test:integration.
run_batch "integration:tenant-isolation" \
  tests/integration/postDeleteOwnership.integration.test.ts \
  tests/integration/postReadOwnership.integration.test.ts \
  tests/integration/externalNotificationTenantIsolation.integration.test.ts \
  tests/integration/scheduledReportTenantIsolation.integration.test.ts \
  tests/integration/campaignTenantIsolation.integration.test.ts \
  tests/integration/recurringPostTenantIsolation.integration.test.ts \
  tests/integration/channelTenantIsolation.integration.test.ts \
  tests/integration/publishWorkerTenantIsolation.integration.test.ts \
  tests/integration/trackedLinkTenantIsolation.integration.test.ts \
  tests/integration/generatedImageTenantIsolation.integration.test.ts \
  tests/integration/projectMemberTenantIsolation.integration.test.ts \
  tests/integration/preAuthIntegrationTenantIsolation.integration.test.ts \
  tests/integration/preAuthSsoTenantIsolation.integration.test.ts \
  tests/integration/preAuthBillingTenantIsolation.integration.test.ts \
  tests/integration/preAuthInboundWebhookTenantIsolation.integration.test.ts \
  tests/integration/sagaTenantIsolation.integration.test.ts \
  tests/integration/repositories/sagaAccountIdBackfill.integration.test.ts \
  tests/integration/rls-tenant-isolation.integration.test.ts \
  tests/integration/tenantGucTransactionBinding.integration.test.ts \
  tests/integration/compositionRootTenantBinding.integration.test.ts \
  tests/integration/tenant-composite-fk.integration.test.ts \
  tests/integration/post-trio-tenant-isolation.integration.test.ts

# Customer pre-identity auth proofs. DB-only: the suite drives the four bare
# `/auth/customer/*` handlers over `app.inject` against the guarded client, so it
# needs Postgres but no live server. Its OWN batch, run alone, because two of
# its cases race the SAME reset token on purpose — one pair of genuinely concurrent
# confirms, one sequential replay — and a sibling suite sharing the runner would
# make which statement won ambiguous, which is the only thing those cases measure.
run_batch "integration:customer-auth" \
  tests/integration/customerPasswordReset.integration.test.ts

# MFA backup-code claim proofs. DB-only: the suite drives the real Prisma MFA
# adapters and the unified MfaService directly, no live server. Its OWN batch,
# run alone, because its cases race the SAME credential on purpose — a
# staggered pair, a simultaneous pair, and a sibling-index collision — and a
# sibling suite sharing the runner would make which statement won ambiguous,
# which is the only thing those cases measure.
run_batch "integration:mfa-backup-single-use" \
  tests/integration/mfaBackupCodeSingleUse.integration.test.ts

# Admin single-use claim proofs. DB-only: the reset suite drives PasswordService
# over the seed client and the refresh suite drives the real AuthService over real
# adapters — no live server, and no Redis on purpose: the rotation claim is the
# subject, so the Redis blacklist stays structurally absent. ONE batch, files
# run alone, because every suite here races the SAME credential on purpose
# (staggered + simultaneous pairs), and a sibling suite sharing the runner would
# make which statement won ambiguous, which is the only thing those cases measure.
run_batch "integration:admin-single-use-claims" \
  tests/integration/adminPasswordResetClaim.integration.test.ts \
  tests/integration/adminRefreshRotationClaim.integration.test.ts

# Saga recovery + promotion proofs. DB-only by dependency (Postgres + Redis; the
# crash suite also owns a real BullMQ queue and worker), so they belong to the
# tier that also runs on pull requests — a merge-blocking gate that only ran
# after the merge would gate nothing. The crash suite, which drives a real queue
# round trip and walks a retry envelope, is the slow one; the compensation and
# promotion suites are quick. The three share one batch because all
# three boot real managers, and a boot loads and dispatches every non-terminal
# row in the table — running them in one serialized batch is what keeps that
# from being three suites executing each other's sagas.
run_batch "integration:saga-recovery" \
  tests/integration/sagaCrashRecovery.integration.test.ts \
  tests/integration/sagaCompensationRecovery.integration.test.ts \
  tests/integration/sagaPublishNowPromotion.integration.test.ts

fi # run_db_batches

# Live-API batches: these fetch http://localhost:3000 (getBaseUrl) and require
# a running API server alongside the DB/Redis services.
if run_live_api_batches; then

run_batch "integration:routes" \
  tests/integration/crisisRoutes.live.test.ts tests/integration/linkRoutes.live.test.ts \
  tests/integration/security-endpoints.live.test.ts

run_batch "integration:flows" \
  tests/auth.integration.test.ts tests/audit.integration.test.ts tests/cache.integration.test.ts \
  tests/security.live.test.ts \
  tests/integration/publishing/failedWrite.smoke.integration.test.ts

# Early warning for the batch that follows. The saga suite carries its own
# authoritative precondition (assertPublishConsumers in tests/testUtils.ts); this
# runs IMMEDIATELY BEFORE that batch so a consumer that died during the ~2-3
# minutes of live-API batches above is named here rather than three 120s budget
# burns later. Placing it near wait_for_api below would put it AFTER the batch it
# protects, which is no protection at all.
#
# An UNKNOWN answer is reported as unknown and does not redden the run: the queue
# being unreadable is not the same fact as nothing consuming it, and a check that
# conflates them sends the reader to restart workers that are running. Only a
# decisive zero is treated as an outage.
assert_publish_consumers() {
  local body consumers
  body=$(curl -s --max-time 5 "http://localhost:3000/health/dependency/queue" 2>/dev/null || true)
  consumers=$(echo "$body" | grep -o '"consumers":[^,}]*' | head -1 | cut -d: -f2 | tr -d ' "')

  case "$consumers" in
    "")
      echo "  publish-consumers          could not be read from the API — UNKNOWN, not zero"
      echo "                             (the saga suite's own precondition reports the exact cause)"
      ;;
    null)
      echo "  publish-consumers          broker cannot answer CLIENT LIST — UNKNOWN, not zero"
      ;;
    0)
      echo "  publish-consumers  no process is consuming the 'publish' queue  [FAIL]"
      echo "       Every publish case in the next batch will park until the 30-minute saga"
      echo "       horizon and burn its full budget. Start the workers before rerunning."
      FAILED_BATCHES="$FAILED_BATCHES publish-consumers"
      ;;
    *)
      echo "  publish-consumers          $consumers attached"
      ;;
  esac
}
assert_publish_consumers

# Saga customer flow against the live API. Listed here to close a blind spot:
# this suite existed on disk but belonged to no batch, so `test:all` never ran
# it.
run_batch "integration:saga-live" \
  tests/integration/sagaCustomerFlow.live.test.ts

run_batch "flow" \
  tests/publish.flow.integration.test.ts tests/analytics.flow.integration.test.ts tests/media.flow.integration.test.ts tests/schedule.flow.integration.test.ts

run_batch "remaining" \
  tests/accountLifecycle.integration.test.ts tests/trialPeriod.integration.test.ts \
  tests/mfa.integration.test.ts tests/rbac.integration.test.ts \
  tests/threading.canonical.integration.test.ts tests/threading.planner.integration.test.ts \
  tests/threading.xprovider.integration.test.ts tests/planPublication.integration.test.ts tests/adapters.integration.test.ts \
  tests/schemaUtils.integration.test.ts

# The rate-limiting suite in `integration:flows` deliberately exhausts the
# /health window and waits in its own `after()` for it to reopen; this check
# confirms /health answers 200 again before the last live batch. That batch
# asserts on real response bodies: run it against a still-limited API and every
# assertion fails on a 429 body, which reads as a broken API rather than as a
# window that never reopened.
API_READY_MAX_ATTEMPTS=30
API_READY_INTERVAL_S=2

wait_for_api() {
  local attempt=0
  while [ "$attempt" -lt "$API_READY_MAX_ATTEMPTS" ]; do
    local status=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health 2>/dev/null)
    if [ "$status" = "200" ]; then
      return 0
    fi
    sleep "$API_READY_INTERVAL_S"
    attempt=$((attempt + 1))
  done
  return 1
}

# A precondition that warns and proceeds is not a precondition. On exhaustion the
# batch is NOT run and the run goes red here instead: its suites would report a
# screenful of assertion failures whose single cause is named on this line, and
# burying that cause is how a limiter artifact gets read as an outage.
#
# The message names the OBSERVATION, not a root cause. A /health that never
# answers 200 is a window that did not reopen, an API that died during the ~2-3
# minutes of live batches above, or an API that was never reachable — three
# different repairs, and asserting the first one sends the reader to wait out a
# window on a process that is not running.
if wait_for_api; then
  run_batch "production" \
    tests/production.live.test.ts tests/multiproject.flow.live.test.ts \
    tests/providerRegistry.live.test.ts
else
  echo "  api-ready  /health never returned 200 in $((API_READY_MAX_ATTEMPTS * API_READY_INTERVAL_S))s  [FAIL]"
  echo "       The 'production' batch was NOT run: against a rate-limited or absent"
  echo "       API its assertions fail on responses the server never produced, and"
  echo "       those failures would name every suite except the one thing that broke."
  echo "       Check the API is still up before concluding the limiter is the cause."
  FAILED_BATCHES="$FAILED_BATCHES api-ready"
fi

fi # run_live_api_batches

echo ""
echo "========================================"
printf "TOTAL: %d tests, %d pass, %d fail, %d cancel, %d skip\n" \
  "$TOTAL_TESTS" "$TOTAL_PASS" "$TOTAL_FAIL" "$TOTAL_CANCEL" "$TOTAL_SKIP"
echo "========================================"

# FAILED_BATCHES is the source of failure truth: a batch lands there on a parsed
# failure, on a cancellation, on a zero collection AND on a non-zero runner exit,
# so its non-emptiness is what makes the per-batch capture reach the gate. Without
# that term a batch could print [FAIL], dump its output, be named in the failed
# list — and the run still exit zero, which is worse than never noticing, because
# everything downstream believes the gate.
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
  if [ -n "${TIER:-}" ] && [ "$TOTAL_SKIP" -gt 0 ] && [ "$TOTAL_FAIL" -eq 0 ] && [ "$TOTAL_CANCEL" -eq 0 ]; then
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
