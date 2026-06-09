/**
 * @file baseline-capture.ts
 * @description Performance baseline capture script for regression detection.
 * @layer infrastructure
 */
import { PerformanceRegressionDetector } from "../monitoring/regression-detector.js";
import { createPrismaRepoAdapter } from "@adapters/db-prisma";
import { prisma } from "@infra/prisma";
import { createBullMQQueueAdapter } from "@adapters/queue-bullmq";
import Redis from "ioredis";
import autocannon from "autocannon";
import { performance } from "perf_hooks";

interface BaselineTestConfig {
  baseUrl: string;
  environment: string;
  version: string;
  testDuration: number; // seconds
  concurrentUsers: number;
}

class BaselineCapture {
  private repo = createPrismaRepoAdapter({ prisma });
  private queue = createBullMQQueueAdapter();
  private redis = new Redis({
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
  });

  constructor(private config: BaselineTestConfig) {}

  /**
   * Capture comprehensive performance baseline
   */
  async captureBaseline(): Promise<void> {
    console.log("🚀 Starting baseline performance capture...");
    console.log(`Version: ${this.config.version}`);
    console.log(`Environment: ${this.config.environment}`);
    console.log(`Base URL: ${this.config.baseUrl}`);

    try {
      // Warm up the system
      await this.warmupSystem();

      // Run performance tests and collect metrics
      const metrics = await this.collectPerformanceMetrics();

      // Save baseline
      const detector = new PerformanceRegressionDetector({
        baselineDir: "./performance/baselines",
      });

      await detector.captureBaseline(
        this.config.version,
        metrics,
        {
          concurrentUsers: this.config.concurrentUsers,
          testDuration: this.config.testDuration * 1000,
          scenario: "baseline_capture",
          dataSize: "mixed",
        },
        this.config.environment
      );

      console.log("✅ Baseline capture completed successfully");
    } catch (error) {
      console.error("❌ Baseline capture failed:", error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Warm up the system before baseline capture
   */
  private async warmupSystem(): Promise<void> {
    console.log("🔥 Warming up system...");

    // Create test data
    await this.createTestData();

    // Warm up API endpoints
    await this.warmupEndpoints();

    // Warm up database connections
    await this.warmupDatabase();

    // Warm up Redis cache
    await this.warmupCache();

    console.log("✅ System warmup completed");
  }

  /**
   * Create test data for baseline testing
   */
  private async createTestData(): Promise<void> {
    try {
      // Create test account
      const account = await this.repo.createAccount({
        email: "baseline-test@example.com",
        name: "Baseline Test Account",
        subscription: "PRO",
      });

      if (!account.ok) {
        throw new Error("Failed to create test account");
      }

      // Create test project
      const project = await this.repo.createProject({
        accountId: account.value.id,
        name: "Baseline Test Project",
        locale: "en",
      });

      if (!project.ok) {
        throw new Error("Failed to create test project");
      }

      // Create test posts
      const posts = Array.from({ length: 50 }, (_, i) => ({
        projectId: project.value.id,
        content: `Baseline test post ${i + 1} with content for performance testing`,
        status: "PUBLISHED" as const,
      }));

      for (const postData of posts) {
        await this.repo.createPost(postData);
      }

      console.log("📊 Test data created");
    } catch (error) {
      console.warn("Test data creation failed:", error);
    }
  }

  /**
   * Warm up API endpoints
   */
  private async warmupEndpoints(): Promise<void> {
    const endpoints = ["/health", "/api/auth/profile", "/api/projects", "/api/posts", "/metrics"];

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(`${this.config.baseUrl}${endpoint}`);
        if (response.ok) {
          console.log(`✓ Warmed up ${endpoint}`);
        }
      } catch (error) {
        console.warn(`Failed to warm up ${endpoint}:`, error.message);
      }
    }
  }

  /**
   * Warm up database connections
   */
  private async warmupDatabase(): Promise<void> {
    try {
      // Execute simple queries to warm up connection pool
      await this.repo.listLogs({ limit: 1 });
      console.log("✓ Database connections warmed up");
    } catch (error) {
      console.warn("Database warmup failed:", error);
    }
  }

  /**
   * Warm up Redis cache
   */
  private async warmupCache(): Promise<void> {
    try {
      // Set and get some test keys
      await this.redis.set("warmup:test", "value");
      await this.redis.get("warmup:test");
      await this.redis.del("warmup:test");
      console.log("✓ Redis cache warmed up");
    } catch (error) {
      console.warn("Redis warmup failed:", error);
    }
  }

  /**
   * Collect comprehensive performance metrics
   */
  private async collectPerformanceMetrics(): Promise<any> {
    console.log("📊 Collecting performance metrics...");

    // API performance metrics
    const apiMetrics = await this.measureApiPerformance();

    // Database performance metrics
    const dbMetrics = await this.measureDatabasePerformance();

    // Memory and resource metrics
    const resourceMetrics = await this.measureResourceUsage();

    // Cache performance metrics
    const cacheMetrics = await this.measureCachePerformance();

    // Provider integration metrics (simulated)
    const providerMetrics = await this.measureProviderPerformance();

    return {
      responseTime: apiMetrics.responseTime,
      throughput: apiMetrics.throughput,
      errorRate: apiMetrics.errorRate,
      dbQueryTime: dbMetrics.queryTime,
      dbConnectionPoolUtilization: dbMetrics.poolUtilization,
      memoryUsage: resourceMetrics.memoryUsage,
      cpuUsage: resourceMetrics.cpuUsage,
      cacheHitRate: cacheMetrics.hitRate,
      cacheResponseTime: cacheMetrics.responseTime,
      providerResponseTime: providerMetrics.responseTime,
      providerErrorRate: providerMetrics.errorRate,
    };
  }

  /**
   * Measure API performance using autocannon
   */
  private async measureApiPerformance(): Promise<{
    responseTime: { p50: number; p95: number; p99: number; max: number };
    throughput: number;
    errorRate: number;
  }> {
    console.log("🔄 Measuring API performance...");

    const result = await autocannon({
      url: this.config.baseUrl,
      connections: this.config.concurrentUsers,
      duration: this.config.testDuration,
      requests: [
        {
          method: "GET",
          path: "/health",
        },
        {
          method: "GET",
          path: "/api/projects",
          headers: {
            Authorization: "Bearer test-token",
          },
        },
        {
          method: "GET",
          path: "/metrics",
        },
      ],
    });

    const latencies = result.latency;
    const throughput = result.requests.average;
    const errorRate = (result.non2xx / result.requests.total) * 100;

    return {
      responseTime: {
        p50: latencies.p50,
        p95: latencies.p95,
        p99: latencies.p99,
        max: latencies.max,
      },
      throughput,
      errorRate,
    };
  }

  /**
   * Measure database performance
   */
  private async measureDatabasePerformance(): Promise<{
    queryTime: { p50: number; p95: number; p99: number };
    poolUtilization: number;
  }> {
    console.log("Measuring database performance...");

    const queryTimes: number[] = [];

    // Measure real listLogs query latency across 100 iterations
    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      try {
        await this.repo.listLogs({ limit: 10 });
        queryTimes.push(performance.now() - start);
      } catch (error) {
        console.warn(`Query ${i} failed:`, error);
      }
    }

    queryTimes.sort((a, b) => a - b);

    const p50 = queryTimes[Math.floor(queryTimes.length * 0.5)] ?? 0;
    const p95 = queryTimes[Math.floor(queryTimes.length * 0.95)] ?? 0;
    const p99 = queryTimes[Math.floor(queryTimes.length * 0.99)] ?? 0;

    return {
      queryTime: { p50, p95, p99 },
      // Future: integrate with Prisma connection pool events or pg_stat_activity to
      // report real pool utilization.
      poolUtilization: 0,
    };
  }

