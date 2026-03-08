import type { DatabaseTestResult } from "./report-types.js";

/**
 * Parse PostgreSQL test results from logs
 */
export function parsePostgresResults(logContent: string): DatabaseTestResult {
  // Simple parsing - in a real implementation, you'd have structured output
  const queryCountMatch = logContent.match(/Total queries: (\d+)/);
  const avgTimeMatch = logContent.match(/Average response time: ([\d.]+)ms/);
  const p95TimeMatch = logContent.match(/P95 response time: ([\d.]+)ms/);
  const p99TimeMatch = logContent.match(/P99 response time: ([\d.]+)ms/);
  const throughputMatch = logContent.match(/Throughput: ([\d.]+) queries\/sec/);
  const errorCountMatch = logContent.match(/Error count: (\d+)/);
  const deadlockMatch = logContent.match(/Deadlock count: (\d+)/);
  const longQueryMatch = logContent.match(/Long-running queries: (\d+)/);

  return {
    queryCount: queryCountMatch ? parseInt(queryCountMatch[1]) : 0,
    averageResponseTime: avgTimeMatch ? parseFloat(avgTimeMatch[1]) : 0,
    p95ResponseTime: p95TimeMatch ? parseFloat(p95TimeMatch[1]) : 0,
    p99ResponseTime: p99TimeMatch ? parseFloat(p99TimeMatch[1]) : 0,
    throughput: throughputMatch ? parseFloat(throughputMatch[1]) : 0,
    errorCount: errorCountMatch ? parseInt(errorCountMatch[1]) : 0,
    deadlockCount: deadlockMatch ? parseInt(deadlockMatch[1]) : 0,
    longRunningQueries: longQueryMatch ? parseInt(longQueryMatch[1]) : 0,
  };
}

/**
 * Parse Redis test results from logs
 */
export function parseRedisResults(logContent: string): {
  operationCount: number;
  averageResponseTime: number;
  throughput: number;
  cacheHitRate: number;
  errorCount: number;
} {
  // Simple parsing for Redis results
  const operationCountMatch = logContent.match(/Total operations: (\d+)/);
  const avgTimeMatch = logContent.match(/Average response time: ([\d.]+)ms/);
  const throughputMatch = logContent.match(/Throughput: ([\d.]+) ops\/sec/);
  const hitRateMatch = logContent.match(/Cache hit rate: ([\d.]+)%/);
  const errorCountMatch = logContent.match(/Error count: (\d+)/);

  return {
    operationCount: operationCountMatch ? parseInt(operationCountMatch[1]) : 0,
    averageResponseTime: avgTimeMatch ? parseFloat(avgTimeMatch[1]) : 0,
    throughput: throughputMatch ? parseFloat(throughputMatch[1]) : 0,
    cacheHitRate: hitRateMatch ? parseFloat(hitRateMatch[1]) : 0,
    errorCount: errorCountMatch ? parseInt(errorCountMatch[1]) : 0,
  };
}
