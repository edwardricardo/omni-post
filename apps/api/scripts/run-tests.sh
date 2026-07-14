#!/usr/bin/env bash
# Run API tests: Vitest for unit tests, node:test for integration/flow tests.
#
# All 283 unit tests (tests/unit/**) have been migrated to Vitest.
# Integration/flow tests (tests/*.test.ts, tests/integration/) remain on node:test
# because they depend on real services (PostgreSQL, Redis, running API).

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
  # Pin the TAP reporter: the summary parser below greps "# tests N" (TAP
  # format). Node's default reporter is version/TTY-dependent (spec emits
  # "ℹ tests N"), which silently parses as 0 tests.
  # --conditions development: opt into the `development`->src export branch so
  # bare workspace specifiers resolve from src against an unbuilt tree (the flag
  # is on the command, NOT NODE_OPTIONS — GitHub Actions restricts NODE_OPTIONS
  # from GITHUB_ENV). See change dev-prod-resolution-model.
  result=$(node --conditions development --import tsx --test --test-reporter=tap --test-reporter-destination=stdout --test-force-exit --test-concurrency="$concurrency" --test-timeout="$timeout" $extra_flags "$@" 2>&1) || true

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

  local status="OK"
  if [ "$fail" -gt 0 ]; then
    status="FAIL"
    FAILED_BATCHES="$FAILED_BATCHES $name"
  fi

  printf "  %-25s %4s tests  %4s pass  %s fail  %s cancel  %s skip  [%s]\n" \
    "$name" "$tests" "$pass" "$fail" "$cancel" "$skip" "$status"

  # A failing (or zero-collected) batch must never be silent — dump the runner
  # output so CI logs show WHY, not just the count.
  if [ "$fail" -gt 0 ] || [ "$tests" -eq 0 ]; then
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
VITEST_RESULT=$(npx vitest run 2>&1) || true
echo "$VITEST_RESULT" | tail -5
echo ""

# Extract vitest summary for the total
VITEST_PASSED=$(echo "$VITEST_RESULT" | grep -oP '\d+ passed' | head -1 | grep -oP '\d+' || echo "0")
VITEST_FAILED=$(echo "$VITEST_RESULT" | grep -oP '\d+ failed' | head -1 | grep -oP '\d+' || echo "0")
VITEST_TOTAL=$((VITEST_PASSED + VITEST_FAILED))

TOTAL_TESTS=$((TOTAL_TESTS + VITEST_TOTAL))
TOTAL_PASS=$((TOTAL_PASS + VITEST_PASSED))
TOTAL_FAIL=$((TOTAL_FAIL + VITEST_FAILED))

if [ "$VITEST_FAILED" -gt 0 ]; then
  FAILED_BATCHES="$FAILED_BATCHES vitest-unit"
fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Phase 2: Integration tests via node:test (require real DB + Redis + API)
# ─────────────────────────────────────────────────────────────────────────────
echo "── Integration tests (node:test) ──"

# DB-only batches: Prisma against the real DB, no live API server required.
if run_db_batches; then

# Repository integration tests (Prisma against real DB)
CONCURRENCY=1 run_batch "integration:repositories" \
  tests/integration/repositories/UserRepository.test.ts \
  tests/integration/repositories/AccountQueryRepository.test.ts \
  tests/integration/repositories/ProjectRepository.test.ts \
  tests/integration/repositories/PrismaPostRepository.test.ts \
  tests/integration/repositories/AnalyticsRepository.basic.test.ts \
  tests/integration/repositories/AnalyticsRepository.channel.test.ts \
  tests/integration/repositories/AnalyticsRepository.timeseries.test.ts \
  tests/integration/repositories/ConversionRepository.test.ts

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

# Two-tenant isolation proofs for the tenant-guard rollout. Each suite seeds
# two tenants against the real DB and drives the guarded client / in-process
# routes (app.inject — no live server), so this is a DB-only batch. Bundled
# here because these MERGE-BLOCKING suites were previously unlisted in any
# batch and therefore never executed under test:all / test:integration.
CONCURRENCY=1 run_batch "integration:tenant-isolation" \
  tests/integration/postDeleteOwnership.test.ts \
  tests/integration/externalNotificationTenantIsolation.test.ts \
  tests/integration/scheduledReportTenantIsolation.test.ts \
  tests/integration/campaignTenantIsolation.test.ts \
  tests/integration/recurringPostTenantIsolation.test.ts \
  tests/integration/trackedLinkTenantIsolation.test.ts \
  tests/integration/generatedImageTenantIsolation.test.ts \
  tests/integration/projectMemberTenantIsolation.test.ts \
  tests/integration/rls-tenant-isolation.test.ts

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

if [ "$TOTAL_FAIL" -gt 0 ]; then
  echo "FAILED batches:$FAILED_BATCHES"
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
