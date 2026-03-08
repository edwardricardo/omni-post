export interface K6Result {
  metrics: {
    [key: string]: {
      values: { [percentile: string]: number };
      count?: number;
      rate?: number;
    };
  };
  root_group: {
    checks: Array<{
      name: string;
      passes: number;
      fails: number;
    }>;
  };
}

export interface DatabaseTestResult {
  queryCount: number;
  averageResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  errorCount: number;
  throughput: number;
  deadlockCount: number;
  longRunningQueries: number;
}

export interface MemoryTestResult {
  testDuration: number;
  analysis: {
    memoryGrowthRate: number;
    peakMemoryUsage: number;
    memoryEfficiency: number;
    gcPressure: number;
    trendAnalysis: {
      pattern: string;
      confidence: number;
      prediction: number;
    };
    anomalies: Array<{
      timestamp: number;
      type: string;
      severity: number;
      description: string;
    }>;
  };
  leakDetected: boolean;
  severity: string;
}

export interface ComprehensiveReport {
  generatedAt: string;
  environment: string;
  version?: string;
  summary: {
    overallStatus: "pass" | "warning" | "fail";
    totalTests: number;
    passedTests: number;
    failedTests: number;
    criticalIssues: number;
  };
  k6Results: {
    [scenario: string]: K6TestSummary;
  };
  databaseResults: DatabaseTestSummary;
  memoryResults: MemoryTestSummary;
  performanceMetrics: PerformanceMetricsSummary;
  recommendations: string[];
  alerts: Alert[];
}

export interface K6TestSummary {
  scenario: string;
  status: "pass" | "fail";
  duration: number;
  virtualUsers: number;
  requests: {
    total: number;
    rate: number;
    failed: number;
  };
  responseTime: {
    avg: number;
    p95: number;
    p99: number;
    max: number;
  };
  checks: {
    passed: number;
    failed: number;
    rate: number;
  };
  thresholds: {
    passed: number;
    failed: number;
  };
}

export interface DatabaseTestSummary {
  postgres: {
    status: "pass" | "warning" | "fail";
    averageResponseTime: number;
    p95ResponseTime: number;
    throughput: number;
    errorCount: number;
    issues: string[];
  };
  redis: {
    status: "pass" | "warning" | "fail";
    operationCount: number;
    averageResponseTime: number;
    throughput: number;
    cacheHitRate: number;
    issues: string[];
  };
}

export interface MemoryTestSummary {
  status: "pass" | "warning" | "fail";
  leakDetected: boolean;
  severity: string;
  memoryGrowthRate: number;
  peakMemoryUsage: number;
  gcPressure: number;
  anomaliesCount: number;
  issues: string[];
}

export interface PerformanceMetricsSummary {
  apiPerformance: {
    score: number;
    responseTimeGrade: string;
    throughputGrade: string;
    errorRateGrade: string;
  };
  databasePerformance: {
    score: number;
    queryTimeGrade: string;
    connectionGrade: string;
  };
  memoryPerformance: {
    score: number;
    usageGrade: string;
    leakGrade: string;
  };
  overallScore: number;
}

export interface Alert {
  type: "critical" | "warning" | "info";
  category: "performance" | "memory" | "database" | "api";
  message: string;
  recommendation: string;
  timestamp: string;
}
