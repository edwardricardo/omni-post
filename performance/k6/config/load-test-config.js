// Load Testing Configuration
export const loadTestConfig = {
  // Multi-stage load test simulating realistic traffic patterns
  stages: [
    // Warm-up phase
    { duration: "2m", target: 50 }, // Gradually ramp up to 50 users over 2 minutes

    // Normal business hours simulation
    { duration: "5m", target: 100 }, // Increase to 100 users (normal load)
    { duration: "10m", target: 100 }, // Maintain 100 users for 10 minutes

    // Peak hours simulation
    { duration: "2m", target: 200 }, // Ramp up to peak (200 users)
    { duration: "10m", target: 200 }, // Sustain peak load

    // Burst traffic simulation
    { duration: "1m", target: 350 }, // Sudden spike (social media viral effect)
    { duration: "3m", target: 350 }, // Maintain spike

    // Recovery phase
    { duration: "2m", target: 200 }, // Return to peak
    { duration: "5m", target: 100 }, // Return to normal
    { duration: "3m", target: 0 }, // Graceful shutdown
  ],

  // Performance thresholds
  thresholds: {
    // HTTP request duration thresholds
    http_req_duration: [
      "p(50)<150", // 50th percentile under 150ms
      "p(90)<300", // 90th percentile under 300ms
      "p(95)<500", // 95th percentile under 500ms
      "p(99)<1000", // 99th percentile under 1s
    ],

    // Error rate thresholds
    http_req_failed: ["rate<0.01"], // Error rate under 1%

    // Check success rate
    checks: ["rate>0.99"], // 99% of checks should pass

    // Custom business metrics
    auth_success_rate: ["rate>0.99"],
    post_creation_success_rate: ["rate>0.98"],
    analytics_query_success_rate: ["rate>0.99"],

    // Performance-specific thresholds
    login_duration: ["p(95)<300"],
    post_creation_duration: ["p(95)<500"],
    dashboard_load_duration: ["p(95)<800"],
  },

  // Test execution options
  scenarios: {
    // Main load test scenario
    load_test: {
      executor: "ramping-vus",
      stages: this.stages,
      gracefulRampDown: "30s",
    },
  },

  // Environment and setup
  setupTimeout: "60s",
  teardownTimeout: "30s",

  // Output configuration
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],

  // Batch requests to reduce overhead
  batch: 10,
  batchPerHost: 5,

  // HTTP configuration
  httpDebug: "full", // Set to 'full' for debugging, 'none' for production
  insecureSkipTLSVerify: true,
  noConnectionReuse: false,

  // User agent
  userAgent: "k6-load-test/1.0 (Performance Testing)",

  // Tags for result analysis
  tags: {
    testType: "load",
    environment: "performance",
    version: "1.0",
  },

  // Discarded samples (samples that won't be included in stats)
  discardResponseBodies: false, // Keep response bodies for debugging

  // External configuration
  ext: {
    loadimpact: {
      name: "Social Media CMS - Load Test",
      projectID: 3649323,
      note: "Baseline load testing for social media platform",
    },
  },
};

// Scenario-specific configurations
export const scenarioConfigs = {
  auth_flow: {
    executor: "ramping-vus",
    stages: [
      { duration: "1m", target: 20 },
      { duration: "3m", target: 50 },
      { duration: "2m", target: 0 },
    ],
    env: { SCENARIO: "auth_flow" },
  },

  posting_workflow: {
    executor: "ramping-vus",
    stages: [
      { duration: "2m", target: 30 },
      { duration: "5m", target: 75 },
      { duration: "2m", target: 0 },
    ],
    env: { SCENARIO: "posting_workflow" },
  },

  analytics_dashboard: {
    executor: "ramping-vus",
    stages: [
      { duration: "1m", target: 15 },
      { duration: "4m", target: 40 },
      { duration: "2m", target: 0 },
    ],
    env: { SCENARIO: "analytics_dashboard" },
  },

  provider_integration: {
    executor: "ramping-vus",
    stages: [
      { duration: "2m", target: 25 },
      { duration: "3m", target: 60 },
      { duration: "2m", target: 0 },
    ],
    env: { SCENARIO: "provider_integration" },
  },

  user_journey: {
    executor: "ramping-vus",
    stages: [
      { duration: "3m", target: 20 },
      { duration: "5m", target: 40 },
      { duration: "2m", target: 0 },
    ],
    env: { SCENARIO: "user_journey" },
  },
};

// Environment-specific configurations
export const environmentConfigs = {
  development: {
    baseUrl: "http://localhost:3000",
    thresholds: {
      // Relaxed thresholds for development
      http_req_duration: ["p(95)<1000"],
      http_req_failed: ["rate<0.05"],
    },
  },

  staging: {
    baseUrl: "https://staging.api.socialmedia-cms.com",
    thresholds: {
      // Production-like thresholds
      http_req_duration: ["p(95)<500"],
      http_req_failed: ["rate<0.02"],
    },
  },

  production: {
    baseUrl: "https://api.socialmedia-cms.com",
    thresholds: {
      // Strict production thresholds
      http_req_duration: ["p(95)<300"],
      http_req_failed: ["rate<0.01"],
    },
  },
};

// Data generation configuration
export const dataConfig = {
  users: {
    count: 1000,
    emailDomain: "perftest.example.com",
  },

  projects: {
    count: 50,
    postsPerProject: 20,
  },

  content: {
    textLengths: [50, 150, 280, 500],
    mediaTypes: ["image", "video", "carousel"],
    platforms: ["x", "instagram", "facebook", "youtube", "tiktok"],
  },
};

// Monitoring and alerting configuration
export const monitoringConfig = {
  prometheus: {
    enabled: true,
    pushgateway: "http://localhost:9091",
    jobName: "k6-load-test",
  },

  grafana: {
    enabled: true,
    dashboard: "k6-performance-testing",
  },

  alerts: {
    webhook: process.env.ALERT_WEBHOOK_URL,
    slack: process.env.SLACK_WEBHOOK_URL,
  },
};

export default loadTestConfig;
