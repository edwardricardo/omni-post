/**
 * @file setupProjectUseCases.test.ts
 * @description Smoke contract test for the Project lifecycle DI setup. Verifies
 *   that the function registers the soft-delete and hard-delete TOKENS without
 *   throwing, that the use cases are singletons, and the two Unit of Work
 *   contracts: the hard delete builds its OWN dedicated UnitOfWork (Serializable,
 *   explicit timeout) from the PrismaClient rather than resolving the shared
 *   UnitOfWork token — that transaction is what binds the `app.account_id` RLS
 *   GUC and pins the isolation level for the whole cascade — while the soft
 *   delete resolves the SHARED UnitOfWork, because a single-row UPDATE has no
 *   snapshot for Serializable to protect. It does NOT test the full
 *   instantiation chain (that belongs to the use case's own tests plus the
 *   integration suite).
 * @layer infrastructure
 */

import { describe, it, expect, vi } from "vitest";
import { setupProjectUseCases } from "../../../../src/infrastructure/container/setupProjectUseCases.js";
import { TOKENS } from "../../../../src/infrastructure/container/types.js";
import type { Container } from "../../../../src/infrastructure/container/Container.js";
import {
  HARD_DELETE_TX_MAX_WAIT_MS,
  HARD_DELETE_TX_OPTIONS,
  HARD_DELETE_TX_TIMEOUT_MS,
} from "../../../../src/infrastructure/hardDeleteTransaction.js";
import { toAdminActorId } from "@core/domain/value-objects/AdminActorId.js";
import { ok } from "@shared/types";

type Factory = () => unknown;

/**
 * A container double. `doubles` maps a token to the instance `resolve` should answer
 * with; any token not named there still gets an empty object, which is all the
 * token-accounting tests need.
 */
function makeMockContainer(doubles: Record<symbol, unknown> = {}) {
  const factories = new Map<symbol, Factory>();
  const singletons = new Map<symbol, boolean>();
  const registered: symbol[] = [];

  const container = {
    register: vi.fn((token: symbol, factory: Factory, singleton?: boolean) => {
      registered.push(token);
      factories.set(token, factory);
      singletons.set(token, singleton === true);
    }),
    resolve: vi.fn((token: symbol) => doubles[token] ?? {}),
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

describe("setupProjectUseCases", () => {
  it("registers the project soft-delete and hard-delete tokens without throwing", () => {
    const { container, registered } = makeMockContainer();

    expect(() => setupProjectUseCases(container)).not.toThrow();

    expect(registered).toContain(TOKENS.DeleteProjectUseCase);
    expect(registered).toContain(TOKENS.HardDeleteProjectUseCase);
  });

  it("registers the use cases as singletons because they are stateless", () => {
    const { container, singletons } = makeMockContainer();

    setupProjectUseCases(container);

    expect(singletons.get(TOKENS.DeleteProjectUseCase)).toBe(true);
    expect(singletons.get(TOKENS.HardDeleteProjectUseCase)).toBe(true);
  });

  it("gives the soft delete the SHARED Unit of Work, never the dedicated Serializable one", () => {
    const { container, factories } = makeMockContainer();
    setupProjectUseCases(container);

    const resolved = tokensResolvedBy(container, factories, TOKENS.DeleteProjectUseCase);

    // The soft delete is one UPDATE of one row by primary key: there is no
    // multi-row tombstone snapshot to keep consistent, so Serializable would buy
    // nothing but retryable serialization failures. What it DOES want from the
    // shared UnitOfWork is the `app.account_id` RLS GUC bound at tx start and
    // atomicity over the probe+update pair. Resolving TOKENS.PrismaClient here
    // would be the signature of building a dedicated transaction instead.
    expect(resolved).toContain(TOKENS.ProjectRepository);
    expect(resolved).toContain(TOKENS.UnitOfWork);
    expect(resolved).not.toContain(TOKENS.PrismaClient);
  });

  it("gives the hard delete its OWN Serializable Unit of Work built from the PrismaClient, not the shared one", () => {
    const { container, factories } = makeMockContainer();
    setupProjectUseCases(container);

    const resolved = tokensResolvedBy(container, factories, TOKENS.HardDeleteProjectUseCase);

    // The hard delete opens a DEDICATED Unit of Work (Serializable + sized timeout)
    // constructed here from the PrismaClient: that transaction is what binds the
    // `app.account_id` RLS GUC and pins the isolation for the whole cascade. It is
    // NOT the shared UnitOfWork (ReadCommitted, default timeout), so the shared
    // token is deliberately absent while the PrismaClient IS resolved.
    expect(resolved).toContain(TOKENS.ProjectRepository);
    expect(resolved).toContain(TOKENS.PrismaClient);
    expect(resolved).not.toContain(TOKENS.UnitOfWork);
  });

  it("delivers Serializable isolation and the sized timeout to the ACTUAL transaction it opens", async () => {
    // The test above proves WHICH tokens the factory resolves. That is not the
    // guarantee: `new PrismaUnitOfWork(prisma)` resolves exactly the same tokens as
    // `new PrismaUnitOfWork(prisma, HARD_DELETE_TX_OPTIONS)`, so dropping the options
    // argument — the ONLY live carrier of Serializable isolation on the production
    // path, because the adapter's own `$transaction` branch is dead whenever a Unit of
    // Work is active — left the whole suite green. So this drives the composed use
    // case end to end and reads the options `$transaction` was really handed.
    const transactionOptions: unknown[] = [];
    const prisma = {
      $transaction: vi.fn(
        async (callback: (tx: unknown) => Promise<unknown>, options?: unknown) => {
          transactionOptions.push(options);
          return callback({ $queryRaw: vi.fn(async () => []) });
        }
      ),
    };
    const repository = {
      countHardDeleteImpact: vi.fn(async () => ({ posts: 0, childRows: 0 })),
      hardDelete: vi.fn(async () => ok(undefined)),
    };

    const { container, factories } = makeMockContainer({
      [TOKENS.PrismaClient as unknown as symbol]: prisma,
      [TOKENS.ProjectRepository as unknown as symbol]: repository,
    });
    setupProjectUseCases(container);

    const useCase = factories.get(TOKENS.HardDeleteProjectUseCase)?.() as {
      execute: (input: unknown) => Promise<{ ok: boolean }>;
    };
    const actor = toAdminActorId("admin-1");
    if (!actor.ok) throw new Error("test setup: invalid admin actor id");
    const result = await useCase.execute({
      projectId: "550e8400-e29b-41d4-a716-446655440302",
      caller: { type: "admin", adminUserId: actor.value, reason: "GDPR erasure request" },
    });

    expect(result.ok).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // Serializable is what stops the tombstone snapshot from missing a row a
    // concurrent insert commits mid-transaction; the timeout is what gives a large
    // cascade a real budget instead of the driver's short default. Both are asserted
    // as VALUES here, not as "some options object was passed".
    expect(transactionOptions[0]).toMatchObject({
      isolationLevel: HARD_DELETE_TX_OPTIONS.isolationLevel,
      timeout: HARD_DELETE_TX_TIMEOUT_MS,
      maxWait: HARD_DELETE_TX_MAX_WAIT_MS,
    });
  });
});
