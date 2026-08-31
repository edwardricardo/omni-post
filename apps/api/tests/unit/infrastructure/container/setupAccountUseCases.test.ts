/**
 * @file setupAccountUseCases.test.ts
 * @description Smoke contract test del setup DI del ciclo de vida de Account.
 *   Verifica que la función registra los TOKENs esperados sin throw, que ambos
 *   use cases son singletons, y —lo que este change vuelve load-bearing— que la
 *   factory del soft delete resuelve la UnitOfWork compartida, mientras la del
 *   hard delete construye su PROPIA UnitOfWork dedicada (Serializable, con timeout
 *   explícito) a partir del PrismaClient: esa transacción es la que liga el GUC de
 *   RLS `app.account_id` y fija el aislamiento de la cascada, por lo que NO usa el
 *   token compartido de UnitOfWork. NO testea la cadena completa de instanciación
 *   (eso es de los tests de cada use case + los de integración).
 * @layer infrastructure
 */

import { describe, it, expect, vi } from "vitest";
import { setupAccountUseCases } from "../../../../src/infrastructure/container/setupAccountUseCases.js";
import { TOKENS } from "../../../../src/infrastructure/container/types.js";
import type { Container } from "../../../../src/infrastructure/container/Container.js";

type Factory = () => unknown;

function makeMockContainer() {
  const factories = new Map<symbol, Factory>();
  const singletons = new Map<symbol, boolean>();
  const registered: symbol[] = [];

  const container = {
    register: vi.fn((token: symbol, factory: Factory, singleton?: boolean) => {
      registered.push(token);
      factories.set(token, factory);
      singletons.set(token, singleton === true);
    }),
    resolve: vi.fn((_token: symbol) => ({})),
  } as unknown as Container;

  return { container, factories, singletons, registered };
}

/** Resolves one registered factory and returns the tokens it asked the container for. */
function tokensResolvedBy(
  container: Container,
  factories: Map<symbol, Factory>,
  token: symbol
): symbol[] {
  const factory = factories.get(token);
  expect(factory, `factory for ${String(token)} was never registered`).toBeDefined();

  const resolveSpy = container.resolve as unknown as ReturnType<typeof vi.fn>;
  resolveSpy.mockClear();
  factory?.();

  return resolveSpy.mock.calls.map((call) => call[0] as symbol);
}

describe("setupAccountUseCases", () => {
  it("registers both account lifecycle tokens without throwing", () => {
    const { container, registered } = makeMockContainer();

    expect(() => setupAccountUseCases(container)).not.toThrow();

    expect(registered).toContain(TOKENS.DeleteAccountUseCase);
    expect(registered).toContain(TOKENS.HardDeleteAccountUseCase);
  });

  it("registers both use cases as singletons because they are stateless", () => {
    const { container, singletons } = makeMockContainer();

    setupAccountUseCases(container);

    expect(singletons.get(TOKENS.DeleteAccountUseCase)).toBe(true);
    expect(singletons.get(TOKENS.HardDeleteAccountUseCase)).toBe(true);
  });

  it("gives the soft delete a UnitOfWork, because it is a mutating use case", () => {
    const { container, factories } = makeMockContainer();
    setupAccountUseCases(container);

    const resolved = tokensResolvedBy(container, factories, TOKENS.DeleteAccountUseCase);

    expect(resolved).toContain(TOKENS.AccountRepository);
    expect(resolved).toContain(TOKENS.UnitOfWork);
  });

  it("gives the hard delete its OWN Serializable Unit of Work built from the PrismaClient, not the shared one", () => {
    const { container, factories } = makeMockContainer();
    setupAccountUseCases(container);

    const resolved = tokensResolvedBy(container, factories, TOKENS.HardDeleteAccountUseCase);

    // The hard delete opens a DEDICATED Unit of Work (Serializable + sized timeout)
    // constructed here from the PrismaClient: that transaction is what binds the
    // `app.account_id` RLS GUC and pins the isolation for the whole cascade. It is
    // NOT the shared UnitOfWork (ReadCommitted, default timeout), so the shared
    // token is deliberately absent while the PrismaClient IS resolved.
    expect(resolved).toContain(TOKENS.AccountRepository);
    expect(resolved).toContain(TOKENS.PrismaClient);
    expect(resolved).not.toContain(TOKENS.UnitOfWork);
  });

  it("registers the restore use case as a singleton with a UnitOfWork (mutating, single-row)", () => {
    const { container, factories, registered, singletons } = makeMockContainer();
    setupAccountUseCases(container);

    expect(registered).toContain(TOKENS.RestoreAccountUseCase);
    expect(singletons.get(TOKENS.RestoreAccountUseCase)).toBe(true);

    const resolved = tokensResolvedBy(container, factories, TOKENS.RestoreAccountUseCase);
    expect(resolved).toContain(TOKENS.AccountRepository);
    expect(resolved).toContain(TOKENS.UnitOfWork);
  });
});
