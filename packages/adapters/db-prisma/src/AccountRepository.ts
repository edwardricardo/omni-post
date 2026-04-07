import {
  ok,
  err,
  type Result,
  type Account,
  type CreateAccountInput,
  type UpdateAccountInput,
} from "@shared/types";
import { prisma } from "@infra/prisma";
import type { SubscriptionTier } from "@shared/types";
import { createLogger } from "@observability/logger";

const logger = createLogger("adapter:db-prisma:account");

export function createAccountRepository(
  readBreaker: { fire: (fn: () => Promise<unknown>) => Promise<unknown> },
  writeBreaker: { fire: (fn: () => Promise<unknown>) => Promise<unknown> }
) {
  return {
    async createAccount(
      input: CreateAccountInput
    ): Promise<Result<Account, "EMAIL_TAKEN" | "DATABASE_ERROR">> {
      try {
        const result = await writeBreaker.fire(() => {
          const maxProjects = input.maxProjects || 1;

          return prisma.account.create({
            data: {
              email: input.email,
              name: input.name,
              maxProjects,
            },
          });
        });

        const dbResult = result as {
          id: string;
          email: string;
          name: string;
          maxProjects: number;
          createdAt: Date;
          updatedAt: Date;
        };

        const account: Account = {
          id: dbResult.id,
          email: dbResult.email,
          name: dbResult.name,

          maxProjects: dbResult.maxProjects,
          createdAt: dbResult.createdAt,
          updatedAt: dbResult.updatedAt,
        };

        return ok(account);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "P2002" &&
          "meta" in error &&
          error.meta &&
          typeof error.meta === "object" &&
          "target" in error.meta &&
          Array.isArray(error.meta.target) &&
          error.meta.target.includes("email")
        ) {
          return err("EMAIL_TAKEN");
        }
        logger.error({ err: error }, "createAccount error");
        return err("DATABASE_ERROR");
      }
    },

    async getAccountById(id: string): Promise<Result<Account, "NOT_FOUND" | "DATABASE_ERROR">> {
      try {
        const result = await readBreaker.fire(() => {
          return prisma.account.findUnique({
            where: { id },
          });
        });

        if (!result) {
          return err("NOT_FOUND");
        }

        const dbResult = result as {
          id: string;
          email: string;
          name: string;
          maxProjects: number;
          createdAt: Date;
          updatedAt: Date;
        };
        const account: Account = {
          id: dbResult.id,
          email: dbResult.email,
          name: dbResult.name,

          maxProjects: dbResult.maxProjects,
          createdAt: dbResult.createdAt,
          updatedAt: dbResult.updatedAt,
        };

        return ok(account);
      } catch (error) {
        logger.error({ err: error }, "getAccountById error");
        return err("DATABASE_ERROR");
      }
    },

    async getAccountByEmail(
      email: string
    ): Promise<Result<Account, "NOT_FOUND" | "DATABASE_ERROR">> {
      try {
        const account = await prisma.account.findUnique({
          where: { email },
        });

        if (!account) {
          return err("NOT_FOUND");
        }

        const result: Account = {
          id: account.id,
          email: account.email,
          name: account.name,

          maxProjects: account.maxProjects,
          createdAt: account.createdAt,
          updatedAt: account.updatedAt,
        };

        return ok(result);
      } catch (error) {
        logger.error({ err: error }, "getAccountByEmail error");
        return err("DATABASE_ERROR");
      }
    },

    async updateAccount(
      id: string,
      input: UpdateAccountInput
    ): Promise<Result<Account, "NOT_FOUND" | "DATABASE_ERROR">> {
      try {
        const updateData: Record<string, unknown> = {};
        if (input.name !== undefined) updateData.name = input.name;
        if (input.maxProjects !== undefined) updateData.maxProjects = input.maxProjects;

        const account = await prisma.account.update({
          where: { id },
          data: updateData,
        });

        const result: Account = {
          id: account.id,
          email: account.email,
          name: account.name,

          maxProjects: account.maxProjects,
          createdAt: account.createdAt,
          updatedAt: account.updatedAt,
        };

        return ok(result);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "P2025") {
          return err("NOT_FOUND");
        }
        logger.error({ err: error }, "updateAccount error");
        return err("DATABASE_ERROR");
      }
    },

    async deleteAccount(id: string): Promise<Result<void, "NOT_FOUND" | "DATABASE_ERROR">> {
      try {
        await prisma.account.delete({
          where: { id },
        });
        return ok(undefined);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "P2025") {
          return err("NOT_FOUND");
        }
        logger.error({ err: error }, "deleteAccount error");
        return err("DATABASE_ERROR");
      }
    },

    async listAccounts(): Promise<Result<Account[], "DATABASE_ERROR">> {
      try {
        const accounts = await prisma.account.findMany({
          orderBy: { createdAt: "desc" },
        });

        const result: Account[] = accounts.map((account) => ({
          id: account.id,
          email: account.email,
          name: account.name,

          maxProjects: account.maxProjects,
          createdAt: account.createdAt,
          updatedAt: account.updatedAt,
        }));

        return ok(result);
      } catch (error) {
        logger.error({ err: error }, "listAccounts error");
        return err("DATABASE_ERROR");
      }
    },
  };
}
