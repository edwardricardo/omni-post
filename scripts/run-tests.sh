#!/usr/bin/env bash
#
# Batch Test Runner — runs API tests in categorized batches to prevent
# inter-file interference from concurrent execution.
#
# Usage:
#   bash scripts/run-tests.sh              # Run all batches
#   bash scripts/run-tests.sh domain       # Run single batch
#   bash scripts/run-tests.sh auth events  # Run multiple batches
#
# Each batch runs with --test-concurrency=1 to prevent concurrency issues.
# Test results are summarized at the end.
#

set -euo pipefail

# Resolve repo root regardless of CWD
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Load env for DATABASE_URL etc.
if [ -z "$DATABASE_URL" ] && [[ -f "$REPO_ROOT/.env" ]]; then
  set -a
  source "$REPO_ROOT/.env"
  set +a
fi

export NODE_ENV=test

# tsx needs tsconfig.base.json (which has path mappings) instead of the root
# tsconfig.json (which is a project-references-only config without paths).
export TSX_TSCONFIG_PATH="${TSX_TSCONFIG_PATH:-${REPO_ROOT}/tsconfig.base.json}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

TIMEOUT=30000
FORCE_EXIT="--test-force-exit"
CONCURRENCY="--test-concurrency=1"
BASE="${REPO_ROOT}/apps/api/tests"

declare -A BATCHES

# ── Batch definitions (each batch is a glob pattern or space-separated list) ──

BATCHES[domain]="
  ${BASE}/unit/domain/*.test.ts
  ${BASE}/unit/AppError.test.ts
  ${BASE}/unit/typeUtils.test.ts
"

BATCHES[application]="
  ${BASE}/unit/application/*.test.ts
  ${BASE}/unit/application/**/*.test.ts
"

