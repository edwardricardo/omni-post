/**
 * @file tenantGuard.ts
 * @description Prisma `$extends` middleware that enforces tenant isolation
 *   on queries to tenant-scoped models. Reads tenant + system context via
 *   a caller-supplied provider (dependency injection — no cycle with
 *   apps/api).
 *
 *   The provider is implemented in `apps/api/src/security/tenantContext.ts`
 *   backed by `AsyncLocalStorage`. This file owns only:
 *   - The list of tenant-scoped models (kept in sync with `schema.prisma`)
 *   - The set of guarded operations
 *   - The fail-loud error classes (so non-apps/api consumers can catch)
 *   - The extension factory itself
 *
 *   ## Decision matrix
 *
 *   | Context state            | Model in denylist | Model tenant-scoped | Behavior                                          |
 *   | ------------------------ | ----------------- | ------------------- | ------------------------------------------------- |
 *   | (any)                    | yes               | (n/a)               | bypass — call query unchanged                     |
 *   | SystemContext active     | (any)             | (any)               | bypass — call query unchanged; emit audit hook   |
 *   | TenantContext bound      | no                | yes; no accountId   | inject `where.accountId = ctx.accountId`         |
 *   | TenantContext bound      | no                | yes; accountId set  | validate matches ctx; mismatch → throw           |
 *   | None                     | no                | yes                 | throw TenantContextMissingError                  |
 *
 * @layer infrastructure
 */
import { Prisma } from "../../generated/prisma/client/client.js";

/**
 * Caller-supplied provider that exposes tenant + system context. Apps that
 * use this extension implement these via `AsyncLocalStorage` (see
 * `apps/api/src/security/tenantContext.ts`).
 */
export interface TenantContextProvider {
  getTenantContext(): { accountId: string } | undefined;
  getSystemContext(): { reason: string } | undefined;
}

/**
 * @class TenantContextMissingError
 * @description Thrown by the guard when a tenant-scoped Prisma query runs
 *   without any TenantContext or SystemContext bound. Indicates a code
 *   path that forgot to bind tenant scope — typically a system job that
 *   should run inside `withSystemContext()`.
 */
export class TenantContextMissingError extends Error {
  readonly code = "TENANT_CONTEXT_MISSING";

  constructor(model?: string, operation?: string) {
    super(
      model && operation
        ? `No TenantContext or SystemContext bound for ${model}.${operation}`
        : "No TenantContext or SystemContext bound"
    );
    this.name = "TenantContextMissingError";
  }
}

/**
 * @class TenantContextMismatchError
 * @description Thrown when a Prisma query carries an explicit `accountId`
 *   that disagrees with the bound `TenantContext`. Indicates either a bug
 *   (caller passing the wrong accountId) or an attempted authorization-
 *   bypass (CWE-639).
 */
export class TenantContextMismatchError extends Error {
  readonly code = "TENANT_CONTEXT_MISMATCH";

  constructor(
    readonly model: string,
    readonly contextAccountId: string,
    readonly queryAccountId: string
  ) {
    super(
      `Tenant mismatch on ${model}: context.accountId=${contextAccountId} but query.where.accountId=${queryAccountId}`
    );
    this.name = "TenantContextMismatchError";
  }
}

/**
 * The 50 Prisma models with `accountId` directly on the row. Names are
 * lowerCamelCase model accessors on the Prisma client
 * (`prisma.<name>.findMany`, etc.).
 *
 * **Keep this in sync with `schema.prisma`.** When a new model with
 * `accountId` is added, append it here. Missing entries silently allow
 * cross-tenant access — a CWE-639 (Authorization Bypass) risk.
 */
const TENANT_SCOPED_MODELS = new Set<string>([
  "aIPromptTemplate",
  "accountCredential",
  "accountOnboarding",
  "accountSubscription",
  "aiTokenUsage",
  "apiKey",
  "approvalWorkflow",
  "assetFolder",
  "assetTag",
  "billingEvent",
  "brandKit",
  "brandVoice",
  "bulkScheduleBatch",
  "consentRecord",
  "contentTemplate",
  "conversion",
  "crmActivity",
  "crmConnection",
  "crmContact",
  "customReport",
  "customerUser",
  "dsarRequest",
  "gatewaySwitchEvent",
  "glossary",
  "instagramAnalytics",
  "instagramStoryProject",
  "integrationApiKey",
  "integrationSubscription",
  "invoice",
  "mediaAsset",
  "mention",
  "oidcConfiguration",
  "project",
  "referralCode",
  "repurposeProposal",
  "sagaInstance",
  "samlConfiguration",
  "samlSession",
  "schedulingRule",
  "socialConversation",
  "socialMessage",
  "styleGuideRule",
  "task",
  "template",
  "trackedTerm",
  "trendRadarResult",
  "usageMetric",
  "videoProcessingJob",
  "webhookEvent",
  "webhookSubscription",
]);

