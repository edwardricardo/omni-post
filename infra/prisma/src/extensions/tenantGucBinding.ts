/**
 * @file tenantGucBinding.ts
 * @description Prisma `$extends` middleware that binds the RLS session GUC
 *   (`app.account_id`) for EVERY model operation the application issues, not only the ones
 *   that happen to run inside a unit of work.
 *
 *   ## Why this exists, measured rather than assumed
 *
 *   `app.account_id` used to be bound in exactly two places — `PrismaUnitOfWork` and the
 *   saga's equivalent — so every statement outside a unit of work ran with the GUC unset.
 *   Under a role that cannot bypass row security the `tenant_isolation` policies then
 *   evaluate false and the read fails closed against the application itself. That is not a
 *   projection: the same 18-suite batch run under both roles reported 177/177 as the owner
 *   and 170/177 as `omnipost_app`, the seven failures all reads issued outside a unit of
 *   work.
 *
 *   ## The shape, and the three branches
 *
 *   - **Scope present, no ambient owner** → the operation runs inside a two-statement batch
 *     transaction whose FIRST statement binds the scope:
 *     `$transaction([set_config('app.account_id', scope, true), query(args)])`. This is the
 *     documented Prisma RLS pattern; enlistment of `query(args)` through a CHAINED extension
 *     was measured end to end before this file was written.
 *   - **Ambient owner** (`isGucBound()`) → pass through untouched. A transaction opened by the
 *     unit of work, the saga, or `withGucBoundTransaction` OWNS GUC adjudication, and wrapping
 *     an operation issued inside it would move that operation onto a SECOND pooled connection,
 *     where it commits even when the enclosing transaction rolls back. That escape was
 *     reproduced before the marker was built.
 *   - **No scope** → pass through UNWRAPPED. Nothing is invented for a flow that declared
 *     neither a tenant nor a system scope; the guard is what makes that loud, throwing
 *     `TenantContextMissingError` on any enrolled model.
 *
 *   ## Every model binds, deliberately
 *
 *   The binding does not skip models the guard leaves unenrolled. `Post` carries no
 *   `accountId` column, so it is not in `TENANT_SCOPED_MODELS` — and
 *   `PrismaPostRepository.findOwnerAccountId` reads it while joining into the RLS-covered
 *   `Project`. Restricting the binding to enrolled models would leave exactly that read
 *   unbound, which is the failure this extension exists to remove.
 *
 *   ## Composition — ONE extension, which is the design's named fallback
 *
 *   The guard and the binding ship as a SINGLE `$extends`, running guard-then-bind inside one
 *   hook. Two chained extensions were tried first, because the enlistment spike measured that
 *   shape end to end against a real RLS-covered table; they work under the application's own
 *   resolver and FAIL under the unit-test runner's — for a reason that is the runner's test
 *   double, not module resolution. `vitest.shared.ts` maps `@infra/prisma` to
 *   `infra/prisma/src/vitest-entry.ts`, whose `prisma` export is a deliberate no-op `Proxy`
 *   returning `async () => undefined` for EVERY `$`-prefixed property. The first `$extends`
 *   therefore yields a Promise, and the second chained call on that Promise throws
 *   `$extends is not a function` (five suites, 97 tests). Extension subpaths are not involved:
 *   the same alias map already points `@infra/prisma/extensions` at source. Folding the two
 *   removes the second call entirely, which is exactly the fallback the design named — one
 *   extension, same seam, no third pattern.
 *
 *   That Proxy also bounds what a green unit suite can prove about this file: under vitest the
 *   API composition root registers it as the container's client, so those suites show the
 *   composition does not throw, not that anything binds. The binding's proof is the integration
 *   tier, on a real connection as the non-bypassing role.
 *
 *   Order inside the hook is guard first: a context-less call on an enrolled model throws
 *   BEFORE any transaction is opened, so there is never one left to roll back. Both halves
 *   read the SAME provider, so layer 1 (the injected `where.accountId`) and layer 2 (the
 *   policy's GUC) cannot drift apart; if they somehow did, composition is intersection — zero
 *   rows, fail closed, never a leak.
 * @layer infrastructure
 */
