/**
 * @file uniqueViolationMapping.test.ts
 * @description Pins how `createAccount` and `createProject` turn a duplicate into their typed
 *   errors, `EMAIL_TAKEN` and `NAME_TAKEN`. Each insert raises the P2002 Prisma 7 raises through
 *   `@prisma/adapter-pg`, measured on PostgreSQL 16 on 2026-10-15: the constraint sits at
 *   `meta.driverAdapterError.cause.constraint`, as `{ index }` on 7.10.0 and as PostgreSQL's
 *   quoted column list on 7.9.1, and `meta.target` is absent. Tier 0: no database, no Redis.
 * @layer infrastructure
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { PrismaClient } from "@infra/prisma";
import { createAccountRepository } from "../src/AccountRepository.js";
import { createProjectRepository } from "../src/ProjectRepository.js";

const ACCOUNT_ID = "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f";

/** A breaker that runs the operation directly, so the repository sees the client's own failure. */
const PASS_THROUGH = { fire: (operation: () => Promise<unknown>) => operation() };

/**
 * @param constraint - The constraint as the driver adapter reports it.
 * @returns A P2002 in the measured Prisma 7 shape, carrying that constraint.
 */
function uniqueViolation(constraint: unknown): Error {
  return Object.assign(new Error("Unique constraint failed"), {
    name: "PrismaClientKnownRequestError",
    code: "P2002",
    meta: {
      driverAdapterError: {
        name: "DriverAdapterError",
        cause: { originalCode: "23505", kind: "UniqueConstraintViolation", constraint },
      },
    },
  });
}

/** An account repository whose `account.create` raises the given error. */
function accountsRaising(error: Error) {
  const prisma = {
    account: { create: (): Promise<never> => Promise.reject(error) },
  } as unknown as PrismaClient;
  return createAccountRepository(PASS_THROUGH, PASS_THROUGH, prisma);
}

/**
 * A project repository whose `project.create` raises the given error, inside the GUC-bound
 * transaction `createProject` opens, for an account that has room for another project.
 */
function projectsRaising(error: Error) {
  const tx = {
    $executeRaw: (): Promise<number> => Promise.resolve(1),
    account: {
      findUnique: () =>
        Promise.resolve({ id: ACCOUNT_ID, maxProjects: 5, _count: { projects: 0 } }),
    },
    project: { create: (): Promise<never> => Promise.reject(error) },
  };
  const prisma = {
    $transaction: (work: (client: typeof tx) => Promise<unknown>) => work(tx),
  } as unknown as PrismaClient;
  return createProjectRepository(prisma);
}

describe("createAccount — a duplicate e-mail", () => {
  it("answers EMAIL_TAKEN when Prisma 7.10.0 names the Account_email_key index", async () => {
    const accounts = accountsRaising(uniqueViolation({ index: "Account_email_key" }));

    const result = await accounts.createAccount({ email: "taken@example.test", name: "Taken" });

    assert.deepStrictEqual(result, { ok: false, error: "EMAIL_TAKEN" });
  });

  it("answers EMAIL_TAKEN when Prisma 7.9.1 names the e-mail column", async () => {
    const accounts = accountsRaising(uniqueViolation({ fields: ["email"] }));

    const result = await accounts.createAccount({ email: "taken@example.test", name: "Taken" });

    assert.deepStrictEqual(result, { ok: false, error: "EMAIL_TAKEN" });
  });

  it("answers DATABASE_ERROR for a collision on another unique index", async () => {
    const accounts = accountsRaising(uniqueViolation({ index: "Account_slug_key" }));

    const result = await accounts.createAccount({ email: "taken@example.test", name: "Taken" });

    assert.deepStrictEqual(result, { ok: false, error: "DATABASE_ERROR" });
  });

  it("answers DATABASE_ERROR when the constraint arrives in a shape it cannot read", async () => {
    const accounts = accountsRaising(uniqueViolation({ name: "Account_email_key" }));

    const result = await accounts.createAccount({ email: "taken@example.test", name: "Taken" });

    assert.deepStrictEqual(result, { ok: false, error: "DATABASE_ERROR" });
  });
});

describe("createProject — a duplicate name in the account", () => {
  it("answers NAME_TAKEN when Prisma 7.10.0 names the Project_accountId_name_key index", async () => {
    const projects = projectsRaising(uniqueViolation({ index: "Project_accountId_name_key" }));

    const result = await projects.createProject(ACCOUNT_ID, { name: "Taken", locale: "en" });

    assert.deepStrictEqual(result, { ok: false, error: "NAME_TAKEN" });
  });

  it("answers NAME_TAKEN when Prisma 7.9.1 names the quoted account and name columns", async () => {
    const projects = projectsRaising(uniqueViolation({ fields: ['"accountId"', "name"] }));

    const result = await projects.createProject(ACCOUNT_ID, { name: "Taken", locale: "en" });

    assert.deepStrictEqual(result, { ok: false, error: "NAME_TAKEN" });
  });

  it("answers DATABASE_ERROR for a collision on another unique index", async () => {
    const projects = projectsRaising(uniqueViolation({ index: "Project_id_accountId_key" }));

    const result = await projects.createProject(ACCOUNT_ID, { name: "Taken", locale: "en" });

    assert.deepStrictEqual(result, { ok: false, error: "DATABASE_ERROR" });
  });
});
