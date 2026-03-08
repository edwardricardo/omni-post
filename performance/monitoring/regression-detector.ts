import * as fs from "fs/promises";
import * as path from "path";

import type {
  PerformanceBaseline,
  BaselineMetrics,
  TestConfiguration,
  RegressionResult,
  RegressionReport,
  RegressionSummary,
  RegressionThresholds,
} from "./regression-detector-types.js";
// RegressionResult kept for generateSummary and generateRecommendations
import { generateRegressionTextSummary } from "./regression-detector-output.js";
import {
  compareResponseTime,
  compareThroughput,
  compareErrorRate,
  compareMemoryUsage,
  compareDatabasePerformance,
  compareCachePerformance,
  compareProviderPerformance,
  compareCoreWebVitals,
} from "./regression-detector-comparators.js";

class PerformanceRegressionDetector {
  private baselineDir: string;
  private thresholds: RegressionThresholds;

  constructor(config: { baselineDir: string; thresholds?: Partial<RegressionThresholds> }) {
    this.baselineDir = config.baselineDir;
    this.thresholds = {
      responseTime: {
        warning: 15, // 15% increase
        critical: 30, // 30% increase
      },
      throughput: {
        warning: 10, // 10% decrease
        critical: 20, // 20% decrease
      },
      errorRate: {
        warning: 50, // 50% increase (e.g., 1% to 1.5%)
        critical: 100, // 100% increase (e.g., 1% to 2%)
      },
      memoryUsage: {
        warning: 20,
        critical: 40,
      },
      cacheHitRate: {
        warning: 10,
        critical: 20,
      },
      ...config.thresholds,
    };
  }

  /**
   * Capture performance baseline
   */
  async captureBaseline(
    version: string,
    metrics: BaselineMetrics,
    testConfig: TestConfiguration,
    environment: string = "development"
  ): Promise<void> {
    const baseline: PerformanceBaseline = {
      version,
      timestamp: Date.now(),
      environment,
      metrics,
      testConfiguration: testConfig,
    };

    await fs.mkdir(this.baselineDir, { recursive: true });

    const filename = `baseline-${environment}-${version}-${Date.now()}.json`;
    const filepath = path.join(this.baselineDir, filename);

    await fs.writeFile(filepath, JSON.stringify(baseline, null, 2));

    // Also save as latest baseline for this environment
    const latestFilename = `baseline-${environment}-latest.json`;
    const latestFilepath = path.join(this.baselineDir, latestFilename);

    await fs.writeFile(latestFilepath, JSON.stringify(baseline, null, 2));

    console.log(`📊 Performance baseline captured: ${filename}`);
  }

  /**
   * Load latest baseline for environment
   */
  async loadLatestBaseline(
    environment: string = "development"
  ): Promise<PerformanceBaseline | null> {
    try {
      const latestFilename = `baseline-${environment}-latest.json`;
      const latestFilepath = path.join(this.baselineDir, latestFilename);

      const content = await fs.readFile(latestFilepath, "utf-8");
      return JSON.parse(content);
    } catch {
      console.warn(`No baseline found for environment: ${environment}`);
      return null;
    }
  }

  /**
   * Load specific baseline by version
   */
  async loadBaseline(
    version: string,
    environment: string = "development"
  ): Promise<PerformanceBaseline | null> {
    try {
      const files = await fs.readdir(this.baselineDir);
      const baselineFile = files.find(
        (f) => f.startsWith(`baseline-${environment}-${version}`) && f.endsWith(".json")
      );

      if (!baselineFile) {
        return null;
      }

      const filepath = path.join(this.baselineDir, baselineFile);
      const content = await fs.readFile(filepath, "utf-8");
      return JSON.parse(content);
    } catch {
      console.warn(`Baseline not found for version: ${version}`);
      return null;
    }
  }

