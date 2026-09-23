/**
 * @file schedulingTenantScope.test.ts
 * @description The three admin scheduling routes driven through the REAL tenant guard.
 *
 *              The suite that already covers these handlers hands them a hand-built
 *              double, so layer 1 never ran and all three routes reported green while
 *              answering 500 in production. Here the client's every model operation goes
 *              through the composed extension the composition root actually installs
 *              (`tenantGuardWithGucBindingExtension` over `ambientTenantContextProvider`),
 *              so a route that binds no scope fails here the way it fails in production.
 *
 *              What the doubles record is not the arguments but the CONTEXT that was
 *              bound when each statement executed — both halves, never one. Asserting the
 *              account alone would pass on a `withTenantContext` NESTED inside the system
 *              scope: the tenant store really is populated there, it is just not what
 *              `resolveGucScope` reads, so the write would bind `__system__` (SMELL-149).
 *              The GUC scope the transaction binds is asserted alongside it, so the two
 *              detectors are independent.
 * @layer infrastructure
 */
import { describe, it, expect, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "@infra/prisma";
import type { TenantContextProvider } from "@infra/prisma/extensions/tenantGuard.js";
import { tenantGuardWithGucBindingExtension } from "@infra/prisma/extensions/tenantGucBinding.js";
import { SYSTEM_TENANT_SCOPE } from "@infra/prisma/extensions/tenantGuc.js";
import {
  ambientTenantContextProvider,
  getSystemContext,
  getTenantContext,
  withTenantContext,
} from "../../../src/security/tenantContext.js";
import { SchedulingPostRouteHandler } from "../../../src/admin/SchedulingPostHandlers.js";

vi.mock("../../../src/lib/logger.js", () => {
  const noop = vi.fn();
  const noopLogger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => noopLogger,
  };
  return { logger: noopLogger, authLogger: noopLogger, createLogger: () => noopLogger };
});

const ACCOUNT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACCOUNT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const POST_A = "11111111-1111-4111-8111-111111111111";
const POST_B = "22222222-2222-4222-8222-222222222222";
const PROJECT_A = "33333333-3333-4333-8333-333333333333";
const PROJECT_B = "44444444-4444-4444-8444-444444444444";
const ABSENT_POST = "55555555-5555-4555-8555-555555555555";

const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

/** One stored post, carrying every column and relation these three handlers read. */
interface PostRow {
  id: string;
  accountId: string;
  projectId: string;
  status: string;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  channelPublications: Array<{ channelId: string; outcome: string; pendingRetraction: boolean }>;
  publishLogs: Array<{ id: string; provider: string; status: string; createdAt: Date }>;
  contents: Array<{ locale: string; title: string | null; body: string; tags: string[] }>;
  project: { id: string; name: string; accountId: string };
}

/** What was bound when a statement executed. Both halves, never one. */
interface ObservedScope {
  readonly tenantAccountId: string | undefined;
  readonly systemReason: string | undefined;
  /**
   * The context OBJECT, not its reason. `withSystemContext` stores a fresh `{ reason }`
   * on every call, so identity is what distinguishes ONE scope held across several
   * statements from a separate scope opened per statement — two shapes the reason string
   * alone reports identically, while only the first leaves no unscoped gap between them.
   */
  readonly systemContext: unknown;
}

function observeScope(): ObservedScope {
  return {
    tenantAccountId: getTenantContext()?.accountId,
    systemReason: getSystemContext()?.reason,
    systemContext: getSystemContext(),
  };
}

/** One model operation that reached the store, below the guard. */
interface Statement {
  readonly model: string;
  readonly operation: string;
  readonly where: Record<string, unknown>;
  readonly scope: ObservedScope;
}

/** One `set_config('app.account_id', …)` the binding or the transaction seam issued. */
interface GucBind {
  readonly scope: unknown;
  readonly from: "operation" | "transaction";
}

/** The one hook the composed extension installs, reached structurally so it can be invoked. */
type ComposedHook = (params: {
  model: string;
  operation: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
}) => Promise<unknown>;

/**
 * @function installedHookOf
 * @description Reaches the hook the SHIPPED factory installs, the way `setup.ts` reaches
 *              it: `Prisma.defineExtension` given the object form returns a function that
 *              applies those args to a client, so a client whose `$extends` records its
 *              argument yields the definition itself.
 * @param client - The client the binding opens its batch transaction on.
 * @param provider - The context provider both halves read.
 * @returns The composed `$allOperations` hook.
 */
