import { createPrismaRepoAdapter } from "@adapters/db-prisma";
import { createBullMQQueueAdapter } from "@adapters/queue-bullmq";
import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import { performance } from "perf_hooks";

interface StressTestConfig {
  concurrentConnections: number;
  testDuration: number; // in milliseconds
  queryComplexity: "simple" | "moderate" | "complex";
  writeRatio: number; // 0.0 to 1.0
}

interface PerformanceMetrics {
  queryCount: number;
  totalDuration: number;
  averageResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  errorCount: number;
  throughput: number; // queries per second
  connectionPoolUtilization: number;
  deadlockCount: number;
  longRunningQueries: number;
}

class PostgresStressTest {
  private prisma: PrismaClient;
  private repo: ReturnType<typeof createPrismaRepoAdapter>;
  private queue: ReturnType<typeof createBullMQQueueAdapter>;
  private responseTimes: number[] = [];
  private errors: string[] = [];
  private deadlocks: number = 0;
  private longRunningQueries: number = 0;

  constructor() {
    this.prisma = createTestPrismaClient();
    this.repo = createPrismaRepoAdapter();
    this.queue = createBullMQQueueAdapter();
  }

  /**
   * Run comprehensive PostgreSQL stress test
   */
  async runStressTest(config: StressTestConfig): Promise<PerformanceMetrics> {
    console.log(
      `🚀 Starting PostgreSQL stress test with ${config.concurrentConnections} connections`
    );
    console.log(
      `📊 Test duration: ${config.testDuration / 1000}s, Query complexity: ${config.queryComplexity}`
    );

    const startTime = performance.now();
    const endTime = startTime + config.testDuration;

    // Reset metrics
    this.responseTimes = [];
    this.errors = [];
    this.deadlocks = 0;
    this.longRunningQueries = 0;

    // Create test data
    await this.setupTestData();

    // Run concurrent stress tests
    const promises = Array.from({ length: config.concurrentConnections }, (_, index) =>
      this.runConcurrentQueries(index, endTime, config)
    );

    // Monitor database metrics during test
    const monitoringPromise = this.monitorDatabaseMetrics(endTime);

    await Promise.all([...promises, monitoringPromise]);

    const totalDuration = performance.now() - startTime;

    return this.calculateMetrics(totalDuration);
  }

  /**
   * Set up test data for stress testing
   */
  private async setupTestData(): Promise<void> {
    console.log("📋 Setting up test data...");

    try {
      // Create test account
      const account = await this.repo.createAccount({
        email: "stress-test@example.com",
        name: "Stress Test Account",
        subscription: "PRO",
      });

      if (!account.ok) {
        throw new Error("Failed to create test account");
      }

      // Create test projects
      const projects = await Promise.all(
        Array.from({ length: 10 }, async (_, i) => {
          const project = await this.repo.createProject({
            accountId: account.value.id,
            name: `Stress Test Project ${i}`,
            locale: "en",
          });
          return project.ok ? project.value.id : null;
        })
      );

      const validProjects = projects.filter(Boolean) as string[];

      // Create test posts for each project
      await Promise.all(
        validProjects.map(async (projectId) => {
          const posts = Array.from({ length: 100 }, (_, i) => ({
            projectId,
            content: `Stress test post ${i} with some content to test database performance`,
            status: "PUBLISHED" as const,
          }));

          // Create posts in batches to avoid overwhelming the database
          for (let i = 0; i < posts.length; i += 10) {
            const batch = posts.slice(i, i + 10);
            await Promise.all(batch.map((post) => this.repo.createPost(post)));
          }
        })
      );

      console.log("✅ Test data setup completed");
    } catch (error) {
      console.error("❌ Failed to setup test data:", error);
      throw error;
    }
  }

