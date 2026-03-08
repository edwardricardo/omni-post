import type {
  BaselineMetrics,
  RegressionResult,
  RegressionThresholds,
} from "./regression-detector-types.js";

/**
 * Create a regression result record from metric comparison
 */
export function createRegressionResult(
  metric: string,
  baseline: number,
  current: number,
  change: number,
  threshold: { warning: number; critical: number }
): RegressionResult {
  let changeDirection: "improvement" | "regression" | "neutral";
  let severity: "low" | "medium" | "high" | "critical";

  if (Math.abs(change) < 5) {
    changeDirection = "neutral";
    severity = "low";
  } else if (change > 0) {
    // Increase
    if (change >= threshold.critical) {
      changeDirection = "regression";
      severity = "critical";
    } else if (change >= threshold.warning) {
      changeDirection = "regression";
      severity = "high";
    } else {
      changeDirection = "regression";
      severity = "medium";
    }
  } else {
    // Decrease (improvement for most metrics)
    changeDirection = "improvement";
    severity = "low";
  }

  // For metrics where increase is bad but we have negative thresholds
  if (threshold.warning < 0 && change < threshold.critical) {
    changeDirection = "regression";
    severity = "critical";
  } else if (threshold.warning < 0 && change < threshold.warning) {
    changeDirection = "regression";
    severity = "high";
  }

  return {
    metric,
    baseline,
    current,
    change,
    changeDirection,
    severity,
    threshold: threshold.warning,
  };
}

/**
 * Compare response time metrics and push results into regressions/improvements arrays
 */
export function compareResponseTime(
  baseline: BaselineMetrics,
  current: BaselineMetrics,
  thresholds: RegressionThresholds,
  regressions: RegressionResult[],
  improvements: RegressionResult[]
): void {
  const metrics = [
    {
      name: "Response Time P50",
      baseline: baseline.responseTime.p50,
      current: current.responseTime.p50,
    },
    {
      name: "Response Time P95",
      baseline: baseline.responseTime.p95,
      current: current.responseTime.p95,
    },
    {
      name: "Response Time P99",
      baseline: baseline.responseTime.p99,
      current: current.responseTime.p99,
    },
    {
      name: "Response Time Max",
      baseline: baseline.responseTime.max,
      current: current.responseTime.max,
    },
  ];

  metrics.forEach((metric) => {
    const change = ((metric.current - metric.baseline) / metric.baseline) * 100;
    const result = createRegressionResult(
      metric.name,
      metric.baseline,
      metric.current,
      change,
      thresholds.responseTime
    );
    if (result.changeDirection === "regression") regressions.push(result);
    else if (result.changeDirection === "improvement") improvements.push(result);
  });
}

/**
 * Compare throughput metrics
 */
export function compareThroughput(
  baseline: BaselineMetrics,
  current: BaselineMetrics,
  thresholds: RegressionThresholds,
  regressions: RegressionResult[],
  improvements: RegressionResult[]
): void {
  const change = ((current.throughput - baseline.throughput) / baseline.throughput) * 100;
  const result = createRegressionResult(
    "Throughput",
    baseline.throughput,
    current.throughput,
    change,
    {
      warning: -thresholds.throughput.warning,
      critical: -thresholds.throughput.critical,
    }
  );
  if (result.changeDirection === "regression") regressions.push(result);
  else if (result.changeDirection === "improvement") improvements.push(result);
}

/**
 * Compare error rate metrics
 */
export function compareErrorRate(
  baseline: BaselineMetrics,
  current: BaselineMetrics,
  thresholds: RegressionThresholds,
  regressions: RegressionResult[],
  improvements: RegressionResult[]
): void {
  const change =
    baseline.errorRate === 0
      ? current.errorRate > 0
        ? 100
        : 0
      : ((current.errorRate - baseline.errorRate) / baseline.errorRate) * 100;

  const result = createRegressionResult(
    "Error Rate",
    baseline.errorRate,
    current.errorRate,
    change,
    thresholds.errorRate
  );
  if (result.changeDirection === "regression") regressions.push(result);
  else if (result.changeDirection === "improvement") improvements.push(result);
}

/**
 * Compare memory usage metrics
 */
export function compareMemoryUsage(
  baseline: BaselineMetrics,
  current: BaselineMetrics,
  thresholds: RegressionThresholds,
  regressions: RegressionResult[],
  improvements: RegressionResult[]
): void {
  const metrics = [
    {
      name: "Heap Used",
      baseline: baseline.memoryUsage.heapUsed,
      current: current.memoryUsage.heapUsed,
    },
    { name: "RSS Memory", baseline: baseline.memoryUsage.rss, current: current.memoryUsage.rss },
    {
      name: "External Memory",
      baseline: baseline.memoryUsage.external,
      current: current.memoryUsage.external,
    },
  ];

  metrics.forEach((metric) => {
    const change = ((metric.current - metric.baseline) / metric.baseline) * 100;
    const result = createRegressionResult(
      metric.name,
      metric.baseline,
      metric.current,
      change,
      thresholds.memoryUsage
    );
    if (result.changeDirection === "regression") regressions.push(result);
    else if (result.changeDirection === "improvement") improvements.push(result);
  });
}

