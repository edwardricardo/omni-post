/**
 * @file setupWebhookAdminUseCases.test.ts
 * @description Smoke contract test for the webhook-admin DI setup. Verifies
 *              the function registers the expected TOKENs without throwing.
 * @layer infrastructure
 */

import { describe, it, expect, vi } from "vitest";
import { setupWebhookAdminUseCases } from "../../../../src/infrastructure/container/setupWebhookAdminUseCases.js";
import { TOKENS } from "../../../../src/infrastructure/container/types.js";
import type { Container } from "../../../../src/infrastructure/container/Container.js";

describe("setupWebhookAdminUseCases", () => {
  it("registers all expected tokens without throwing", () => {
    const registered: symbol[] = [];

    const mockContainer = {
      registerInstance: vi.fn((token: symbol) => {
        registered.push(token);
      }),
      register: vi.fn((token: symbol) => {
        registered.push(token);
      }),
      resolve: vi.fn(() => ({})),
    } as unknown as Container;

    expect(() => setupWebhookAdminUseCases(mockContainer)).not.toThrow();

    expect(registered).toContain(TOKENS.WebhookSubscriptionRotationRepository);
    expect(registered).toContain(TOKENS.RotateWebhookSecretKeyUseCase);
  });
});
