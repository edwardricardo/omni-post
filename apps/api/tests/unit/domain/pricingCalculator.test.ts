/**
 * @file pricingCalculator.test.ts
 * @description Unit tests for PricingCalculator domain service.
 *              Tests the complete provider-based pricing model.
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import assert from "node:assert/strict";
import { PricingCalculator } from "@core/domain/billing/PricingCalculator.js";
import type {
  ProviderTier,
  AccountTier,
  BundleDef,
  PriceQuote,
  BundleMatch,
} from "@core/domain/billing/PricingCalculator.js";
import { InvariantViolationError } from "@core/domain/errors/DomainError.js";
import type { Result } from "@shared/types";

function unwrapQuote(result: Result<PriceQuote, InvariantViolationError>): PriceQuote {
  assert.ok(result.ok, `expected ok result, got: ${result.ok ? "ok" : result.error.message}`);
  return result.value;
}

function unwrapBundleMatch(
  result: Result<BundleMatch | null, InvariantViolationError>
): BundleMatch | null {
  assert.ok(result.ok, `expected ok result, got: ${result.ok ? "ok" : result.error.message}`);
  return result.value;
}

const providerTiers: ProviderTier[] = [
  { minProviders: 1, maxProviders: 1, pricePerProviderMonth: 12, isActive: true },
  { minProviders: 2, maxProviders: 3, pricePerProviderMonth: 10, isActive: true },
  { minProviders: 4, maxProviders: 6, pricePerProviderMonth: 8, isActive: true },
  { minProviders: 7, maxProviders: null, pricePerProviderMonth: 6, isActive: true },
];

const accountTiers: AccountTier[] = [
  { minAccounts: 1, maxAccounts: 1, multiplier: 1.0, isActive: true },
  { minAccounts: 2, maxAccounts: 3, multiplier: 0.8, isActive: true },
  { minAccounts: 4, maxAccounts: 9, multiplier: 0.65, isActive: true },
  { minAccounts: 10, maxAccounts: null, multiplier: 0.5, isActive: true },
];

const bundles: BundleDef[] = [
  {
    id: "b1",
    name: "Creator",
    slug: "creator",
    providers: ["X", "INSTAGRAM", "YOUTUBE"],
    pricePerAccountMonth: 25,
    isActive: true,
  },
  {
    id: "b2",
    name: "Social Pro",
    slug: "social-pro",
    providers: ["X", "INSTAGRAM", "FACEBOOK", "LINKEDIN"],
    pricePerAccountMonth: 32,
    isActive: true,
  },
  {
    id: "b3",
    name: "Agency Full",
    slug: "agency-full",
    providers: [
      "X",
      "INSTAGRAM",
      "FACEBOOK",
      "YOUTUBE",
      "TIKTOK",
      "LINKEDIN",
      "PINTEREST",
      "SNAPCHAT",
      "TELEGRAM",
      "BLUESKY",
    ],
    pricePerAccountMonth: 55,
    isActive: true,
  },
];

describe("PricingCalculator.calculateCustomPrice()", () => {
  it("1 provider, 1 account = $12", () => {
    const { total } = unwrapQuote(
      PricingCalculator.calculateCustomPrice(1, 1, providerTiers, accountTiers)
    );
    assert.strictEqual(total, 12);
  });

  it("3 providers, 1 account = $30", () => {
    const { total } = unwrapQuote(
      PricingCalculator.calculateCustomPrice(3, 1, providerTiers, accountTiers)
    );
    assert.strictEqual(total, 30);
  });

  it("3 providers, 3 accounts applies volume discount on accounts 2 and 3", () => {
    // Account 1: $30 x 1.0 = $30
    // Account 2: $30 x 0.8 = $24
    // Account 3: $30 x 0.8 = $24
    // Total: $78
    const { total } = unwrapQuote(
      PricingCalculator.calculateCustomPrice(3, 3, providerTiers, accountTiers)
    );
    assert.strictEqual(total, 78);
  });

  it("7 providers triggers lowest per-provider tier ($6)", () => {
    const { breakdown } = unwrapQuote(
      PricingCalculator.calculateCustomPrice(7, 1, providerTiers, accountTiers)
    );
    assert.strictEqual(breakdown.pricePerProvider, 6);
  });

  it("10 custom providers = $60 (10 x $6)", () => {
    const { total } = unwrapQuote(
      PricingCalculator.calculateCustomPrice(10, 1, providerTiers, accountTiers)
    );
    assert.strictEqual(total, 60);
  });

  it("4 providers, 5 accounts with deep discount", () => {
    // Per-provider: $8 (4-6 tier)
    // Base/account: $32
    // Account 1: $32 x 1.0 = $32
    // Account 2: $32 x 0.8 = $25.60
    // Account 3: $32 x 0.8 = $25.60
    // Account 4: $32 x 0.65 = $20.80
    // Account 5: $32 x 0.65 = $20.80
    // Total: $124.80
    const { total } = unwrapQuote(
      PricingCalculator.calculateCustomPrice(4, 5, providerTiers, accountTiers)
    );
    assert.strictEqual(total, 124.8);
  });

  it("calculates savings vs no-discount", () => {
    const { breakdown } = unwrapQuote(
      PricingCalculator.calculateCustomPrice(3, 3, providerTiers, accountTiers)
    );
    // No discount: $30 x 3 = $90. With discount: $78. Savings: $12
    assert.strictEqual(breakdown.savings, 12);
  });

  it("returns InvariantViolationError when no tier covers provider count (0 providers)", () => {
    const result = PricingCalculator.calculateCustomPrice(0, 1, providerTiers, accountTiers);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(InvariantViolationError);
      expect(result.error.code).toBe("INVARIANT_VIOLATION");
      expect(result.error.message).toContain("provider count 0");
    }
  });
});

describe("PricingCalculator.calculateBundlePrice()", () => {
  it("Creator bundle, 1 account = $25", () => {
    const { total } = unwrapQuote(PricingCalculator.calculateBundlePrice(25, 1, accountTiers));
    assert.strictEqual(total, 25);
  });

  it("Agency Full, 3 accounts applies volume discount", () => {
    // Account 1: $55 x 1.0 = $55
    // Account 2: $55 x 0.8 = $44
    // Account 3: $55 x 0.8 = $44
    // Total: $143
    const { total } = unwrapQuote(PricingCalculator.calculateBundlePrice(55, 3, accountTiers));
    assert.strictEqual(total, 143);
  });
});

describe("PricingCalculator.findCheaperBundle()", () => {
  it("returns Agency Full when 10 custom providers ($60) > Agency Full ($55)", () => {
    const match = unwrapBundleMatch(
      PricingCalculator.findCheaperBundle(
        [
          "X",
          "INSTAGRAM",
          "FACEBOOK",
          "YOUTUBE",
          "TIKTOK",
          "LINKEDIN",
          "PINTEREST",
          "SNAPCHAT",
          "TELEGRAM",
          "BLUESKY",
        ],
        60,
        bundles,
        1,
        accountTiers
      )
    );
    assert.ok(match);
    assert.strictEqual(match.bundle.slug, "agency-full");
    assert.strictEqual(match.savings, 5);
  });

  it("returns null when custom is cheaper than any bundle", () => {
    // 1 provider = $12, no bundle covers just 1 provider at a lower price
    const match = unwrapBundleMatch(
      PricingCalculator.findCheaperBundle(["X"], 12, bundles, 1, accountTiers)
    );
    assert.strictEqual(match, null);
  });

  it("returns null when no bundle covers all selected providers", () => {
    // Creator covers X+IG+YT but not TIKTOK
    const match = unwrapBundleMatch(
      PricingCalculator.findCheaperBundle(
        ["X", "INSTAGRAM", "TIKTOK"],
        30,
        bundles,
        1,
        accountTiers
      )
    );
    // Social Pro doesn't cover TIKTOK either. Agency Full at $55 > $30
    assert.strictEqual(match, null);
  });

  it("returns savings amount", () => {
    const match = unwrapBundleMatch(
      PricingCalculator.findCheaperBundle(
        ["X", "INSTAGRAM", "FACEBOOK", "LINKEDIN"],
        40, // custom = $40 (4 x $8 = $32... actually this would be $32)
        bundles,
        1,
        accountTiers
      )
    );
    // Social Pro covers these 4 at $32. $40 - $32 = $8
    assert.ok(match);
    assert.strictEqual(match.savings, 8);
  });

  it("skips inactive bundles", () => {
    const inactiveBundles = bundles.map((b) =>
      b.slug === "agency-full" ? { ...b, isActive: false } : b
    );
    const match = unwrapBundleMatch(
      PricingCalculator.findCheaperBundle(
        [
          "X",
          "INSTAGRAM",
          "FACEBOOK",
          "YOUTUBE",
          "TIKTOK",
          "LINKEDIN",
          "PINTEREST",
          "SNAPCHAT",
          "TELEGRAM",
          "BLUESKY",
        ],
        60,
        inactiveBundles,
        1,
        accountTiers
      )
    );
    assert.strictEqual(match, null);
  });
});
