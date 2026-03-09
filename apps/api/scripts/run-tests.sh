#!/usr/bin/env bash
# Run all API test batches as separate node processes.
# Uses --test-force-exit to handle Prisma connection pool sockets that prevent clean exit.
# This eliminates count variance caused by process kill during TAP reporting.

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

echo "Running API test batches..."
echo ""

# Unit test batches (concurrency=4)
run_batch "unit:domain"       tests/unit/domain/**/*.test.ts
run_batch "unit:application"  'tests/unit/application/**/*.test.ts'
run_batch "unit:infra" \
  tests/unit/infrastructure/**/*.test.ts \
  tests/unit/outbox/PrismaOutboxWriter.test.ts \
  tests/unit/outbox/OutboxRelay.test.ts \
  tests/unit/outbox/OutboxCleaner.test.ts \
  tests/unit/integration-events/**/*.test.ts
run_batch "unit:webhooks"     tests/unit/webhooks/**/*.test.ts
run_batch "unit:admin" \
  tests/unit/admin/**/*.test.ts \
  tests/unit/channelRoutes.test.ts tests/unit/executiveRoutes.test.ts \
  tests/unit/queueRoutes.test.ts tests/unit/schedulingRoutes.test.ts

run_batch "unit:ai" \
  tests/unit/ai/gemini.init.test.ts tests/unit/ai/gemini.generation.test.ts \
  tests/unit/ai/gemini.analysis.test.ts tests/unit/ai/gemini.advanced.test.ts \
  tests/unit/ai/openai.init.test.ts tests/unit/ai/openai.generation.test.ts \
  tests/unit/ai/openai.optimization.test.ts \
  tests/unit/ai/perplexity.init.test.ts tests/unit/ai/perplexity.advanced.test.ts \
  tests/unit/ai/types.test.ts \
  tests/unit/aiTypes.schemas.test.ts tests/unit/aiTypes.optimize.test.ts \
  tests/unit/aiTypes.smartanalysis.test.ts \
  tests/unit/aiOrchestrator.providers.test.ts tests/unit/aiOrchestrator.cache.test.ts \
  tests/unit/aiOrchestrator.content.test.ts \
  tests/unit/aiRoutes.generate.test.ts tests/unit/aiRoutes.predict.test.ts \
  tests/unit/aiRoutes.smartanalysis.test.ts \
  tests/unit/aiService.test.ts

run_batch "unit:events" \
  tests/unit/CQRSBus.registration.test.ts tests/unit/CQRSBus.monitoring.test.ts \
  tests/unit/cqrsIntegration.init-commands-queries.test.ts \
  tests/unit/cqrsIntegration.system-errors-cache-shutdown.test.ts \
  tests/unit/eventIntegration.routes-creation-updates.test.ts \
  tests/unit/eventIntegration.publishing-history-analytics-health.test.ts \
  tests/unit/EventPublisher.test.ts \
  tests/unit/EventService.post-channel.test.ts tests/unit/EventService.user-analytics.test.ts \
  tests/unit/EventService.integration.test.ts tests/unit/EventStore.test.ts \
  tests/unit/sagaManager.lifecycle.test.ts tests/unit/sagaManager.execution.test.ts \
  tests/unit/sagaIntegration.init.test.ts tests/unit/sagaIntegration.lifecycle.test.ts \
  tests/unit/sagaIntegration.monitoring.test.ts tests/unit/sagaIntegration.routes.test.ts

run_batch "unit:auth" \
  tests/unit/authRoutes.test.ts tests/unit/authService.test.ts tests/unit/authMiddleware.test.ts \
  tests/unit/authRateLimit.test.ts \
  tests/unit/bruteForceProtection.core.test.ts tests/unit/bruteForceProtection.advanced.test.ts \
  tests/unit/enhancedOAuthProvider.pkce-state.test.ts \
  tests/unit/enhancedOAuthProvider.authurl-encryption.test.ts \
  tests/unit/enhancedOAuthProvider.callback-refresh-revoke-scope.test.ts \
  tests/unit/connectionManager.retrieval-config.test.ts \
  tests/unit/connectionManager.credentials-usage-errors.test.ts \
  tests/unit/connectionManager.health-summary-cleanup.test.ts \
  tests/unit/slidingWindowRateLimit.config-basic.test.ts \
  tests/unit/slidingWindowRateLimit.advanced.test.ts \
  tests/unit/slidingWindowRateLimit.plugin-cleanup.test.ts \
  tests/unit/rbacRoutes.test.ts tests/unit/rbacService.test.ts tests/unit/rbacMiddleware.test.ts \
  tests/unit/mfaRoutes.test.ts tests/unit/mfaService.test.ts tests/unit/UserRepository.test.ts \
  tests/unit/secureSchemas.basic.test.ts tests/unit/secureSchemas.social.test.ts tests/unit/secureSchemas.query.test.ts tests/unit/securityHeaders.test.ts \
  tests/unit/inputValidation.test.ts tests/unit/enhancedValidator.test.ts \
  tests/unit/fileUploadValidator.test.ts \
  tests/unit/advancedRateLimit.test.ts tests/unit/rateLimit.test.ts