function installedHookOf(client: unknown, provider: TenantContextProvider): ComposedHook {
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
  const definition = installed[0] as
    { query?: { $allModels?: { $allOperations?: ComposedHook } } } | undefined;
  const hook = definition?.query?.$allModels?.$allOperations;
  if (!hook) {
    throw new Error(
      "the composed extension installed no $allModels/$allOperations hook — the factory's " +
        "shape changed and these assertions would otherwise pass over nothing"
    );
  }
  return hook;
}

/**
 * @function matches
 * @description Whether a stored row satisfies a Prisma `where`, including the `accountId`
 *              the guard injects — which is what makes the scope decide OUTCOMES here and
 *              not only arguments. An operator this store does not model throws rather
 *              than being skipped: a filter silently ignored is a filter that never fails.
 * @param row - The stored row.
 * @param where - The `where` as it reached the store.
 * @returns Whether the row is visible through that filter.
 */
function matches(row: PostRow, where: Record<string, unknown>): boolean {
  const columns = row as unknown as Record<string, unknown>;
  return Object.entries(where).every(([key, condition]) => {
    const value = columns[key];
    if (condition === null || typeof condition === "string" || typeof condition === "number") {
      return value === condition;
    }
    if (typeof condition === "object") {
      const operators = condition as Record<string, unknown>;
      if (Array.isArray(operators.in)) {
        return operators.in.includes(value);
      }
      if ("not" in operators) {
        return value !== operators.not;
      }
      if ("gte" in operators || "lte" in operators) {
        const moment = value instanceof Date ? value.getTime() : Number.NaN;
        const lower = operators.gte instanceof Date ? operators.gte.getTime() : -Infinity;
        const upper = operators.lte instanceof Date ? operators.lte.getTime() : Infinity;
        return moment >= lower && moment <= upper;
      }
    }
    throw new Error(`the store does not model the where condition on "${key}"`);
  });
}

/**
 * @function guardedStore
 * @description An in-memory post store whose every model operation is issued THROUGH the
 *              composed production extension, so the handler under test holds a client
 *              that guards exactly as the container's does.
 * @param rows - The posts the store starts with.
 * @returns The client, the rows (live, so a write is observable), and the two call logs.
 */
function guardedStore(rows: PostRow[]): {
  prisma: PrismaClient;
  rows: PostRow[];
  statements: Statement[];
  binds: GucBind[];
} {
  const statements: Statement[] = [];
  const binds: GucBind[] = [];
  let hook: ComposedHook | undefined;

  const whereOf = (args: unknown): Record<string, unknown> =>
    ((args as { where?: Record<string, unknown> }).where ?? {}) as Record<string, unknown>;

  const through =
    (model: string, operation: string, run: (args: unknown) => unknown) =>
    (args: unknown): PromiseLike<unknown> => {
      // A model method returns a LAZY thenable, exactly as Prisma's
      // `createPrismaPromise` does, and that fidelity is the point of this harness
      // rather than a detail of it. A real `prisma.post.count(...)` executes NOTHING
      // when called: the extension chain — the tenant guard and the GUC binding with
      // it — runs only once `then()` is invoked. A double built from an ordinary
      // `async` function runs its body on the CALL instead, inside whatever
      // `AsyncLocalStorage.run` the caller opened. That one difference in TIMING hides
      // a whole class of defect: a callback written `() => prisma.post.count(...)`
      // hands the inert object back before the store is popped, so in production the
      // guard sees no scope at all, while an eager double sees the scope and reports
      // green. This harness was eager at first and certified exactly that defect fixed.
      const start = async (): Promise<unknown> => {
        if (!hook) {
          throw new Error("the composed extension was not installed over this store");
        }
        return hook({
          model,
          operation,
          args,
          query: async (guarded: unknown) => {
            statements.push({ model, operation, where: whereOf(guarded), scope: observeScope() });
            return run(guarded);
          },
        });
      };
      return {
        then: (onOk, onErr) => start().then(onOk, onErr),
        catch: (onErr: ((reason: unknown) => unknown) | null) => start().catch(onErr),
        finally: (onDone: (() => void) | null) => start().finally(onDone),
      } as PromiseLike<unknown>;
    };

  const visible = (args: unknown): PostRow[] => rows.filter((row) => matches(row, whereOf(args)));

  const postModel = {
    findFirst: through("Post", "findFirst", (args) => visible(args)[0] ?? null),
    count: through("Post", "count", (args) => visible(args).length),
    findMany: through("Post", "findMany", (args) => {
      const { skip, take } = args as { skip?: number; take?: number };
      return visible(args).slice(skip ?? 0, (skip ?? 0) + (take ?? rows.length));
    }),
    update: through("Post", "update", (args) => {
      const target = visible(args)[0];
      if (!target) {
        throw Object.assign(
          new Error("An operation failed because it depends on one or more records"),
          {
            code: "P2025",
          }
        );
      }
      const data = (args as { data: { status: string; scheduledAt: Date | null } }).data;
      target.status = data.status;
      target.scheduledAt = data.scheduledAt;
      return { id: target.id, status: target.status, scheduledAt: target.scheduledAt };
    }),
  };

  const publishLogModel = {
    updateMany: through("PublishLog", "updateMany", () => ({ count: 0 })),
  };

  const recordBind =
    (from: GucBind["from"]) =>
    (_query: TemplateStringsArray, ...values: unknown[]): Promise<number> => {
      binds.push({ scope: values[0], from });
      return Promise.resolve(1);
    };

  const tx = {
    post: postModel,
    publishLog: publishLogModel,
    $executeRaw: recordBind("transaction"),
  };

  const client = {
    post: postModel,
    publishLog: publishLogModel,
    $executeRaw: recordBind("operation"),
    $transaction: (work: unknown): Promise<unknown> => {
      if (Array.isArray(work)) {
        return Promise.all(work as Array<Promise<unknown>>);
      }
      return (work as (client: typeof tx) => Promise<unknown>)(tx);
    },
  };

  hook = installedHookOf(client, ambientTenantContextProvider);

  // canon-exception: test-fixture — the store carries only the slice these handlers touch,
  // which is not provably a `PrismaClient`; the double assertion says so rather than
  // claiming an overlap the compiler has already refused.
  return { prisma: client as unknown as PrismaClient, rows, statements, binds };
}

