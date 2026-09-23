/**
 * @file workerTenantScope.test.ts
 * @description The workers' tenant scope, and the client the composition root builds over it.
 *
 *              The client under test is the one `workerContainer.ts` EXPORTS, reached by
 *              replacing only the Prisma singleton: the guard, the GUC binding and the
 *              provider are the production objects, so a root that stopped extending, or
 *              extended with the wrong provider, fails here.
 *
 *              Every model method on the double is a LAZY thenable, as Prisma's own
 *              `createPrismaPromise` is, and that fidelity is the point rather than a
 *              detail. A real model call executes NOTHING until `then()`, so the guard runs
 *              inside the caller's continuation; a double built from an ordinary `async`
 *              function runs its body on the CALL, inside whatever `AsyncLocalStorage.run`
 *              the caller opened, and reports green over a callback that in production
 *              hands the inert object back and leaves the statement unscoped.
 * @layer infrastructure
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TenantContextMissingError } from "@infra/prisma/extensions/tenantGuard.js";

const workersPackageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** One statement that reached the store, with the scope that was bound when it ran. */
interface Statement {
  readonly where: Record<string, unknown>;
  readonly boundAccountId: string | undefined;
}

const statements: Statement[] = [];
const binds: unknown[][] = [];
/** What the root handed each adapter, so "the GUARDED client" is asserted, not assumed. */
const constructedWith: Record<string, unknown[]> = {};

vi.mock("@adapters/db-prisma", () => ({
  PrismaOutboxWriter: class {},
  PrismaPostRepository: class {
    constructor(...args: unknown[]) {
      constructedWith.repository = args;
    }
  },
  PrismaUnitOfWork: class {
    constructor(...args: unknown[]) {
      constructedWith.unitOfWork = args;
    }
  },
}));

vi.mock("@core/posts", () => ({
  OpenPublicationEpisodeUseCase: class {
    constructor(...args: unknown[]) {
      constructedWith.openEpisode = args;
    }
  },
  RecordChannelPublicationAttemptUseCase: class {
    constructor(...args: unknown[]) {
      constructedWith.recordAttempt = args;
    }
  },
}));

vi.mock("@infra/prisma", async () => {
  const { getWorkerTenantContext } = await import("../../src/security/workerTenantContext.js");
  type Hook = (params: {
    model: string;
    operation: string;
    args: unknown;
    query: (args: unknown) => Promise<unknown>;
  }) => Promise<unknown>;
  let hook: Hook | undefined;

  const lazy =
    (model: string, operation: string) =>
    (args: unknown): PromiseLike<unknown> => {
      const start = async (): Promise<unknown> => {
        if (!hook) throw new Error("the composition root installed no extension");
        return hook({
          model,
          operation,
          args,
          query: async (guarded: unknown) => {
            statements.push({
              where: ((guarded as { where?: Record<string, unknown> }).where ?? {}) as Record<
                string,
                unknown
              >,
              boundAccountId: getWorkerTenantContext()?.accountId,
            });
            return null;
          },
        });
      };
      return { then: (ok, no) => start().then(ok, no) } as PromiseLike<unknown>;
    };

  const guarded = {
    project: { findFirst: lazy("Project", "findFirst") },
  };

  const client = {
    $executeRaw: (_q: TemplateStringsArray, ...values: unknown[]) => {
      binds.push(values);
      return Promise.resolve(1);
    },
    $transaction: (operations: unknown[]) => Promise.all(operations),
    $extends(definition: unknown) {
      if (typeof definition === "function") {
        return (definition as (base: unknown) => unknown)(this);
      }
      const installed = definition as
        { query?: { $allModels?: { $allOperations?: Hook } } } | undefined;
      hook = installed?.query?.$allModels?.$allOperations;
      if (!hook) {
        throw new Error(
          "the root installed an extension with no $allModels/$allOperations hook — the " +
            "assertions below would otherwise pass over nothing"
        );
      }
      return guarded;
    },
  };

  return { prisma: client, verifyDatabaseAuth: vi.fn() };
});

const { workerPostWiring } = await import("../../src/container/workerContainer.js");
const { withWorkerTenant, getWorkerTenantContext, workerTenantProvider } =
  await import("../../src/security/workerTenantContext.js");

const wiring = workerPostWiring();
const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/**
 * The guarded client, typed only where this suite touches it — and typed returning a real
 * `Promise`, as Prisma types it (`PrismaPromise<T> extends Promise<T>`) while returning the
 * lazy object the double models. That gap is what makes the escaping callback below compile.
 */
const guardedProject = (
  wiring.guardedPrisma as unknown as { project: { findFirst: (args: unknown) => Promise<null> } }
).project;

