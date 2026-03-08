import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ProviderDependencyManager } from "../../src/orchestration/ProviderDependencyManager.js";
import type { ProviderDependency, ConflictResolutionStrategy } from "@shared/orchestration";
import type { ProviderId } from "../../src/providers/providerAdapter.interface";
import {
  MockPrismaClient,
  MockRedis,
  MockEventService,
  createMockRetryPolicy,
  createMockPublishResult,
} from "./ProviderDependencyManager.test-helpers.js";

describe("ProviderDependencyManager - Ready Providers", { concurrency: 1 }, () => {
  let manager: ProviderDependencyManager;
  let mockPrisma: MockPrismaClient;
  let mockRedis: MockRedis;
  let mockEventService: MockEventService;

  beforeEach(() => {
    mockPrisma = new MockPrismaClient();
    mockRedis = new MockRedis();
    mockEventService = new MockEventService();

    manager = new ProviderDependencyManager({
      prisma: mockPrisma as any,
      redis: mockRedis as any,
      eventService: mockEventService as any,
    });
  });

  it("should return ready providers with no dependencies", async () => {
    const providers: ProviderId[] = ["twitter", "facebook"];
    const dependencies: ProviderDependency[] = [];

    const graphResult = await manager.buildDependencyGraph(providers, dependencies);
    assert.equal(graphResult.ok, true);

    if (graphResult.ok) {
      const graphId = "test-graph-ready-1";
      (manager as any).activeDependencyGraphs.set(graphId, graphResult.value);

      const context = {
        planId: "plan-1",
        conflictResolution: "BEST_EFFORT" as ConflictResolutionStrategy,
        globalRetryPolicy: createMockRetryPolicy(),
        timeout: 30000,
        startedAt: new Date(),
      };

      const readyResult = await manager.getReadyProviders(graphId, context);

      assert.equal(readyResult.ok, true);
      if (readyResult.ok) {
        assert.equal(readyResult.value.length, 2);
        assert.ok(readyResult.value.includes("twitter"));
        assert.ok(readyResult.value.includes("facebook"));
      }
    }
  });

  it("should exclude running and completed providers", async () => {
    const providers: ProviderId[] = ["twitter", "facebook", "instagram"];
    const dependencies: ProviderDependency[] = [];

    const graphResult = await manager.buildDependencyGraph(providers, dependencies);
    assert.equal(graphResult.ok, true);

    if (graphResult.ok) {
      const graphId = "test-graph-ready-2";
      (manager as any).activeDependencyGraphs.set(graphId, graphResult.value);

      // Mark twitter as running and facebook as completed
      await manager.updateProviderStatus(graphId, "twitter", "running");
      await manager.updateProviderStatus(
        graphId,
        "facebook",
        "completed",
        createMockPublishResult("facebook", "success")
      );

      const context = {
        planId: "plan-1",
        conflictResolution: "BEST_EFFORT" as ConflictResolutionStrategy,
        globalRetryPolicy: createMockRetryPolicy(),
        timeout: 30000,
        startedAt: new Date(),
      };

      const readyResult = await manager.getReadyProviders(graphId, context);

      assert.equal(readyResult.ok, true);
      if (readyResult.ok) {
        assert.equal(readyResult.value.length, 1);
        assert.equal(readyResult.value[0], "instagram");
      }
    }
  });

  it("should return empty array when graph not found", async () => {
    const context = {
      planId: "plan-1",
      conflictResolution: "BEST_EFFORT" as ConflictResolutionStrategy,
      globalRetryPolicy: createMockRetryPolicy(),
      timeout: 30000,
      startedAt: new Date(),
    };

    const result = await manager.getReadyProviders("non-existent", context);

    assert.equal(result.ok, false);
  });
});

