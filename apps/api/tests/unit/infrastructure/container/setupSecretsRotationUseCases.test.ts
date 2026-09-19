/**
 * @file setupSecretsRotationUseCases.test.ts
 * @description Smoke contract test for the secrets-rotation status DI setup.
 *              Verifies that the function registers the expected TOKENs without
 *              throwing. It does not test the full instantiation chain (that
 *              belongs to each adapter/use case's own tests and the integration
 *              tests).
 * @layer infrastructure
 */

import { describe, it, expect, vi } from "vitest";
import { setupSecretsRotationUseCases } from "../../../../src/infrastructure/container/setupSecretsRotationUseCases.js";
import { TOKENS } from "../../../../src/infrastructure/container/types.js";
import type { Container } from "../../../../src/infrastructure/container/Container.js";

describe("setupSecretsRotationUseCases", () => {
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

    expect(() => setupSecretsRotationUseCases(mockContainer)).not.toThrow();

    expect(registered).toContain(TOKENS.SecretRotationLogReadRepository);
    expect(registered).toContain(TOKENS.GetSecretRotationStatusQuery);
  });
});
