/**
 * @file ProjectRepository.ts
 * @description Prisma-backed repository for Project entities — creates and retrieves projects
 *              scoped to an account with locale metadata.
 * @layer infrastructure
 */
import { ok, err, type Result } from "@shared/types";
import { prisma } from "@infra/prisma";
import { createLogger } from "@observability/logger";

const logger = createLogger("adapter:db-prisma:project");

export interface CreateProjectInput {
  name: string;
  locale: "es" | "en";
}

export function createProjectRepository() {
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
        // Check if account exists and get current project count
        const account = await prisma.account.findUnique({
          where: { id: accountId },
          include: { _count: { select: { projects: true } } },
        });

        if (!account) {
          return err("ACCOUNT_NOT_FOUND");
        }

        // Check quota
        if (account._count.projects >= account.maxProjects) {
          return err("QUOTA_EXCEEDED");
        }

        // Create project
        const project = await prisma.project.create({
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
        const projects = await prisma.project.findMany({
          where: { accountId },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            name: true,
            accountId: true,
            createdAt: true,
          },
        });

        return ok(projects);
      } catch (error) {
        logger.error({ err: error }, "getProjectsByAccount error");
        return err("DATABASE_ERROR");
      }
    },

    async deleteProject(id: string): Promise<Result<void, "NOT_FOUND" | "DATABASE_ERROR">> {
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