describe("ProviderDependencyManager - Deadlock Detection", { concurrency: 1 }, () => {
  let manager: ProviderDependencyManager;
  let mockPrisma: MockPrismaClient;
  let mockRedis: MockRedis;
  let mockEventService: MockEventService;

  beforeEach(() => {
    mockPrisma = new MockPrismaClient();
    mockRedis = new MockRedis();
    mockEventService = new MockEventService();

    manager = new ProviderDependencyManager({
      prisma: mockPrisma as any,
      redis: mockRedis as any,
      eventService: mockEventService as any,
    });
  });

  it("should detect deadlock with pending nodes but no ready nodes", async () => {
    const providers: ProviderId[] = ["twitter", "facebook"];
    const dependencies: ProviderDependency[] = [
      {
        providerId: "facebook",
        dependsOn: ["twitter"],
      },
    ];

    const graphResult = await manager.buildDependencyGraph(providers, dependencies);
    assert.equal(graphResult.ok, true);

    if (graphResult.ok) {
      const graphId = "test-deadlock-1";
      const graph = graphResult.value;
      (manager as any).activeDependencyGraphs.set(graphId, graph);

      // Manually create deadlock: mark twitter as failed, facebook remains pending
      graph.nodes.get("twitter")!.status = "failed";
      graph.readyNodes.clear();

      const hasDeadlock = await manager.detectDeadlock(graphId);
      assert.equal(hasDeadlock, true);
    }
  });

  it("should not detect deadlock when providers are ready", async () => {
    const providers: ProviderId[] = ["twitter", "facebook"];
    const dependencies: ProviderDependency[] = [];

    const graphResult = await manager.buildDependencyGraph(providers, dependencies);
    assert.equal(graphResult.ok, true);

    if (graphResult.ok) {
      const graphId = "test-deadlock-2";
      (manager as any).activeDependencyGraphs.set(graphId, graphResult.value);

      const hasDeadlock = await manager.detectDeadlock(graphId);
      assert.equal(hasDeadlock, false);
    }
  });

  it("should not detect deadlock when all completed", async () => {
    const providers: ProviderId[] = ["twitter", "facebook"];
    const dependencies: ProviderDependency[] = [];

    const graphResult = await manager.buildDependencyGraph(providers, dependencies);
    assert.equal(graphResult.ok, true);

    if (graphResult.ok) {
      const graphId = "test-deadlock-3";
      const graph = graphResult.value;
      (manager as any).activeDependencyGraphs.set(graphId, graph);

      // Mark all as completed
      graph.nodes.get("twitter")!.status = "completed";
      graph.nodes.get("facebook")!.status = "completed";
      graph.readyNodes.clear();

      const hasDeadlock = await manager.detectDeadlock(graphId);
      assert.equal(hasDeadlock, false);
    }
  });

  it("should return false for non-existent graph", async () => {
    const hasDeadlock = await manager.detectDeadlock("non-existent");
    assert.equal(hasDeadlock, false);
  });
});

