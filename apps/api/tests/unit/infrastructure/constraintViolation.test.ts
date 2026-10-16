/**
 * @file constraintViolation.test.ts
 * @description Pins `infra/prisma/src/extensions/constraintViolation.ts`, the one reader of the
 *   constraint a Prisma 7 known-request error names. `infra/prisma` has no test runner of its
 *   own, so its extensions are tested here, as `tenantGuard.test.ts` tests the guard.
 *
 *   Every positive case raises the shape measured on PostgreSQL 16 through `@prisma/adapter-pg`
 *   (`../helpers/prismaKnownRequestErrors.ts`): the index name of 7.10.0 and the quoted column
 *   list of 7.9.1. Every other shape must read as unknown, so a repository falls back to its
 *   generic failure rather than mapping a collision it cannot identify.
 * @layer infrastructure
 */
import { describe, expect, it } from "vitest";
import {
  isUniqueViolationOf,
  violatedConstraint,
} from "@infra/prisma/extensions/constraintViolation.js";
import {
  foreignKeyViolationOnIndex,
  uniqueViolationOnFields,
  uniqueViolationOnIndex,
  uniqueViolationWithConstraint,
} from "../helpers/prismaKnownRequestErrors.js";

const ACCOUNT_EMAIL = { index: "Account_email_key", fields: ["email"] } as const;
const PROJECT_NAME = {
  index: "Project_accountId_name_key",
  fields: ["accountId", "name"],
} as const;

describe("violatedConstraint", () => {
  it("returns the index name Prisma 7.10.0 reports", () => {
    expect(violatedConstraint(uniqueViolationOnIndex("Account_email_key", "Account"))).toEqual({
      index: "Account_email_key",
    });
  });

  it("returns the columns Prisma 7.9.1 reports, with PostgreSQL's quotes removed", () => {
    const error = uniqueViolationOnFields(['"accountId"', "name"], PROJECT_NAME.index, "Project");

    expect(violatedConstraint(error)).toEqual({ fields: ["accountId", "name"] });
  });

  it("undoes the doubled quote PostgreSQL escapes inside a quoted identifier", () => {
    const error = uniqueViolationWithConstraint({ fields: ['"odd""name"'] });

    expect(violatedConstraint(error)).toEqual({ fields: ['odd"name'] });
  });

  it("reads a foreign-key violation's constraint the same way", () => {
    const error = foreignKeyViolationOnIndex("Project_accountId_fkey", "Project");

    expect(violatedConstraint(error)).toEqual({ index: "Project_accountId_fkey" });
  });

  it.each([
    ["the Prisma 5 and 6 meta.target", { code: "P2002", meta: { target: ["email"] } }],
    ["no meta at all", { code: "P2002" }],
    ["a value that is not an object", "P2002"],
    ["null", null],
    ["a cause with no constraint", uniqueViolationWithConstraint(undefined)],
    ["both keys at once", uniqueViolationWithConstraint({ index: "a_key", fields: ["a"] })],
    ["an unknown key", uniqueViolationWithConstraint({ name: "Account_email_key" })],
    ["an empty index name", uniqueViolationWithConstraint({ index: "" })],
    ["an empty column list", uniqueViolationWithConstraint({ fields: [] })],
    ["a column that is not a string", uniqueViolationWithConstraint({ fields: ["email", 7] })],
    ["an empty column name", uniqueViolationWithConstraint({ fields: [""] })],
  ])("returns null for %s", (_label, error) => {
    expect(violatedConstraint(error)).toBeNull();
  });
});

describe("isUniqueViolationOf", () => {
  it("matches the constraint by its index name (7.10.0)", () => {
    const error = uniqueViolationOnIndex("Account_email_key", "Account");

    expect(isUniqueViolationOf(error, ACCOUNT_EMAIL)).toBe(true);
  });

  it("matches the constraint by its ordered columns (7.9.1)", () => {
    const error = uniqueViolationOnFields(['"accountId"', "name"], PROJECT_NAME.index, "Project");

    expect(isUniqueViolationOf(error, PROJECT_NAME)).toBe(true);
  });

  it("does not match another index of the same table", () => {
    const error = uniqueViolationOnIndex("Account_slug_key", "Account");

    expect(isUniqueViolationOf(error, ACCOUNT_EMAIL)).toBe(false);
  });

  it("does not match a column list in another order", () => {
    const error = uniqueViolationOnFields(["name", '"accountId"'], PROJECT_NAME.index, "Project");

    expect(isUniqueViolationOf(error, PROJECT_NAME)).toBe(false);
  });

  it("does not match a column list that only contains the constraint's columns", () => {
    const error = uniqueViolationOnFields(['"accountId"', "email"], "x_key", "CustomerUser");

    expect(isUniqueViolationOf(error, ACCOUNT_EMAIL)).toBe(false);
  });

  it("does not match a foreign-key violation that names the same index", () => {
    const error = foreignKeyViolationOnIndex("Account_email_key", "Account");

    expect(isUniqueViolationOf(error, ACCOUNT_EMAIL)).toBe(false);
  });

  it("does not match a constraint it cannot read", () => {
    const error = uniqueViolationWithConstraint({ name: "Account_email_key" });

    expect(isUniqueViolationOf(error, ACCOUNT_EMAIL)).toBe(false);
  });
});