const WHERE_OPERATIONS = new Set<string>([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
  "count",
  "aggregate",
  "groupBy",
]);

const CREATE_OPERATIONS = new Set<string>(["create", "createMany", "upsert"]);

const GUARDED_OPERATIONS = new Set<string>([...WHERE_OPERATIONS, ...CREATE_OPERATIONS]);

/**
 * @function tenantGuardCheck
 * @description Pure guard logic — given a `(model, operation, args, query)`
 *   tuple and a `provider`, decides whether to bypass, inject, validate,
 *   or throw. Extracted as a standalone function so unit tests can exercise
 *   the decision matrix without instantiating a Prisma client.
 */
export async function tenantGuardCheck(
  params: {
    model: string;
    operation: string;
    args: Record<string, unknown>;
    query: (args: unknown) => Promise<unknown>;
  },
  provider: TenantContextProvider
): Promise<unknown> {
  const { model, operation, args, query } = params;
  const lowerModel = lowerCamel(model);

  if (!GUARDED_OPERATIONS.has(operation)) {
    return query(args);
  }

  if (!TENANT_SCOPED_MODELS.has(lowerModel)) {
    return query(args);
  }

  const systemCtx = provider.getSystemContext();
  if (systemCtx) {
    return query(args);
  }

  const tenantCtx = provider.getTenantContext();
  if (!tenantCtx) {
    throw new TenantContextMissingError(model, operation);
  }

  if (WHERE_OPERATIONS.has(operation)) {
    const argsWithWhere = args as { where?: Record<string, unknown> };
    const where = (argsWithWhere.where ?? {}) as Record<string, unknown>;
    const existing = where.accountId;

    if (existing === undefined) {
      argsWithWhere.where = { ...where, accountId: tenantCtx.accountId };
    } else if (typeof existing === "string" && existing !== tenantCtx.accountId) {
      throw new TenantContextMismatchError(model, tenantCtx.accountId, existing);
    }
  }

  if (CREATE_OPERATIONS.has(operation)) {
    const argsWithData = args as {
      data?: Record<string, unknown> | Array<Record<string, unknown>>;
      create?: Record<string, unknown>;
    };

    if (argsWithData.data !== undefined) {
      if (Array.isArray(argsWithData.data)) {
        argsWithData.data = argsWithData.data.map((row) =>
          injectAccountIdIfMissing(row, tenantCtx.accountId, model)
        );
      } else {
        argsWithData.data = injectAccountIdIfMissing(argsWithData.data, tenantCtx.accountId, model);
      }
    }
    if (operation === "upsert" && argsWithData.create !== undefined) {
      argsWithData.create = injectAccountIdIfMissing(
        argsWithData.create,
        tenantCtx.accountId,
        model
      );
    }
  }

  return query(args);
}

/**
 * @function tenantGuardExtension
 * @description Returns a Prisma `$extends` definition that wraps every
 *   query to a tenant-scoped model with the isolation guard. The actual
 *   logic lives in `tenantGuardCheck` — this function only wires it into
 *   Prisma's extension API.
 *
 * @param provider - Caller-supplied lookup for tenant + system context.
 */
export function tenantGuardExtension(provider: TenantContextProvider) {
  return Prisma.defineExtension({
    name: "tenantGuard",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          return tenantGuardCheck(
            {
              model,
              operation,
              args: args as Record<string, unknown>,
              query: query as (a: unknown) => Promise<unknown>,
            },
            provider
          );
        },
      },
    },
  });
}

function lowerCamel(modelName: string): string {
  if (!modelName) return modelName;
  return modelName.charAt(0).toLowerCase() + modelName.slice(1);
}

function injectAccountIdIfMissing(
  row: Record<string, unknown>,
  ctxAccountId: string,
  model: string
): Record<string, unknown> {
  const existing = row.accountId;
  if (existing === undefined) {
    return { ...row, accountId: ctxAccountId };
  }
  if (typeof existing === "string" && existing !== ctxAccountId) {
    throw new TenantContextMismatchError(model, ctxAccountId, existing);
  }
  return row;
}

/** Read-only accessor for the tenant-scoped model list (for tests + docgen). */
export function getTenantScopedModels(): ReadonlySet<string> {
  return TENANT_SCOPED_MODELS;
}
