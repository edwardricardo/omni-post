import Redis from "ioredis";
import { performance } from "perf_hooks";

interface RedisTestConfig {
  concurrentClients: number;
  testDuration: number; // in milliseconds
  operationType: "read" | "write" | "mixed";
  dataSize: "small" | "medium" | "large";
  usePatterns: boolean;
}

interface RedisPerformanceMetrics {
  operationCount: number;
  totalDuration: number;
  averageResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  throughput: number; // operations per second
  errorCount: number;
  memoryUsage: number;
  connectionCount: number;
  cacheHitRate: number;
  keyspaceSize: number;
}

class RedisPerformanceTest {
  private clients: Redis[] = [];
  private responseTimes: number[] = [];
  private errors: string[] = [];
  private cacheHits: number = 0;
  private cacheMisses: number = 0;
  private testKeys: string[] = [];

  constructor() {
    // Primary Redis client for monitoring
    this.clients = [
      new Redis({
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379"),
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      }),
    ];
  }

  /**
   * Run comprehensive Redis performance test
   */
  async runPerformanceTest(config: RedisTestConfig): Promise<RedisPerformanceMetrics> {
    console.log(`🚀 Starting Redis performance test with ${config.concurrentClients} clients`);
    console.log(
      `📊 Test duration: ${config.testDuration / 1000}s, Operation: ${config.operationType}, Data size: ${config.dataSize}`
    );

    const startTime = performance.now();
    const endTime = startTime + config.testDuration;

    // Reset metrics
    this.responseTimes = [];
    this.errors = [];
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.testKeys = [];

    // Create additional Redis clients for concurrent testing
    await this.createClients(config.concurrentClients);

    // Setup test data
    await this.setupTestData(config);

    // Run concurrent operations
    const promises = Array.from({ length: config.concurrentClients }, (_, index) =>
      this.runConcurrentOperations(index, endTime, config)
    );

    // Monitor Redis metrics during test
    const monitoringPromise = this.monitorRedisMetrics(endTime);

    await Promise.all([...promises, monitoringPromise]);

    const totalDuration = performance.now() - startTime;
    const metrics = await this.calculateMetrics(totalDuration);

    await this.cleanup();

    return metrics;
  }

  /**
   * Create Redis clients for concurrent testing
   */
  private async createClients(count: number): Promise<void> {
    const clientPromises = Array.from({ length: count - 1 }, () => {
      const client = new Redis({
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379"),
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      });
      return client.connect().then(() => client);
    });

    const newClients = await Promise.all(clientPromises);
    this.clients.push(...newClients);

    console.log(`✅ Created ${this.clients.length} Redis clients`);
  }

  /**
   * Setup test data based on configuration
   */
  private async setupTestData(config: RedisTestConfig): Promise<void> {
    console.log("📋 Setting up test data...");

    const client = this.clients[0];
    const dataSize = this.getDataSize(config.dataSize);

    // Create test keys with varying data sizes
    for (let i = 0; i < 1000; i++) {
      const key = `perf_test:${i}`;
      const value = this.generateTestData(dataSize);

      await client.set(key, value);
      this.testKeys.push(key);

      // Add some hash and list data structures
      if (i % 10 === 0) {
        const hashKey = `perf_test:hash:${i}`;
        await client.hset(hashKey, {
          field1: value,
          field2: `${Date.now()}`,
          field3: `test_data_${i}`,
        });
        this.testKeys.push(hashKey);

        const listKey = `perf_test:list:${i}`;
        await client.lpush(listKey, ...Array.from({ length: 10 }, (_, j) => `item_${j}`));
        this.testKeys.push(listKey);
      }

      // Add some set data
      if (i % 20 === 0) {
        const setKey = `perf_test:set:${i}`;
        await client.sadd(setKey, ...Array.from({ length: 5 }, (_, j) => `member_${j}`));
        this.testKeys.push(setKey);
      }

      // Add some sorted set data
      if (i % 30 === 0) {
        const zsetKey = `perf_test:zset:${i}`;
        const members = Array.from({ length: 10 }, (_, j) => [j, `member_${j}`]).flat();
        await client.zadd(zsetKey, ...members);
        this.testKeys.push(zsetKey);
      }
    }

    console.log(`✅ Created ${this.testKeys.length} test keys`);
  }

