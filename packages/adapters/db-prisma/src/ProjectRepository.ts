/**
 * @file ProjectRepository.ts
 * @description Prisma-backed repository for Project entities — creates and retrieves projects
 *              scoped to an account with locale metadata.
 * @layer infrastructure
 */
import { ok, err, type Result } from "@shared/types";
import type { PrismaClient } from "@infra/prisma";
import { withGucBoundTransaction } from "@infra/prisma/extensions/tenantGuc.js";
import { createLogger } from "@observability/logger";

const logger = createLogger("adapter:db-prisma:project");

export interface CreateProjectInput {
  name: string;
  locale: "es" | "en";
}

/**
 * `Project` is RLS-covered, and this package is shared with the workers, where no request-scoped
 * tenant context exists to bind from. So every statement that touches it runs inside a
 * transaction that binds `app.account_id` EXPLICITLY from the account the caller already passed
 * — the pattern `ChannelRepository` established here, applied to the second covered table this
 * package reads. Under a role that cannot bypass row security an unbound read returns nothing,
 * silently, so binding is what keeps these methods answering at all after the cutover.
 */
export function createProjectRepository(prisma: PrismaClient) {
  return {
    async createProject(
      accountId: string,
      input: CreateProjectInput
    ): Promise<
      Result<
        { id: string; name: string; accountId: string },
        "QUOTA_EXCEEDED" | "NAME_TAKEN" | "ACCOUNT_NOT_FOUND" | "DATABASE_ERROR"
      >
    > {
      try {
        // One transaction for the quota read and the insert, bound to the caller's account:
        // the `_count` of projects is itself an RLS-covered read, so an unbound check would
        // report zero projects for every account and wave every create through the quota.
        const created = await withGucBoundTransaction(prisma, accountId, async (tx) => {
          // Check if account exists and get current project count
          const account = await tx.account.findUnique({
            where: { id: accountId },
            include: { _count: { select: { projects: true } } },
          });

          if (!account) {
            return err("ACCOUNT_NOT_FOUND" as const);
          }

          // Check quota
          if (account._count.projects >= account.maxProjects) {
            return err("QUOTA_EXCEEDED" as const);
          }

          // Create project
          const project = await tx.project.create({
            data: {
              accountId,
              name: input.name,
              locale: input.locale || "es",
            },
          });

          return ok({
            id: project.id,
            name: project.name,
            accountId: project.accountId,
          });
        });

        return created;
      } catch (error) {
        logger.error(
          {
            err: error,
            code:
              error instanceof Error && "code" in error
                ? (error as Record<string, unknown>).code
                : undefined,
            meta:
              error instanceof Error && "meta" in error
                ? (error as Record<string, unknown>).meta
                : undefined,
          },
          "createProject error"
        );

        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "P2002" &&
          "meta" in error &&
          error.meta &&
          typeof error.meta === "object" &&
          "target" in error.meta
        ) {
          const target = (error.meta as Record<string, unknown>).target;
          logger.error({ target }, "P2002 unique constraint violation");

          // Check for various ways Prisma might format the constraint name
          if (
            Array.isArray(target) &&
            (target.includes("name") ||
              target.some((t: string) => typeof t === "string" && t.includes("name")) ||
              target.some(
                (t: string) => typeof t === "string" && t.includes("Project_accountId_name")
              ))
          ) {
            logger.error("Detected NAME_TAKEN scenario");
            return err("NAME_TAKEN");
          }
        }
        logger.error({ err: error }, "createProject fallthrough error");
        return err("DATABASE_ERROR");
      }
    },

    async getProjectsByAccount(
      accountId: string
    ): Promise<
      Result<
        Array<{ id: string; name: string; accountId: string; createdAt: Date }>,
        "DATABASE_ERROR"
      >
    > {
      try {
        const projects = await withGucBoundTransaction(prisma, accountId, async (tx) =>
          tx.project.findMany({
            where: { accountId },
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              name: true,
              accountId: true,
              createdAt: true,
            },
          })
        );

        return ok(projects);
      } catch (error) {
        logger.error({ err: error }, "getProjectsByAccount error");
        return err("DATABASE_ERROR");
      }
    },

    async deleteProject(id: string): Promise<Result<void, "NOT_FOUND" | "DATABASE_ERROR">> {
      // Deliberately NOT bound, and deliberately not `__system__`. This signature carries no
      // account, so there is nothing to scope the delete to, and a system bypass would hand an
      // unscoped delete-by-id the right to remove any tenant's project. Under a role that cannot
      // bypass row security the policy refuses the row and this returns NOT_FOUND — fail-closed,
      // which is the correct answer to a destructive call that cannot say whose data it is
      // touching. The tenant-scoped deletion path is the API's own `DeleteProjectUseCase`, which
      // runs inside a unit of work that binds the caller's account.
      try {
        await prisma.project.delete({
          where: { id },
        });
        return ok(undefined);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "P2025") {
          return err("NOT_FOUND");
        }
        logger.error({ err: error }, "deleteProject error");
        return err("DATABASE_ERROR");
      }
    },
  };
}
