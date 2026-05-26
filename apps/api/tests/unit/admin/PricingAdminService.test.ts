/**
 * @file pricingAdminService.test.ts
 * @description Unit tests for PricingAdminService with a mocked Prisma client:
 *              tier/bundle reads, slug-uniqueness on create, the active-
 *              subscription delete guard, unique-constraint mapping, and the
 *              NOT_FOUND mapping for updates/toggles.
 * @layer infrastructure
 */
import { describe, it, expect, vi } from "vitest";
import { PricingAdminService } from "../../../src/admin/PricingAdminService.js";
import type { PrismaClient } from "@infra/prisma";

function makePrisma(over: Record<string, unknown> = {}) {
  return {
    providerPricingTier: {
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => ({ id: "pt-1" })),
      create: vi.fn(async () => ({ id: "pt-1" })),
    },
    accountPricingTier: {
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => ({ id: "at-1" })),
      create: vi.fn(async () => ({ id: "at-1" })),
    },
    providerBundle: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      update: vi.fn(async () => ({ id: "b-1" })),
      create: vi.fn(async () => ({ id: "b-1" })),
      delete: vi.fn(async () => ({ id: "b-1" })),
    },
    accountSubscription: {
      count: vi.fn(async () => 0),
    },
    ...over,
  };
}

const svc = (p: ReturnType<typeof makePrisma>) =>
  new PricingAdminService(p as unknown as PrismaClient);

describe("PricingAdminService", () => {
  describe("getTiers", () => {
    it("returns provider tiers, account tiers and bundles", async () => {
      const p = makePrisma();
      const result = await svc(p).getTiers();
      expect(result).toHaveProperty("providerTiers");
      expect(result).toHaveProperty("accountTiers");
      expect(result).toHaveProperty("bundles");
    });
  });

  describe("createBundle", () => {
    it("returns SLUG_EXISTS when the slug is taken", async () => {
      const p = makePrisma();
      p.providerBundle.findUnique = vi.fn(async () => ({ id: "existing" }));
      const result = await svc(p).createBundle({
        name: "B",
        slug: "b",
        description: "d",
        providers: ["X"],
        pricePerAccountMonth: 10,
        isActive: true,
        sortOrder: 0,
      });
      expect(!result.ok && result.error).toBe("SLUG_EXISTS");
    });

    it("creates the bundle when the slug is free", async () => {
      const p = makePrisma();
      const result = await svc(p).createBundle({
        name: "B",
        slug: "b",
        description: "d",
        providers: ["X"],
        pricePerAccountMonth: 10,
        isActive: true,
        sortOrder: 0,
      });
      expect(result.ok).toBe(true);
      expect(p.providerBundle.create).toHaveBeenCalledOnce();
    });
  });

  describe("deleteBundle", () => {
    it("refuses deletion when active subscriptions reference the bundle", async () => {
      const p = makePrisma();
      p.accountSubscription.count = vi.fn(async () => 3);
      const result = await svc(p).deleteBundle("b-1");
      expect(!result.ok && result.error).toBe("HAS_SUBSCRIPTIONS");
      expect(p.providerBundle.delete).not.toHaveBeenCalled();
    });

    it("deletes when no subscriptions reference the bundle", async () => {
      const p = makePrisma();
      const result = await svc(p).deleteBundle("b-1");
      expect(result.ok).toBe(true);
      expect(p.providerBundle.delete).toHaveBeenCalledOnce();
    });
  });

  describe("createProviderTier", () => {
    it("maps a unique-constraint violation to DUPLICATE", async () => {
      const p = makePrisma();
      p.providerPricingTier.create = vi.fn(async () => {
        throw new Error("Unique constraint failed on the fields: (`minProviders`)");
      });
      const result = await svc(p).createProviderTier({ minProviders: 1, pricePerProviderMonth: 5 });
      expect(!result.ok && result.error).toBe("DUPLICATE");
    });
  });

  describe("updates / toggles", () => {
    it("maps a missing record to NOT_FOUND on updateProviderTier", async () => {
      const p = makePrisma();
      p.providerPricingTier.update = vi.fn(async () => {
        throw new Error("Record to update not found.");
      });
      const result = await svc(p).updateProviderTier("nope", { minProviders: 2 });
      expect(!result.ok && result.error).toBe("NOT_FOUND");
    });

    it("toggles account tier status", async () => {
      const p = makePrisma();
      const result = await svc(p).toggleAccountTierStatus("at-1", false);
      expect(result.ok).toBe(true);
      expect(p.accountPricingTier.update).toHaveBeenCalledOnce();
    });
  });
});