/**
 * @function postRow
 * @description A scheduled post of the given tenant, with nothing live on any channel so
 *              the C3 guard lets the write through and the scope is what decides.
 * @param overrides - Identity of the post and its owner.
 * @returns The stored row.
 */
function postRow(overrides: { id: string; accountId: string; projectId: string }): PostRow {
  return {
    ...overrides,
    status: "SCHEDULED",
    scheduledAt: new Date("2026-10-01T09:00:00.000Z"),
    publishedAt: null,
    createdAt: new Date("2026-09-01T09:00:00.000Z"),
    updatedAt: new Date("2026-09-01T09:00:00.000Z"),
    deletedAt: null,
    channelPublications: [],
    publishLogs: [],
    contents: [],
    project: { id: overrides.projectId, name: "Project", accountId: overrides.accountId },
  };
}

/**
 * What `sendSuccess` puts on the reply for the list route: the envelope wraps the
 * paginated response, which carries its own `data` array.
 */
interface SentBody {
  data?: { data?: Array<{ id: string }> };
}

function replyDouble(): { reply: FastifyReply; sent: { statusCode: number; body: SentBody } } {
  const sent: { statusCode: number; body: SentBody } = { statusCode: 0, body: {} };
  const reply = {
    code(statusCode: number) {
      sent.statusCode = statusCode;
      return reply;
    },
    send(body: unknown) {
      // canon-exception: test-fixture — the serializer's body is opaque here; the cast
      // narrows it to the field these cases read.
      sent.body = body as SentBody;
      return reply;
    },
  };
  // canon-exception: test-fixture — the two methods the handler calls are all that exists,
  // which is not a `FastifyReply`.
  return { reply: reply as unknown as FastifyReply, sent };
}

function requestDouble(parts: {
  params?: Record<string, unknown>;
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
}): FastifyRequest {
  const request = {
    params: parts.params ?? {},
    body: parts.body ?? {},
    query: parts.query ?? {},
    headers: {},
    id: "req-1",
    url: "/admin/posts",
    method: "POST",
  };
  // canon-exception: test-fixture — the request carries only the fields the validators and
  // the logger read, which is not a `FastifyRequest`.
  return request as unknown as FastifyRequest;
}

/**
 * @function afterOwnershipLookup
 * @description Every statement except the first. The first is the ownership resolution,
 *              which by construction cannot be tenant-scoped — it is what discovers the
 *              tenant — so it is asserted on its own and excluded here.
 * @param statements - The full call log.
 * @returns The statements that must all be tenant-bound.
 */
function afterOwnershipLookup(statements: Statement[]): Statement[] {
  return statements.slice(1);
}

