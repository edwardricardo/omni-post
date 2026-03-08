// Endurance Testing Configuration
export const enduranceTestConfig = {
  // Long-running test to detect memory leaks and performance degradation
  stages: [
    // Initial ramp-up
    { duration: "5m", target: 50 }, // Gradual warm-up to 50 users
    { duration: "5m", target: 100 }, // Increase to target load

    // Endurance phase - sustained load for extended period
    { duration: "30m", target: 100 }, // 30 minutes sustained load
    { duration: "60m", target: 150 }, // 1 hour at higher load
    { duration: "120m", target: 200 }, // 2 hours at peak endurance load
    { duration: "60m", target: 150 }, // 1 hour step-down
    { duration: "30m", target: 100 }, // 30 minutes normal load

    // Final stress burst to test system after endurance
    { duration: "10m", target: 300 }, // Burst test after endurance
    { duration: "10m", target: 300 }, // Sustain burst

    // Graceful shutdown
    { duration: "10m", target: 100 }, // Return to normal
    { duration: "5m", target: 0 }, // Graceful exit
  ],

  // Endurance-specific thresholds
  thresholds: {
    // Response time should remain stable over time
    http_req_duration: [
      "p(50)<200", // Median should stay under 200ms
      "p(90)<500", // 90th percentile under 500ms
      "p(95)<1000", // 95th percentile under 1s
      "p(99)<2000", // 99th percentile under 2s
    ],

    // Error rate should remain low throughout the test
    http_req_failed: ["rate<0.01"], // Error rate under 1%

    // Check success rate should remain high
    checks: ["rate>0.98"], // 98% success rate

    // Memory leak detection metrics
    memory_growth_rate: ["rate<0.05"], // Less than 5% memory growth per hour
    gc_frequency: ["rate<100"], // Garbage collection frequency
    heap_usage: ["rate<0.80"], // Heap usage under 80%

    // Performance stability metrics
    response_time_stability: ["rate>0.95"], // Response time should be stable
    throughput_stability: ["rate>0.95"], // Throughput should be stable

    // Resource usage metrics
    cpu_usage: ["rate<0.80"], // CPU usage under 80%
    database_connections: ["rate<0.85"], // DB connections under 85% of pool
    cache_hit_rate: ["rate>0.80"], // Cache hit rate above 80%

    // Business operation metrics
    auth_success_rate: ["rate>0.99"],
    post_creation_success_rate: ["rate>0.98"],
    analytics_query_success_rate: ["rate>0.99"],
  },

  // Extended timeouts for long-running test
  setupTimeout: "300s", // 5 minutes setup
  teardownTimeout: "180s", // 3 minutes teardown

  // Endurance test scenarios
  scenarios: {
    // Main endurance scenario with mixed workload
    endurance_mixed_workload: {
      executor: "ramping-vus",
      stages: [
        { duration: "10m", target: 50 },
        { duration: "240m", target: 100 }, // 4 hours sustained
        { duration: "10m", target: 0 },
      ],
      gracefulRampDown: "120s",
      exec: "enduranceMixedWorkload",
    },

    // Memory leak detection scenario
    memory_leak_detection: {
      executor: "constant-vus",
      vus: 25,
      duration: "180m", // 3 hours
      exec: "memoryLeakTest",
    },

    // Database endurance scenario
    database_endurance: {
      executor: "constant-arrival-rate",
      rate: 10, // 10 req/s constant
      timeUnit: "1s",
      duration: "120m", // 2 hours
      preAllocatedVUs: 20,
      maxVUs: 100,
      exec: "databaseEnduranceTest",
    },

    // Provider integration endurance
    provider_endurance: {
      executor: "ramping-vus",
      stages: [
        { duration: "5m", target: 15 },
        { duration: "180m", target: 30 }, // 3 hours provider testing
        { duration: "5m", target: 0 },
      ],
      exec: "providerEnduranceTest",
    },

    // Analytics heavy load endurance
    analytics_endurance: {
      executor: "constant-vus",
      vus: 10,
      duration: "120m", // 2 hours
      exec: "analyticsEnduranceTest",
    },
  },

  // HTTP configuration for long-running tests
  batch: 10,
  batchPerHost: 5,
  maxRedirects: 4,
  insecureSkipTLSVerify: true,
  noConnectionReuse: false,

  // Tags for endurance test identification
  tags: {
    testType: "endurance",
    environment: "performance",
    version: "1.0",
    purpose: "memory_leak_and_stability_testing",
  },

  // Keep detailed logs for long-running analysis
  discardResponseBodies: false,

  // External monitoring integration
  ext: {
    loadimpact: {
      name: "Social Media CMS - Endurance Test",
      projectID: 3649323,
      note: "Long-running endurance test for memory leak detection and stability analysis",
    },
  },
};