  /**
   * Run concurrent operations for a single client
   */
  private async runConcurrentOperations(
    clientIndex: number,
    endTime: number,
    config: RedisTestConfig
  ): Promise<void> {
    const client = this.clients[clientIndex];
    let operationCount = 0;

    while (performance.now() < endTime) {
      try {
        const operationStart = performance.now();

        switch (config.operationType) {
          case "read":
            await this.executeReadOperation(client, config);
            break;
          case "write":
            await this.executeWriteOperation(client, config);
            break;
          case "mixed":
            if (Math.random() < 0.7) {
              await this.executeReadOperation(client, config);
            } else {
              await this.executeWriteOperation(client, config);
            }
            break;
        }

        const operationDuration = performance.now() - operationStart;
        this.responseTimes.push(operationDuration);

        operationCount++;

        // Small delay to prevent overwhelming Redis
        await this.sleep(Math.random() * 5);
      } catch (error) {
        this.errors.push(`Client ${clientIndex}: ${error.message}`);

        // Exponential backoff on error
        await this.sleep(Math.min(1000, Math.pow(2, this.errors.length)));
      }
    }

    console.log(`🔗 Client ${clientIndex} completed ${operationCount} operations`);
  }

  /**
   * Execute read operations
   */
  private async executeReadOperation(client: Redis, config: RedisTestConfig): Promise<any> {
    const operations = [
      () => this.basicReadOperations(client),
      () => this.hashReadOperations(client),
      () => this.listReadOperations(client),
      () => this.setReadOperations(client),
      () => this.sortedSetReadOperations(client),
    ];

    if (config.usePatterns) {
      operations.push(() => this.patternReadOperations(client));
    }

    const operation = operations[Math.floor(Math.random() * operations.length)];
    return operation();
  }

  /**
   * Execute write operations
   */
  private async executeWriteOperation(client: Redis, config: RedisTestConfig): Promise<any> {
    const operations = [
      () => this.basicWriteOperations(client, config),
      () => this.hashWriteOperations(client, config),
      () => this.listWriteOperations(client),
      () => this.setWriteOperations(client),
      () => this.sortedSetWriteOperations(client),
    ];

    const operation = operations[Math.floor(Math.random() * operations.length)];
    return operation();
  }

  /**
   * Basic read operations (GET, MGET, EXISTS)
   */
  private async basicReadOperations(client: Redis): Promise<any> {
    const key = this.getRandomTestKey();
    const result = await client.get(key);

    if (result) {
      this.cacheHits++;
    } else {
      this.cacheMisses++;
    }

    // Sometimes do multi-key operations
    if (Math.random() < 0.3) {
      const keys = Array.from({ length: 5 }, () => this.getRandomTestKey());
      await client.mget(...keys);
    }

    return result;
  }

  /**
   * Hash read operations
   */
  private async hashReadOperations(client: Redis): Promise<any> {
    const hashKey = this.testKeys.find((k) => k.includes("hash")) || this.getRandomTestKey();

    const operations = [
      () => client.hget(hashKey, "field1"),
      () => client.hgetall(hashKey),
      () => client.hkeys(hashKey),
      () => client.hvals(hashKey),
      () => client.hlen(hashKey),
    ];

    const operation = operations[Math.floor(Math.random() * operations.length)];
    return operation();
  }

  /**
   * List read operations
   */
  private async listReadOperations(client: Redis): Promise<any> {
    const listKey = this.testKeys.find((k) => k.includes("list")) || this.getRandomTestKey();

    const operations = [
      () => client.lrange(listKey, 0, -1),
      () => client.llen(listKey),
      () => client.lindex(listKey, 0),
      () => client.lrange(listKey, 0, 5),
    ];

    const operation = operations[Math.floor(Math.random() * operations.length)];
    return operation();
  }

  /**
   * Set read operations
   */
  private async setReadOperations(client: Redis): Promise<any> {
    const setKey = this.testKeys.find((k) => k.includes("set")) || this.getRandomTestKey();

    const operations = [
      () => client.smembers(setKey),
      () => client.scard(setKey),
      () => client.sismember(setKey, "member_1"),
      () => client.srandmember(setKey),
    ];

    const operation = operations[Math.floor(Math.random() * operations.length)];
    return operation();
  }

  /**
   * Sorted set read operations
   */
  private async sortedSetReadOperations(client: Redis): Promise<any> {
    const zsetKey = this.testKeys.find((k) => k.includes("zset")) || this.getRandomTestKey();

    const operations = [
      () => client.zrange(zsetKey, 0, -1),
      () => client.zcard(zsetKey),
      () => client.zscore(zsetKey, "member_1"),
      () => client.zrange(zsetKey, 0, 5, "WITHSCORES"),
      () => client.zrevrange(zsetKey, 0, 5),
    ];

    const operation = operations[Math.floor(Math.random() * operations.length)];
    return operation();
  }

  /**
   * Pattern-based read operations
   */
  private async patternReadOperations(client: Redis): Promise<any> {
    const operations = [
      () => client.keys("perf_test:*"),
      () => client.scan(0, "MATCH", "perf_test:hash:*", "COUNT", 10),
      () => client.scan(0, "MATCH", "perf_test:list:*", "COUNT", 10),
    ];

    const operation = operations[Math.floor(Math.random() * operations.length)];
    return operation();
  }