  /**
   * Detect performance regressions
   */
  async detectRegressions(
    currentMetrics: BaselineMetrics,
    currentVersion: string,
    environment: string = "development",
    baselineVersion?: string
  ): Promise<RegressionReport> {
    console.log("🔍 Detecting performance regressions...");

    let baseline: PerformanceBaseline | null;

    if (baselineVersion) {
      baseline = await this.loadBaseline(baselineVersion, environment);
    } else {
      baseline = await this.loadLatestBaseline(environment);
    }

    if (!baseline) {
      throw new Error(`No baseline found for comparison in environment: ${environment}`);
    }

    console.log(`📊 Comparing against baseline version: ${baseline.version}`);

    const regressions: RegressionResult[] = [];
    const improvements: RegressionResult[] = [];

    // Compare all metrics
    compareResponseTime(
      baseline.metrics,
      currentMetrics,
      this.thresholds,
      regressions,
      improvements
    );
    compareThroughput(baseline.metrics, currentMetrics, this.thresholds, regressions, improvements);
    compareErrorRate(baseline.metrics, currentMetrics, this.thresholds, regressions, improvements);
    compareMemoryUsage(
      baseline.metrics,
      currentMetrics,
      this.thresholds,
      regressions,
      improvements
    );
    compareDatabasePerformance(
      baseline.metrics,
      currentMetrics,
      this.thresholds,
      regressions,
      improvements
    );
    compareCachePerformance(
      baseline.metrics,
      currentMetrics,
      this.thresholds,
      regressions,
      improvements
    );
    compareProviderPerformance(
      baseline.metrics,
      currentMetrics,
      this.thresholds,
      regressions,
      improvements
    );

    if (baseline.metrics.coreWebVitals && currentMetrics.coreWebVitals) {
      compareCoreWebVitals(
        baseline.metrics,
        currentMetrics,
        this.thresholds,
        regressions,
        improvements
      );
    }

    // Determine overall status
    const criticalRegressions = regressions.filter((r) => r.severity === "critical").length;
    const highRegressions = regressions.filter((r) => r.severity === "high").length;

    let overallStatus: "pass" | "warning" | "fail";
    if (criticalRegressions > 0) {
      overallStatus = "fail";
    } else if (highRegressions > 0 || regressions.length > 5) {
      overallStatus = "warning";
    } else {
      overallStatus = "pass";
    }

    // Generate summary
    const summary = this.generateSummary(regressions, improvements);

    // Generate recommendations
    const recommendations = this.generateRecommendations(regressions, improvements);

    const report: RegressionReport = {
      timestamp: Date.now(),
      version: currentVersion,
      baselineVersion: baseline.version,
      environment,
      overallStatus,
      regressions,
      improvements,
      summary,
      recommendations,
    };

    // Save regression report
    await this.saveReport(report);

    return report;
  }

  /**
   * Generate summary statistics
   */
  private generateSummary(
    regressions: RegressionResult[],
    improvements: RegressionResult[]
  ): RegressionSummary {
    const totalMetrics = regressions.length + improvements.length;
    const criticalRegressions = regressions.filter((r) => r.severity === "critical").length;

    const allChanges = [...regressions, ...improvements].map((r) => r.change);
    const averageChange =
      allChanges.length > 0
        ? allChanges.reduce((sum, change) => sum + change, 0) / allChanges.length
        : 0;

    const worstRegression =
      regressions.length > 0
        ? regressions.reduce((worst, current) => (current.change > worst.change ? current : worst))
        : null;

    const bestImprovement =
      improvements.length > 0
        ? improvements.reduce((best, current) =>
            Math.abs(current.change) > Math.abs(best.change) ? current : best
          )
        : null;

    return {
      totalMetrics,
      regressionsCount: regressions.length,
      improvementsCount: improvements.length,
      criticalRegressions,
      averageChange,
      worstRegression,
      bestImprovement,
    };
  }

