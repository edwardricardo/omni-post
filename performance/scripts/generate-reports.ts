import * as fs from "fs/promises";
import * as path from "path";

import type {
  K6Result,
  MemoryTestResult,
  ComprehensiveReport,
  K6TestSummary,
  DatabaseTestSummary,
  MemoryTestSummary,
  PerformanceMetricsSummary,
  Alert,
} from "./report-types.js";
import { generateHtmlReport, generateTextSummary } from "./generate-reports-renderers.js";
import { parsePostgresResults } from "./generate-reports-parsers.js";

class PerformanceReportGenerator {
  private outputDir: string;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
  }

  /**
   * Generate comprehensive performance report
   */
  async generateComprehensiveReport(): Promise<ComprehensiveReport> {
    console.log("📊 Generating comprehensive performance report...");

    // Collect all test results
    const k6Results = await this.collectK6Results();
    const databaseResults = await this.collectDatabaseResults();
    const memoryResults = await this.collectMemoryResults();

    // Analyze and summarize results
    const summary = this.generateSummary(k6Results, databaseResults, memoryResults);
    const performanceMetrics = this.calculatePerformanceMetrics(
      k6Results,
      databaseResults,
      memoryResults
    );
    const recommendations = this.generateRecommendations(k6Results, databaseResults, memoryResults);
    const alerts = this.generateAlerts(k6Results, databaseResults, memoryResults);

    const report: ComprehensiveReport = {
      generatedAt: new Date().toISOString(),
      environment: process.env.TEST_ENV || "development",
      version: process.env.VERSION,
      summary,
      k6Results: this.summarizeK6Results(k6Results),
      databaseResults: this.summarizeDatabaseResults(databaseResults),
      memoryResults: this.summarizeMemoryResults(memoryResults),
      performanceMetrics,
      recommendations,
      alerts,
    };

    // Save reports in multiple formats
    await this.saveReport(report);

    return report;
  }

  /**
   * Collect k6 test results
   */
  private async collectK6Results(): Promise<{ [scenario: string]: K6Result }> {
    const k6Dir = path.join(this.outputDir, "k6");
    const results: { [scenario: string]: K6Result } = {};

    try {
      const files = await fs.readdir(k6Dir);
      const jsonFiles = files.filter((f) => f.endsWith(".json"));

      for (const file of jsonFiles) {
        const scenario = file.split("-")[0];
        const filePath = path.join(k6Dir, file);

        try {
          const content = await fs.readFile(filePath, "utf-8");
          const lines = content.split("\n").filter((line) => line.trim());

          // Parse k6 JSON output (each line is a JSON object)
          const metrics: any = {};
          const checks: any[] = [];

          for (const line of lines) {
            try {
              const data = JSON.parse(line);

              if (data.type === "Metric") {
                metrics[data.metric] = {
                  values: data.data?.values || {},
                  count: data.data?.count,
                  rate: data.data?.rate,
                };
              } else if (data.type === "Point" && data.data?.tags?.check) {
                checks.push({
                  name: data.data.tags.check,
                  passes: data.data.value === 1 ? 1 : 0,
                  fails: data.data.value === 0 ? 1 : 0,
                });
              }
            } catch {
              // Skip invalid JSON lines
            }
          }

          results[scenario] = {
            metrics,
            root_group: { checks },
          };
        } catch (error) {
          console.warn(`Failed to parse k6 result file ${file}:`, error);
        }
      }
    } catch (error) {
      console.warn("No k6 results found:", error);
    }

    return results;
  }

  /**
   * Collect database test results
   */
  private async collectDatabaseResults(): Promise<{
    postgres?: DatabaseTestResult;
  }> {
    const databaseDir = path.join(this.outputDir, "database");
    const results: any = {};

    try {
      const files = await fs.readdir(databaseDir);

      for (const file of files) {
        const filePath = path.join(databaseDir, file);
        const content = await fs.readFile(filePath, "utf-8");

        // Parse database test logs for metrics
        if (file.includes("postgres")) {
          results.postgres = parsePostgresResults(content);
        }
      }
    } catch (error) {
      console.warn("No database results found:", error);
    }

    return results;
  }

  /**
   * Collect memory test results
   */
  private async collectMemoryResults(): Promise<MemoryTestResult | null> {
    const memoryDir = path.join(this.outputDir, "memory");

    try {
      const files = await fs.readdir(memoryDir);
      const jsonFiles = files.filter(
        (f) => f.endsWith(".json") && f.includes("memory-leak-report")
      );

      if (jsonFiles.length === 0) {
        return null;
      }

      // Get the most recent report
      const latestFile = jsonFiles.sort().reverse()[0];
      const filePath = path.join(memoryDir, latestFile);
      const content = await fs.readFile(filePath, "utf-8");

      return JSON.parse(content);
    } catch (error) {
      console.warn("No memory results found:", error);
      return null;
    }
  }

  /**
   * Generate overall summary
   */
  private generateSummary(
    k6Results: any,
    databaseResults: any,
    memoryResults: any
  ): ComprehensiveReport["summary"] {
    let totalTests = 0;
    let passedTests = 0;
    let failedTests = 0;
    let criticalIssues = 0;

    // Count k6 tests
    const k6TestCount = Object.keys(k6Results).length;
    totalTests += k6TestCount;

    // Simplified pass/fail logic for k6 tests
    Object.values(k6Results).forEach((result: any) => {
      const hasErrors = result.metrics?.http_req_failed?.rate > 0.01; // >1% error rate
      const slowResponse = result.metrics?.http_req_duration?.values?.["p(95)"] > 1000; // >1s P95

      if (hasErrors || slowResponse) {
        failedTests++;
        if (hasErrors && result.metrics?.http_req_failed?.rate > 0.05) {
          criticalIssues++;
        }
      } else {
        passedTests++;
      }
    });

    // Database tests. The count tracks the database stages that actually run, so a
    // stage that is not part of the suite can never be scored as a failed test.
    if (databaseResults.postgres) {
      totalTests += 1;

      if (
        databaseResults.postgres?.errorCount === 0 &&
        databaseResults.postgres?.p95ResponseTime < 200
      ) {
        passedTests++;
      } else {
        failedTests++;
        if (databaseResults.postgres?.p95ResponseTime > 1000) {
          criticalIssues++;
        }
      }
    }

    // Memory tests
    if (memoryResults) {
      totalTests++;

      if (!memoryResults.leakDetected && memoryResults.severity !== "critical") {
        passedTests++;
      } else {
        failedTests++;
        if (memoryResults.severity === "critical") {
          criticalIssues++;
        }
      }
    }

    let overallStatus: "pass" | "warning" | "fail" = "pass";
    if (criticalIssues > 0) {
      overallStatus = "fail";
    } else if (failedTests > 0) {
      overallStatus = "warning";
    }

    return {
      overallStatus,
      totalTests,
      passedTests,
      failedTests,
      criticalIssues,
    };
  }

  /**
   * Calculate performance metrics and scores
   */
  private calculatePerformanceMetrics(
    k6Results: any,
    databaseResults: any,
    memoryResults: any
  ): PerformanceMetricsSummary {
    // API Performance Score (0-100)
    let apiScore = 100;
    let responseTimeGrade = "A";
    let throughputGrade = "A";
    let errorRateGrade = "A";

    // Calculate based on k6 results
    Object.values(k6Results).forEach((result: any) => {
      const p95 = result.metrics?.http_req_duration?.values?.["p(95)"] || 0;
      const errorRate = result.metrics?.http_req_failed?.rate || 0;

      if (p95 > 1000) {
        apiScore -= 20;
        responseTimeGrade = "D";
      } else if (p95 > 500) {
        apiScore -= 10;
        responseTimeGrade = "C";
      } else if (p95 > 200) {
        apiScore -= 5;
        responseTimeGrade = "B";
      }

      if (errorRate > 0.05) {
        apiScore -= 30;
        errorRateGrade = "F";
      } else if (errorRate > 0.02) {
        apiScore -= 15;
        errorRateGrade = "D";
      } else if (errorRate > 0.01) {
        apiScore -= 5;
        errorRateGrade = "C";
      }
    });

    // Database Performance Score
    let dbScore = 100;
    let queryTimeGrade = "A";
    let connectionGrade = "A";

    if (databaseResults.postgres) {
      const p95 = databaseResults.postgres.p95ResponseTime;
      if (p95 > 500) {
        dbScore -= 30;
        queryTimeGrade = "D";
      } else if (p95 > 200) {
        dbScore -= 15;
        queryTimeGrade = "C";
      } else if (p95 > 100) {
        dbScore -= 5;
        queryTimeGrade = "B";
      }

      if (databaseResults.postgres.deadlockCount > 0) {
        dbScore -= 20;
        connectionGrade = "C";
      }
    }

    // Memory Performance Score
    let memoryScore = 100;
    let usageGrade = "A";
    let leakGrade = "A";

    if (memoryResults) {
      if (memoryResults.leakDetected) {
        memoryScore -= 50;
        leakGrade = "F";
      }

      if (memoryResults.analysis.memoryGrowthRate > 100) {
        memoryScore -= 30;
        usageGrade = "D";
      } else if (memoryResults.analysis.memoryGrowthRate > 50) {
        memoryScore -= 15;
        usageGrade = "C";
      }

      if (memoryResults.analysis.gcPressure > 20) {
        memoryScore -= 20;
        usageGrade = "D";
      }
    }

    const overallScore = Math.round((apiScore + dbScore + memoryScore) / 3);

    return {
      apiPerformance: {
        score: Math.max(0, apiScore),
        responseTimeGrade,
        throughputGrade,
        errorRateGrade,
      },
      databasePerformance: {
        score: Math.max(0, dbScore),
        queryTimeGrade,
        connectionGrade,
      },
      memoryPerformance: {
        score: Math.max(0, memoryScore),
        usageGrade,
        leakGrade,
      },
      overallScore: Math.max(0, overallScore),
    };
  }

  /**
   * Summarize k6 results
   */
  private summarizeK6Results(k6Results: any): { [scenario: string]: K6TestSummary } {
    const summary: { [scenario: string]: K6TestSummary } = {};

    Object.entries(k6Results).forEach(([scenario, result]: [string, any]) => {
      const responseTime = {
        avg: result.metrics?.http_req_duration?.values?.avg || 0,
        p95: result.metrics?.http_req_duration?.values?.["p(95)"] || 0,
        p99: result.metrics?.http_req_duration?.values?.["p(99)"] || 0,
        max: result.metrics?.http_req_duration?.values?.max || 0,
      };

      const totalRequests = result.metrics?.http_reqs?.count || 0;
      const failedRequests = Math.round(
        (result.metrics?.http_req_failed?.rate || 0) * totalRequests
      );

      const checks = result.root_group?.checks || [];
      const passedChecks = checks.reduce((sum: number, check: any) => sum + (check.passes || 0), 0);
      const failedChecks = checks.reduce((sum: number, check: any) => sum + (check.fails || 0), 0);

      summary[scenario] = {
        scenario,
        status:
          responseTime.p95 < 1000 && (result.metrics?.http_req_failed?.rate || 0) < 0.01
            ? "pass"
            : "fail",
        duration: result.metrics?.iteration_duration?.values?.avg || 0,
        virtualUsers: result.metrics?.vus?.values?.value || 0,
        requests: {
          total: totalRequests,
          rate: result.metrics?.http_req_duration?.count || 0,
          failed: failedRequests,
        },
        responseTime,
        checks: {
          passed: passedChecks,
          failed: failedChecks,
          rate: (passedChecks / (passedChecks + failedChecks)) * 100 || 0,
        },
        thresholds: {
          passed: 0, // Would need to parse threshold results
          failed: 0,
        },
      };
    });

    return summary;
  }

  /**
   * Summarize database results
   */
  private summarizeDatabaseResults(databaseResults: any): DatabaseTestSummary {
    const postgres = databaseResults.postgres
      ? {
          status:
            databaseResults.postgres.p95ResponseTime < 200 &&
            databaseResults.postgres.errorCount === 0
              ? ("pass" as const)
              : ("warning" as const),
          averageResponseTime: databaseResults.postgres.averageResponseTime,
          p95ResponseTime: databaseResults.postgres.p95ResponseTime,
          throughput: databaseResults.postgres.throughput,
          errorCount: databaseResults.postgres.errorCount,
          issues: [
            ...(databaseResults.postgres.deadlockCount > 0
              ? [`${databaseResults.postgres.deadlockCount} deadlocks detected`]
              : []),
            ...(databaseResults.postgres.longRunningQueries > 0
              ? [`${databaseResults.postgres.longRunningQueries} long-running queries`]
              : []),
            ...(databaseResults.postgres.p95ResponseTime > 500 ? ["Slow query performance"] : []),
          ],
        }
      : {
          status: "fail" as const,
          averageResponseTime: 0,
          p95ResponseTime: 0,
          throughput: 0,
          errorCount: 0,
          issues: ["No PostgreSQL test results available"],
        };

    return { postgres };
  }

  /**
   * Summarize memory results
   */
  private summarizeMemoryResults(memoryResults: any): MemoryTestSummary {
    if (!memoryResults) {
      return {
        status: "fail",
        leakDetected: false,
        severity: "unknown",
        memoryGrowthRate: 0,
        peakMemoryUsage: 0,
        gcPressure: 0,
        anomaliesCount: 0,
        issues: ["No memory test results available"],
      };
    }

    const issues: string[] = [];

    if (memoryResults.leakDetected) {
      issues.push("Memory leak detected");
    }

    if (memoryResults.analysis.memoryGrowthRate > 100) {
      issues.push(
        `High memory growth rate: ${memoryResults.analysis.memoryGrowthRate.toFixed(2)} MB/hour`
      );
    }

    if (memoryResults.analysis.gcPressure > 15) {
      issues.push(`High GC pressure: ${memoryResults.analysis.gcPressure.toFixed(2)}%`);
    }

    if (memoryResults.analysis.anomalies.length > 0) {
      issues.push(`${memoryResults.analysis.anomalies.length} memory anomalies detected`);
    }

    let status: "pass" | "warning" | "fail" = "pass";
    if (memoryResults.severity === "critical" || memoryResults.leakDetected) {
      status = "fail";
    } else if (memoryResults.severity === "high" || issues.length > 0) {
      status = "warning";
    }

    return {
      status,
      leakDetected: memoryResults.leakDetected,
      severity: memoryResults.severity,
      memoryGrowthRate: memoryResults.analysis.memoryGrowthRate,
      peakMemoryUsage: memoryResults.analysis.peakMemoryUsage,
      gcPressure: memoryResults.analysis.gcPressure,
      anomaliesCount: memoryResults.analysis.anomalies.length,
      issues,
    };
  }

  /**
   * Generate recommendations
   */
  private generateRecommendations(
    k6Results: any,
    databaseResults: any,
    memoryResults: any
  ): string[] {
    const recommendations: string[] = [];

    // API recommendations
    Object.values(k6Results).forEach((result: any) => {
      const p95 = result.metrics?.http_req_duration?.values?.["p(95)"] || 0;
      const errorRate = result.metrics?.http_req_failed?.rate || 0;

      if (p95 > 500) {
        recommendations.push(
          "⚡ Optimize API response times - consider caching, database query optimization, or code profiling"
        );
      }

      if (errorRate > 0.01) {
        recommendations.push(
          "🔧 Investigate and fix API errors - review error logs and improve error handling"
        );
      }
    });

    // Database recommendations
    if (databaseResults.postgres?.p95ResponseTime > 200) {
      recommendations.push(
        "🗄️ Optimize database queries - add indexes, review query plans, or implement query optimization"
      );
    }

    if (databaseResults.postgres?.deadlockCount > 0) {
      recommendations.push(
        "🔒 Address database deadlocks - review transaction isolation levels and query ordering"
      );
    }

    // Memory recommendations
    if (memoryResults?.leakDetected) {
      recommendations.push(
        "🚨 Fix memory leaks immediately - review event listeners, closures, and object references"
      );
    }

    if (memoryResults?.analysis?.memoryGrowthRate > 50) {
      recommendations.push(
        "💾 Optimize memory usage - implement object pooling and reduce object creation frequency"
      );
    }

    if (memoryResults?.analysis?.gcPressure > 15) {
      recommendations.push(
        "🗑️ Reduce garbage collection pressure - optimize data structures and reduce allocations"
      );
    }

    if (recommendations.length === 0) {
      recommendations.push("✅ Performance looks good! Continue monitoring for long-term trends");
    }

    return recommendations;
  }

  /**
   * Generate alerts
   */
  private generateAlerts(k6Results: any, databaseResults: any, memoryResults: any): Alert[] {
    const alerts: Alert[] = [];
    const timestamp = new Date().toISOString();

    // Critical alerts
    if (memoryResults?.leakDetected) {
      alerts.push({
        type: "critical",
        category: "memory",
        message: "Memory leak detected",
        recommendation:
          "Immediate investigation required - review recent code changes and memory allocation patterns",
        timestamp,
      });
    }

    // API alerts
    Object.entries(k6Results).forEach(([scenario, result]: [string, any]) => {
      const errorRate = result.metrics?.http_req_failed?.rate || 0;
      const p95 = result.metrics?.http_req_duration?.values?.["p(95)"] || 0;

      if (errorRate > 0.05) {
        alerts.push({
          type: "critical",
          category: "api",
          message: `High error rate in ${scenario}: ${(errorRate * 100).toFixed(2)}%`,
          recommendation: "Review error logs and fix underlying issues",
          timestamp,
        });
      } else if (errorRate > 0.01) {
        alerts.push({
          type: "warning",
          category: "api",
          message: `Elevated error rate in ${scenario}: ${(errorRate * 100).toFixed(2)}%`,
          recommendation: "Monitor closely and investigate if rate increases",
          timestamp,
        });
      }

      if (p95 > 1000) {
        alerts.push({
          type: "warning",
          category: "performance",
          message: `Slow response times in ${scenario}: P95 ${p95.toFixed(2)}ms`,
          recommendation: "Optimize API performance through caching or query optimization",
          timestamp,
        });
      }
    });

    // Database alerts
    if (databaseResults.postgres?.deadlockCount > 0) {
      alerts.push({
        type: "warning",
        category: "database",
        message: `Database deadlocks detected: ${databaseResults.postgres.deadlockCount}`,
        recommendation: "Review transaction handling and query patterns",
        timestamp,
      });
    }

    return alerts;
  }

  /**
   * Save report in multiple formats
   */
  private async saveReport(report: ComprehensiveReport): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const baseFilename = `performance-report-${timestamp}`;

    // JSON report
    const jsonPath = path.join(this.outputDir, "reports", `${baseFilename}.json`);
    await fs.mkdir(path.dirname(jsonPath), { recursive: true });
    await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));

    // HTML report
    const htmlPath = path.join(this.outputDir, "reports", `${baseFilename}.html`);
    const htmlContent = generateHtmlReport(report);
    await fs.writeFile(htmlPath, htmlContent);

    // Text summary
    const txtPath = path.join(this.outputDir, "reports", `${baseFilename}.txt`);
    const textContent = generateTextSummary(report);
    await fs.writeFile(txtPath, textContent);

    console.log(`📊 Reports generated:`);
    console.log(`   JSON: ${jsonPath}`);
    console.log(`   HTML: ${htmlPath}`);
    console.log(`   Text: ${txtPath}`);
  }
}

/**
 * Main function to generate reports
 */
async function generateReports(): Promise<void> {
  const outputDir = process.argv[2] || "./performance/reports";

  const generator = new PerformanceReportGenerator(outputDir);

  try {
    const report = await generator.generateComprehensiveReport();

    console.log("\n📊 Comprehensive Performance Report Generated");
    console.log(`Overall Status: ${report.summary.overallStatus.toUpperCase()}`);
    console.log(`Overall Score: ${report.performanceMetrics.overallScore}/100`);

    if (report.summary.criticalIssues > 0) {
      console.log(`\n🚨 ${report.summary.criticalIssues} critical issues detected!`);
    }

    if (report.alerts.length > 0) {
      console.log(`\n⚠️ ${report.alerts.length} alerts generated`);
    }
  } catch (error) {
    console.error("❌ Report generation failed:", error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  generateReports().catch(console.error);
}

export { PerformanceReportGenerator };
