#!/usr/bin/env bash
# Run API tests: Vitest for unit tests, node:test for integration/flow tests.
#
# Unit tests (tests/unit/**) run on Vitest, which collects them from the tree
# itself (vitest.config.ts). Integration/flow tests (tests/*.test.ts,
# tests/integration/) remain on node:test because they depend on real services
# (PostgreSQL, Redis, a running API), and they are selected here by EXPLICIT file
# list. The batch lists below are therefore the node:test inventory, and it is a
# HAND-MAINTAINED one with two measured holes: a suite no batch names never runs
# (SMELL-75), and a batch can silently stop running a path it does name
# (SMELL-74). Both are tracked in docs/reports/roadmap-detected-smells-backlog.md
# with their current counts; treat the lists as the inventory, never as proof of
# coverage. No test total appears here on purpose — a count in a comment rots.

set -e
export NODE_ENV=test

# Load .env if DATABASE_URL is not already set
if [ -z "$DATABASE_URL" ] && [ -f "$(git rev-parse --show-toplevel 2>/dev/null)/.env" ]; then
  set -a
  source "$(git rev-parse --show-toplevel)/.env"
  set +a
fi

TOTAL_TESTS=0
TOTAL_PASS=0
TOTAL_FAIL=0
TOTAL_CANCEL=0
TOTAL_SKIP=0
FAILED_BATCHES=""

# TIER selects which slice of the suite runs, so CI can split it across jobs:
#   (unset)          local default — Vitest unit phase + every node:test batch.
#   pr-integration   DB-only node:test batches (no live API server needed);
#                    the Vitest unit phase is skipped (owned by another CI job).
#   full-integration every node:test batch (DB-only + live-API); Vitest skipped.
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

# Returns success when the Vitest unit phase should run for the current TIER.
run_vitest_phase() {
  [ -z "$TIER" ]
}

# Returns success when DB-only node:test batches should run for the current TIER.
run_db_batches() {
  [ -z "$TIER" ] || [ "$TIER" = "pr-integration" ] || [ "$TIER" = "full-integration" ]
}

# Returns success when live-API node:test batches should run for the current TIER.
run_live_api_batches() {
  [ -z "$TIER" ] || [ "$TIER" = "full-integration" ]
}

run_batch() {
  local name="$1"
  shift
  local concurrency="${CONCURRENCY:-4}"
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
  result=$(node --conditions development --import tsx --test --test-reporter=tap --test-reporter-destination=stdout --test-force-exit --test-concurrency="$concurrency" --test-timeout="$timeout" $extra_flags "$@" 2>&1) || runner_exit=$?

  local tests=$(echo "$result" | grep "^# tests " | tail -1 | awk '{print $3}')
  local pass=$(echo "$result" | grep "^# pass " | tail -1 | awk '{print $3}')
  local fail=$(echo "$result" | grep "^# fail " | tail -1 | awk '{print $3}')
  local cancel=$(echo "$result" | grep "^# cancelled " | tail -1 | awk '{print $3}')
  local skip=$(echo "$result" | grep "^# skipped " | tail -1 | awk '{print $3}')
  tests=${tests:-0}; pass=${pass:-0}; fail=${fail:-0}; cancel=${cancel:-0}; skip=${skip:-0}

  TOTAL_TESTS=$((TOTAL_TESTS + tests))
  TOTAL_PASS=$((TOTAL_PASS + pass))
  TOTAL_FAIL=$((TOTAL_FAIL + fail))
  TOTAL_CANCEL=$((TOTAL_CANCEL + cancel))
  TOTAL_SKIP=$((TOTAL_SKIP + skip))

  # A CANCELLED test is a test that did not run, and Node reports a broken
  # `before` hook as cancelled subtests with "# fail 0" — so a batch whose whole
  # setup collapsed used to print OK. A gate that cannot go red on its own setup
  # gates nothing, which matters most for the batches called merge-blocking.
  local status="OK"
  if [ "$fail" -gt 0 ] || [ "$cancel" -gt 0 ] || [ "$runner_exit" -ne 0 ]; then
    status="FAIL"
    FAILED_BATCHES="$FAILED_BATCHES $name"
  fi

  # A batch that collected NOTHING is a failure too. Every batch below names at
  # least one suite, so zero collected means a suite stopped being found: a
  # renamed path the list still carries, an emptied file, a suite-wide skip, or a
  # collection error --test-force-exit swallowed. The batch already dumps its
  # output for this case; without this it dumped and still reported OK. Scoped to
  # tier-driven runs so a developer trimming a batch list locally is not blocked.
  if [ -n "${TIER:-}" ] && [ "$tests" -eq 0 ] && [ "$status" = "OK" ]; then
    status="FAIL"
    FAILED_BATCHES="$FAILED_BATCHES $name"
  fi

  printf "  %-25s %4s tests  %4s pass  %s fail  %s cancel  %s skip  exit %s  [%s]\n" \
    "$name" "$tests" "$pass" "$fail" "$cancel" "$skip" "$runner_exit" "$status"

  # A failing (or zero-collected) batch must never be silent — dump the runner
  # output so CI logs show WHY, not just the count.
  if [ "$status" = "FAIL" ] || [ "$tests" -eq 0 ]; then
    echo "── output of failing batch '$name' (last 200 lines) ──"
    echo "$result" | tail -200
    echo "── end of '$name' output ──"
  fi
}