  /**
   * Basic write operations
   */
  private async basicWriteOperations(client: Redis, config: RedisTestConfig): Promise<any> {
    const key = `perf_test:write:${Date.now()}:${Math.random()}`;
    const value = this.generateTestData(this.getDataSize(config.dataSize));

    const operations = [
      () => client.set(key, value),
      () => client.set(key, value, "EX", 3600), // 1 hour expiry
      () => client.setex(key, 1800, value), // 30 minutes expiry
      () => client.incr(`perf_test:counter:${Math.floor(Math.random() * 10)}`),
    ];

    const operation = operations[Math.floor(Math.random() * operations.length)];
    return operation();
  }

  /**
   * Hash write operations
   */
  private async hashWriteOperations(client: Redis, config: RedisTestConfig): Promise<any> {
    const hashKey = `perf_test:hash:write:${Date.now()}`;
    const value = this.generateTestData(this.getDataSize(config.dataSize));

    const operations = [
      () => client.hset(hashKey, "field1", value),
      () =>
        client.hset(hashKey, {
          field1: value,
          field2: `${Date.now()}`,
          field3: "test_data",
        }),
      () => client.hincrby(hashKey, "counter", 1),
    ];

    const operation = operations[Math.floor(Math.random() * operations.length)];
    return operation();
  }

  /**
   * List write operations
   */
  private async listWriteOperations(client: Redis): Promise<any> {
    const listKey = `perf_test:list:write:${Date.now()}`;
    const value = `list_item_${Date.now()}`;

    const operations = [
      () => client.lpush(listKey, value),
      () => client.rpush(listKey, value),
      () => client.lpush(listKey, ...Array.from({ length: 5 }, (_, i) => `item_${i}`)),
    ];

    const operation = operations[Math.floor(Math.random() * operations.length)];
    return operation();
  }

  /**
   * Set write operations
   */
  private async setWriteOperations(client: Redis): Promise<any> {
    const setKey = `perf_test:set:write:${Date.now()}`;
    const member = `member_${Date.now()}`;

    const operations = [
      () => client.sadd(setKey, member),
      () => client.sadd(setKey, ...Array.from({ length: 5 }, (_, i) => `member_${i}`)),
    ];

    const operation = operations[Math.floor(Math.random() * operations.length)];
    return operation();
  }

  /**
   * Sorted set write operations
   */
  private async sortedSetWriteOperations(client: Redis): Promise<any> {
    const zsetKey = `perf_test:zset:write:${Date.now()}`;
    const score = Math.random() * 100;
    const member = `member_${Date.now()}`;

    const operations = [
      () => client.zadd(zsetKey, score, member),
      () => client.zincrby(zsetKey, 1, member),
    ];

    const operation = operations[Math.floor(Math.random() * operations.length)];
    return operation();
  }

  /**
   * Monitor Redis metrics during test
   */
  private async monitorRedisMetrics(endTime: number): Promise<void> {
    const client = this.clients[0];

    while (performance.now() < endTime) {
      try {
        const info = await client.info("memory");
        const memoryMatch = info.match(/used_memory:(\d+)/);
        const memoryUsage = memoryMatch ? parseInt(memoryMatch[1]) : 0;

        const clientsInfo = await client.info("clients");
        const connectionsMatch = clientsInfo.match(/connected_clients:(\d+)/);
        const connections = connectionsMatch ? parseInt(connectionsMatch[1]) : 0;

        const dbSize = await client.dbsize();

        console.log(
          `📊 Memory: ${(memoryUsage / 1024 / 1024).toFixed(2)}MB, Connections: ${connections}, Keys: ${dbSize}`
        );

        await this.sleep(5000); // Check every 5 seconds
      } catch (error) {
        console.warn("Monitoring error:", error.message);
      }
    }
  }

  /**
   * Calculate performance metrics
   */
  private async calculateMetrics(totalDuration: number): Promise<RedisPerformanceMetrics> {
    const sortedResponseTimes = this.responseTimes.sort((a, b) => a - b);
    const operationCount = this.responseTimes.length;

    const p95Index = Math.floor(operationCount * 0.95);
    const p99Index = Math.floor(operationCount * 0.99);

    const client = this.clients[0];

    // Get current Redis metrics
    const info = await client.info("memory");
    const memoryMatch = info.match(/used_memory:(\d+)/);
    const memoryUsage = memoryMatch ? parseInt(memoryMatch[1]) : 0;

    const clientsInfo = await client.info("clients");
    const connectionsMatch = clientsInfo.match(/connected_clients:(\d+)/);
    const connectionCount = connectionsMatch ? parseInt(connectionsMatch[1]) : 0;

    const keyspaceSize = await client.dbsize();

    const totalCacheOperations = this.cacheHits + this.cacheMisses;
    const cacheHitRate =
      totalCacheOperations > 0 ? (this.cacheHits / totalCacheOperations) * 100 : 0;

    return {
      operationCount,
      totalDuration,
      averageResponseTime: this.responseTimes.reduce((a, b) => a + b, 0) / operationCount,
      p95ResponseTime: sortedResponseTimes[p95Index] || 0,
      p99ResponseTime: sortedResponseTimes[p99Index] || 0,
      throughput: (operationCount / totalDuration) * 1000,
      errorCount: this.errors.length,
      memoryUsage,
      connectionCount,
      cacheHitRate,
      keyspaceSize,
    };
  }

