/**
 * @file tenantTransaction.test.ts
 * @description Unit surface of `withTenantTransaction` — the one-line rule a
 *   repository adopts instead of restating the join-or-open ternary. Two
 *   branches, each with the regression that flips it:
 *   - JOIN: an active unit-of-work transaction receives `fn` DIRECTLY (no new
 *     transaction, no re-binding). Red = opening a standalone transaction
 *     anyway, which is exactly the atomicity escape 0d-1a demonstrated (a write
 *     surviving its caller's rollback).
 *   - OPEN: with no unit of work active, the call routes through
 *     `withGucBoundTransaction` with the AMBIENT scope, so the standalone
 *     transaction is GUC-bound (or deliberately unbound when no scope exists).
 *     Red = bypassing the seam or dropping the ambient scope.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { withTenantTransaction } from "../../../../src/infrastructure/unitofwork/tenantTransaction.js";
import { PrismaUnitOfWork } from "../../../../src/infrastructure/unitofwork/PrismaUnitOfWork.js";
import * as tenantGuc from "@infra/prisma/extensions/tenantGuc.js";
import { withTenantContext } from "../../../../src/security/tenantContext.js";

describe("withTenantTransaction", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("joins the active unit-of-work transaction without opening a new one", async () => {
    const activeTx = { post: { create: vi.fn() } };
    vi.spyOn(PrismaUnitOfWork, "getTransactionClient").mockReturnValue(activeTx as never);
    const seamSpy = vi.spyOn(tenantGuc, "withGucBoundTransaction");
    const prisma = { $transaction: vi.fn() };

    const result = await withTenantTransaction(prisma as never, async (tx) => {
      expect(tx).toBe(activeTx);
      return "joined";
    });

    expect(result).toBe("joined");
    expect(seamSpy).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("opens through the GUC seam with the ambient tenant scope when no unit of work is active", async () => {
    vi.spyOn(PrismaUnitOfWork, "getTransactionClient").mockReturnValue(undefined as never);
    const seamSpy = vi
      .spyOn(tenantGuc, "withGucBoundTransaction")
      .mockResolvedValue("opened" as never);

    const fn = vi.fn(async () => "opened");
    const result = await withTenantContext({ accountId: "acc-under-test" }, () =>
      withTenantTransaction({} as never, fn)
    );

    expect(result).toBe("opened");
    expect(seamSpy).toHaveBeenCalledTimes(1);
    expect(seamSpy.mock.calls[0]?.[1]).toBe("acc-under-test");
  });

  it("opens deliberately unbound when neither unit of work nor tenant scope exists", async () => {
    vi.spyOn(PrismaUnitOfWork, "getTransactionClient").mockReturnValue(undefined as never);
    const seamSpy = vi
      .spyOn(tenantGuc, "withGucBoundTransaction")
      .mockResolvedValue("unbound" as never);

    const result = await withTenantTransaction({} as never, async () => "unbound");

    expect(result).toBe("unbound");
    expect(seamSpy).toHaveBeenCalledTimes(1);
    expect(seamSpy.mock.calls[0]?.[1]).toBeUndefined();
  });
});
