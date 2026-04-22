import { describe, it, beforeEach, afterEach, afterAll, expect } from "vitest";
import { ProviderCoordinator } from "../../src/orchestration/ProviderCoordinator.js";
import type { PrismaClient } from "@infra/prisma";
import type Redis from "ioredis";
import type { EventService } from "../../src/events/EventService.js";
import type { ProviderId } from "../../src/providers/providerAdapter.interface.js";
import { providerRegistry } from "../../src/providers/providerRegistry.js";
import {
  createMockPrisma,
  createMockRedis,
  createMockEventService,
  createMockProviderAdapter,
  createMockCanonicalPost,
  createMockScheduler,
  mockProviders,
  mockAdapters,
  setupMockProviders,
} from "./ProviderCoordinator.test-helpers.js";

const originalGetAllProviders = providerRegistry.getAllProviders.bind(providerRegistry);
const originalGetAdapter = providerRegistry.getAdapter.bind(providerRegistry);

providerRegistry.getAllProviders = () => Array.from(mockProviders.values());
providerRegistry.getAdapter = ((id: string) => mockAdapters.get(id as ProviderId)) as any;

describe("ProviderCoordinator - init and selection", () => {
  afterAll(() => {
    providerRegistry.getAllProviders = originalGetAllProviders;
    providerRegistry.getAdapter = originalGetAdapter;
  });

  // ============================================================================
  // Initialization Tests
  // ============================================================================

  describe("ProviderCoordinator - Initialization", () => {
    let coordinator: ProviderCoordinator;
    let mockPrisma: PrismaClient;
    let mockRedis: Redis;
    let mockEventService: EventService;

    beforeEach(() => {
      mockPrisma = createMockPrisma();
      mockRedis = createMockRedis();
      mockEventService = createMockEventService();

      setupMockProviders([
        { id: "x" as ProviderId, adapter: createMockProviderAdapter("x" as ProviderId) },
        {
          id: "instagram" as ProviderId,
          adapter: createMockProviderAdapter("instagram" as ProviderId),
        },
      ]);

      coordinator = new ProviderCoordinator({
        prisma: mockPrisma,
        redis: mockRedis,
        eventService: mockEventService,
        scheduler: createMockScheduler(),
      });
    });

    afterEach(async () => {
      await (coordinator as any).scheduler?.shutdownAll();
    });

    it("should initialize with provider nodes loaded", async () => {
      await coordinator.initialize();

      const providerNodes = (coordinator as any).providerNodes;
      expect(providerNodes.size).toBe(2);
      expect(providerNodes.has("x" as ProviderId)).toBeTruthy();
      expect(providerNodes.has("instagram" as ProviderId)).toBeTruthy();
    });

    it("should set up default configuration for each provider", async () => {
      await coordinator.initialize();

      const providerNodes = (coordinator as any).providerNodes;
      const xNode = providerNodes.get("x" as ProviderId);

      expect(xNode).toBeTruthy();
      expect(xNode.status).toBe("active");
      expect(xNode.configuration.priority).toBe(1);
      expect(xNode.configuration.maxConcurrentRequests).toBe(10);
      expect(xNode.configuration.circuitBreaker.enabled).toBeTruthy();
    });

    it("should initialize load balancing strategy", async () => {
      await coordinator.initialize();

      const loadBalancer = (coordinator as any).loadBalancer;
      expect(loadBalancer.type).toBe("weighted");
      expect(loadBalancer.enabled).toBe(true);
      expect(loadBalancer.parameters.responseTimeWeight).toBeTruthy();
    });

    it("should not reinitialize if already initialized", async () => {
      await coordinator.initialize();
      const providerNodesSize = (coordinator as any).providerNodes.size;

      await coordinator.initialize();
      expect((coordinator as any).providerNodes.size).toBe(providerNodesSize);
    });

    it("should register event handlers on initialization", async () => {
      await coordinator.initialize();

      const healthHandler = (mockEventService as any).getHandler("PROVIDER_HEALTH_CHANGED");
      const errorHandler = (mockEventService as any).getHandler("PROVIDER_ERROR");

      expect(healthHandler).toBeTruthy();
      expect(errorHandler).toBeTruthy();
    });
  });

  // ============================================================================
  // Provider Selection Tests
  // ============================================================================

  describe("ProviderCoordinator - Provider Selection", () => {
    let coordinator: ProviderCoordinator;
    let mockPrisma: PrismaClient;
    let mockRedis: Redis;
    let mockEventService: EventService;

    beforeEach(async () => {
      mockPrisma = createMockPrisma();
      mockRedis = createMockRedis();
      mockEventService = createMockEventService();

      setupMockProviders([
        {
          id: "x" as ProviderId,
          adapter: createMockProviderAdapter("x" as ProviderId, { latency: 100 }),
        },
        {
          id: "instagram" as ProviderId,
          adapter: createMockProviderAdapter("instagram" as ProviderId, { latency: 200 }),
        },
        {
          id: "facebook" as ProviderId,
          adapter: createMockProviderAdapter("facebook" as ProviderId, { latency: 150 }),
        },
      ]);

      coordinator = new ProviderCoordinator({
        prisma: mockPrisma,
        redis: mockRedis,
        eventService: mockEventService,
        scheduler: createMockScheduler(),
      });

      await coordinator.initialize();
    });

    afterEach(async () => {
      await (coordinator as any).scheduler?.shutdownAll();
    });

    it("should select provider with highest score", async () => {
      const content = createMockCanonicalPost();
      const providers = ["x", "instagram", "facebook"] as ProviderId[];

      const result = await coordinator.selectOptimalProvider(providers, content);

      expect(result.ok).toBeTruthy();
      expect(result.value).toBeTruthy();
      expect(providers.includes(result.value.selectedProvider)).toBeTruthy();
    });

    it("should exclude inactive providers from selection", async () => {
      const content = createMockCanonicalPost();
      const providerNodes = (coordinator as any).providerNodes;

      const xNode = providerNodes.get("x" as ProviderId);
      xNode.status = "inactive";

      const result = await coordinator.selectOptimalProvider(["x"] as ProviderId[], content);

      expect(result.ok).toBe(false);
      expect(result.error?.message.includes("No valid providers")).toBeTruthy();
    });

    it("should exclude providers in excludeProviders criteria", async () => {
      const content = createMockCanonicalPost();
      const providers = ["x", "instagram", "facebook"] as ProviderId[];

      const result = await coordinator.selectOptimalProvider(providers, content, {
        excludeProviders: ["x", "instagram"] as ProviderId[],
      });

      expect(result.ok).toBeTruthy();
      expect(result.value?.selectedProvider).toBe("facebook");
    });

    it("should return alternative providers in routing decision", async () => {
      const content = createMockCanonicalPost();
      const providers = ["x", "instagram", "facebook"] as ProviderId[];

      const result = await coordinator.selectOptimalProvider(providers, content);

      expect(result.ok).toBeTruthy();
      expect(result.value?.alternativeProviders).toBeTruthy();
      expect(result.value!.alternativeProviders.length > 0).toBeTruthy();
    });

    it("should include reasoning in routing decision", async () => {
      const content = createMockCanonicalPost();

      const result = await coordinator.selectOptimalProvider(["x"] as ProviderId[], content);

      expect(result.ok).toBeTruthy();
      expect(result.value?.reasoning).toBeTruthy();
      expect(result.value!.reasoning.length > 0).toBeTruthy();
    });
  });
}); // end outer describe
