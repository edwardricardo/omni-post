/**
 * @file setupSecretsRotationUseCases.test.ts
 * @description Smoke contract test del setup DI de secrets-rotation status.
 *              Verifica que la función registra los TOKENs esperados sin throw.
 *              No testea la cadena completa de instantiation (responsabilidad
 *              de los tests de cada adapter/use case y los integration tests).
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