describe("ProviderDependencyManager - Deadlock Resolution", { concurrency: 1 }, () => {
  let manager: ProviderDependencyManager;
  let mockPrisma: MockPrismaClient;
  let mockRedis: MockRedis;
  let mockEventService: MockEventService;

  beforeEach(() => {
    mockPrisma = new MockPrismaClient();
    mockRedis = new MockRedis();
    mockEventService = new MockEventService();

    manager = new ProviderDependencyManager({
      prisma: mockPrisma as any,
      redis: mockRedis as any,
      eventService: mockEventService as any,
    });
  });

  afterEach(() => {
    mockRedis.clear();
  });

  it("should resolve deadlock with BEST_EFFORT strategy", async () => {
    const providers: ProviderId[] = ["twitter", "facebook", "instagram"];
    const dependencies: ProviderDependency[] = [
      { providerId: "facebook", dependsOn: ["twitter"] },
      { providerId: "instagram", dependsOn: ["twitter"] },
    ];

    const graphResult = await manager.buildDependencyGraph(providers, dependencies);
    assert.equal(graphResult.ok, true);

    if (graphResult.ok) {
      const graphId = "test-resolve-1";
      const graph = graphResult.value;
      (manager as any).activeDependencyGraphs.set(graphId, graph);

      // Create deadlock: twitter failed, dependents blocked
      graph.nodes.get("twitter")!.status = "failed";
      graph.nodes.get("facebook")!.status = "blocked";
      graph.nodes.get("instagram")!.status = "blocked";
      graph.readyNodes.clear();

      const context = {
        planId: "plan-1",
        conflictResolution: "BEST_EFFORT" as ConflictResolutionStrategy,
        globalRetryPolicy: createMockRetryPolicy(),
        timeout: 30000,
        startedAt: new Date(),
      };

      const resolutionResult = await manager.resolveDeadlock(graphId, context);

      assert.equal(resolutionResult.ok, true);
      if (resolutionResult.ok) {
        assert.ok(resolutionResult.value.length > 0);
        assert.ok(resolutionResult.value.some((a) => a.includes("Bypassed")));

        // Check that blocked providers are now ready
        const updatedGraph = (manager as any).activeDependencyGraphs.get(graphId);
        assert.ok(updatedGraph.readyNodes.size > 0);
      }
    }
  });

  it("should resolve deadlock with FAIL_FAST strategy", async () => {
    const providers: ProviderId[] = ["twitter", "facebook", "instagram"];
    const dependencies: ProviderDependency[] = [
      { providerId: "facebook", dependsOn: ["twitter"] },
      { providerId: "instagram", dependsOn: ["twitter"] },
    ];

    const graphResult = await manager.buildDependencyGraph(providers, dependencies);
    assert.equal(graphResult.ok, true);

    if (graphResult.ok) {
      const graphId = "test-resolve-2";
      const graph = graphResult.value;
      (manager as any).activeDependencyGraphs.set(graphId, graph);

      graph.nodes.get("twitter")!.status = "failed";
      graph.nodes.get("facebook")!.status = "blocked";
      graph.nodes.get("instagram")!.status = "blocked";
      graph.readyNodes.clear();

      const context = {
        planId: "plan-1",
        conflictResolution: "FAIL_FAST" as ConflictResolutionStrategy,
        globalRetryPolicy: createMockRetryPolicy(),
        timeout: 30000,
        startedAt: new Date(),
      };

      const resolutionResult = await manager.resolveDeadlock(graphId, context);

      assert.equal(resolutionResult.ok, true);
      if (resolutionResult.ok) {
        assert.ok(resolutionResult.value.some((a) => a.includes("Failed dependent providers")));

        // Check that blocked providers are now failed
        const updatedGraph = (manager as any).activeDependencyGraphs.get(graphId);
        assert.equal(updatedGraph.nodes.get("facebook")!.status, "failed");
        assert.equal(updatedGraph.nodes.get("instagram")!.status, "failed");
      }
    }
  });

  it("should resolve deadlock with CONTINUE_ON_ERROR strategy", async () => {
    const providers: ProviderId[] = ["twitter", "facebook"];
    const dependencies: ProviderDependency[] = [{ providerId: "facebook", dependsOn: ["twitter"] }];

    const graphResult = await manager.buildDependencyGraph(providers, dependencies);
    assert.equal(graphResult.ok, true);

    if (graphResult.ok) {
      const graphId = "test-resolve-3";
      const graph = graphResult.value;
      (manager as any).activeDependencyGraphs.set(graphId, graph);

      graph.nodes.get("twitter")!.status = "failed";
      graph.nodes.get("facebook")!.status = "blocked";
      graph.readyNodes.clear();

      const context = {
        planId: "plan-1",
        conflictResolution: "CONTINUE_ON_ERROR" as ConflictResolutionStrategy,
        globalRetryPolicy: createMockRetryPolicy(),
        timeout: 30000,
        startedAt: new Date(),
      };

      const resolutionResult = await manager.resolveDeadlock(graphId, context);

      assert.equal(resolutionResult.ok, true);
      if (resolutionResult.ok) {
        assert.ok(resolutionResult.value.some((a) => a.includes("Continued execution")));
      }
    }
  });

  it("should return error when graph not found", async () => {
    const context = {
      planId: "plan-1",
      conflictResolution: "BEST_EFFORT" as ConflictResolutionStrategy,
      globalRetryPolicy: createMockRetryPolicy(),
      timeout: 30000,
      startedAt: new Date(),
    };

    const result = await manager.resolveDeadlock("non-existent", context);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error.message, /Dependency graph not found/);
    }
  });
});