  /**
   * Generate test data of specified size
   */
  private generateTestData(size: number): string {
    return "x".repeat(size);
  }

  /**
   * Get data size in bytes
   */
  private getDataSize(size: "small" | "medium" | "large"): number {
    switch (size) {
      case "small":
        return 100; // 100 bytes
      case "medium":
        return 1024; // 1KB
      case "large":
        return 10240; // 10KB
      default:
        return 1024;
    }
  }

  /**
   * Get a random test key
   */
  private getRandomTestKey(): string {
    return this.testKeys[Math.floor(Math.random() * this.testKeys.length)] || "perf_test:0";
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
  private async cleanup(): Promise<void> {
    try {
      const client = this.clients[0];

      // Clean up test keys
      const testKeys = await client.keys("perf_test:*");
      if (testKeys.length > 0) {
        await client.del(...testKeys);
      }

      // Close all client connections
      await Promise.all(this.clients.map((client) => client.disconnect()));

      console.log("✅ Redis cleanup completed");
    } catch (error) {
      console.error("❌ Redis cleanup failed:", error);
    }
  }
}

/**
 * Run Redis performance test suite
 */
async function runRedisPerformanceTest(): Promise<void> {
  const performanceTest = new RedisPerformanceTest();

  // Test configurations
  const testConfigs: RedisTestConfig[] = [
    {
      concurrentClients: 10,
      testDuration: 60000,
      operationType: "read",
      dataSize: "small",
      usePatterns: false,
    },
    {
      concurrentClients: 20,
      testDuration: 90000,
      operationType: "mixed",
      dataSize: "medium",
      usePatterns: true,
    },
    {
      concurrentClients: 50,
      testDuration: 120000,
      operationType: "write",
      dataSize: "large",
      usePatterns: false,
    },
  ];

  console.log("🧪 Starting Redis performance testing suite...");

  for (const config of testConfigs) {
    try {
      console.log(`\n${"=".repeat(60)}`);
      console.log(
        `🔄 Running test: ${config.concurrentClients} clients, ${config.operationType} operations, ${config.dataSize} data`
      );

      const metrics = await performanceTest.runPerformanceTest(config);

      console.log("\n📈 Performance Metrics:");
      console.log(`   Total operations: ${metrics.operationCount}`);
      console.log(`   Average response time: ${metrics.averageResponseTime.toFixed(2)}ms`);
      console.log(`   P95 response time: ${metrics.p95ResponseTime.toFixed(2)}ms`);
      console.log(`   P99 response time: ${metrics.p99ResponseTime.toFixed(2)}ms`);
      console.log(`   Throughput: ${metrics.throughput.toFixed(2)} ops/sec`);
      console.log(`   Error count: ${metrics.errorCount}`);
      console.log(`   Memory usage: ${(metrics.memoryUsage / 1024 / 1024).toFixed(2)}MB`);
      console.log(`   Active connections: ${metrics.connectionCount}`);
      console.log(`   Cache hit rate: ${metrics.cacheHitRate.toFixed(2)}%`);
      console.log(`   Keyspace size: ${metrics.keyspaceSize}`);

      // Performance assertions
      if (metrics.p95ResponseTime > 50) {
        console.warn(
          `⚠️  P95 response time (${metrics.p95ResponseTime.toFixed(2)}ms) exceeds 50ms threshold`
        );
      }

      if (metrics.errorCount > 0) {
        console.warn(`⚠️  Errors detected: ${metrics.errorCount}`);
      }

      if (metrics.cacheHitRate < 50) {
        console.warn(`⚠️  Low cache hit rate: ${metrics.cacheHitRate.toFixed(2)}%`);
      }

      // Wait between tests
      await new Promise((resolve) => setTimeout(resolve, 5000));
    } catch (error) {
      console.error(`❌ Test failed:`, error);
    }
  }

  console.log("\n✅ Redis performance testing completed");
}

// Run the test if this file is executed directly
if (require.main === module) {
  runRedisPerformanceTest().catch(console.error);
}

export { RedisPerformanceTest, runRedisPerformanceTest };
