/**
 * Infrastructure Layer - Container Setup
 *
 * Composes the DI container from sub-setup modules:
 * - setupRepositories (repository adapters)
 * - setupUseCases     (application use cases)
 * - setupServices     (business services and infrastructure)
 *
 * @module infrastructure/container/setup
 */
import type { PrismaClient } from "@infra/prisma";
import { Container, getContainer } from "./Container.js";
import { TOKENS } from "./types.js";
import { InMemoryEventDispatcher, type EventDispatcher } from "../../domain/index.js";
import { ComposedEventDispatcher } from "../integration-events/ComposedEventDispatcher.js";
import type { IntegrationEventPublisher } from "../integration-events/IntegrationEventPort.js";
import { setupRepositories } from "./setupRepositories.js";
import { setupUseCases } from "./setupUseCases.js";
import { setupBillingUseCases } from "./setupBillingUseCases.js";
import { setupServices } from "./setupServices.js";

/**
 * Container setup options
 */
export interface ContainerSetupOptions {
  /** Prisma client instance */
  prisma: PrismaClient;
  /** Optional custom event dispatcher */
  eventDispatcher?: EventDispatcher;
  /** Optional integration event publisher for cross-process events (P2-2) */
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

  // Register Prisma client
  container.registerInstance(TOKENS.PrismaClient, options.prisma);

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
