/**
 * @file tenantGucBinding.test.ts
 * @description Unit tests for the request-scoped GUC binding extension: the piece that makes
 *   `app.account_id` reach EVERY statement the application issues, not only the ones inside a
 *   unit of work. Pure logic — the client is a double that records the transactions it is
 *   asked to open, so no PostgreSQL is involved. The real-database halves (an out-of-unit-of-
 *   work read resolving under the app role, and atomicity on both transaction shapes) live in
 *   the integration tier.
 *
 *   Four claims are pinned here, and each one is a decision that was measured before it was
 *   written down:
 *
 *   - **The batch shape.** One transaction carrying exactly two statements, the bind first:
 *     `[set_config('app.account_id', scope, true), query(args)]`. The operation's result is
 *     the batch's LAST element.
 *   - **Pass-through when the marker is held.** An ambient transaction owns GUC adjudication,
 *     so the operation runs on that transaction's connection instead of checking out a second
 *     one and committing through its caller's rollback.
 *   - **Unwrapped pass-through with no scope.** Nothing is invented for a flow that declared
 *     neither a tenant nor a system scope; the guard is what makes that loud on any enrolled
 *     model.
 *   - **Guard-then-bind.** The composition order the spike measured (first-applied extension
 *     is the outermost), which means a context-less call on an enrolled model throws BEFORE a
 *     transaction is opened — there is never a transaction left to roll back.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import {
  TenantContextMissingError,
  tenantGuardCheck,
  type TenantContextProvider,
} from "../../../../../infra/prisma/src/extensions/tenantGuard.js";
import {
  SYSTEM_TENANT_SCOPE,
  runWithBoundGuc,
} from "../../../../../infra/prisma/src/extensions/tenantGuc.js";
import {
  bindGucForOperation,
  tenantGuardWithGucBindingExtension,
} from "../../../../../infra/prisma/src/extensions/tenantGucBinding.js";

/** The one hook the composed extension installs, reached structurally so it can be invoked. */
interface ComposedExtension {
  query: {
    $allModels: {
      $allOperations: (params: {
        model: string;
        operation: string;
        args: unknown;
        query: (args: unknown) => Promise<unknown>;
      }) => Promise<unknown>;
    };
  };
}

/** One statement the double was asked to run, recorded rather than executed. */
interface RecordedBind {
  strings: readonly string[];
  values: unknown[];
}

/**
 * A client double whose `$transaction` records the operation array it receives instead of
 * talking to a database. `$executeRaw` returns a sentinel so the assertions can tell the bind
 * statement apart from the wrapped operation inside the batch.
 */
function makeFakeClient() {
  const binds: RecordedBind[] = [];
  const batches: unknown[][] = [];

  const client = {
    $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): unknown {
      const recorded: RecordedBind = { strings: [...strings], values };
      binds.push(recorded);
      return recorded;
    },
    async $transaction(operations: unknown[]): Promise<unknown[]> {
      batches.push(operations);
      return Promise.all(operations);
    },
  };

  return { client, binds, batches };
}

/** Provider double: whatever the two contexts are said to be for this test. */
function makeProvider(
  tenant: { accountId: string } | undefined,
  system?: { reason: string }
): TenantContextProvider {
  return {
    getTenantContext: () => tenant,
    getSystemContext: () => system,
  };
}

describe("request-scoped GUC binding", () => {
  it("runs the operation in one transaction whose first statement binds the tenant scope", async () => {
    const { client, binds, batches } = makeFakeClient();

    const result = await bindGucForOperation(
      {
        client,
        args: { where: { id: "post-1" } },
        query: async (args) => ({ echoed: args }),
      },
      makeProvider({ accountId: "account-1" })
    );

    expect(batches).toHaveLength(1);
    // Exactly two statements, the bind first and the operation second — the shape the
    // documented Prisma RLS pattern uses, and the shape the spike measured through the chain.
    expect(batches[0]).toHaveLength(2);
    expect(binds).toHaveLength(1);
    expect(binds[0]?.strings.join("?")).toBe("SELECT set_config('app.account_id', ?, true)");
    expect(binds[0]?.values).toEqual(["account-1"]);
    // The operation's result is the batch's LAST element, never the bind's row count.
    expect(result).toEqual({ echoed: { where: { id: "post-1" } } });
  });

  it("binds the system sentinel when a system context is active, tenant context notwithstanding", async () => {
    const { client, binds } = makeFakeClient();

    await bindGucForOperation(
      { client, args: {}, query: async () => null },
      makeProvider({ accountId: "account-1" }, { reason: "system:test" })
    );

    expect(binds[0]?.values).toEqual([SYSTEM_TENANT_SCOPE]);
  });

  it("passes the operation through untouched while an ambient transaction owns adjudication", async () => {
    const { client, batches } = makeFakeClient();

    const result = await runWithBoundGuc("account-1", () =>
      bindGucForOperation(
        { client, args: { take: 5 }, query: async (args) => ({ echoed: args }) },
        makeProvider({ accountId: "account-1" })
      )
    );

    // No transaction of its own: the operation stays on the ambient transaction's connection,
    // which is the whole reason the marker exists.
    expect(batches).toEqual([]);
    expect(result).toEqual({ echoed: { take: 5 } });
  });

  it("passes the operation through UNWRAPPED when neither context is bound", async () => {
    const { client, batches, binds } = makeFakeClient();

    const result = await bindGucForOperation(
      { client, args: {}, query: async () => "unbound" },
      makeProvider(undefined)
    );

    // Nothing is invented for a flow that declared no scope. Loudness is the guard's job,
    // asserted in the composition test below.
    expect(batches).toEqual([]);
    expect(binds).toEqual([]);
    expect(result).toBe("unbound");
  });

  it("binds for a model the guard does not enroll, because ownership joins into one that is", async () => {
    const { client, binds } = makeFakeClient();
    const provider = makeProvider({ accountId: "account-1" });

    // `post` carries no accountId column and is therefore NOT in TENANT_SCOPED_MODELS, yet
    // `findOwnerAccountId` reads it and joins into the RLS-covered `Project`. Skipping
    // unenrolled roots would leave exactly that read unbound — the measured failure.
    const result = await tenantGuardCheck(
      {
        model: "Post",
        operation: "findFirst",
        args: { where: { id: "post-1" } },
        query: async (args) =>
          bindGucForOperation(
            { client, args, query: async () => ({ project: { accountId: "account-1" } }) },
            provider
          ),
      },
      provider
    );

    expect(binds).toHaveLength(1);
    expect(binds[0]?.values).toEqual(["account-1"]);
    expect(result).toEqual({ project: { accountId: "account-1" } });
  });

  it("throws from the guard before any transaction is opened when no context is bound", async () => {
    const { client, batches } = makeFakeClient();
    const provider = makeProvider(undefined);

    // Guard-then-bind: the spike measured that the FIRST-applied extension is the OUTERMOST,
    // so `$extends(guard).$extends(binding)` runs the guard first. A context-less call on an
    // enrolled model therefore never leaves an opened transaction behind.
    await expect(
      tenantGuardCheck(
        {
          model: "Project",
          operation: "findMany",
          args: {},
          query: async (args) =>
            bindGucForOperation({ client, args, query: async () => [] }, provider),
        },
        provider
      )
    ).rejects.toBeInstanceOf(TenantContextMissingError);

    expect(batches).toEqual([]);
  });
});