  /**
   * Run concurrent queries for a single connection
   */
  private async runConcurrentQueries(
    connectionId: number,
    endTime: number,
    config: StressTestConfig
  ): Promise<void> {
    let queryCount = 0;

    while (performance.now() < endTime) {
      try {
        const isWrite = Math.random() < config.writeRatio;
        const queryStart = performance.now();

        if (isWrite) {
          await this.executeWriteQuery(config.queryComplexity);
        } else {
          await this.executeReadQuery(config.queryComplexity);
        }

        const queryDuration = performance.now() - queryStart;
        this.responseTimes.push(queryDuration);

        // Track long-running queries (>1 second)
        if (queryDuration > 1000) {
          this.longRunningQueries++;
        }

        queryCount++;

        // Small delay to prevent overwhelming the database
        await this.sleep(Math.random() * 10);
      } catch (error) {
        this.errors.push(`Connection ${connectionId}: ${error.message}`);

        // Detect deadlocks
        if (error.message.includes("deadlock")) {
          this.deadlocks++;
        }

        // Exponential backoff on error
        await this.sleep(Math.min(1000, Math.pow(2, this.errors.length)));
      }
    }

    console.log(`🔗 Connection ${connectionId} completed ${queryCount} queries`);
  }

  /**
   * Execute read queries of varying complexity
   */
  private async executeReadQuery(complexity: string): Promise<any> {
    switch (complexity) {
      case "simple":
        return this.executeSimpleReadQuery();
      case "moderate":
        return this.executeModerateReadQuery();
      case "complex":
        return this.executeComplexReadQuery();
      default:
        return this.executeSimpleReadQuery();
    }
  }

  /**
   * Execute write queries of varying complexity
   */
  private async executeWriteQuery(complexity: string): Promise<any> {
    switch (complexity) {
      case "simple":
        return this.executeSimpleWriteQuery();
      case "moderate":
        return this.executeModerateWriteQuery();
      case "complex":
        return this.executeComplexWriteQuery();
      default:
        return this.executeSimpleWriteQuery();
    }
  }

  /**
   * Simple read queries
   */
  private async executeSimpleReadQuery(): Promise<any> {
    const queries = [
      () => this.prisma.account.findMany({ take: 10 }),
      () => this.prisma.project.findMany({ take: 20 }),
      () => this.prisma.post.findMany({ take: 50 }),
      () => this.prisma.post.count(),
      () => this.prisma.account.count(),
    ];

    const randomQuery = queries[Math.floor(Math.random() * queries.length)];
    return randomQuery();
  }

  /**
   * Moderate complexity read queries
   */
  private async executeModerateReadQuery(): Promise<any> {
    const queries = [
      () =>
        this.prisma.post.findMany({
          include: { project: true },
          where: { status: "PUBLISHED" },
          orderBy: { createdAt: "desc" },
          take: 25,
        }),
      () =>
        this.prisma.project.findMany({
          include: { posts: { take: 10 } },
          where: { posts: { some: { status: "PUBLISHED" } } },
        }),
      () =>
        this.prisma.post.groupBy({
          by: ["status"],
          _count: { id: true },
          _avg: { id: true },
        }),
      () =>
        this.prisma.account.findMany({
          include: {
            projects: {
              include: { _count: { select: { posts: true } } },
            },
          },
        }),
    ];

    const randomQuery = queries[Math.floor(Math.random() * queries.length)];
    return randomQuery();
  }

