/**
 * @file setupRepositories.test.ts
 * @description Pins the PROPERTY the repository composition root now owns: it hands the
 *   relocated persistence adapters the AMBIENT tenant context provider, so a transaction
 *   they open binds the same `app.account_id` the request-scoped guard reads. A token
 *   accounting test cannot see this — `new PrismaUnitOfWork(prisma)` resolves exactly the
 *   same tokens as `new PrismaUnitOfWork(prisma, provider)` — so both factories are driven
 *   end to end and the statement the transaction really issued is read back. A fixed double
 *   or a missing provider cannot react to `withTenantContext`, which is what makes this an
 *   assertion about the root's wiring rather than about the adapters.
 * @layer infrastructure
 */

import { describe, it, expect, vi } from "vitest";
import { setupRepositories } from "../../../../src/infrastructure/container/setupRepositories.js";
import { TOKENS } from "../../../../src/infrastructure/container/types.js";
import type { Container } from "../../../../src/infrastructure/container/Container.js";
import { withTenantContext } from "../../../../src/security/tenantContext.js";
import { PostAggregate, ProjectId } from "@core/domain/index.js";
import type { UnitOfWork } from "@core/domain/index.js";
import type { PostRepository } from "@core/domain/index.js";

type Factory = () => unknown;

const PROJECT_ID = "b0000000-0000-4000-8000-000000000001";
const ACCOUNT_ID = "a0000000-0000-4000-8000-000000000001";
const ROOT_SCOPE = "acc-root";

/**
 * A container double. `doubles` maps a token to the instance `resolve` should answer
 * with; any token not named there still gets an empty object.
 */
function makeMockContainer(doubles: Record<symbol, unknown> = {}) {
  const factories = new Map<symbol, Factory>();

  const container = {
    register: vi.fn((token: symbol, factory: Factory, _singleton?: boolean) => {
      factories.set(token, factory);
    }),
    resolve: vi.fn((token: symbol) => doubles[token] ?? {}),
  } as unknown as Container;

  return { container, factories };
}

/**
 * A Prisma double whose transaction client records the GUC statement each seam issues:
 * the unit of work binds through `$queryRaw`, the repository's own seam through
 * `$executeRaw`. Recording both is what lets one double answer for both factories.
 */
function makePrismaDouble() {
  const tx = {
    $queryRaw: vi.fn(async () => [] as unknown[]),
    $executeRaw: vi.fn(async () => 1),
    project: { findFirst: vi.fn(async () => ({ accountId: ACCOUNT_ID })) },
    post: { create: vi.fn(async () => ({})) },
    postContent: { create: vi.fn(async () => ({})) },
    postMedia: { createMany: vi.fn(async () => ({ count: 0 })) },
  };

  const prisma = {
    // The existence probe answers "no such post", which is what routes `save` onto the
    // standalone create path — the one that opens its own GUC-bound transaction.
    post: { count: vi.fn(async () => 0) },
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>, _options?: unknown) =>
      fn(tx)
    ),
  };

  return { prisma, tx };
}

/** The scope a tagged-template GUC statement was interpolated with. */
function boundScope(calls: unknown[][]): unknown {
  return (calls[0] as unknown[] | undefined)?.[1];
}

function makeDoubles() {
  const { prisma, tx } = makePrismaDouble();
  const outboxWriter = { writeEvents: vi.fn(async () => {}) };

  const { container, factories } = makeMockContainer({
    [TOKENS.PrismaClient as unknown as symbol]: prisma,
    [TOKENS.OutboxWriter as unknown as symbol]: outboxWriter,
  });
  setupRepositories(container);

  return { container, factories, prisma, tx };
}

function newPostAggregate(): PostAggregate {
  const created = PostAggregate.create({
    projectId: ProjectId.fromStringUnsafe(PROJECT_ID),
    body: "Root wiring probe",
  });
  if (!created.ok) throw new Error("test setup: could not build a post aggregate");
  return created.value;
}

describe("setupRepositories", () => {
  it("gives the Unit of Work a provider that resolves the AMBIENT tenant context", async () => {
    const { factories, tx } = makeDoubles();

    const unitOfWork = factories.get(TOKENS.UnitOfWork)?.() as UnitOfWork;

    await withTenantContext({ accountId: ROOT_SCOPE }, async () =>
      unitOfWork.executeInTransaction(async () => {})
    );

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(boundScope(tx.$queryRaw.mock.calls)).toBe(ROOT_SCOPE);
  });

  it("gives the Post repository a provider that resolves the AMBIENT tenant context", async () => {
    const { factories, tx } = makeDoubles();

    const repository = factories.get(TOKENS.PostRepository)?.() as PostRepository;

    const saved = await withTenantContext({ accountId: ROOT_SCOPE }, async () =>
      repository.save(newPostAggregate())
    );

    expect(saved.ok).toBe(true);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(boundScope(tx.$executeRaw.mock.calls)).toBe(ROOT_SCOPE);
  });

  it("binds nothing when no tenant context is bound, for either adapter", async () => {
    const { factories, tx } = makeDoubles();

    const unitOfWork = factories.get(TOKENS.UnitOfWork)?.() as UnitOfWork;
    const repository = factories.get(TOKENS.PostRepository)?.() as PostRepository;

    await unitOfWork.executeInTransaction(async () => {});
    const saved = await repository.save(newPostAggregate());

    // Unbound is the fail-closed default: `current_setting(..., true)` returns NULL and
    // the RLS policy evaluates to false. Binding an invented scope here would be worse
    // than binding none.
    expect(saved.ok).toBe(true);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});
