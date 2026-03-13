import { describe, it, beforeEach, afterEach, expect } from "vitest";
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

describe("ProviderDependencyManager - Ready Providers", () => {
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
    expect(graphResult.ok).toBe(true);

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

      expect(readyResult.ok).toBe(true);
      if (readyResult.ok) {
        expect(readyResult.value.length).toBe(2);
        expect(readyResult.value.includes("twitter")).toBeTruthy();
        expect(readyResult.value.includes("facebook")).toBeTruthy();
      }
    }
  });

  it("should exclude running and completed providers", async () => {
    const providers: ProviderId[] = ["twitter", "facebook", "instagram"];
    const dependencies: ProviderDependency[] = [];

    const graphResult = await manager.buildDependencyGraph(providers, dependencies);
    expect(graphResult.ok).toBe(true);

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

      expect(readyResult.ok).toBe(true);
      if (readyResult.ok) {
        expect(readyResult.value.length).toBe(1);
        expect(readyResult.value[0]).toBe("instagram");
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

    expect(result.ok).toBe(false);
  });
});

describe("ProviderDependencyManager - Deadlock Detection", () => {
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
    expect(graphResult.ok).toBe(true);

    if (graphResult.ok) {
      const graphId = "test-deadlock-1";
      const graph = graphResult.value;
      (manager as any).activeDependencyGraphs.set(graphId, graph);

      // Manually create deadlock: mark twitter as failed, facebook remains pending
      graph.nodes.get("twitter")!.status = "failed";
      graph.readyNodes.clear();

      const hasDeadlock = await manager.detectDeadlock(graphId);
      expect(hasDeadlock).toBe(true);
    }
  });

  it("should not detect deadlock when providers are ready", async () => {
    const providers: ProviderId[] = ["twitter", "facebook"];
    const dependencies: ProviderDependency[] = [];

    const graphResult = await manager.buildDependencyGraph(providers, dependencies);
    expect(graphResult.ok).toBe(true);

    if (graphResult.ok) {
      const graphId = "test-deadlock-2";
      (manager as any).activeDependencyGraphs.set(graphId, graphResult.value);

      const hasDeadlock = await manager.detectDeadlock(graphId);
      expect(hasDeadlock).toBe(false);
    }
  });

  it("should not detect deadlock when all completed", async () => {
    const providers: ProviderId[] = ["twitter", "facebook"];
    const dependencies: ProviderDependency[] = [];

    const graphResult = await manager.buildDependencyGraph(providers, dependencies);
    expect(graphResult.ok).toBe(true);

    if (graphResult.ok) {
      const graphId = "test-deadlock-3";
      const graph = graphResult.value;
      (manager as any).activeDependencyGraphs.set(graphId, graph);

      // Mark all as completed
      graph.nodes.get("twitter")!.status = "completed";
      graph.nodes.get("facebook")!.status = "completed";
      graph.readyNodes.clear();

      const hasDeadlock = await manager.detectDeadlock(graphId);
      expect(hasDeadlock).toBe(false);
    }
  });

  it("should return false for non-existent graph", async () => {
    const hasDeadlock = await manager.detectDeadlock("non-existent");
    expect(hasDeadlock).toBe(false);
  });
});

describe("ProviderDependencyManager - Deadlock Resolution", () => {
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
    expect(graphResult.ok).toBe(true);

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

      expect(resolutionResult.ok).toBe(true);
      if (resolutionResult.ok) {
        expect(resolutionResult.value.length > 0).toBeTruthy();
        expect(resolutionResult.value.some((a) => a.includes("Bypassed"))).toBeTruthy();

        // Check that blocked providers are now ready
        const updatedGraph = (manager as any).activeDependencyGraphs.get(graphId);
        expect(updatedGraph.readyNodes.size > 0).toBeTruthy();
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
    expect(graphResult.ok).toBe(true);

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

      expect(resolutionResult.ok).toBe(true);
      if (resolutionResult.ok) {
        expect(
          resolutionResult.value.some((a) => a.includes("Failed dependent providers"))
        ).toBeTruthy();

        // Check that blocked providers are now failed
        const updatedGraph = (manager as any).activeDependencyGraphs.get(graphId);
        expect(updatedGraph.nodes.get("facebook")!.status).toBe("failed");
        expect(updatedGraph.nodes.get("instagram")!.status).toBe("failed");
      }
    }
  });

  it("should resolve deadlock with CONTINUE_ON_ERROR strategy", async () => {
    const providers: ProviderId[] = ["twitter", "facebook"];
    const dependencies: ProviderDependency[] = [{ providerId: "facebook", dependsOn: ["twitter"] }];

    const graphResult = await manager.buildDependencyGraph(providers, dependencies);
    expect(graphResult.ok).toBe(true);

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

      expect(resolutionResult.ok).toBe(true);
      if (resolutionResult.ok) {
        expect(resolutionResult.value.some((a) => a.includes("Continued execution"))).toBeTruthy();
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

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toMatch(/Dependency graph not found/);
    }
  });
});

describe("ProviderDependencyManager - Graph Statistics", () => {
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
    expect(graphResult.ok).toBe(true);

    if (graphResult.ok) {
      const graphId = "test-stats-1";
      (manager as any).activeDependencyGraphs.set(graphId, graphResult.value);

      const stats = await manager.getGraphStatistics(graphId);

      expect(stats.totalProviders).toBe(3);
      expect(stats.completedProviders).toBe(0);
      expect(stats.failedProviders).toBe(0);
      expect(stats.pendingProviders).toBe(3);
      expect(stats.readyProviders).toBe(2); // twitter and instagram
      expect(stats.blockedProviders).toBe(0);
    }
  });

  it("should track completion progress", async () => {
    const providers: ProviderId[] = ["twitter", "facebook"];
    const dependencies: ProviderDependency[] = [];

    const graphResult = await manager.buildDependencyGraph(providers, dependencies);
    expect(graphResult.ok).toBe(true);

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

      expect(stats.completedProviders).toBe(1);
      expect(stats.pendingProviders).toBe(1);
    }
  });

  it("should return zero statistics for non-existent graph", async () => {
    const stats = await manager.getGraphStatistics("non-existent");

    expect(stats.totalProviders).toBe(0);
    expect(stats.completedProviders).toBe(0);
    expect(stats.failedProviders).toBe(0);
    expect(stats.estimatedCompletion).toBe(null);
  });
});

describe("ProviderDependencyManager - Graph Caching", () => {
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
    expect(graphResult.ok).toBe(true);

    if (graphResult.ok) {
      const graphId = "test-cache-1";
      (manager as any).activeDependencyGraphs.set(graphId, graphResult.value);

      await manager.updateProviderStatus(graphId, "twitter", "running");

      const cached = await mockRedis.get(`dependency:graph:${graphId}`);
      expect(cached !== null).toBeTruthy();

      const parsedCache = JSON.parse(cached!);
      expect(parsedCache.nodes).toBeTruthy();
      expect(parsedCache.executionOrder).toBeTruthy();
    }
  });
});
