import type { ComprehensiveReport } from "./report-types.js";

export function generateHtmlReport(report: ComprehensiveReport): string {
  return `
<!DOCTYPE html>
<html>
<head>
    <title>Performance Test Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #f8f9fa; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
        .status { padding: 5px 10px; border-radius: 3px; color: white; font-weight: bold; }
        .status.pass { background: #28a745; }
        .status.warning { background: #ffc107; color: black; }
        .status.fail { background: #dc3545; }
        .metric { display: inline-block; margin: 10px; padding: 10px; border: 1px solid #ddd; border-radius: 5px; }
        .score { font-size: 24px; font-weight: bold; }
        .alert { padding: 10px; margin: 5px 0; border-radius: 5px; }
        .alert.critical { background: #f8d7da; border: 1px solid #f5c6cb; }
        .alert.warning { background: #fff3cd; border: 1px solid #ffeaa7; }
        .section { margin: 20px 0; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: #f8f9fa; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Performance Test Report</h1>
        <p><strong>Generated:</strong> ${report.generatedAt}</p>
        <p><strong>Environment:</strong> ${report.environment}</p>
        ${report.version ? `<p><strong>Version:</strong> ${report.version}</p>` : ""}
        <span class="status ${report.summary.overallStatus}">${report.summary.overallStatus.toUpperCase()}</span>
    </div>

    <div class="section">
        <h2>Summary</h2>
        <div class="metric">
            <div>Total Tests</div>
            <div class="score">${report.summary.totalTests}</div>
        </div>
        <div class="metric">
            <div>Passed</div>
            <div class="score" style="color: #28a745;">${report.summary.passedTests}</div>
        </div>
        <div class="metric">
            <div>Failed</div>
            <div class="score" style="color: #dc3545;">${report.summary.failedTests}</div>
        </div>
        <div class="metric">
            <div>Critical Issues</div>
            <div class="score" style="color: #dc3545;">${report.summary.criticalIssues}</div>
        </div>
    </div>

    <div class="section">
        <h2>Performance Scores</h2>
        <div class="metric">
            <div>Overall Score</div>
            <div class="score">${report.performanceMetrics.overallScore}/100</div>
        </div>
        <div class="metric">
            <div>API Performance</div>
            <div class="score">${report.performanceMetrics.apiPerformance.score}/100</div>
        </div>
        <div class="metric">
            <div>Database Performance</div>
            <div class="score">${report.performanceMetrics.databasePerformance.score}/100</div>
        </div>
        <div class="metric">
            <div>Memory Performance</div>
            <div class="score">${report.performanceMetrics.memoryPerformance.score}/100</div>
        </div>
    </div>

    ${
      report.alerts.length > 0
        ? `
    <div class="section">
        <h2>Alerts</h2>
        ${report.alerts
          .map(
            (alert) => `
            <div class="alert ${alert.type}">
                <strong>${alert.type.toUpperCase()}:</strong> ${alert.message}
                <br><em>Recommendation:</em> ${alert.recommendation}
            </div>
        `
          )
          .join("")}
    </div>
    `
        : ""
    }

    <div class="section">
        <h2>Recommendations</h2>
        <ul>
            ${report.recommendations.map((rec) => `<li>${rec}</li>`).join("")}
        </ul>
    </div>

    <div class="section">
        <h2>K6 Test Results</h2>
        <table>
            <tr>
                <th>Scenario</th>
                <th>Status</th>
                <th>Requests</th>
                <th>P95 Response Time</th>
                <th>Error Rate</th>
                <th>Check Success Rate</th>
            </tr>
            ${Object.values(report.k6Results)
              .map(
                (result) => `
                <tr>
                    <td>${result.scenario}</td>
                    <td><span class="status ${result.status}">${result.status}</span></td>
                    <td>${result.requests.total}</td>
                    <td>${result.responseTime.p95.toFixed(2)}ms</td>
                    <td>${((result.requests.failed / result.requests.total) * 100).toFixed(2)}%</td>
                    <td>${result.checks.rate.toFixed(1)}%</td>
                </tr>
            `
              )
              .join("")}
        </table>
    </div>
</body>
</html>
    `;
}

export function generateTextSummary(report: ComprehensiveReport): string {
  const statusEmoji = {
    pass: "✅",
    warning: "⚠️",
    fail: "❌",
  };

  return `
Performance Test Report
======================

${statusEmoji[report.summary.overallStatus]} Overall Status: ${report.summary.overallStatus.toUpperCase()}
Generated: ${report.generatedAt}
Environment: ${report.environment}
${report.version ? `Version: ${report.version}` : ""}

Summary:
- Total Tests: ${report.summary.totalTests}
- Passed: ${report.summary.passedTests}
- Failed: ${report.summary.failedTests}
- Critical Issues: ${report.summary.criticalIssues}

Performance Scores:
- Overall: ${report.performanceMetrics.overallScore}/100
- API: ${report.performanceMetrics.apiPerformance.score}/100
- Database: ${report.performanceMetrics.databasePerformance.score}/100
- Memory: ${report.performanceMetrics.memoryPerformance.score}/100

${
  report.alerts.length > 0
    ? `
Alerts:
${report.alerts.map((alert) => `- ${alert.type.toUpperCase()}: ${alert.message}`).join("\n")}
`
    : ""
}

K6 Test Results:
${Object.values(report.k6Results)
  .map(
    (result) =>
      `- ${result.scenario}: ${result.status} (P95: ${result.responseTime.p95.toFixed(2)}ms, Errors: ${((result.requests.failed / result.requests.total) * 100).toFixed(2)}%)`
  )
  .join("\n")}

Database Results:
- PostgreSQL: ${report.databaseResults.postgres.status} (P95: ${report.databaseResults.postgres.p95ResponseTime.toFixed(2)}ms)

Memory Results:
- Status: ${report.memoryResults.status}
- Leak Detected: ${report.memoryResults.leakDetected ? "YES" : "NO"}
- Growth Rate: ${report.memoryResults.memoryGrowthRate.toFixed(2)} MB/hour
- Peak Usage: ${report.memoryResults.peakMemoryUsage.toFixed(2)} MB

Recommendations:
${report.recommendations.map((rec) => `- ${rec}`).join("\n")}
    `;
}