  /**
   * Complex read queries with joins and aggregations
   */
  private async executeComplexReadQuery(): Promise<any> {
    const queries = [
      () => this.prisma.$queryRaw`
        SELECT
          a.name as account_name,
          COUNT(p.id) as project_count,
          COUNT(po.id) as post_count,
          AVG(EXTRACT(EPOCH FROM (po.created_at - p.created_at))) as avg_post_delay_seconds
        FROM accounts a
        LEFT JOIN projects p ON a.id = p.account_id
        LEFT JOIN posts po ON p.id = po.project_id
        GROUP BY a.id, a.name
        HAVING COUNT(po.id) > 0
        ORDER BY post_count DESC
        LIMIT 10
      `,
      () => this.prisma.$queryRaw`
        WITH monthly_stats AS (
          SELECT
            DATE_TRUNC('month', created_at) as month,
            COUNT(*) as post_count,
            status
          FROM posts
          WHERE created_at >= NOW() - INTERVAL '12 months'
          GROUP BY DATE_TRUNC('month', created_at), status
        )
        SELECT
          month,
          SUM(CASE WHEN status = 'PUBLISHED' THEN post_count ELSE 0 END) as published,
          SUM(CASE WHEN status = 'DRAFT' THEN post_count ELSE 0 END) as drafts,
          SUM(CASE WHEN status = 'SCHEDULED' THEN post_count ELSE 0 END) as scheduled
        FROM monthly_stats
        GROUP BY month
        ORDER BY month DESC
      `,
      () =>
        this.prisma.post.findMany({
          include: {
            project: {
              include: {
                account: true,
                _count: {
                  select: {
                    posts: true,
                  },
                },
              },
            },
          },
          where: {
            AND: [
              { status: "PUBLISHED" },
              { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
              {
                project: {
                  account: {
                    subscription: { in: ["PRO", "ENTERPRISE"] },
                  },
                },
              },
            ],
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 100,
        }),
    ];

    const randomQuery = queries[Math.floor(Math.random() * queries.length)];
    return randomQuery();
  }

  /**
   * Simple write queries
   */
  private async executeSimpleWriteQuery(): Promise<any> {
    const postData = {
      projectId: await this.getRandomProjectId(),
      content: `Stress test post created at ${new Date().toISOString()}`,
      status: "DRAFT" as const,
    };

    return this.repo.createPost(postData);
  }

  /**
   * Moderate complexity write queries
   */
  private async executeModerateWriteQuery(): Promise<any> {
    return this.prisma.$transaction(async (tx) => {
      // Create a post
      const post = await tx.post.create({
        data: {
          projectId: await this.getRandomProjectId(),
          content: `Transaction test post ${Date.now()}`,
          status: "PUBLISHED",
        },
      });

      // Update related project
      await tx.project.update({
        where: { id: post.projectId },
        data: { updatedAt: new Date() },
      });

      return post;
    });
  }

  /**
   * Complex write queries with multiple operations
   */
  private async executeComplexWriteQuery(): Promise<any> {
    return this.prisma.$transaction(async (tx) => {
      const projectId = await this.getRandomProjectId();

      // Create multiple posts
      const posts = await Promise.all(
        Array.from({ length: 3 }, (_, i) =>
          tx.post.create({
            data: {
              projectId,
              content: `Batch post ${i} - ${Date.now()}`,
              status: "DRAFT",
            },
          })
        )
      );

      // Bulk update posts
      await tx.post.updateMany({
        where: { id: { in: posts.map((p) => p.id) } },
        data: { status: "PUBLISHED" },
      });

      // Update project timestamp
      await tx.project.update({
        where: { id: projectId },
        data: { updatedAt: new Date() },
      });

      return posts;
    });
  }

  /**
   * Monitor database metrics during stress test
   */
  private async monitorDatabaseMetrics(endTime: number): Promise<void> {
    while (performance.now() < endTime) {
      try {
        // Monitor active connections
        const activeConnections = await this.prisma.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*) as count
          FROM pg_stat_activity
          WHERE state = 'active'
        `;

        // Monitor long-running queries
        const longQueries = await this.prisma.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*) as count
          FROM pg_stat_activity
          WHERE state = 'active'
          AND now() - query_start > interval '5 seconds'
        `;

        // Monitor locks
        const locks = await this.prisma.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*) as count
          FROM pg_locks
          WHERE NOT granted
        `;

        console.log(
          `📊 Active connections: ${activeConnections[0].count}, Long queries: ${longQueries[0].count}, Waiting locks: ${locks[0].count}`
        );

        await this.sleep(5000); // Check every 5 seconds
      } catch (error) {
        console.warn("Monitoring error:", error.message);
      }
    }
  }

  /**
   * Calculate performance metrics from collected data
   */
  private calculateMetrics(totalDuration: number): PerformanceMetrics {
    const sortedResponseTimes = this.responseTimes.sort((a, b) => a - b);
    const queryCount = this.responseTimes.length;

    const p95Index = Math.floor(queryCount * 0.95);
    const p99Index = Math.floor(queryCount * 0.99);

    return {
      queryCount,
      totalDuration,
      averageResponseTime: this.responseTimes.reduce((a, b) => a + b, 0) / queryCount,
      p95ResponseTime: sortedResponseTimes[p95Index] || 0,
      p99ResponseTime: sortedResponseTimes[p99Index] || 0,
      errorCount: this.errors.length,
      throughput: (queryCount / totalDuration) * 1000, // queries per second
      connectionPoolUtilization: 0, // TODO: Implement connection pool monitoring
      deadlockCount: this.deadlocks,
      longRunningQueries: this.longRunningQueries,
    };
  }

  /**
   * Get a random project ID for testing
   */
  private async getRandomProjectId(): Promise<string> {
    const projects = await this.prisma.project.findMany({
      select: { id: true },
      take: 10,
    });

    if (projects.length === 0) {
      throw new Error("No projects available for testing");
    }

    return projects[Math.floor(Math.random() * projects.length)].id;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    try {
      // Clean up test data
      await this.prisma.post.deleteMany({
        where: { content: { contains: "Stress test post" } },
      });

      await this.prisma.post.deleteMany({
        where: { content: { contains: "Transaction test post" } },
      });

      await this.prisma.post.deleteMany({
        where: { content: { contains: "Batch post" } },
      });

      await this.prisma.project.deleteMany({
        where: { name: { contains: "Stress Test Project" } },
      });

      await this.prisma.account.deleteMany({
        where: { email: "stress-test@example.com" },
      });

      await this.prisma.$disconnect();
      console.log("✅ Cleanup completed");
    } catch (error) {
      console.error("❌ Cleanup failed:", error);
    }
  }
}

/**
 * Run PostgreSQL stress test
 */
async function runPostgresStressTest(): Promise<void> {
  const stressTest = new PostgresStressTest();

  // Test configurations
  const testConfigs: StressTestConfig[] = [
    {
      concurrentConnections: 10,
      testDuration: 60000, // 1 minute
      queryComplexity: "simple",
      writeRatio: 0.2,
    },
    {
      concurrentConnections: 25,
      testDuration: 120000, // 2 minutes
      queryComplexity: "moderate",
      writeRatio: 0.3,
    },
    {
      concurrentConnections: 50,
      testDuration: 180000, // 3 minutes
      queryComplexity: "complex",
      writeRatio: 0.4,
    },
  ];

  console.log("🧪 Starting PostgreSQL stress testing suite...");

  for (const config of testConfigs) {
    try {
      console.log(`\n${"=".repeat(60)}`);
      console.log(
        `🔄 Running test: ${config.concurrentConnections} connections, ${config.queryComplexity} queries`
      );

      const metrics = await stressTest.runStressTest(config);

      console.log("\n📈 Performance Metrics:");
      console.log(`   Total queries: ${metrics.queryCount}`);
      console.log(`   Average response time: ${metrics.averageResponseTime.toFixed(2)}ms`);
      console.log(`   P95 response time: ${metrics.p95ResponseTime.toFixed(2)}ms`);
      console.log(`   P99 response time: ${metrics.p99ResponseTime.toFixed(2)}ms`);
      console.log(`   Throughput: ${metrics.throughput.toFixed(2)} queries/sec`);
      console.log(`   Error count: ${metrics.errorCount}`);
      console.log(`   Deadlock count: ${metrics.deadlockCount}`);
      console.log(`   Long-running queries: ${metrics.longRunningQueries}`);

      // Performance assertions
      if (metrics.p95ResponseTime > 1000) {
        console.warn(
          `⚠️  P95 response time (${metrics.p95ResponseTime.toFixed(2)}ms) exceeds 1000ms threshold`
        );
      }

      if (metrics.errorCount / metrics.queryCount > 0.01) {
        console.warn(
          `⚠️  Error rate (${((metrics.errorCount / metrics.queryCount) * 100).toFixed(2)}%) exceeds 1% threshold`
        );
      }

      if (metrics.deadlockCount > 0) {
        console.warn(`⚠️  Deadlocks detected: ${metrics.deadlockCount}`);
      }

      // Wait between tests
      await stressTest.sleep(10000);
    } catch (error) {
      console.error(`❌ Test failed:`, error);
    }
  }

  await stressTest.cleanup();
  console.log("\n✅ PostgreSQL stress testing completed");
}

// Run the test if this file is executed directly
if (require.main === module) {
  runPostgresStressTest().catch(console.error);
}

export { PostgresStressTest, runPostgresStressTest };