  /**
   * Measure resource usage
   */
  private async measureResourceUsage(): Promise<{
    memoryUsage: {
      heapUsed: number;
      heapTotal: number;
      external: number;
      rss: number;
    };
    cpuUsage: number;
  }> {
    console.log("Measuring resource usage...");

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }

    const memoryUsage = process.memoryUsage();

    // Future: integrate with os.cpuUsage() delta measurements or a real APM agent
    // (e.g. clinic.js, Node.js --prof) to report actual CPU utilization percentage.
    const cpuUsage = 0;

    return {
      memoryUsage,
      cpuUsage,
    };
  }

  /**
   * Measure cache performance
   */
  private async measureCachePerformance(): Promise<{
    hitRate: number;
    responseTime: number;
  }> {
    console.log("🗂️ Measuring cache performance...");

    const cacheOperations = 100;
    let hits = 0;
    const responseTimes: number[] = [];

    // Set up some test data in cache
    for (let i = 0; i < 50; i++) {
      await this.redis.set(`baseline:test:${i}`, `value${i}`, "EX", 3600);
    }

    // Perform cache operations
    for (let i = 0; i < cacheOperations; i++) {
      const start = performance.now();

      const key = `baseline:test:${Math.floor(Math.random() * 100)}`;
      const result = await this.redis.get(key);

      const duration = performance.now() - start;
      responseTimes.push(duration);

      if (result !== null) {
        hits++;
      }
    }

    const hitRate = (hits / cacheOperations) * 100;
    const averageResponseTime =
      responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;

    // Cleanup test data
    for (let i = 0; i < 100; i++) {
      await this.redis.del(`baseline:test:${i}`);
    }

    return {
      hitRate,
      responseTime: averageResponseTime,
    };
  }

  /**
   * Measure provider performance
   */
  private async measureProviderPerformance(): Promise<{
    responseTime: { p95: number; p99: number };
    errorRate: number;
  }> {
    console.log("Measuring provider performance...");

    // Future: make real sandboxed calls to each active provider's OAuth ping /
    // rate-limit endpoint and record actual latencies here. Until real provider
    // test credentials are available in CI, return empty baseline values.
    return {
      responseTime: { p95: 0, p99: 0 },
      errorRate: 0,
    };
  }

  /**
   * Cleanup test resources
   */
  private async cleanup(): Promise<void> {
    try {
      // Clean up test data
      console.log("🧹 Cleaning up test resources...");

      // Note: In a real implementation, you might want to keep test data
      // for consistency across baseline captures, or clean it up here

      await this.redis.disconnect();
      console.log("✅ Cleanup completed");
    } catch (error) {
      console.warn("Cleanup failed:", error);
    }
  }
}

/**
 * Main function to capture baseline
 */
async function captureBaseline(): Promise<void> {
  const version = process.argv[2] || `baseline-${Date.now()}`;
  const environment = process.argv[3] || "development";
  const baseUrl = process.env.BASE_URL || "http://localhost:3000";

  const config: BaselineTestConfig = {
    baseUrl,
    environment,
    version,
    testDuration: 60, // 1 minute
    concurrentUsers: 10,
  };

  const capture = new BaselineCapture(config);

  try {
    await capture.captureBaseline();
    console.log(`\n✅ Baseline captured successfully for version ${version}`);
    console.log(`Environment: ${environment}`);
    console.log("📁 Baseline saved to: ./performance/baselines/");
  } catch (error) {
    console.error("\n❌ Baseline capture failed:", error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  captureBaseline().catch(console.error);
}

export { BaselineCapture };
