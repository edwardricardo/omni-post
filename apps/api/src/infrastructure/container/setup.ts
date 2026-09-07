/**
 * @file setup.ts
 * @description Composes the DI container from sub-setup modules: repositories,
 *              use cases, and services. Entry point for container initialization.
 * @layer infrastructure
 */
import type { PrismaClient } from "@infra/prisma";
import { tenantGuardWithGucBindingExtension } from "@infra/prisma/extensions/tenantGucBinding.js";
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
import { ambientTenantContextProvider } from "../../security/tenantContext.js";
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

  // Wrap the Prisma client with the tenant guard (layer 1) and the request-scoped
  // GUC binding (layer 2). Every consumer that resolves PrismaClient from the
  // container gets the extended instance; scripts/migrations that import `prisma`
  // directly from `@infra/prisma` get the unwrapped client.
  //
  // ONE `$extends`, guard-then-bind inside it. Two chained extensions were the first
  // shape, and folding them is the fallback the design names for this class of trouble.
  // What triggered the fold, measured rather than inferred: under the unit-test runner
  // `@infra/prisma` resolves to `infra/prisma/src/vitest-entry.ts`, whose `prisma` export
  // is a deliberate no-op Proxy returning `async () => undefined` for EVERY `$`-prefixed
  // property. One `$extends` against it yields a Promise, so a second chained call throws
  // `$extends is not a function`. Module resolution is not the cause — the same alias map
  // already points `@infra/prisma/extensions` at source.
  //
  // Both halves read the SAME `ambientTenantContextProvider` object — the one
  // `getAmbientGucScope()` resolves a repository-opened transaction's scope from — so
  // layer 1's injected `where.accountId` and layer 2's policy GUC cannot drift apart:
  // one provider, not two literals that happen to agree. The client is passed in
  // because that is what the binding opens its batch transaction on.
  const guardedPrisma = options.prisma.$extends(
    tenantGuardWithGucBindingExtension(options.prisma, ambientTenantContextProvider)
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