// Memory leak detection configuration
export const memoryLeakConfig = {
  // Monitoring intervals
  memoryCheckInterval: "60s", // Check memory every minute
  heapSnapshotInterval: "600s", // Take heap snapshots every 10 minutes

  // Memory growth thresholds
  memoryGrowthThresholds: {
    warning: 50, // 50MB/hour growth = warning
    critical: 100, // 100MB/hour growth = critical
    failure: 200, // 200MB/hour growth = test failure
  },

  // Memory patterns to detect
  leakPatterns: [
    "linear_growth", // Steady memory increase
    "sawtooth_pattern", // Memory spikes with incomplete cleanup
    "plateau_shift", // Sudden jumps to new memory levels
    "exponential_growth", // Accelerating memory usage
  ],

  // Monitoring metrics
  metrics: [
    "heap_used",
    "heap_total",
    "external_memory",
    "array_buffers",
    "rss_memory",
    "gc_duration",
    "gc_frequency",
  ],
};

// Performance degradation detection
export const performanceDegradationConfig = {
  // Baseline performance window
  baselineWindow: "30m", // First 30 minutes as baseline

  // Degradation detection thresholds
  degradationThresholds: {
    responseTime: {
      minor: 1.2, // 20% increase
      major: 1.5, // 50% increase
      critical: 2.0, // 100% increase
    },
    throughput: {
      minor: 0.9, // 10% decrease
      major: 0.8, // 20% decrease
      critical: 0.7, // 30% decrease
    },
    errorRate: {
      minor: 2.0, // 2x increase
      major: 5.0, // 5x increase
      critical: 10.0, // 10x increase
    },
  },

  // Analysis windows
  analysisWindows: [
    "15m", // Short-term trends
    "30m", // Medium-term trends
    "60m", // Long-term trends
  ],

  // Alert configuration
  alerts: {
    enabled: true,
    webhookUrl: process.env.ENDURANCE_ALERT_WEBHOOK,
    emailRecipients: ["performance-team@company.com"],
  },
};

// Resource monitoring configuration
export const resourceMonitoringConfig = {
  // System metrics to monitor
  systemMetrics: [
    "cpu_usage",
    "memory_usage",
    "disk_io",
    "network_io",
    "file_descriptors",
    "thread_count",
  ],

  // Database metrics
  databaseMetrics: [
    "connection_count",
    "active_queries",
    "query_duration",
    "deadlocks",
    "cache_hit_ratio",
    "buffer_pool_usage",
  ],

  // Application metrics
  applicationMetrics: [
    "request_queue_size",
    "active_sessions",
    "cache_usage",
    "worker_processes",
    "response_time_percentiles",
  ],

  // Monitoring frequency
  monitoringFrequency: "30s",

  // Resource usage thresholds
  resourceThresholds: {
    cpu: {
      warning: 70, // 70% CPU usage
      critical: 85, // 85% CPU usage
    },
    memory: {
      warning: 80, // 80% memory usage
      critical: 90, // 90% memory usage
    },
    disk: {
      warning: 80, // 80% disk usage
      critical: 90, // 90% disk usage
    },
    connections: {
      warning: 80, // 80% of connection pool
      critical: 95, // 95% of connection pool
    },
  },
};

// Stability testing patterns
export const stabilityTestPatterns = {
  // Constant load pattern
  constant_load: {
    description: "Maintain constant load for extended period",
    pattern: [
      { duration: "10m", target: 100 },
      { duration: "180m", target: 100 }, // 3 hours constant
      { duration: "10m", target: 0 },
    ],
  },

  // Gradual increase pattern
  gradual_increase: {
    description: "Gradually increase load over time",
    pattern: [
      { duration: "30m", target: 50 },
      { duration: "30m", target: 75 },
      { duration: "30m", target: 100 },
      { duration: "30m", target: 125 },
      { duration: "30m", target: 150 },
      { duration: "30m", target: 0 },
    ],
  },

  // Wave pattern
  wave_pattern: {
    description: "Cyclical load increases and decreases",
    pattern: [
      { duration: "30m", target: 50 },
      { duration: "30m", target: 150 },
      { duration: "30m", target: 50 },
      { duration: "30m", target: 150 },
      { duration: "30m", target: 50 },
      { duration: "10m", target: 0 },
    ],
  },

  // Business hours simulation
  business_hours: {
    description: "Simulate realistic business hours traffic",
    pattern: [
      { duration: "60m", target: 25 }, // Early morning
      { duration: "120m", target: 100 }, // Morning peak
      { duration: "60m", target: 50 }, // Lunch lull
      { duration: "120m", target: 125 }, // Afternoon peak
      { duration: "60m", target: 75 }, // Evening
      { duration: "60m", target: 25 }, // Night
      { duration: "10m", target: 0 }, // Shutdown
    ],
  },
};

// Endurance test reporting configuration
export const enduranceReportConfig = {
  // Report generation settings
  generateReports: true,
  reportFormats: ["json", "html", "csv"],
  reportInterval: "60m", // Generate reports every hour

  // Key metrics to track over time
  timeSeriesMetrics: [
    "response_time_p95",
    "throughput",
    "error_rate",
    "memory_usage",
    "cpu_usage",
    "database_connections",
  ],

  // Trend analysis
  trendAnalysis: {
    enabled: true,
    detectionWindow: "60m",
    alertOnTrends: true,
  },

  // Performance comparison
  baselineComparison: {
    enabled: true,
    baselinePeriod: "30m", // Use first 30 minutes as baseline
    comparisonWindows: ["1h", "2h", "4h"],
  },
};

export default enduranceTestConfig;
