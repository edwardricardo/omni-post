/**
 * @file setupPostUseCases.test.ts
 * @description Smoke contract test for the per-channel publication writers in the
 *   Post DI setup. It asserts the four tokens exist and are registered, that each
 *   writer is a singleton, and — the part that matters — that every one of them
 *   resolves BOTH the post repository and the shared Unit of Work. The Unit of Work
 *   is not decoration on these four: each writes through the narrow
 *   `savePublication`, and the seam is what binds the `app.account_id` RLS GUC for
 *   the statement and what rolls the write back when the aggregate refuses. A
 *   writer registered without it would still compile, still pass its own unit
 *   tests (the parameter is optional so those can construct it), and write outside
 *   a transaction in production.
 * @layer infrastructure
 */

import { describe, it, expect, vi } from "vitest";
import { setupPostUseCases } from "../../../../src/infrastructure/container/setupPostUseCases.js";
import { TOKENS } from "../../../../src/infrastructure/container/types.js";
import type { Container } from "../../../../src/infrastructure/container/Container.js";

type Factory = () => unknown;

/** A container double: it records what was registered and what each factory resolves. */
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
    resolve: vi.fn(() => ({})),
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

const PUBLICATION_WRITERS = [
  ["OpenPublicationEpisodeUseCase", () => TOKENS.OpenPublicationEpisodeUseCase],
  ["RecordChannelPublicationAttemptUseCase", () => TOKENS.RecordChannelPublicationAttemptUseCase],
  ["ConfirmManualRetractionUseCase", () => TOKENS.ConfirmManualRetractionUseCase],
  ["ExpireRetractionActionWindowUseCase", () => TOKENS.ExpireRetractionActionWindowUseCase],
] as const;

describe("setupPostUseCases — the per-channel publication writers", () => {
  it("registers the four publication writers without throwing", () => {
    const { container, registered } = makeMockContainer();

    expect(() => setupPostUseCases(container)).not.toThrow();

    for (const [name, token] of PUBLICATION_WRITERS) {
      expect(token(), `${name} has no DI token`).toBeDefined();
      expect(registered, `${name} is not registered`).toContain(token());
    }
  });

  it("registers them as singletons, because they hold no per-call state", () => {
    const { container, singletons } = makeMockContainer();

    setupPostUseCases(container);

    for (const [name, token] of PUBLICATION_WRITERS) {
      expect(singletons.get(token()), `${name} is not a singleton`).toBe(true);
    }
  });

  it("gives every one of them the post repository and the SHARED Unit of Work", () => {
    const { container, factories } = makeMockContainer();
    setupPostUseCases(container);

    for (const [name, token] of PUBLICATION_WRITERS) {
      const resolved = tokensResolvedBy(container, factories, token());

      expect(resolved, `${name} does not resolve the post repository`).toContain(
        TOKENS.PostRepository
      );
      // The seam, not an ornament: `savePublication` is a write, and without the
      // Unit of Work it runs on an unbound connection where the tenant GUC the
      // row policy reads was never set.
      expect(resolved, `${name} does not resolve the Unit of Work`).toContain(TOKENS.UnitOfWork);
      // These four build no dedicated transaction of their own, so reaching for
      // the raw client would be the signature of one.
      expect(resolved, `${name} reaches for the raw Prisma client`).not.toContain(
        TOKENS.PrismaClient
      );
    }
  });
});
