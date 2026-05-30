/**
 * @file setup.ts
 * @description Composes the DI container from sub-setup modules: repositories,
 *              use cases, and services. Entry point for container initialization.
 * @layer infrastructure
 */
import type { PrismaClient } from "@infra/prisma";
import { tenantGuardExtension } from "@infra/prisma/extensions/tenantGuard.js";
import { Container, getContainer } from "./Container.js";
import { TOKENS } from "./types.js";
import { InMemoryEventDispatcher, type EventDispatcher } from "@core/domain/index.js";
import { ComposedEventDispatcher } from "../integration-events/ComposedEventDispatcher.js";
import type { IntegrationEventPublisher } from "../integration-events/IntegrationEventPort.js";
import { setupRepositories } from "./setupRepositories.js";
import { setupUseCases } from "./setupUseCases.js";
import { setupBillingUseCases } from "./setupBillingUseCases.js";
import { setupServices } from "./setupServices.js";
import { setupAgentOrchestration } from "./setupAgentOrchestration.js";
import { getTenantContext, getSystemContext } from "../../security/tenantContext.js";
import type { ApiMetrics } from "../../metrics/apiMetrics.js";

/**
 * Container setup options
 */
export interface ContainerSetupOptions {
  /** Prisma client instance */
  prisma: PrismaClient;
  /** Prometheus-backed metrics collector (built in the bootstrap, owns
   * `client.register` so consumers don't double-instantiate). Required —
   * the BF adapter and any other infra wiring that emits metrics MUST
   * resolve this instance from the container, not construct an empty stub. */
  apiMetrics: ApiMetrics;
  /** Optional custom event dispatcher */
  eventDispatcher?: EventDispatcher;
  /** Optional integration event publisher for cross-process events */
  integrationEventPublisher?: IntegrationEventPublisher;
}

/**
 * Configure the container with all services
 *
 * @param options - Setup options
 * @returns Configured container
 *
 * @example
 * import { prisma } from "@infra/prisma";
 * import { setupContainer } from "./infrastructure/container/setup.js";
 *
 * const container = setupContainer({ prisma });
 * const postRepo = container.resolve<PostRepository>(TOKENS.PostRepository);
 */
export function setupContainer(options: ContainerSetupOptions): Container {
  const container = getContainer();

  // Wrap the Prisma client with the tenant guard extension. Every
  // consumer that resolves PrismaClient from the container gets the
  // guarded instance; scripts/migrations that import `prisma` directly
  // from `@infra/prisma` get the unwrapped client. The extension reads
  // tenant + system context via the AsyncLocalStorage holders in
  // `apps/api/src/security/tenantContext.ts` — see
  // `docs/security/MULTI_TENANT_GUARDS.md`.
  const guardedPrisma = options.prisma.$extends(
    tenantGuardExtension({ getTenantContext, getSystemContext })
  ) as unknown as PrismaClient;
  container.registerInstance(TOKENS.PrismaClient, guardedPrisma);

  // Register the Prometheus-backed ApiMetrics built in the bootstrap. Single
  // instance, shared across every consumer that emits metrics (BF adapter,
  // file upload validator, thread analytics, rate limiters, …).
  container.registerInstance(TOKENS.ApiMetrics, options.apiMetrics);

  // Register Event Dispatcher
  container.register<EventDispatcher>(
    TOKENS.EventDispatcher,
    () => {
      if (options.eventDispatcher) return options.eventDispatcher;
      const inMemory = new InMemoryEventDispatcher();
      if (options.integrationEventPublisher) {
        return new ComposedEventDispatcher(inMemory, options.integrationEventPublisher);
      }
      return inMemory;
    },
    true
  );

  // Register all repositories
  setupRepositories(container);

  // Register all use cases
  setupUseCases(container);
  setupBillingUseCases(container);

  // Register all services
  setupServices(container, options.integrationEventPublisher);
  setupAgentOrchestration(container);

  return container;
}

/**
 * Create a test container with mock services
 *
 * @param overrides - Service overrides for testing
 * @returns Test container
 */
export function createTestContainer(overrides: Partial<Record<symbol, unknown>> = {}): Container {
  const container = new Container();

  // Register defaults
  container.register(TOKENS.EventDispatcher, () => new InMemoryEventDispatcher(), true);

  // Apply overrides
  for (const [token, instance] of Object.entries(overrides)) {
    container.registerInstance(Symbol.for(token), instance);
  }

  // Apply symbol overrides
  for (const token of Object.getOwnPropertySymbols(overrides)) {
    const instance = overrides[token as keyof typeof overrides];
    if (instance !== undefined) {
      container.registerInstance(token as symbol, instance);
    }
  }

  return container;
}
