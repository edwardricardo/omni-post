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

run_batch() {
  local name="$1"
  shift
  local concurrency="${CONCURRENCY:-4}"
  local timeout="${TIMEOUT:-30000}"

  local extra_flags="${EXTRA_FLAGS:-}"

  local result
  result=$(node --import tsx --test --test-force-exit --test-concurrency="$concurrency" --test-timeout="$timeout" $extra_flags "$@" 2>&1) || true

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
}

echo "Running API tests..."
echo ""

# ─────────────────────────────────────────────────────────────────────────────
# Phase 1: Unit tests via Vitest (all tests/unit/**)
# ─────────────────────────────────────────────────────────────────────────────
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

# ─────────────────────────────────────────────────────────────────────────────
# Phase 2: Integration tests via node:test (require real DB + Redis + API)
# ─────────────────────────────────────────────────────────────────────────────
echo "── Integration tests (node:test) ──"

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

CONCURRENCY=1 run_batch "integration:routes" \
  tests/integration/crisisRoutes.test.ts tests/integration/linkRoutes.test.ts \
  tests/integration/security-endpoints.test.ts

CONCURRENCY=1 run_batch "integration:outbox" \
  tests/integration/outbox/OutboxRelay.integration.test.ts \
  tests/integration/bulkScheduleOutboxSmoke.test.ts \
  tests/integration/bulkScheduling.test.ts

CONCURRENCY=1 run_batch "integration:flows" \
  tests/auth.test.ts tests/audit.test.ts tests/cache.test.ts \
  tests/rateLimit.smoke.test.ts tests/security.test.ts

CONCURRENCY=1 TIMEOUT=60000 run_batch "flow" \
  tests/publish.flow.test.ts tests/analytics.flow.test.ts tests/media.flow.test.ts tests/schedule.flow.test.ts

CONCURRENCY=1 run_batch "remaining" \
  tests/accountLifecycle.test.ts tests/trialPeriod.test.ts \
  tests/mfa.test.ts tests/rbac.test.ts \
  tests/threading.canonical.test.ts tests/threading.planner.test.ts \
  tests/threading.xprovider.test.ts tests/planPublication.test.ts tests/adapters.test.ts \
  tests/schemaUtils.test.ts

# Wait for API rate limiter to reset after integration:flows batch
# (rateLimit.smoke.test.ts exhausts the rate limit window)
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
  tests/phase4c-integration.test.ts tests/providerRegistry.test.ts

echo ""
echo "========================================"
printf "TOTAL: %d tests, %d pass, %d fail, %d cancel, %d skip\n" \
  "$TOTAL_TESTS" "$TOTAL_PASS" "$TOTAL_FAIL" "$TOTAL_CANCEL" "$TOTAL_SKIP"
echo "========================================"

if [ "$TOTAL_FAIL" -gt 0 ]; then
  echo "FAILED batches:$FAILED_BATCHES"
  exit 1
fi

exit 0