describe("admin scheduling by-id writers — tenant scope derived from the post's own account", () => {
  it("cancels under the post's own account, with the system scope closed before the write", async () => {
    const store = guardedStore([
      postRow({ id: POST_A, accountId: ACCOUNT_A, projectId: PROJECT_A }),
      postRow({ id: POST_B, accountId: ACCOUNT_B, projectId: PROJECT_B }),
    ]);
    const { reply, sent } = replyDouble();

    await new SchedulingPostRouteHandler(store.prisma).cancelScheduledPost(
      requestDouble({ params: { id: POST_A } }),
      reply
    );

    expect(sent.statusCode).toBe(200);

    // The ownership resolution is the ONE statement allowed to bypass, and it bypasses
    // with no tenant bound — it is what discovers the tenant.
    const lookup = store.statements[0];
    expect(lookup?.operation).toBe("findFirst");
    expect(lookup?.scope.systemReason).toEqual(expect.stringMatching(/^system:/));
    expect(lookup?.scope.tenantAccountId).toBeUndefined();

    // Everything after it is tenant-bound AND outside the system scope. The second half of
    // that pair is the whole assertion: a nested `withTenantContext` populates the tenant
    // store too, and would satisfy the account check alone.
    const rest = afterOwnershipLookup(store.statements);
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.map((statement) => statement.scope.tenantAccountId)).toEqual(
      rest.map(() => ACCOUNT_A)
    );
    expect(rest.map((statement) => statement.scope.systemReason)).toEqual(
      rest.map(() => undefined)
    );

    // The independent detector: what the transaction actually bound for RLS. Nesting the
    // two scopes leaves the tenant store populated but resolves `__system__` here.
    const transactionBinds = store.binds.filter((bind) => bind.from === "transaction");
    expect(transactionBinds.map((bind) => bind.scope)).toEqual([ACCOUNT_A]);
    expect(transactionBinds.map((bind) => bind.scope)).not.toContain(SYSTEM_TENANT_SCOPE);
  });

  it("reschedules under the post's own account, with the system scope closed before the write", async () => {
    const store = guardedStore([
      postRow({ id: POST_A, accountId: ACCOUNT_A, projectId: PROJECT_A }),
      postRow({ id: POST_B, accountId: ACCOUNT_B, projectId: PROJECT_B }),
    ]);
    const { reply, sent } = replyDouble();

    await new SchedulingPostRouteHandler(store.prisma).reschedulePost(
      requestDouble({ params: { id: POST_A }, body: { scheduledAt: FUTURE } }),
      reply
    );

    expect(sent.statusCode).toBe(200);

    const lookup = store.statements[0];
    expect(lookup?.scope.systemReason).toEqual(expect.stringMatching(/^system:/));
    expect(lookup?.scope.tenantAccountId).toBeUndefined();

    const rest = afterOwnershipLookup(store.statements);
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.map((statement) => statement.scope.tenantAccountId)).toEqual(
      rest.map(() => ACCOUNT_A)
    );
    expect(rest.map((statement) => statement.scope.systemReason)).toEqual(
      rest.map(() => undefined)
    );

    const transactionBinds = store.binds.filter((bind) => bind.from === "transaction");
    expect(transactionBinds.map((bind) => bind.scope)).toEqual([ACCOUNT_A]);
  });

  it("scopes the write to the owning account and leaves the other tenant's post untouched", async () => {
    const store = guardedStore([
      postRow({ id: POST_A, accountId: ACCOUNT_A, projectId: PROJECT_A }),
      postRow({ id: POST_B, accountId: ACCOUNT_B, projectId: PROJECT_B }),
    ]);
    const { reply, sent } = replyDouble();

    await new SchedulingPostRouteHandler(store.prisma).cancelScheduledPost(
      requestDouble({ params: { id: POST_A } }),
      reply
    );

    expect(sent.statusCode).toBe(200);
    const write = store.statements.find((statement) => statement.operation === "update");
    // The guard injected the derived account, so the write is a compare-and-swap on the
    // owner as well as on the word.
    expect(write?.where.accountId).toBe(ACCOUNT_A);
    expect(store.rows.find((row) => row.id === POST_A)?.status).toBe("DRAFT");
    expect(store.rows.find((row) => row.id === POST_B)?.status).toBe("SCHEDULED");
  });

  it("answers 404 without ever entering a tenant context when the post does not exist", async () => {
    const store = guardedStore([
      postRow({ id: POST_A, accountId: ACCOUNT_A, projectId: PROJECT_A }),
    ]);
    const { reply, sent } = replyDouble();

    await new SchedulingPostRouteHandler(store.prisma).cancelScheduledPost(
      requestDouble({ params: { id: ABSENT_POST } }),
      reply
    );

    expect(sent.statusCode).toBe(404);
    expect(store.statements).toHaveLength(1);
    expect(store.statements.map((statement) => statement.scope.tenantAccountId)).toEqual([
      undefined,
    ]);
  });

  it("answers 500 and opens no tenant scope when the ownership lookup itself fails", async () => {
    const store = guardedStore([
      postRow({ id: POST_A, accountId: ACCOUNT_A, projectId: PROJECT_A }),
    ]);
    const { reply, sent } = replyDouble();

    // The lookup is the only statement that runs before any account is known, so its
    // failure is the one branch of the seam with nothing to fall back to. It is replaced
    // by a LAZY rejecting thenable rather than a rejected promise, so the failure arrives
    // at the same moment a real one would — an eagerly rejected promise would reject
    // inside `withSystemContext` instead of at the `await`, which is a different path.
    // canon-exception: test-fixture
    const failing = store.prisma as unknown as {
      post: { findFirst: () => PromiseLike<unknown> };
    };
    failing.post.findFirst = () => ({
      then: (_onOk?: unknown, onErr?: ((reason: unknown) => unknown) | null) =>
        Promise.reject(new Error("the ownership lookup failed")).then(undefined, onErr),
    });

    await new SchedulingPostRouteHandler(store.prisma).cancelScheduledPost(
      requestDouble({ params: { id: POST_A } }),
      reply
    );

    expect(sent.statusCode).toBe(500);
    // Nothing reached the store below the guard, and no tenant was ever bound: the
    // handler must not proceed on an account it could not establish.
    expect(store.statements).toHaveLength(0);
    expect(store.rows[0]?.status).toBe("SCHEDULED");
  });
});