describe("the workers' tenant scope", () => {
  beforeEach(() => {
    statements.length = 0;
    binds.length = 0;
  });

  it("refuses a tenant-scoped operation issued outside any worker tenant", async () => {
    await expect(guardedProject.findFirst({ where: { id: "p1" } })).rejects.toBeInstanceOf(
      TenantContextMissingError
    );
    expect(statements).toEqual([]);
    expect(binds).toEqual([]);
  });

  it("scopes an operation issued inside withWorkerTenant, in both layers", async () => {
    await withWorkerTenant(ACCOUNT, async () => guardedProject.findFirst({ where: { id: "p1" } }));

    // Layer 1 injected the account into the `where`; layer 2 bound the same scope.
    expect(statements).toEqual([
      { where: { id: "p1", accountId: ACCOUNT }, boundAccountId: ACCOUNT },
    ]);
    expect(binds).toEqual([[ACCOUNT]]);
  });

  // The shape that type-checks and used to leave the statement unscoped: a NON-async
  // callback that merely RETURNS the lazy operation. `run` pops the store when the callback
  // returns, so before the helper awaited the callback this raised
  // `TenantContextMissingError` — fail-closed, never a cross-tenant read, because every
  // model the workers touch is tenant-scoped. It is asserted as SCOPED because awaiting the
  // callback inside the store is what the helper now does.
  it("scopes an operation the callback RETURNS rather than awaits", async () => {
    await withWorkerTenant(ACCOUNT, () => guardedProject.findFirst({ where: { id: "p1" } }));

    expect(statements).toEqual([
      { where: { id: "p1", accountId: ACCOUNT }, boundAccountId: ACCOUNT },
    ]);
    expect(binds).toEqual([[ACCOUNT]]);
  });

  it("leaves no scope bound after withWorkerTenant resolves", async () => {
    await withWorkerTenant(ACCOUNT, async () => undefined);
    expect(getWorkerTenantContext()).toBeUndefined();
  });

  it("has no system context to bypass the guard with, under any scope", async () => {
    expect(workerTenantProvider.getSystemContext()).toBeUndefined();
    await withWorkerTenant(ACCOUNT, async () => {
      expect(workerTenantProvider.getSystemContext()).toBeUndefined();
    });
  });
});

describe("the workers' composition root", () => {
  // Handing an adapter the RAW client would leave both isolation layers off for every
  // statement it issues, while every suite that mocks the adapter stays green.
  it("builds the post persistence over the GUARDED client and the worker provider", () => {
    expect(constructedWith.repository?.[0]).toBe(wiring.guardedPrisma);
    expect(constructedWith.repository?.[2]).toBe(workerTenantProvider);
    expect(constructedWith.unitOfWork?.[0]).toBe(wiring.guardedPrisma);
    expect(constructedWith.unitOfWork?.[1]).toBe(workerTenantProvider);
  });

  it("wires both shared use cases onto that persistence rather than reimplementing them", () => {
    expect(constructedWith.openEpisode).toEqual([wiring.postRepository, wiring.unitOfWork]);
    expect(constructedWith.recordAttempt).toEqual([wiring.postRepository, wiring.unitOfWork]);
  });

  // A second graph would mean a second guarded client, a second repository and a second
  // transaction seam behind the same import.
  it("hands every caller the same graph", () => {
    expect(workerPostWiring()).toBe(wiring);
  });
});

describe("importing the workers composition root", () => {
  // Not assertable in process: vitest aliases `@infra/prisma` to its test entry, whose
  // `prisma` export is inert. The claim is about the REAL singleton — a lazy Proxy that
  // builds a client on any property access — so it is measured where that one loads: a child
  // Node under the source condition, with DATABASE_URL removed from its environment.
  it("constructs no client, leaving a missing DATABASE_URL for the env module to report", () => {
    const childEnv = { ...process.env };
    delete childEnv.DATABASE_URL;
    const probe =
      "import('./src/container/workerContainer.ts')" +
      ".then((m) => { console.log('IMPORT OK');" +
      " try { m.workerPostWiring(); console.log('FACTORY OK'); }" +
      " catch { console.log('FACTORY THREW'); } })" +
      ".catch(() => console.log('IMPORT THREW'))";

    const out = execFileSync(
      process.execPath,
      ["--conditions", "development", "--import", "tsx", "-e", probe],
      { cwd: workersPackageRoot, env: childEnv, encoding: "utf8" }
    );

    expect(out).toContain("IMPORT OK");
    // Where the construction moved TO is the fix, so it is asserted rather than left implied
    // by an import that could also succeed by wiring nothing at all.
    expect(out).toContain("FACTORY THREW");
  }, 60_000);
});