describe("ProviderDependencyManager - Graph Statistics", { concurrency: 1 }, () => {
  let manager: ProviderDependencyManager;
  let mockPrisma: MockPrismaClient;
  let mockRedis: MockRedis;
  let mockEventService: MockEventService;

  beforeEach(() => {
    mockPrisma = new MockPrismaClient();
    mockRedis = new MockRedis();
    mockEventService = new MockEventService();

    manager = new ProviderDependencyManager({
      prisma: mockPrisma as any,
      redis: mockRedis as any,
      eventService: mockEventService as any,
    });
  });

  it("should return statistics for active graph", async () => {
    const providers: ProviderId[] = ["twitter", "facebook", "instagram"];
    const dependencies: ProviderDependency[] = [{ providerId: "facebook", dependsOn: ["twitter"] }];

    const graphResult = await manager.buildDependencyGraph(providers, dependencies);
    assert.equal(graphResult.ok, true);

    if (graphResult.ok) {
      const graphId = "test-stats-1";
      (manager as any).activeDependencyGraphs.set(graphId, graphResult.value);

      const stats = await manager.getGraphStatistics(graphId);

      assert.equal(stats.totalProviders, 3);
      assert.equal(stats.completedProviders, 0);
      assert.equal(stats.failedProviders, 0);
      assert.equal(stats.pendingProviders, 3);
      assert.equal(stats.readyProviders, 2); // twitter and instagram
      assert.equal(stats.blockedProviders, 0);
    }
  });

  it("should track completion progress", async () => {
    const providers: ProviderId[] = ["twitter", "facebook"];
    const dependencies: ProviderDependency[] = [];

    const graphResult = await manager.buildDependencyGraph(providers, dependencies);
    assert.equal(graphResult.ok, true);

    if (graphResult.ok) {
      const graphId = "test-stats-2";
      (manager as any).activeDependencyGraphs.set(graphId, graphResult.value);

      await manager.updateProviderStatus(
        graphId,
        "twitter",
        "completed",
        createMockPublishResult("twitter", "success")
      );

      const stats = await manager.getGraphStatistics(graphId);

      assert.equal(stats.completedProviders, 1);
      assert.equal(stats.pendingProviders, 1);
    }
  });

  it("should return zero statistics for non-existent graph", async () => {
    const stats = await manager.getGraphStatistics("non-existent");

    assert.equal(stats.totalProviders, 0);
    assert.equal(stats.completedProviders, 0);
    assert.equal(stats.failedProviders, 0);
    assert.equal(stats.estimatedCompletion, null);
  });
});

describe("ProviderDependencyManager - Graph Caching", { concurrency: 1 }, () => {
  let manager: ProviderDependencyManager;
  let mockPrisma: MockPrismaClient;
  let mockRedis: MockRedis;
  let mockEventService: MockEventService;

  beforeEach(() => {
    mockPrisma = new MockPrismaClient();
    mockRedis = new MockRedis();
    mockEventService = new MockEventService();

    manager = new ProviderDependencyManager({
      prisma: mockPrisma as any,
      redis: mockRedis as any,
      eventService: mockEventService as any,
    });
  });

  afterEach(() => {
    mockRedis.clear();
  });

  it("should cache graph in Redis on status update", async () => {
    const providers: ProviderId[] = ["twitter"];
    const dependencies: ProviderDependency[] = [];

    const graphResult = await manager.buildDependencyGraph(providers, dependencies);
    assert.equal(graphResult.ok, true);

    if (graphResult.ok) {
      const graphId = "test-cache-1";
      (manager as any).activeDependencyGraphs.set(graphId, graphResult.value);

      await manager.updateProviderStatus(graphId, "twitter", "running");

      const cached = await mockRedis.get(`dependency:graph:${graphId}`);
      assert.ok(cached !== null);

      const parsedCache = JSON.parse(cached!);
      assert.ok(parsedCache.nodes);
      assert.ok(parsedCache.executionOrder);
    }
  });
});