BATCHES[infrastructure]="
  ${BASE}/unit/infrastructure/*.test.ts
  ${BASE}/unit/outbox/*.test.ts
  ${BASE}/unit/integration-events/*.test.ts
"

BATCHES[auth]="
  ${BASE}/unit/authMiddleware.test.ts
  ${BASE}/unit/authRateLimit.test.ts
  ${BASE}/unit/authRoutes.test.ts
  ${BASE}/unit/authService.test.ts
  ${BASE}/unit/bruteForceProtection.test.ts
  ${BASE}/unit/enhancedOAuthProvider.test.ts
  ${BASE}/unit/mfaRoutes.test.ts
  ${BASE}/unit/mfaService.test.ts
  ${BASE}/unit/rbacMiddleware.test.ts
  ${BASE}/unit/rbacRoutes.test.ts
  ${BASE}/unit/rbacService.test.ts
  ${BASE}/unit/secureSchemas.basic.test.ts
  ${BASE}/unit/secureSchemas.query.test.ts
  ${BASE}/unit/secureSchemas.social.test.ts
  ${BASE}/unit/secureSchemas.test.ts
  ${BASE}/unit/securityHeaders.test.ts
  ${BASE}/unit/slidingWindowRateLimit.test.ts
"

BATCHES[ai]="
  ${BASE}/unit/ai/*.test.ts
  ${BASE}/unit/aiOrchestrator.cache.test.ts
  ${BASE}/unit/aiOrchestrator.content.test.ts
  ${BASE}/unit/aiOrchestrator.providers.test.ts
  ${BASE}/unit/aiRoutes.generate.test.ts
  ${BASE}/unit/aiRoutes.predict.test.ts
  ${BASE}/unit/aiRoutes.smartanalysis.test.ts
  ${BASE}/unit/aiService.test.ts
  ${BASE}/unit/aiTypes.optimize.test.ts
  ${BASE}/unit/aiTypes.schemas.test.ts
  ${BASE}/unit/aiTypes.smartanalysis.test.ts
  ${BASE}/unit/audienceAnalyzer.test.ts
"

BATCHES[providers]="
  ${BASE}/unit/cachedProviderRoutes.test.ts
  ${BASE}/unit/credentialManager.test.ts
  ${BASE}/unit/providerAdapterInterface.test.ts
  ${BASE}/unit/providerCapabilityManager.combinations.test.ts
  ${BASE}/unit/providerCapabilityManager.init.test.ts
  ${BASE}/unit/providerCapabilityManager.matrix.test.ts
  ${BASE}/unit/providerConstraintValidator.test.ts
  ${BASE}/unit/ProviderCoordinator.balancing.test.ts
  ${BASE}/unit/ProviderCoordinator.failover.test.ts
  ${BASE}/unit/ProviderCoordinator.init.test.ts
  ${BASE}/unit/ProviderCoordinator.scoring.test.ts
  ${BASE}/unit/ProviderCoordinator.test.ts
  ${BASE}/unit/ProviderDependencyManager.deadlock.test.ts
  ${BASE}/unit/ProviderDependencyManager.graph.test.ts
  ${BASE}/unit/ProviderDependencyManager.test.ts
  ${BASE}/unit/ProviderDependencyManager.validation.test.ts
  ${BASE}/unit/providerOAuth.connections.test.ts
  ${BASE}/unit/providerOAuth.initiation.test.ts
  ${BASE}/unit/providerOAuth.tokenexchange.test.ts
  ${BASE}/unit/providerRegistry.test.ts
  ${BASE}/unit/providerService.test.ts
"

BATCHES[content]="
  ${BASE}/unit/ContentRoutingEngine.test.ts
  ${BASE}/unit/ContentSynchronizer.conflicts.test.ts
  ${BASE}/unit/ContentSynchronizer.init.test.ts
  ${BASE}/unit/ContentSynchronizer.streaming.test.ts
  ${BASE}/unit/ContentSynchronizer.test.ts
  ${BASE}/unit/ContentSynchronizer.versions.test.ts
  ${BASE}/unit/ContentVersionManager.compare.test.ts
  ${BASE}/unit/ContentVersionManager.create.test.ts
  ${BASE}/unit/ContentVersionManager.merge.test.ts
  ${BASE}/unit/ContentVersionManager.test.ts
  ${BASE}/unit/ConflictResolver.adaptation.test.ts
  ${BASE}/unit/ConflictResolver.init.test.ts
  ${BASE}/unit/ConflictResolver.stats.test.ts
  ${BASE}/unit/contentOptimizer.advanced.test.ts
  ${BASE}/unit/contentOptimizer.analysis.test.ts
  ${BASE}/unit/contentOptimizer.insights.test.ts
  ${BASE}/unit/contentOptimizer.variations.test.ts
  ${BASE}/unit/contentRoutes.test.ts
  ${BASE}/unit/PlatformContentAdapter-simple.test.ts
  ${BASE}/unit/PlatformContentAdapter.content.test.ts
  ${BASE}/unit/PlatformContentAdapter.media-errors.test.ts
  ${BASE}/unit/PlatformContentAdapter.platforms.test.ts
  ${BASE}/unit/PlatformContentAdapter.test.ts
  ${BASE}/unit/PlatformContentAdapter.twitter.test.ts
  ${BASE}/unit/ServerTemplateEngine.test.ts
  ${BASE}/unit/SyncEngine.test.ts
  ${BASE}/unit/syncEngine.conflicts.test.ts
  ${BASE}/unit/syncEngine.init.test.ts
  ${BASE}/unit/syncEngine.monitoring.test.ts
  ${BASE}/unit/syncEngine.sync.test.ts
  ${BASE}/unit/templateAnalytics.test.ts
  ${BASE}/unit/templateEngine.test.ts
  ${BASE}/unit/templateRoutes.actions.test.ts
  ${BASE}/unit/templateRoutes.crud.test.ts
  ${BASE}/unit/templateRoutes.features.test.ts
  ${BASE}/unit/templateRoutes.test.ts
  ${BASE}/unit/templateService.crud.test.ts
  ${BASE}/unit/templateService.test.ts
  ${BASE}/unit/templateService.versions.test.ts
"

BATCHES[events]="
  ${BASE}/unit/CQRSBus.monitoring.test.ts
  ${BASE}/unit/CQRSBus.registration.test.ts
  ${BASE}/unit/CQRSIntegration.test.ts
  ${BASE}/unit/cqrsIntegration.init-commands-queries.test.ts
  ${BASE}/unit/cqrsIntegration.system-errors-cache-shutdown.test.ts
  ${BASE}/unit/EventIntegration.test.ts
  ${BASE}/unit/eventIntegration.publishing-history-analytics-health.test.ts
  ${BASE}/unit/eventIntegration.routes-creation-updates.test.ts
  ${BASE}/unit/EventPublisher.test.ts
  ${BASE}/unit/EventService.integration.test.ts
  ${BASE}/unit/EventService.post-channel.test.ts
  ${BASE}/unit/EventService.test.ts
  ${BASE}/unit/EventService.user-analytics.test.ts
  ${BASE}/unit/EventStore.test.ts
  ${BASE}/unit/sagaIntegration.init.test.ts
  ${BASE}/unit/sagaIntegration.lifecycle.test.ts
  ${BASE}/unit/sagaIntegration.monitoring.test.ts
  ${BASE}/unit/sagaIntegration.routes.test.ts
  ${BASE}/unit/sagaManager.execution.test.ts
  ${BASE}/unit/sagaManager.lifecycle.test.ts
"

BATCHES[webhooks]="
  ${BASE}/unit/realtimeWebhookBroadcaster.broadcasting.test.ts
  ${BASE}/unit/realtimeWebhookBroadcaster.connections.test.ts
  ${BASE}/unit/realtimeWebhookBroadcaster.stats-shutdown.test.ts
  ${BASE}/unit/realtimeWebhookBroadcaster.test.ts
  ${BASE}/unit/webhookDashboardRoutes.test.ts
  ${BASE}/unit/webhookDashboardService.test.ts
  ${BASE}/unit/webhookHandler.errors.test.ts
  ${BASE}/unit/webhookHandler.init.test.ts
  ${BASE}/unit/webhookHandler.processing.test.ts
  ${BASE}/unit/webhookHandler.stats.test.ts
  ${BASE}/unit/webhookHandler.test.ts
  ${BASE}/unit/webhookJobProcessor.integration.test.ts
  ${BASE}/unit/webhookJobProcessor.jobid-structure.test.ts
  ${BASE}/unit/webhookJobProcessor.priority-delay.test.ts
  ${BASE}/unit/webhookJobProcessor.test.ts
  ${BASE}/unit/webhookManager.processing.test.ts
  ${BASE}/unit/webhookManager.subscriptions.test.ts
  ${BASE}/unit/webhookManager.test.ts
  ${BASE}/unit/webhooks/*.test.ts
"

BATCHES[cache]="
  ${BASE}/unit/autoCacheMiddleware.invalidation-config.test.ts
  ${BASE}/unit/autoCacheMiddleware.registration-get.test.ts
  ${BASE}/unit/autoCacheMiddleware.test.ts
  ${BASE}/unit/cacheConfig.test.ts
  ${BASE}/unit/cacheDecorators.test.ts
  ${BASE}/unit/cacheStatsRoutes.test.ts
  ${BASE}/unit/DatabaseIntegration.test.ts
  ${BASE}/unit/DatabaseOptimizer.test.ts
  ${BASE}/unit/dbOptimization.test.ts
"

BATCHES[monitoring]="
  ${BASE}/unit/apiMetrics.http.test.ts
  ${BASE}/unit/apiMetrics.monitoring.test.ts
  ${BASE}/unit/apiMetrics.operations.test.ts
  ${BASE}/unit/apiMetrics.test.ts
  ${BASE}/unit/architecture.test.ts
  ${BASE}/unit/correlationMiddleware.test.ts
  ${BASE}/unit/healthMetrics.test.ts
  ${BASE}/unit/healthRoutes.test.ts
  ${BASE}/unit/logger.test.ts
  ${BASE}/unit/metricsMiddleware.test.ts
  ${BASE}/unit/performanceMonitor.init.test.ts
  ${BASE}/unit/performanceMonitor.stats.test.ts
  ${BASE}/unit/performanceMonitor.test.ts
  ${BASE}/unit/rateLimitingDashboard.test.ts
"

BATCHES[account]="
  ${BASE}/unit/AccountMapper.test.ts
  ${BASE}/unit/AccountRepository.test.ts
  ${BASE}/unit/accountLifecycleRoutes.test.ts
  ${BASE}/unit/accountLifecycleService.test.ts
  ${BASE}/unit/accountRoutes.test.ts
  ${BASE}/unit/auditLogger.test.ts
  ${BASE}/unit/auditMiddleware.test.ts
  ${BASE}/unit/auditRoutes.test.ts
  ${BASE}/unit/auditService.log.test.ts
  ${BASE}/unit/auditService.query.test.ts
  ${BASE}/unit/auditService.retention.test.ts
  ${BASE}/unit/auditService.stats.test.ts
  ${BASE}/unit/auditService.test.ts
  ${BASE}/unit/AuditableService.test.ts
  ${BASE}/unit/dashboardRoutes.test.ts
  ${BASE}/unit/projectRoutes.test.ts
  ${BASE}/unit/ProjectRepository.test.ts
  ${BASE}/unit/subscriptionRoutes.operations.test.ts
  ${BASE}/unit/subscriptionRoutes.plans.test.ts
  ${BASE}/unit/subscriptionRoutes.test.ts
  ${BASE}/unit/subscriptionRoutes.trials.test.ts
  ${BASE}/unit/subscriptionService.test.ts
  ${BASE}/unit/UserRepository.test.ts
"

BATCHES[analytics]="
  ${BASE}/unit/AnalyticsAggregator.test.ts
  ${BASE}/unit/AnalyticsRepository.basic.test.ts
  ${BASE}/unit/AnalyticsRepository.channel.test.ts
  ${BASE}/unit/AnalyticsRepository.timeseries.test.ts
  ${BASE}/unit/analyticsRoutes.test.ts
  ${BASE}/unit/analyticsUseCaseRoutes.test.ts
  ${BASE}/unit/analyticsUtils.test.ts
  ${BASE}/unit/engagementPredictor.test.ts
  ${BASE}/unit/predictionModels.ensemble.test.ts
  ${BASE}/unit/predictionModels.management.test.ts
  ${BASE}/unit/predictionModels.models.test.ts
  ${BASE}/unit/realtimeAnalytics.test.ts
  ${BASE}/unit/roiCalculator.test.ts
  ${BASE}/unit/threadAnalytics.test.ts
  ${BASE}/unit/timingPredictor.core.test.ts
  ${BASE}/unit/timingPredictor.platform.test.ts
  ${BASE}/unit/timingPredictor.realtime.test.ts
  ${BASE}/unit/timingPredictor.scheduling.test.ts
  ${BASE}/unit/timingPredictor.test.ts
  ${BASE}/unit/trendAnalysisService.init-trending.test.ts
  ${BASE}/unit/trendAnalysisService.opportunities-report.test.ts
  ${BASE}/unit/trendAnalysisService.predictions-viral.test.ts
  ${BASE}/unit/trendAnalysisService.test.ts
  ${BASE}/unit/trendRoutes.test.ts
"

BATCHES[posts]="
  ${BASE}/unit/optimizedPostsRoutes.test.ts
  ${BASE}/unit/PostCommandHandlers.create.test.ts
  ${BASE}/unit/PostCommandHandlers.delete.test.ts
  ${BASE}/unit/PostCommandHandlers.publish.test.ts
  ${BASE}/unit/PostCommandHandlers.test.ts
  ${BASE}/unit/PostCommandHandlers.update.test.ts
  ${BASE}/unit/PostQueryHandlers.errors.test.ts
  ${BASE}/unit/PostQueryHandlers.get-list.test.ts
  ${BASE}/unit/PostQueryHandlers.search-analytics.test.ts
  ${BASE}/unit/PostQueryHandlers.test.ts
  ${BASE}/unit/postRoutes.test.ts
  ${BASE}/unit/postsService.test.ts
  ${BASE}/unit/PublishingOrchestrator.test.ts
"

BATCHES[media]="
  ${BASE}/unit/fileUploadValidator.test.ts
  ${BASE}/unit/inputValidation.test.ts
  ${BASE}/unit/thumbnailGenerator.test.ts
  ${BASE}/unit/uploadPipeline.test.ts
  ${BASE}/unit/videoProcessor.metadata-processing.test.ts
  ${BASE}/unit/videoProcessor.features.test.ts
"

BATCHES[admin]="
  ${BASE}/unit/admin/*.test.ts
  ${BASE}/unit/channelRoutes.test.ts
  ${BASE}/unit/executiveRoutes.test.ts
  ${BASE}/unit/queueRoutes.test.ts
  ${BASE}/unit/schedulingRoutes.test.ts
"

BATCHES[misc]="
  ${BASE}/unit/advancedRateLimit.test.ts
  ${BASE}/unit/BaseService.test.ts
  ${BASE}/unit/connectionManager.test.ts
  ${BASE}/unit/dataGenerator.test.ts
  ${BASE}/unit/enhancedValidator.test.ts
  ${BASE}/unit/errorHandler.test.ts
  ${BASE}/unit/errorPlugin.test.ts
  ${BASE}/unit/rateLimit.test.ts
"

# Ordered list of batch names for deterministic execution
BATCH_ORDER=(
  domain application infrastructure auth ai providers content
  events webhooks cache monitoring account analytics posts
  media admin misc
)

# ── Run a single batch ──
run_batch() {
  local name=$1
  local files_raw="${BATCHES[$name]}"

  # Expand globs and filter existing files
  local files=()
  for pattern in $files_raw; do
    # Use compgen to safely expand globs
    for f in $pattern; do
      [[ -f "$f" ]] && files+=("$f")
    done
  done

  if [[ ${#files[@]} -eq 0 ]]; then
    echo -e "${YELLOW}  ⚠ SKIP${NC} — no test files found"
    return 2
  fi

  local result
  result=$(node --import tsx --experimental-test-module-mocks --test $FORCE_EXIT --test-timeout=$TIMEOUT $CONCURRENCY "${files[@]}" 2>&1) || true

  local tests=$(echo "$result" | grep "^# tests" | tail -1 | awk '{print $3}')
  local pass=$(echo "$result" | grep "^# pass" | tail -1 | awk '{print $3}')
  local fail=$(echo "$result" | grep "^# fail" | tail -1 | awk '{print $3}')
  local skip=$(echo "$result" | grep "^# skipped" | tail -1 | awk '{print $3}')

  tests=${tests:-0}
  pass=${pass:-0}
  fail=${fail:-0}
  skip=${skip:-0}

  if [[ "$fail" == "0" ]]; then
    echo -e "${GREEN}  ✓ PASS${NC} — ${pass} tests, ${#files[@]} files"
    return 0
  else
    echo -e "${RED}  ✗ FAIL${NC} — ${pass} pass, ${fail} fail, ${#files[@]} files"
    # Show first few failures
    echo "$result" | grep "not ok" | grep -v "subtest" | head -5 | sed 's/^/    /'
    return 1
  fi
}

# ── Main ──
echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║          OmniPost API Test Runner (Batched)         ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# Determine which batches to run
if [[ $# -gt 0 ]]; then
  SELECTED=("$@")
else
  SELECTED=("${BATCH_ORDER[@]}")
fi

total_pass=0
total_fail=0
total_skip=0
failed_batches=()
start_time=$SECONDS

for batch in "${SELECTED[@]}"; do
  if [[ -z "${BATCHES[$batch]+x}" ]]; then
    echo -e "${RED}Unknown batch: $batch${NC}"
    echo "Available: ${BATCH_ORDER[*]}"
    exit 1
  fi

  echo -e "${CYAN}▸ Batch: ${batch}${NC}"
  batch_start=$SECONDS

  if run_batch "$batch"; then
    : # pass
  else
    exit_code=$?
    if [[ $exit_code -eq 1 ]]; then
      failed_batches+=("$batch")
    fi
  fi

  elapsed=$(( SECONDS - batch_start ))
  echo "    (${elapsed}s)"
  echo ""
done

total_elapsed=$(( SECONDS - start_time ))

echo -e "${CYAN}──────────────────────────────────────────────────────${NC}"
echo -e "${CYAN}Summary${NC} (${total_elapsed}s total)"

if [[ ${#failed_batches[@]} -eq 0 ]]; then
  echo -e "${GREEN}  All batches passed!${NC}"
else
  echo -e "${RED}  Failed batches: ${failed_batches[*]}${NC}"
  exit 1
fi