describe("the composed extension the composition root applies", () => {
  /**
   * Every case above re-states the guard→bind nesting by hand, so inverting the SHIPPED factory
   * would leave all of them green. These consume `tenantGuardWithGucBindingExtension` itself and
   * invoke the hook it installs.
   *
   * The discriminator is what a REJECTED call leaves behind. Guard-then-bind decides and throws
   * before the binding is reached, so nothing is issued. Bind-then-guard evaluates
   * `[$executeRaw..., query(args)]` first, so it issues a bind statement and opens a transaction
   * whose only other member is an already-rejected promise — a wasted round trip on every
   * refused query, and, on a real client, a transaction opened for an operation that never runs.
   */
  /**
   * `Prisma.defineExtension` given the object form returns a FUNCTION that applies those args to
   * a client, so the definition is reached the way `setup.ts` reaches it: by handing the factory's
   * result a client whose `$extends` records what it was asked to install.
   */
  const hookOf = (client: unknown, provider: TenantContextProvider) => {
    const installed: unknown[] = [];
    const apply = tenantGuardWithGucBindingExtension(client, provider) as unknown as (
      base: unknown
    ) => unknown;
    apply({
      $extends: (definition: unknown) => {
        installed.push(definition);
        return {};
      },
    });
    const definition = installed[0] as ComposedExtension | undefined;
    if (!definition?.query?.$allModels?.$allOperations) {
      throw new Error(
        "the composed extension installed no $allModels/$allOperations hook — the factory's " +
          "shape changed and these assertions would otherwise pass over nothing"
      );
    }
    return definition.query.$allModels.$allOperations;
  };

  it("applies BOTH halves: the guard's injected scope reaches the query, inside a bound transaction", async () => {
    const { client, binds, batches } = makeFakeClient();
    const provider = makeProvider({ accountId: "account-1" });
    const seen: unknown[] = [];

    const result = await hookOf(
      client,
      provider
    )({
      model: "Project",
      operation: "findMany",
      args: {},
      query: async (args) => {
        seen.push(args);
        return ["row"];
      },
    });

    // Layer 1 ran: the guard injected the bound tenant into a `where` that had none.
    expect(seen).toEqual([{ where: { accountId: "account-1" } }]);
    // Layer 2 ran: one transaction, bind first, carrying the same scope.
    expect(batches).toHaveLength(1);
    expect(binds).toHaveLength(1);
    expect(binds[0]?.values).toEqual(["account-1"]);
    expect(result).toEqual(["row"]);
  });

  it("issues NO bind and opens NO transaction when the guard refuses a context-less call", async () => {
    const { client, binds, batches } = makeFakeClient();

    await expect(
      hookOf(
        client,
        makeProvider(undefined)
      )({
        model: "Project",
        operation: "findMany",
        args: {},
        query: async () => [],
      })
    ).rejects.toBeInstanceOf(TenantContextMissingError);

    // Inverting the factory to bind-then-guard turns both of these into 1.
    expect(binds).toEqual([]);
    expect(batches).toEqual([]);
  });

  it("issues NO bind and opens NO transaction when the guard refuses a foreign accountId", async () => {
    const { client, binds, batches } = makeFakeClient();

    await expect(
      hookOf(
        client,
        makeProvider({ accountId: "account-1" })
      )({
        model: "Project",
        operation: "findMany",
        args: { where: { accountId: "account-2" } },
        query: async () => [],
      })
    ).rejects.toThrow();

    expect(binds).toEqual([]);
    expect(batches).toEqual([]);
  });

  it("keeps an operation on the ambient transaction's connection when the marker is held", async () => {
    const { client, batches } = makeFakeClient();

    const result = await runWithBoundGuc("account-1", () =>
      hookOf(
        client,
        makeProvider({ accountId: "account-1" })
      )({
        model: "Project",
        operation: "findMany",
        args: {},
        query: async () => ["row"],
      })
    );

    expect(batches).toEqual([]);
    expect(result).toEqual(["row"]);
  });
});
