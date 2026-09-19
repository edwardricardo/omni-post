/**
 * @file setupExternalNotificationUseCases.test.ts
 * @description Smoke contract test for the external-notifications DI setup.
 *   Verifies that the function registers the expected TOKENs without throwing,
 *   and that the ConfigureExternalNotificationUseCase factory resolves the
 *   ProjectRepository (required for the project ownership check on the create
 *   path). It does NOT test the full instantiation chain (that belongs to each
 *   adapter/use case's own tests + the integration tests).
 * @layer infrastructure
 */

import { describe, it, expect, vi } from "vitest";
import { setupExternalNotificationUseCases } from "../../../../src/infrastructure/container/setupExternalNotificationUseCases.js";
import { TOKENS } from "../../../../src/infrastructure/container/types.js";
import type { Container } from "../../../../src/infrastructure/container/Container.js";

type Factory = () => unknown;

function makeMockContainer() {
  const factories = new Map<symbol, Factory>();
  const registered: symbol[] = [];
  const resolved: symbol[] = [];

  const container = {
    register: vi.fn((token: symbol, factory: Factory) => {
      registered.push(token);
      factories.set(token, factory);
    }),
    resolve: vi.fn((token: symbol) => {
      resolved.push(token);
      return {};
    }),
  } as unknown as Container;

  return { container, factories, registered, resolved };
}

describe("setupExternalNotificationUseCases", () => {
  it("registers all expected tokens without throwing", () => {
    const { container, registered } = makeMockContainer();

    expect(() => setupExternalNotificationUseCases(container)).not.toThrow();

    // Core tokens this setup must register
    expect(registered).toContain(TOKENS.ExternalNotificationConfigRepository);
    expect(registered).toContain(TOKENS.ExternalNotifierPort);
    expect(registered).toContain(TOKENS.ExternalNotificationDispatcher);
    expect(registered).toContain(TOKENS.ConfigureExternalNotificationUseCase);
    expect(registered).toContain(TOKENS.ListExternalNotificationsQuery);
    expect(registered).toContain(TOKENS.DeleteExternalNotificationUseCase);
    expect(registered).toContain(TOKENS.TestExternalNotificationUseCase);
  });

  it("wires ProjectRepository into the Configure use case factory (create-path ownership check)", () => {
    const { container, factories, resolved } = makeMockContainer();

    setupExternalNotificationUseCases(container);

    const configureFactory = factories.get(TOKENS.ConfigureExternalNotificationUseCase);
    expect(configureFactory).toBeDefined();

    // Invoke the factory: it must resolve ProjectRepository so the use case can
    // verify project ownership before persisting.
    configureFactory?.();

    expect(resolved).toContain(TOKENS.ProjectRepository);
    expect(resolved).toContain(TOKENS.ExternalNotificationConfigRepository);
    expect(resolved).toContain(TOKENS.UnitOfWork);
  });
});