  /**
   * Generate recommendations based on regressions
   */
  private generateRecommendations(
    regressions: RegressionResult[],
    improvements: RegressionResult[]
  ): string[] {
    const recommendations: string[] = [];

    // Critical regressions
    const criticalRegressions = regressions.filter((r) => r.severity === "critical");
    if (criticalRegressions.length > 0) {
      recommendations.push(
        "🚨 Critical performance regressions detected. Immediate investigation required."
      );
      criticalRegressions.forEach((regression) => {
        recommendations.push(`   - ${regression.metric}: ${regression.change.toFixed(1)}% worse`);
      });
    }

    // Response time regressions
    const responseTimeRegressions = regressions.filter((r) => r.metric.includes("Response Time"));
    if (responseTimeRegressions.length > 0) {
      recommendations.push("⏱️ Response time degradation detected. Check for:");
      recommendations.push("   - Database query optimization opportunities");
      recommendations.push("   - Network latency issues");
      recommendations.push("   - Code inefficiencies in hot paths");
    }

    // Memory regressions
    const memoryRegressions = regressions.filter(
      (r) => r.metric.includes("Memory") || r.metric.includes("Heap")
    );
    if (memoryRegressions.length > 0) {
      recommendations.push("💾 Memory usage increase detected. Consider:");
      recommendations.push("   - Memory leak analysis");
      recommendations.push("   - Object pooling implementation");
      recommendations.push("   - Garbage collection tuning");
    }

    // Error rate regressions
    const errorRegressions = regressions.filter((r) => r.metric.includes("Error Rate"));
    if (errorRegressions.length > 0) {
      recommendations.push("❌ Error rate increase detected. Investigate:");
      recommendations.push("   - Recent code changes");
      recommendations.push("   - External service dependencies");
      recommendations.push("   - Error handling robustness");
    }

    // Cache regressions
    const cacheRegressions = regressions.filter((r) => r.metric.includes("Cache"));
    if (cacheRegressions.length > 0) {
      recommendations.push("🗄️ Cache performance degradation detected. Check:");
      recommendations.push("   - Cache configuration and sizing");
      recommendations.push("   - Cache key patterns and expiration");
      recommendations.push("   - Cache warming strategies");
    }

    // Positive feedback for improvements
    if (improvements.length > 0) {
      recommendations.push("✅ Performance improvements detected:");
      improvements.slice(0, 3).forEach((improvement) => {
        recommendations.push(
          `   - ${improvement.metric}: ${Math.abs(improvement.change).toFixed(1)}% better`
        );
      });
    }

    if (recommendations.length === 0) {
      recommendations.push("✅ No significant performance regressions detected.");
    }

    return recommendations;
  }

  /**
   * Save regression report
   */
  private async saveReport(report: RegressionReport): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `regression-report-${report.version}-${timestamp}.json`;
    const filepath = path.join(this.baselineDir, filename);

    await fs.writeFile(filepath, JSON.stringify(report, null, 2));

    // Generate human-readable summary
    const summaryFilename = `regression-summary-${report.version}-${timestamp}.txt`;
    const summaryFilepath = path.join(this.baselineDir, summaryFilename);

    const summary = generateRegressionTextSummary(report);
    await fs.writeFile(summaryFilepath, summary);

    console.log(`📊 Regression report saved: ${filename}`);
  }
}

// Example usage
async function exampleRegressionDetection(): Promise<void> {
  const detector = new PerformanceRegressionDetector({
    baselineDir: "./performance/baselines",
    thresholds: {
      responseTime: { warning: 10, critical: 25 },
      throughput: { warning: 15, critical: 30 },
      errorRate: { warning: 50, critical: 100 },
      memoryUsage: { warning: 20, critical: 40 },
      cacheHitRate: { warning: 10, critical: 20 },
    },
  });

  // Capture a baseline
  const baselineMetrics: BaselineMetrics = {
    responseTime: { p50: 45, p95: 120, p99: 250, max: 500 },
    throughput: 1500,
    errorRate: 0.5,
    dbQueryTime: { p50: 15, p95: 50, p99: 100 },
    dbConnectionPoolUtilization: 45,
    memoryUsage: {
      heapUsed: 67108864, // 64MB
      heapTotal: 134217728, // 128MB
      external: 8388608, // 8MB
      rss: 134217728, // 128MB
    },
    cpuUsage: 35,
    cacheHitRate: 85,
    cacheResponseTime: 5,
    providerResponseTime: { p95: 800, p99: 1500 },
    providerErrorRate: 2.0,
    coreWebVitals: {
      lcp: 1200,
      fid: 50,
      cls: 0.05,
    },
  };

  await detector.captureBaseline("v1.0.0", baselineMetrics, {
    concurrentUsers: 100,
    testDuration: 300000, // 5 minutes
    scenario: "mixed_workload",
    dataSize: "medium",
  });

  // Simulate current metrics with some regressions
  const currentMetrics: BaselineMetrics = {
    ...baselineMetrics,
    responseTime: { p50: 55, p95: 145, p99: 320, max: 650 }, // Regression
    throughput: 1350, // Regression
    errorRate: 0.8, // Regression
    memoryUsage: {
      ...baselineMetrics.memoryUsage,
      heapUsed: 83886080, // 80MB - regression
    },
    cacheHitRate: 78, // Regression
  };

  const report = await detector.detectRegressions(currentMetrics, "v1.1.0");

  console.log(`Regression detection completed: ${report.overallStatus}`);
  console.log(
    `Regressions: ${report.regressions.length}, Improvements: ${report.improvements.length}`
  );
}

// Run example if this file is executed directly
if (require.main === module) {
  exampleRegressionDetection().catch(console.error);
}

export { PerformanceRegressionDetector };