echo "Running API tests..."
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# Phase 1: Unit tests via Vitest (all tests/unit/**)
# ─────────────────────────────────────────────────────────────────────────────
if run_vitest_phase; then
echo "── Unit tests (Vitest) ──"
# The Vitest runner's own exit is captured, exactly as run_batch captures the
# node:test runner's: a Vitest process that dies before writing a summary — an
# OOM-killed fork is the documented case here (vitest.config.ts) — parses as
# "0 failed", so the exit code is the only remaining evidence that it died.
VITEST_EXIT=0
VITEST_RESULT=$(npx vitest run 2>&1) || VITEST_EXIT=$?
echo "$VITEST_RESULT" | tail -5
echo ""

# Read the summary from the line that begins with `Tests`. Vitest prints
# `Test Files  N passed` FIRST, so an unanchored match reports FILE counts as TEST
# counts — 18 instead of 219 on the saga surface. `head -1` on an empty pipeline
# exits 0, so `|| echo 0` never fires; the explicit defaults below do that job.
VITEST_SUMMARY=$(echo "$VITEST_RESULT" | grep -E "^[[:space:]]*Tests[[:space:]]" | tail -1)
VITEST_PASSED=$(echo "$VITEST_SUMMARY" | grep -oP '\d+(?= passed)' | head -1)
VITEST_FAILED=$(echo "$VITEST_SUMMARY" | grep -oP '\d+(?= failed)' | head -1)
VITEST_PASSED=${VITEST_PASSED:-0}
VITEST_FAILED=${VITEST_FAILED:-0}
VITEST_TOTAL=$((VITEST_PASSED + VITEST_FAILED))

TOTAL_TESTS=$((TOTAL_TESTS + VITEST_TOTAL))
TOTAL_PASS=$((TOTAL_PASS + VITEST_PASSED))
TOTAL_FAIL=$((TOTAL_FAIL + VITEST_FAILED))

if [ "$VITEST_FAILED" -gt 0 ]; then
  FAILED_BATCHES="$FAILED_BATCHES vitest-unit"
fi

# The runner exit is an INDEPENDENT signal from the parsed count, not a refinement
# of it: a non-zero exit reddens the phase on its own. Guarded on a zero count so
# a run that failed both ways is not listed twice. The dump matches run_batch's:
# the five-line tail above is enough for a summary that exists, and useless for a
# process that died before writing one.
if [ "$VITEST_EXIT" -ne 0 ] && [ "$VITEST_FAILED" -eq 0 ]; then
  echo "  [FAIL] vitest-unit: runner exited $VITEST_EXIT with 0 parsed failures"
  echo "── output of failing phase 'vitest-unit' (last 200 lines) ──"
  echo "$VITEST_RESULT" | tail -200
  echo "── end of 'vitest-unit' output ──"
  FAILED_BATCHES="$FAILED_BATCHES vitest-unit"
fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Phase 2: Integration tests via node:test (require real DB + Redis + API)
# ─────────────────────────────────────────────────────────────────────────────
echo "── Integration tests (node:test) ──"