describe("admin scheduling list — the platform-wide read, which is a different case", () => {
  it("reads across tenants under a declared system scope and returns every tenant's posts", async () => {
    const store = guardedStore([
      postRow({ id: POST_A, accountId: ACCOUNT_A, projectId: PROJECT_A }),
      postRow({ id: POST_B, accountId: ACCOUNT_B, projectId: PROJECT_B }),
    ]);
    const { reply, sent } = replyDouble();

    await new SchedulingPostRouteHandler(store.prisma).getScheduledPosts(
      requestDouble({ query: {} }),
      reply
    );

    expect(sent.statusCode).toBe(200);
    expect(store.statements.map((statement) => statement.operation)).toEqual(["count", "findMany"]);
    expect(store.statements.map((statement) => statement.scope.systemReason)).toEqual([
      expect.stringMatching(/^system:/),
      expect.stringMatching(/^system:/),
    ]);
    // ONE scope held across both reads, not one opened per read. Identity decides it,
    // because the reason string is the same either way. The shapes differ in what sits
    // BETWEEN the statements: with a scope per read, anything added there runs unscoped
    // and answers 500 — which is the failure this route was repaired from.
    expect(store.statements[0]?.scope.systemContext).toBe(store.statements[1]?.scope.systemContext);
    expect(store.statements[0]?.scope.systemContext).toBeDefined();
    // No account was injected into either read: the view is platform-wide by design, and a
    // filter the guard added would silently narrow it to nothing.
    expect(store.statements.map((statement) => statement.where.accountId)).toEqual([
      undefined,
      undefined,
    ]);
    expect(sent.body.data?.data?.map((post) => post.id).sort()).toEqual([POST_A, POST_B].sort());
  });
});

describe("the derived scope is enforced, not decorative", () => {
  it("refuses the same write on a post of another account when the bound scope is B", async () => {
    const store = guardedStore([
      postRow({ id: POST_A, accountId: ACCOUNT_A, projectId: PROJECT_A }),
    ]);

    // `async` here for the same reason the production call sites carry it: the model
    // method is a lazy thenable, so a plain `() => …` would return it before
    // `withTenantContext` pops its store and the guard would never see ACCOUNT_B. The
    // write would still be refused — for the wrong reason, with no scope bound at all —
    // and this case would pass while proving nothing about the sentence it is named for.
    await expect(
      withTenantContext({ accountId: ACCOUNT_B }, async () =>
        store.prisma.post.update({
          where: { id: POST_A, status: { in: ["SCHEDULED", "DRAFT", "FAILED"] } },
          data: { status: "DRAFT", scheduledAt: null },
        })
      )
    ).rejects.toMatchObject({ code: "P2025" });

    expect(store.rows[0]?.status).toBe("SCHEDULED");
  });
});