import { Prisma } from "../../generated/prisma/client/client.js";
import { tenantGuardCheck, type TenantContextProvider } from "./tenantGuard.js";
import { isGucBound, resolveGucScope } from "./tenantGuc.js";

/**
 * Minimal structural surface the binding needs from the client it wraps operations on: the
 * BATCH form of `$transaction` plus the raw statement that binds the GUC. Structural for the
 * same reason the seam's own interfaces are: the generated client types do not unify across
 * instantiations, and these two members are all that is used.
 */
export interface GucBindingHost {
  $transaction(operations: unknown[]): Promise<unknown[]>;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): unknown;
}

/**
 * @function bindGucForOperation
 * @description Pure decision + execution for ONE model operation, extracted from the
 *   extension so unit tests can exercise all three branches without instantiating a Prisma
 *   client — the same split `tenantGuardCheck` uses for the guard.
 * @param params - The client to open the batch on, the operation's args, and the operation.
 * @param provider - Caller-supplied lookup for tenant + system context.
 * @returns The operation's own result, whichever branch it took.
 */
export async function bindGucForOperation(
  params: {
    client: GucBindingHost;
    args: unknown;
    query: (args: unknown) => Promise<unknown>;
  },
  provider: TenantContextProvider
): Promise<unknown> {
  const { client, args, query } = params;

  // An ambient transaction owns adjudication: staying on its connection is what preserves
  // its atomicity, so this check comes before the scope is even resolved.
  if (isGucBound()) {
    return query(args);
  }

  const scope = resolveGucScope(provider);
  if (scope === undefined) {
    return query(args);
  }

  const results = await client.$transaction([
    client.$executeRaw`SELECT set_config('app.account_id', ${scope}, true)`,
    query(args),
  ]);
  return results[results.length - 1];
}

/**
 * @function tenantGuardWithGucBindingExtension
 * @description Returns the ONE Prisma `$extends` definition the API composition root applies:
 *   the tenant guard (layer 1) wrapping the request-scoped GUC binding (layer 2). Both
 *   decisions stay in their own pure functions — `tenantGuardCheck` and
 *   {@link bindGucForOperation} — so each is unit-testable on its own; this factory only
 *   nests them in the order the composition demands.
 *
 *   The client is a PARAMETER rather than something the extension reaches for. Prisma's
 *   `defineExtension` also accepts a callback that receives the client, but the object form is
 *   what composes reliably across this repo's resolvers, and the batch transaction has to be
 *   opened on a client the caller already holds.
 * @param client - The client the two-statement batch transaction is opened on. Pass the same
 *   client this extension is applied to.
 * @param provider - Caller-supplied lookup for tenant + system context. ONE object, read by
 *   both halves.
 * @returns A Prisma extension definition ready for `$extends`.
 */
export function tenantGuardWithGucBindingExtension(
  client: unknown,
  provider: TenantContextProvider
) {
  const host = client as GucBindingHost;
  return Prisma.defineExtension({
    name: "tenantGuardWithGucBinding",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          return tenantGuardCheck(
            {
              model,
              operation,
              args: args as Record<string, unknown>,
              // The guard's `query` is the binding: whatever the guard decides to run — with
              // `where.accountId` injected, or a create's `data` filled in — runs inside the
              // GUC-bound transaction, and a guard throw happens before that transaction is
              // ever opened.
              query: (guardedArgs: unknown) =>
                bindGucForOperation(
                  {
                    client: host,
                    args: guardedArgs,
                    query: query as (a: unknown) => Promise<unknown>,
                  },
                  provider
                ),
            },
            provider
          );
        },
      },
    },
  });
}
