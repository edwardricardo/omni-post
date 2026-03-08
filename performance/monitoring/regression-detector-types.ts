export interface PerformanceBaseline {
  version: string;
  timestamp: number;
  environment: string;
  metrics: BaselineMetrics;
  testConfiguration: TestConfiguration;
}

export interface BaselineMetrics {
  responseTime: {
    p50: number;
    p95: number;
    p99: number;
    max: number;
  };
  throughput: number;
  errorRate: number;
  dbQueryTime: {
    p50: number;
    p95: number;
    p99: number;
  };
  dbConnectionPoolUtilization: number;
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  cpuUsage: number;
  cacheHitRate: number;
  cacheResponseTime: number;
  providerResponseTime: {
    p95: number;
    p99: number;
  };
  providerErrorRate: number;
  coreWebVitals?: {
    lcp: number;
    fid: number;
    cls: number;
  };
}

export interface TestConfiguration {
  concurrentUsers: number;
  testDuration: number;
  scenario: string;
  dataSize: string;
}

export interface RegressionResult {
  metric: string;
  baseline: number;
  current: number;
  change: number;
  changeDirection: "improvement" | "regression" | "neutral";
  severity: "low" | "medium" | "high" | "critical";
  threshold: number;
}

export interface RegressionReport {
  timestamp: number;
  version: string;
  baselineVersion: string;
  environment: string;
  overallStatus: "pass" | "warning" | "fail";
  regressions: RegressionResult[];
  improvements: RegressionResult[];
  summary: RegressionSummary;
  recommendations: string[];
}

export interface RegressionSummary {
  totalMetrics: number;
  regressionsCount: number;
  improvementsCount: number;
  criticalRegressions: number;
  averageChange: number;
  worstRegression: RegressionResult | null;
  bestImprovement: RegressionResult | null;
}

export interface RegressionThresholds {
  responseTime: {
    warning: number;
    critical: number;
  };
  throughput: {
    warning: number;
    critical: number;
  };
  errorRate: {
    warning: number;
    critical: number;
  };
  memoryUsage: {
    warning: number;
    critical: number;
  };
  cacheHitRate: {
    warning: number;
    critical: number;
  };
}
