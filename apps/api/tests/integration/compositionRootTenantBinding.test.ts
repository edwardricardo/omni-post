/**
 * @file compositionRootTenantBinding.test.ts
 * @description Real-database proof that a repository the COMPOSITION ROOT registers is handed
 *   the container's guarded, GUC-bound client — and not the raw `@infra/prisma` singleton.
 *
 *   ## The class this pins, and why its red is a SILENCE
 *
 *   The tenant guard and the request-scoped GUC binding are applied in `setup.ts`, to the client
 *   the container registers. They therefore cover only repositories that RECEIVE that client. A
 *   setup module that builds its repository from the raw `@infra/prisma` singleton instead
 *   produces a repository that is DI-resolved and yet unguarded and unbound: under the
 *   application role its reads of an RLS-covered table return zero rows, with no guard throw and
 *   no error of any kind. Nothing fails. `brandKit` is the named site because it is
 *   guard-enrolled AND RLS-covered, so both halves of the defect are observable on one model.
 *
 *   Two assertions, because the defect has two faces:
 *
 *   - a bound tenant read must RETURN the row (the fail-closed face), and
 *   - a read with no context must THROW `TenantContextMissingError` (the stays-loud face). A
 *     silent zero-row answer is the defect, not a pass.
 *
 *   ## What this suite's `prisma` actually IS
 *
 *   Stated rather than assumed, because a green here is only worth what the client behind it is.
 *   This is a node:test integration suite, so `@infra/prisma` is the REAL package — not the
 *   vitest entry, whose `prisma` export is a no-op Proxy answering every `$`-prefixed property
 *   with `async () => undefined`. Under that Proxy a silent-zero-rows red would be
 *   indistinguishable from the double returning `undefined`, which is exactly why this proof
 *   lives in the integration tier and cannot be moved to a unit suite.
 *
 *   Two distinct clients are in play, both on the APPLICATION role so row security is in force:
 *
 *   - the container's client, extended with guard + binding, which is what a converted setup
 *     module resolves; and
 *   - the raw process-wide singleton, which this suite pins to the same app-role connection.
 *     The pin is what keeps the proof alive after the conversion lands: a future revert to
 *     `import { prisma }` resolves to an unguarded, unbound app-role client and turns both
 *     assertions red again, instead of quietly reading through a superuser connection.
 *
 *   Fixtures are written on the owner channel, because seeding an RLS-covered table with no
 *   tenant bound is precisely what the policy exists to refuse.
 *
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@infra/prisma";
import { tenantGuardWithGucBindingExtension } from "@infra/prisma/extensions/tenantGucBinding.js";
import { TenantContextMissingError } from "@infra/prisma/extensions/tenantGuard.js";
import type { BrandKitRepository } from "@core/domain/repositories/BrandKitRepository.js";
import { Container } from "../../src/infrastructure/container/Container.js";
import { TOKENS } from "../../src/infrastructure/container/types.js";
import { setupBrandKitUseCases } from "../../src/infrastructure/container/setupBrandKitUseCases.js";
import {
  ambientTenantContextProvider,
  withTenantContext,
} from "../../src/security/tenantContext.js";
import { createSeedPrismaClient } from "./helpers/seedPrismaClient.js";
import { assertAppRoleSession, createAppRoleClient } from "./helpers/appRoleClient.js";

/**
 * The lazy singleton's cache slot. `@infra/prisma` builds its client on first property access
 * and memoises it here, so writing the slot before that first access is what decides which
 * connection a raw-singleton consumer gets — without mutating the environment.
 */
interface PrismaSingletonCache {
  prisma?: unknown;
}

describe("composition-root tenant binding", () => {
  const suffix = randomUUID();
  const accountId = `crtb-acct-${suffix}`;
  const primaryColor = "#123456";

  let seedClient: PrismaClient;
  let appRoleClient: PrismaClient;
  let repository: BrandKitRepository;

  before(async () => {
    seedClient = createSeedPrismaClient();
    appRoleClient = createAppRoleClient();
    await assertAppRoleSession(appRoleClient);

    // The pin must land before anything touches the singleton, or the memoised client is
    // already the owner's and the app-role posture below would be a claim about nothing.
    const singletonCache = globalThis as PrismaSingletonCache;
    assert.equal(
      singletonCache.prisma,
      undefined,
      "the process-wide Prisma singleton was already resolved before this suite pinned it, so " +
        "a raw-singleton consumer would read through whatever channel resolved it first"
    );
    singletonCache.prisma = appRoleClient;

    await seedClient.account.create({
      data: {
        id: accountId,
        name: "composition-root binding account",
        email: `${accountId}@example.test`,
      },
    });
    await seedClient.brandKit.create({ data: { accountId, primaryColor } });

    const container = new Container();
    const guardedPrisma = appRoleClient.$extends(
      tenantGuardWithGucBindingExtension(appRoleClient, ambientTenantContextProvider)
    ) as unknown as PrismaClient;
    container.registerInstance(TOKENS.PrismaClient, guardedPrisma);

    setupBrandKitUseCases(container);
    repository = container.resolve<BrandKitRepository>(TOKENS.BrandKitRepository);
  });

  after(async () => {
    await seedClient.brandKit.deleteMany({ where: { accountId } });
    await seedClient.account.deleteMany({ where: { id: accountId } });
    await seedClient.$disconnect();
    await appRoleClient.$disconnect();
    delete (globalThis as PrismaSingletonCache).prisma;
  });

  it("returns the tenant's own row through the repository the composition root registered", async () => {
    const found = await withTenantContext({ accountId }, () =>
      repository.findByAccountId(accountId)
    );

    assert.notEqual(
      found,
      null,
      "the tenant's own brand kit came back as zero rows under a bound tenant context: the " +
        "repository is reading through a client the request-scoped GUC binding never touched"
    );
    assert.equal(found?.primaryColor, primaryColor, "the row returned is not the seeded one");
  });

  it("throws TenantContextMissingError instead of answering zero rows with no context bound", async () => {
    await assert.rejects(
      () => repository.findByAccountId(accountId),
      TenantContextMissingError,
      "a context-less read of an enrolled model answered without throwing: the repository is " +
        "reading through a client the tenant guard never wrapped, so the failure is silent"
    );
  });
});
