/**
 * @file setupExternalNotificationUseCases.test.ts
 * @description Smoke contract test del setup DI de external notifications.
 *   Verifica que la función registra los TOKENs esperados sin throw. NO testea
 *   la cadena completa de instantiation (eso es responsabilidad de los tests
 *   de cada adapter/use case individual + integration tests).
 * @layer infrastructure
 */

import { describe, it, expect, vi } from "vitest";
import { setupExternalNotificationUseCases } from "../../../../src/infrastructure/container/setupExternalNotificationUseCases.js";
import { TOKENS } from "../../../../src/infrastructure/container/types.js";
import type { Container } from "../../../../src/infrastructure/container/Container.js";

describe("setupExternalNotificationUseCases", () => {
  it("registers all expected tokens without throwing", () => {
    const registered: symbol[] = [];

    const mockContainer = {
      register: vi.fn((token: symbol) => {
        registered.push(token);
      }),
      resolve: vi.fn(() => ({})),
    } as unknown as Container;

    expect(() => setupExternalNotificationUseCases(mockContainer)).not.toThrow();

    // Tokens centrales que este setup debe registrar
    expect(registered).toContain(TOKENS.ExternalNotificationConfigRepository);
    expect(registered).toContain(TOKENS.ExternalNotifierPort);
    expect(registered).toContain(TOKENS.ExternalNotificationDispatcher);
    expect(registered).toContain(TOKENS.ConfigureExternalNotificationUseCase);
    expect(registered).toContain(TOKENS.ListExternalNotificationsQuery);
    expect(registered).toContain(TOKENS.DeleteExternalNotificationUseCase);
    expect(registered).toContain(TOKENS.TestExternalNotificationUseCase);
  });
});
