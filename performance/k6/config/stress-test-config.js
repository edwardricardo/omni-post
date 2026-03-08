// Stress Testing Configuration
export const stressTestConfig = {
  // Aggressive stress test to find breaking points
  stages: [
    // Gradual ramp-up to identify initial capacity
    { duration: "2m", target: 100 }, // Baseline load
    { duration: "3m", target: 200 }, // Double the load
    { duration: "2m", target: 400 }, // Aggressive increase
    { duration: "3m", target: 600 }, // High stress
    { duration: "2m", target: 800 }, // Very high stress
    { duration: "3m", target: 1000 }, // Maximum planned load
    { duration: "2m", target: 1200 }, // Beyond capacity
    { duration: "3m", target: 1500 }, // Breaking point test
    { duration: "5m", target: 1500 }, // Sustain breaking point
    { duration: "3m", target: 800 }, // Recovery test
    { duration: "3m", target: 400 }, // Further recovery
    { duration: "2m", target: 0 }, // Graceful shutdown
  ],

  // Stress test thresholds (more lenient to capture breaking points)
  thresholds: {
    // HTTP request duration - expect degradation under stress
    http_req_duration: [
      "p(50)<500", // 50th percentile under 500ms (stress conditions)
      "p(90)<2000", // 90th percentile under 2s
      "p(95)<5000", // 95th percentile under 5s
      "p(99)<10000", // 99th percentile under 10s
    ],

    // Error rate - acceptable degradation under extreme stress
    http_req_failed: ["rate<0.10"], // Error rate under 10% (stress tolerance)

    // Check success rate - lower tolerance for stress testing
    checks: ["rate>0.85"], // 85% of checks should pass

    // System stability metrics
    system_breaking_point: ["rate<0.20"], // Less than 20% complete failures
    recovery_time: ["p(95)<30000"], // Recovery under 30s

    // Business-critical operations should remain more stable
    auth_success_rate: ["rate>0.95"], // Auth should remain stable
    critical_operations: ["rate>0.90"], // Critical ops maintain 90%

    // Performance degradation tracking
    response_time_degradation: ["rate<0.50"], // Track severe degradation
  },

  // Stress test scenarios
  scenarios: {
    // Concurrent user stress test
    concurrent_users_stress: {
      executor: "ramping-vus",
      stages: [
        { duration: "1m", target: 200 },
        { duration: "2m", target: 500 },
        { duration: "3m", target: 1000 },
        { duration: "2m", target: 1500 },
        { duration: "5m", target: 1500 },
        { duration: "2m", target: 0 },
      ],
      gracefulRampDown: "60s",
      exec: "stressTestMainFlow",
    },

    // Database stress scenario
    database_stress: {
      executor: "constant-vus",
      vus: 100,
      duration: "10m",
      exec: "databaseStressTest",
    },

    // Provider API stress scenario
    provider_stress: {
      executor: "ramping-arrival-rate",
      startRate: 10,
      timeUnit: "1s",
      stages: [
        { duration: "2m", target: 50 }, // 50 req/s
        { duration: "3m", target: 100 }, // 100 req/s
        { duration: "2m", target: 200 }, // 200 req/s
        { duration: "3m", target: 300 }, // 300 req/s (breaking point)
        { duration: "2m", target: 50 }, // Recovery
      ],
      preAllocatedVUs: 50,
      maxVUs: 500,
      exec: "providerStressTest",
    },

    // Memory stress scenario
    memory_stress: {
      executor: "ramping-vus",
      stages: [
        { duration: "3m", target: 50 },
        { duration: "5m", target: 100 },
        { duration: "5m", target: 100 },
        { duration: "2m", target: 0 },
      ],
      exec: "memoryStressTest",
    },
  },

  // Extended timeouts for stress conditions
  setupTimeout: "120s",
  teardownTimeout: "60s",

  // Resource limits
  maxRedirects: 4,
  insecureSkipTLSVerify: true,
  noConnectionReuse: false,

  // Stress-specific HTTP settings
  batch: 5, // Reduce batch size under stress
  batchPerHost: 3,

  // Tags for stress test identification
  tags: {
    testType: "stress",
    environment: "performance",
    version: "1.0",
    purpose: "breaking_point_analysis",
  },

  // Keep response bodies for failure analysis
  discardResponseBodies: false,

  // External monitoring integration
  ext: {
    loadimpact: {
      name: "Social Media CMS - Stress Test",
      projectID: 3649323,
      note: "Stress testing to identify system breaking points and recovery behavior",
    },
  },
};