run_batch "unit:providers" \
  tests/unit/providerAdapterInterface.test.ts \
  tests/unit/providerCapabilityManager.init.test.ts \
  tests/unit/providerCapabilityManager.matrix.test.ts \
  tests/unit/providerCapabilityManager.combinations.test.ts \
  tests/unit/ProviderCoordinator.init.test.ts \
  tests/unit/ProviderCoordinator.scoring.test.ts \
  tests/unit/ProviderCoordinator.failover.test.ts \
  tests/unit/ProviderCoordinator.balancing.test.ts \
  tests/unit/ProviderDependencyManager.graph.test.ts \
  tests/unit/ProviderDependencyManager.validation.test.ts \
  tests/unit/ProviderDependencyManager.deadlock.test.ts \
  tests/unit/providerOAuth.initiation.test.ts \
  tests/unit/providerOAuth.tokenexchange.test.ts \
  tests/unit/providerOAuth.connections.test.ts \
  tests/unit/providerRegistry.test.ts \
  tests/unit/providerService.test.ts \
  tests/unit/cachedProviderRoutes.test.ts \
  tests/unit/credentialManager.test.ts \
  tests/unit/PlatformContentAdapter.twitter.test.ts \
  tests/unit/PlatformContentAdapter.platforms.test.ts \
  tests/unit/PlatformContentAdapter.content.test.ts \
  tests/unit/PlatformContentAdapter.media-errors.test.ts \
  tests/unit/PlatformContentAdapter-simple.test.ts

run_batch "unit:analytics" \
  tests/unit/AnalyticsRepository.basic.test.ts \
  tests/unit/AnalyticsRepository.channel.test.ts \
  tests/unit/AnalyticsRepository.timeseries.test.ts \
  tests/unit/AnalyticsAggregator.test.ts \
  tests/unit/analyticsRoutes.test.ts \
  tests/unit/analyticsUtils.test.ts \
  tests/unit/roiCalculator.test.ts \
  tests/unit/engagementPredictor.test.ts \
  tests/unit/trendAnalysisService.init-trending.test.ts \
  tests/unit/trendAnalysisService.predictions-viral.test.ts \
  tests/unit/trendAnalysisService.opportunities-report.test.ts \
  tests/unit/trendRoutes.test.ts \
  tests/unit/realtimeAnalytics.test.ts tests/unit/threadAnalytics.test.ts

run_batch "unit:orchestration" \
  tests/unit/PublishingOrchestrator.init-plans.test.ts \
  tests/unit/PublishingOrchestrator.execution.test.ts \
  tests/unit/PublishingOrchestrator.lifecycle.test.ts

run_batch "unit:content" \
  tests/unit/contentRoutes.test.ts \
  tests/unit/ContentSynchronizer.init.test.ts \
  tests/unit/ContentSynchronizer.versions.test.ts \
  tests/unit/ContentSynchronizer.conflicts.test.ts \
  tests/unit/ContentSynchronizer.streaming.test.ts \
  tests/unit/ContentVersionManager.create.test.ts \
  tests/unit/ContentVersionManager.compare.test.ts \
  tests/unit/ContentVersionManager.merge.test.ts \
  tests/unit/ConflictResolver.init.test.ts \
  tests/unit/ConflictResolver.adaptation.test.ts \
  tests/unit/ConflictResolver.stats.test.ts \
  tests/unit/templateRoutes.crud.test.ts tests/unit/templateRoutes.actions.test.ts \
  tests/unit/templateRoutes.features.test.ts \
  tests/unit/templateService.crud.test.ts tests/unit/templateService.versions.test.ts \
  tests/unit/ServerTemplateEngine.test.ts tests/unit/templateAnalytics.test.ts \
  tests/unit/PostCommandHandlers.create.test.ts \
  tests/unit/PostCommandHandlers.update.test.ts \
  tests/unit/PostCommandHandlers.publish.test.ts \
  tests/unit/PostCommandHandlers.delete.test.ts \
  tests/unit/PostQueryHandlers.get-list.test.ts \
  tests/unit/PostQueryHandlers.search-analytics.test.ts \
  tests/unit/PostQueryHandlers.errors.test.ts \
  tests/unit/postRoutes.test.ts tests/unit/postsService.test.ts \
  tests/unit/optimizedPostsRoutes.test.ts tests/unit/templateEngine.test.ts