# DB-only batches: Prisma against the real DB, no live API server required.
if run_db_batches; then

# Repository + data-migration integration tests (Prisma against real DB, no live API).
# backfillAdminMfaBackupCodes drives the migration script's injected-Prisma exports
# against Postgres — DB-only, so it belongs here (not a live-API batch). CONCURRENCY=1
# keeps its whole-table runBackfill/runCleanup from racing sibling files.
CONCURRENCY=1 run_batch "integration:repositories" \
  tests/integration/repositories/UserRepository.test.ts \
  tests/integration/repositories/AccountQueryRepository.test.ts \
  tests/integration/repositories/ProjectRepository.test.ts \
  tests/integration/repositories/PrismaPostRepository.test.ts \
  tests/integration/repositories/AnalyticsRepository.basic.test.ts \
  tests/integration/repositories/AnalyticsRepository.channel.test.ts \
  tests/integration/repositories/AnalyticsRepository.timeseries.test.ts \
  tests/integration/repositories/ConversionRepository.test.ts \
  tests/integration/backfillAdminMfaBackupCodes.integration.test.ts

CONCURRENCY=1 run_batch "integration:sync" \
  tests/integration/syncEngine/syncEngine.init.test.ts \
  tests/integration/syncEngine/syncEngine.sync.test.ts \
  tests/integration/syncEngine/syncEngine.conflicts.test.ts \
  tests/integration/syncEngine/syncEngine.monitoring.test.ts

CONCURRENCY=1 run_batch "integration:outbox" \
  tests/integration/outbox/OutboxRelay.integration.test.ts \
  tests/integration/bulkScheduleOutboxSmoke.test.ts \
  tests/integration/bulkScheduling.test.ts

CONCURRENCY=1 run_batch "integration:consumers" \
  tests/integration/consumers/workerConnection.integration.test.ts

# Chaos scenarios. They drive the saga engine against in-memory doubles, so no
# service is required, but they are node:test files and therefore belong to a
# batch — a suite that no batch lists is a suite that never runs.
CONCURRENCY=1 run_batch "chaos" \
  tests/chaos/saga-step-retry-recovery.test.ts

# Two-tenant isolation proofs for the tenant-guard rollout. Each suite seeds
# two tenants against the real DB and drives the guarded client / in-process
# routes (app.inject — no live server), so this is a DB-only batch. Bundled
# here because these MERGE-BLOCKING suites were previously unlisted in any
# batch and therefore never executed under test:all / test:integration.
CONCURRENCY=1 run_batch "integration:tenant-isolation" \
  tests/integration/postDeleteOwnership.test.ts \
  tests/integration/postReadOwnership.test.ts \
  tests/integration/externalNotificationTenantIsolation.test.ts \
  tests/integration/scheduledReportTenantIsolation.test.ts \
  tests/integration/campaignTenantIsolation.test.ts \
  tests/integration/recurringPostTenantIsolation.test.ts \
  tests/integration/channelTenantIsolation.test.ts \
  tests/integration/publishWorkerTenantIsolation.test.ts \
  tests/integration/trackedLinkTenantIsolation.test.ts \
  tests/integration/generatedImageTenantIsolation.test.ts \
  tests/integration/projectMemberTenantIsolation.test.ts \
  tests/integration/preAuthIntegrationTenantIsolation.test.ts \
  tests/integration/preAuthSsoTenantIsolation.test.ts \
  tests/integration/preAuthBillingTenantIsolation.test.ts \
  tests/integration/preAuthInboundWebhookTenantIsolation.test.ts \
  tests/integration/sagaTenantIsolation.test.ts \
  tests/integration/repositories/sagaAccountIdBackfill.integration.test.ts \
  tests/integration/rls-tenant-isolation.test.ts