// Breaking point detection configuration
export const breakingPointConfig = {
  // Metrics to monitor for breaking point detection
  criticalMetrics: [
    "http_req_duration",
    "http_req_failed",
    "response_time_p95",
    "error_rate",
    "throughput",
  ],

  // Breaking point thresholds
  breakingPointThresholds: {
    maxResponseTime: 10000, // 10s response time = breaking point
    maxErrorRate: 0.25, // 25% error rate = breaking point
    minThroughput: 10, // Below 10 req/s = system failure
    maxMemoryUsage: 4096, // 4GB memory usage = resource exhaustion
    maxCpuUsage: 95, // 95% CPU = resource exhaustion
  },

  // Recovery testing
  recoveryTest: {
    enabled: true,
    recoveryDuration: "5m", // Time to test recovery
    recoveryTarget: 100, // VUs during recovery test
    stabilityThreshold: 0.95, // 95% success rate for recovery
  },
};

// Resource exhaustion test scenarios
export const resourceExhaustionTests = {
  memory_exhaustion: {
    // Test memory leaks and high memory usage
    scenario: "memory_intensive_operations",
    duration: "15m",
    maxMemoryThreshold: "2GB",
    operations: ["large_file_uploads", "complex_analytics_queries", "bulk_data_processing"],
  },

  connection_exhaustion: {
    // Test database connection pool limits
    scenario: "connection_pool_stress",
    duration: "10m",
    maxConnections: 100,
    operations: ["concurrent_database_queries", "long_running_transactions", "connection_leaks"],
  },

  rate_limit_exhaustion: {
    // Test rate limiting under extreme load
    scenario: "rate_limit_stress",
    duration: "5m",
    requestRate: 1000, // req/s
    operations: ["auth_requests", "api_calls", "provider_requests"],
  },
};

// Failure mode testing
export const failureModeTests = {
  provider_failures: {
    // Simulate provider API failures
    enabled: true,
    failureRate: 0.3, // 30% failure rate
    scenarios: [
      "provider_timeout",
      "provider_rate_limit",
      "provider_authentication_failure",
      "provider_service_unavailable",
    ],
  },

  database_failures: {
    // Simulate database issues
    enabled: true,
    scenarios: [
      "connection_timeout",
      "query_timeout",
      "deadlock_simulation",
      "connection_pool_exhaustion",
    ],
  },

  network_failures: {
    // Simulate network issues
    enabled: true,
    scenarios: ["high_latency", "packet_loss", "connection_drops", "dns_failures"],
  },
};

// Performance degradation analysis
export const degradationAnalysis = {
  baselineMetrics: {
    // Baseline performance metrics for comparison
    responseTime: {
      p50: 50, // 50ms
      p95: 200, // 200ms
      p99: 500, // 500ms
    },
    throughput: 1000, // 1000 req/s
    errorRate: 0.001, // 0.1%
    concurrentUsers: 100, // 100 users
  },

  degradationThresholds: {
    // Acceptable degradation levels
    responseTimeDegradation: 5, // 5x slower is critical
    throughputDegradation: 0.5, // 50% reduction is critical
    errorRateIncrease: 10, // 10x error rate increase
  },

  monitoringInterval: "10s", // Monitor every 10 seconds
  alertThresholds: {
    warning: 2, // 2x degradation = warning
    critical: 5, // 5x degradation = critical
  },
};

// Environment-specific stress configurations
export const stressEnvironmentConfigs = {
  development: {
    // Lighter stress testing for development
    maxVUs: 500,
    maxDuration: "10m",
    breakingPointTarget: 300,
  },

  staging: {
    // Full stress testing for staging
    maxVUs: 1000,
    maxDuration: "20m",
    breakingPointTarget: 800,
  },

  production: {
    // Controlled stress testing for production (if allowed)
    maxVUs: 200,
    maxDuration: "5m",
    breakingPointTarget: 150,
    safeguards: {
      enabled: true,
      maxErrorRate: 0.05, // Stop test if error rate > 5%
      maxResponseTime: 2000, // Stop test if response time > 2s
    },
  },
};

export default stressTestConfig;