run_batch "unit:account" \
  tests/unit/accountLifecycleRoutes.test.ts tests/unit/accountLifecycleService.test.ts \
  tests/unit/AccountMapper.test.ts tests/unit/AccountRepository.test.ts \
  tests/unit/accountRoutes.test.ts tests/unit/projectRoutes.test.ts \
  tests/unit/ProjectRepository.test.ts \
  tests/unit/subscriptionRoutes.plans.test.ts \
  tests/unit/subscriptionRoutes.operations.test.ts \
  tests/unit/subscriptionRoutes.trials.test.ts \
  tests/unit/subscriptionService.test.ts \
  tests/unit/auditRoutes.test.ts \
  tests/unit/auditService.log.test.ts tests/unit/auditService.query.test.ts \
  tests/unit/auditService.stats.test.ts tests/unit/auditService.retention.test.ts \
  tests/unit/auditLogger.test.ts \
  tests/unit/auditMiddleware.test.ts tests/unit/AuditableService.test.ts \
  tests/unit/dashboardRoutes.test.ts

run_batch "unit:cache" \
  tests/unit/autoCacheMiddleware.registration-get.test.ts \
  tests/unit/autoCacheMiddleware.invalidation-config.test.ts \
  tests/unit/cacheConfig.test.ts \
  tests/unit/cacheDecorators.test.ts \
  tests/unit/cacheStatsRoutes.test.ts tests/unit/DatabaseOptimizer.test.ts \
  tests/unit/dbOptimization.test.ts \
  tests/unit/DatabaseIntegration.init-routes.test.ts \
  tests/unit/DatabaseIntegration.query-transaction.test.ts \
  tests/unit/DatabaseIntegration.analytics-config-shutdown.test.ts \
  tests/unit/performanceMonitor.init.test.ts \
  tests/unit/performanceMonitor.stats.test.ts

# healthRoutes uses mock.module() which requires --experimental-test-module-mocks
EXTRA_FLAGS="--experimental-test-module-mocks" run_batch "unit:health" \
  tests/unit/healthRoutes.test.ts

run_batch "unit:upload" \
  tests/unit/uploadPipeline.sessions.test.ts \
  tests/unit/uploadPipeline.upload.test.ts \
  tests/unit/uploadPipeline.destinations.test.ts \
  tests/unit/uploadPipeline.lifecycle.test.ts \
  tests/unit/uploadPipeline.features.test.ts

run_batch "unit:video" \
  tests/unit/videoProcessor.metadata-processing.test.ts \
  tests/unit/videoProcessor.features.test.ts

run_batch "unit:misc" \
  tests/unit/AppError.test.ts tests/unit/architecture.test.ts \
  tests/unit/BaseService.test.ts tests/unit/correlationMiddleware.test.ts \
  tests/unit/errorHandler.test.ts tests/unit/errorPlugin.test.ts \
  tests/unit/healthMetrics.test.ts \
  tests/unit/logger.test.ts tests/unit/metricsMiddleware.test.ts \
  tests/unit/apiMetrics.http.test.ts tests/unit/apiMetrics.operations.test.ts \
  tests/unit/apiMetrics.monitoring.test.ts \
  tests/unit/rateLimitingDashboard.test.ts tests/unit/typeUtils.test.ts \
  tests/unit/webhookDashboardRoutes.test.ts tests/unit/webhookDashboardService.test.ts \
  tests/unit/webhookJobProcessor.priority-delay.test.ts \
  tests/unit/webhookJobProcessor.jobid-structure.test.ts \
  tests/unit/webhookJobProcessor.integration.test.ts \
  tests/unit/realtimeWebhookBroadcaster.connections.test.ts \
  tests/unit/realtimeWebhookBroadcaster.broadcasting.test.ts \
  tests/unit/realtimeWebhookBroadcaster.stats-shutdown.test.ts \
  tests/unit/thumbnailGenerator.single.test.ts \
  tests/unit/thumbnailGenerator.multiple.test.ts \
  tests/unit/thumbnailGenerator.analysis.test.ts \
  tests/unit/thumbnailGenerator.templates.test.ts

# Webhook handler/manager tests use real DB (DELETE FROM ... WHERE 1=1)
# and must run sequentially to avoid cross-test data cleanup races.
CONCURRENCY=1 run_batch "unit:webhooks-db" \
  tests/unit/webhookHandler.init.test.ts tests/unit/webhookHandler.processing.test.ts \
  tests/unit/webhookHandler.errors.test.ts tests/unit/webhookHandler.stats.test.ts \
  tests/unit/webhookManager.subscriptions.test.ts \
  tests/unit/webhookManager.processing.test.ts

# SyncEngine uses real PG + Redis — needs concurrency=1 (shared Redis keys)
CONCURRENCY=1 run_batch "integration:sync" \
  tests/unit/syncEngine.init.test.ts tests/unit/syncEngine.sync.test.ts \
  tests/unit/syncEngine.conflicts.test.ts tests/unit/syncEngine.monitoring.test.ts

# Integration test batches (concurrency=1 for shared DB state)
CONCURRENCY=1 run_batch "integration:routes" \
  tests/integration/crisisRoutes.test.ts tests/integration/linkRoutes.test.ts \
  tests/integration/security-endpoints.test.ts

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