/**
 * Compare database performance metrics
 */
export function compareDatabasePerformance(
  baseline: BaselineMetrics,
  current: BaselineMetrics,
  thresholds: RegressionThresholds,
  regressions: RegressionResult[],
  improvements: RegressionResult[]
): void {
  const metrics = [
    {
      name: "DB Query Time P50",
      baseline: baseline.dbQueryTime.p50,
      current: current.dbQueryTime.p50,
    },
    {
      name: "DB Query Time P95",
      baseline: baseline.dbQueryTime.p95,
      current: current.dbQueryTime.p95,
    },
    {
      name: "DB Query Time P99",
      baseline: baseline.dbQueryTime.p99,
      current: current.dbQueryTime.p99,
    },
    {
      name: "DB Connection Pool Utilization",
      baseline: baseline.dbConnectionPoolUtilization,
      current: current.dbConnectionPoolUtilization,
    },
  ];

  metrics.forEach((metric) => {
    const change = ((metric.current - metric.baseline) / metric.baseline) * 100;
    const threshold = metric.name.includes("Connection Pool")
      ? thresholds.memoryUsage
      : thresholds.responseTime;
    const result = createRegressionResult(
      metric.name,
      metric.baseline,
      metric.current,
      change,
      threshold
    );
    if (result.changeDirection === "regression") regressions.push(result);
    else if (result.changeDirection === "improvement") improvements.push(result);
  });
}

/**
 * Compare cache performance metrics
 */
export function compareCachePerformance(
  baseline: BaselineMetrics,
  current: BaselineMetrics,
  thresholds: RegressionThresholds,
  regressions: RegressionResult[],
  improvements: RegressionResult[]
): void {
  const hitRateChange =
    ((current.cacheHitRate - baseline.cacheHitRate) / baseline.cacheHitRate) * 100;
  const hitRateResult = createRegressionResult(
    "Cache Hit Rate",
    baseline.cacheHitRate,
    current.cacheHitRate,
    hitRateChange,
    {
      warning: -thresholds.cacheHitRate.warning,
      critical: -thresholds.cacheHitRate.critical,
    }
  );

  const responseTimeChange =
    ((current.cacheResponseTime - baseline.cacheResponseTime) / baseline.cacheResponseTime) * 100;
  const responseTimeResult = createRegressionResult(
    "Cache Response Time",
    baseline.cacheResponseTime,
    current.cacheResponseTime,
    responseTimeChange,
    thresholds.responseTime
  );

  [hitRateResult, responseTimeResult].forEach((result) => {
    if (result.changeDirection === "regression") regressions.push(result);
    else if (result.changeDirection === "improvement") improvements.push(result);
  });
}

/**
 * Compare provider performance metrics
 */
export function compareProviderPerformance(
  baseline: BaselineMetrics,
  current: BaselineMetrics,
  thresholds: RegressionThresholds,
  regressions: RegressionResult[],
  improvements: RegressionResult[]
): void {
  const metrics = [
    {
      name: "Provider Response Time P95",
      baseline: baseline.providerResponseTime.p95,
      current: current.providerResponseTime.p95,
    },
    {
      name: "Provider Response Time P99",
      baseline: baseline.providerResponseTime.p99,
      current: current.providerResponseTime.p99,
    },
    {
      name: "Provider Error Rate",
      baseline: baseline.providerErrorRate,
      current: current.providerErrorRate,
    },
  ];

  metrics.forEach((metric) => {
    const change =
      metric.baseline === 0
        ? metric.current > 0
          ? 100
          : 0
        : ((metric.current - metric.baseline) / metric.baseline) * 100;

    const threshold = metric.name.includes("Error Rate")
      ? thresholds.errorRate
      : thresholds.responseTime;
    const result = createRegressionResult(
      metric.name,
      metric.baseline,
      metric.current,
      change,
      threshold
    );
    if (result.changeDirection === "regression") regressions.push(result);
    else if (result.changeDirection === "improvement") improvements.push(result);
  });
}

/**
 * Compare Core Web Vitals metrics
 */
export function compareCoreWebVitals(
  baseline: BaselineMetrics,
  current: BaselineMetrics,
  thresholds: RegressionThresholds,
  regressions: RegressionResult[],
  improvements: RegressionResult[]
): void {
  if (!baseline.coreWebVitals || !current.coreWebVitals) return;

  const metrics = [
    {
      name: "LCP (Largest Contentful Paint)",
      baseline: baseline.coreWebVitals.lcp,
      current: current.coreWebVitals.lcp,
    },
    {
      name: "FID (First Input Delay)",
      baseline: baseline.coreWebVitals.fid,
      current: current.coreWebVitals.fid,
    },
    {
      name: "CLS (Cumulative Layout Shift)",
      baseline: baseline.coreWebVitals.cls,
      current: current.coreWebVitals.cls,
    },
  ];

  metrics.forEach((metric) => {
    const change = ((metric.current - metric.baseline) / metric.baseline) * 100;
    const result = createRegressionResult(
      metric.name,
      metric.baseline,
      metric.current,
      change,
      thresholds.responseTime
    );
    if (result.changeDirection === "regression") regressions.push(result);
    else if (result.changeDirection === "improvement") improvements.push(result);
  });
}
