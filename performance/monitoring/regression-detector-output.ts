import type { RegressionReport } from "./regression-detector-types.js";

export function generateRegressionTextSummary(report: RegressionReport): string {
  const { summary } = report;

  let statusEmoji = "✅";
  if (report.overallStatus === "warning") statusEmoji = "⚠️";
  if (report.overallStatus === "fail") statusEmoji = "❌";

  return `
Performance Regression Report
============================

${statusEmoji} Overall Status: ${report.overallStatus.toUpperCase()}
Version: ${report.version}
Baseline: ${report.baselineVersion}
Environment: ${report.environment}
Generated: ${new Date(report.timestamp).toISOString()}

Summary:
- Total Metrics Compared: ${summary.totalMetrics}
- Regressions: ${summary.regressionsCount}
- Improvements: ${summary.improvementsCount}
- Critical Regressions: ${summary.criticalRegressions}
- Average Change: ${summary.averageChange.toFixed(2)}%

${summary.worstRegression ? `Worst Regression: ${summary.worstRegression.metric} (${summary.worstRegression.change.toFixed(1)}% worse)` : ""}
${summary.bestImprovement ? `Best Improvement: ${summary.bestImprovement.metric} (${Math.abs(summary.bestImprovement.change).toFixed(1)}% better)` : ""}

Regressions Detected:
${
  report.regressions.length === 0
    ? "None"
    : report.regressions
        .map(
          (r) =>
            `- ${r.metric}: ${r.baseline.toFixed(2)} → ${r.current.toFixed(2)} (${r.change.toFixed(1)}% ${r.severity})`
        )
        .join("\n")
}

Improvements:
${
  report.improvements.length === 0
    ? "None"
    : report.improvements
        .slice(0, 5)
        .map(
          (i) =>
            `- ${i.metric}: ${i.baseline.toFixed(2)} → ${i.current.toFixed(2)} (${Math.abs(i.change).toFixed(1)}% better)`
        )
        .join("\n")
}

Recommendations:
${report.recommendations.map((r) => `${r}`).join("\n")}
`;
}