# Saga recovery proofs. DB-only by dependency (Postgres + Redis; the crash suite
# also owns a real BullMQ queue and worker), so they belong to the tier that
# also runs on pull requests — a merge-blocking gate that only ran after the
# merge would gate nothing. The raised timeout is for the CRASH suite, which
# drives a real queue round trip and walks a retry envelope; the compensation
# suite is quick but shares the batch because both boot real managers, and a
# boot loads and dispatches every non-terminal row in the table — running them
# in one serialized batch is what keeps that from being two suites executing
# each other's sagas.
CONCURRENCY=1 TIMEOUT=120000 run_batch "integration:saga-recovery" \
  tests/integration/sagaCrashRecovery.test.ts \
  tests/integration/sagaCompensationRecovery.test.ts

fi # run_db_batches

# Live-API batches: these fetch http://localhost:3000 (getBaseUrl) and require
# a running API server alongside the DB/Redis services.
if run_live_api_batches; then

CONCURRENCY=1 run_batch "integration:routes" \
  tests/integration/crisisRoutes.test.ts tests/integration/linkRoutes.test.ts \
  tests/integration/security-endpoints.test.ts

CONCURRENCY=1 run_batch "integration:flows" \
  tests/auth.test.ts tests/audit.test.ts tests/cache.test.ts \
  tests/security.test.ts \
  tests/integration/publishing/failedWrite.smoke.test.ts

# Saga customer flow against the live API. Its own batch because the file's
# worst case is ~110s+ (one 60s horizon plus one 90s horizon plus the short
# tests) and the default 30000 test timeout would cancel them. Listed here to
# close a blind spot: this suite existed on disk but belonged to no batch, so
# `test:all` never ran it.
CONCURRENCY=1 TIMEOUT=180000 run_batch "integration:saga-live" \
  tests/integration/sagaCustomerFlow.test.ts

CONCURRENCY=1 TIMEOUT=60000 run_batch "flow" \
  tests/publish.flow.test.ts tests/analytics.flow.test.ts tests/media.flow.test.ts tests/schedule.flow.test.ts

CONCURRENCY=1 run_batch "remaining" \
  tests/accountLifecycle.test.ts tests/trialPeriod.test.ts \
  tests/mfa.test.ts tests/rbac.test.ts \
  tests/threading.canonical.test.ts tests/threading.planner.test.ts \
  tests/threading.xprovider.test.ts tests/planPublication.test.ts tests/adapters.test.ts \
  tests/schemaUtils.test.ts

# Wait for API rate limiter to reset after integration:flows batch
# (security.test.ts's rate-limiting suite exhausts the rate limit window)
wait_for_api() {
  local max_attempts=30
  local attempt=0
  while [ $attempt -lt $max_attempts ]; do
    local status=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health 2>/dev/null)
    if [ "$status" = "200" ]; then
      return 0
    fi
    sleep 2
    attempt=$((attempt + 1))
  done
  echo "  [WARN] API rate limiter did not reset after ${max_attempts}x2s"
}
wait_for_api

CONCURRENCY=1 run_batch "production" \
  tests/production.integration.test.ts tests/multiproject.flow.test.ts \
  tests/providerRegistry.test.ts

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
# The two count terms are therefore REDUNDANT today (every path that raises them
# also appends a batch name), and they are kept deliberately: they are the
# defence-in-depth half. Should a future edit narrow run_batch's append condition,
# a run with real failures must still go red on the counts alone. Do not "simplify"
# the disjunction back to one term — the static suite pins all three for this
# reason.
if [ "$TOTAL_FAIL" -gt 0 ] || [ "$TOTAL_CANCEL" -gt 0 ] || [ -n "$FAILED_BATCHES" ]; then
  echo "FAILED batches:$FAILED_BATCHES"
  if [ "$TOTAL_FAIL" -eq 0 ] && [ "$TOTAL_CANCEL" -eq 0 ]; then
    echo "ERROR: every test that ran reported passing, yet a batch runner exited"
    echo "       non-zero, or a batch collected nothing. A crash after the summary,"
    echo "       an unhandled rejection, an OOM-killed Vitest fork (that phase"
    echo "       collects from the tree, so no file list is involved), or a"
    echo "       single-file batch whose one path no longer exists all end this way"
    echo "       — with nothing in the counts to show for it. In a MULTI-file batch"
    echo "       a missing path is dropped silently instead (SMELL-74)."
    echo "       See the dumped output for the batch named on the FAILED batches"
    echo "       line above; its runner exit code is in the 'exit' column."
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
