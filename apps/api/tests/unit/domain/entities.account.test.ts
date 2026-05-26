/**
 * @file entities.account.test.ts
 * @description Unit tests for Account domain entity — tenant fields, slug validation,
 *              team/storage/recurring-post capacity checks, and tier limits.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  Account,
  SUBSCRIPTION_TIER,
  type CreateAccountInput,
} from "@core/domain/entities/Account.js";
import { AccountId } from "@core/domain/value-objects/EntityId.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAccount(overrides?: Partial<CreateAccountInput>): Account {
  const input: CreateAccountInput = {
    email: "test@example.com",
    name: "Test Account",
    ...overrides,
  };
  const result = Account.create(input);
  assert.ok(result.ok, `Account.create should succeed: ${JSON.stringify(result)}`);
  return result.value;
}

function makeReconstitutedAccount(
  tier: "BASIC" | "PRO" | "ENTERPRISE",
  overrides?: Record<string, unknown>
): Account {
  return Account.reconstitute(AccountId.generate(), {
    email: "recon@example.com",
    name: "Reconstituted",
    subscription: tier,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Account Entity — Tenant Fields", () => {
  describe("default values", () => {
    it("returns UTC timezone and en locale when not provided", () => {
      const account = makeAccount();
      assert.strictEqual(account.timezone, "UTC");
      assert.strictEqual(account.locale, "en");
      assert.strictEqual(account.slug, undefined);
      assert.strictEqual(account.phone, undefined);
    });

    it("uses provided timezone and locale from create input", () => {
      const account = makeAccount({ timezone: "America/New_York", locale: "es" });
      assert.strictEqual(account.timezone, "America/New_York");
      assert.strictEqual(account.locale, "es");
    });

    it("uses provided slug from create input", () => {
      const account = makeAccount({ slug: "my-company" });
      assert.strictEqual(account.slug, "my-company");
    });
  });

  describe("BASIC tier defaults", () => {
    it("sets correct team, storage, and recurring limits", () => {
      const account = makeAccount({ subscription: SUBSCRIPTION_TIER.BASIC });
      assert.strictEqual(account.maxTeamMembers, 5);
      assert.strictEqual(account.maxStorageBytes, 5_368_709_120n);
      assert.strictEqual(account.maxRecurringPosts, 5);
    });
  });

  describe("PRO tier defaults", () => {
    it("sets correct team, storage, and recurring limits", () => {
      const account = makeAccount({ subscription: SUBSCRIPTION_TIER.PRO });
      assert.strictEqual(account.maxTeamMembers, 15);
      assert.strictEqual(account.maxStorageBytes, 53_687_091_200n);
      assert.strictEqual(account.maxRecurringPosts, 20);
    });
  });

  describe("ENTERPRISE tier defaults", () => {
    it("sets unlimited team members, storage, and recurring posts", () => {
      const account = makeAccount({ subscription: SUBSCRIPTION_TIER.ENTERPRISE });
      assert.strictEqual(account.maxTeamMembers, Infinity);
      assert.strictEqual(account.maxStorageBytes, BigInt(Number.MAX_SAFE_INTEGER));
      assert.strictEqual(account.maxRecurringPosts, Infinity);
    });
  });

  describe("reconstitute with overrides", () => {
    it("respects explicit maxTeamMembers from persistence", () => {
      const account = makeReconstitutedAccount("BASIC", { maxTeamMembers: 99 });
      assert.strictEqual(account.maxTeamMembers, 99);
    });

    it("respects explicit maxStorageBytes from persistence", () => {
      const account = makeReconstitutedAccount("BASIC", {
        maxStorageBytes: 1_000_000n,
      });
      assert.strictEqual(account.maxStorageBytes, 1_000_000n);
    });

    it("respects explicit maxRecurringPosts from persistence", () => {
      const account = makeReconstitutedAccount("PRO", { maxRecurringPosts: 50 });
      assert.strictEqual(account.maxRecurringPosts, 50);
    });

    it("preserves slug, timezone, locale, and phone from persistence", () => {
      const account = makeReconstitutedAccount("BASIC", {
        slug: "acme-corp",
        timezone: "Europe/London",
        locale: "fr",
        phone: "+33612345678",
      });
      assert.strictEqual(account.slug, "acme-corp");
      assert.strictEqual(account.timezone, "Europe/London");
      assert.strictEqual(account.locale, "fr");
      assert.strictEqual(account.phone, "+33612345678");
    });
  });
});

describe("Account Entity — setSlug", () => {
  let account: Account;

  beforeEach(() => {
    account = makeAccount();
  });

  it("accepts a valid slug with lowercase letters and hyphens", () => {
    const result = account.setSlug("acme-corp");
    assert.ok(result.ok, "setSlug should succeed for valid slug");
    assert.strictEqual(account.slug, "acme-corp");
  });

  it("accepts a slug with numbers", () => {
    const result = account.setSlug("team-42");
    assert.ok(result.ok);
    assert.strictEqual(account.slug, "team-42");
  });

  it("accepts a 3-character slug", () => {
    const result = account.setSlug("abc");
    assert.ok(result.ok);
    assert.strictEqual(account.slug, "abc");
  });

  it("accepts a 30-character slug", () => {
    const slug = "a" + "b".repeat(28) + "c";
    const result = account.setSlug(slug);
    assert.ok(result.ok);
    assert.strictEqual(account.slug, slug);
  });

  it("rejects uppercase characters", () => {
    const result = account.setSlug("Acme-Corp");
    assert.ok(!result.ok, "setSlug should reject uppercase");
    expect(result.error.message).toContain("lowercase");
  });

  it("rejects slug shorter than 3 characters", () => {
    const result = account.setSlug("ab");
    assert.ok(!result.ok, "setSlug should reject too short");
    expect(result.error.message).toContain("3 and 30");
  });

  it("rejects slug longer than 30 characters", () => {
    const result = account.setSlug("a".repeat(31));
    assert.ok(!result.ok, "setSlug should reject too long");
    expect(result.error.message).toContain("3 and 30");
  });

  it("rejects special characters (underscores)", () => {
    const result = account.setSlug("acme_corp");
    assert.ok(!result.ok, "setSlug should reject underscores");
    expect(result.error.message).toContain("lowercase");
  });

  it("rejects special characters (spaces)", () => {
    const result = account.setSlug("acme corp");
    assert.ok(!result.ok, "setSlug should reject spaces");
  });

  it("rejects slug starting with hyphen", () => {
    const result = account.setSlug("-acme");
    assert.ok(!result.ok, "setSlug should reject leading hyphen");
  });

  it("rejects slug ending with hyphen", () => {
    const result = account.setSlug("acme-");
    assert.ok(!result.ok, "setSlug should reject trailing hyphen");
  });
});

describe("Account Entity — canAddTeamMember", () => {
  it("returns true when current count is under limit", () => {
    const account = makeReconstitutedAccount("BASIC");
    assert.strictEqual(account.canAddTeamMember(3), true);
  });

  it("returns false when current count equals limit", () => {
    const account = makeReconstitutedAccount("BASIC");
    assert.strictEqual(account.canAddTeamMember(5), false);
  });

  it("returns false when current count exceeds limit", () => {
    const account = makeReconstitutedAccount("BASIC");
    assert.strictEqual(account.canAddTeamMember(6), false);
  });

  it("returns true for ENTERPRISE regardless of count", () => {
    const account = makeReconstitutedAccount("ENTERPRISE");
    assert.strictEqual(account.canAddTeamMember(999_999), true);
  });

  it("returns true for PRO when under 15", () => {
    const account = makeReconstitutedAccount("PRO");
    assert.strictEqual(account.canAddTeamMember(14), true);
  });

  it("returns false for PRO when at 15", () => {
    const account = makeReconstitutedAccount("PRO");
    assert.strictEqual(account.canAddTeamMember(15), false);
  });
});

describe("Account Entity — canAddStorage", () => {
  it("returns true when total is under limit", () => {
    const account = makeReconstitutedAccount("BASIC");
    assert.strictEqual(account.canAddStorage(1_000_000n, 1_000n), true);
  });

  it("returns true when total exactly equals limit", () => {
    const account = makeReconstitutedAccount("BASIC");
    assert.strictEqual(account.canAddStorage(5_368_709_100n, 20n), true);
  });

  it("returns false when total exceeds limit", () => {
    const account = makeReconstitutedAccount("BASIC");
    assert.strictEqual(account.canAddStorage(5_368_709_120n, 1n), false);
  });

  it("returns true for ENTERPRISE with very large values", () => {
    const account = makeReconstitutedAccount("ENTERPRISE");
    const currentBytes = BigInt(Number.MAX_SAFE_INTEGER) - 1000n;
    assert.strictEqual(account.canAddStorage(currentBytes, 1000n), true);
  });

  it("respects custom maxStorageBytes override from persistence", () => {
    const account = makeReconstitutedAccount("BASIC", {
      maxStorageBytes: 100n,
    });
    assert.strictEqual(account.canAddStorage(50n, 50n), true);
    assert.strictEqual(account.canAddStorage(50n, 51n), false);
  });
});

describe("Account Entity — canAddRecurringPost", () => {
  it("returns true when under BASIC limit of 5", () => {
    const account = makeReconstitutedAccount("BASIC");
    assert.strictEqual(account.canAddRecurringPost(4), true);
  });

  it("returns false when at BASIC limit of 5", () => {
    const account = makeReconstitutedAccount("BASIC");
    assert.strictEqual(account.canAddRecurringPost(5), false);
  });

  it("returns true when under PRO limit of 20", () => {
    const account = makeReconstitutedAccount("PRO");
    assert.strictEqual(account.canAddRecurringPost(19), true);
  });

  it("returns false when at PRO limit of 20", () => {
    const account = makeReconstitutedAccount("PRO");
    assert.strictEqual(account.canAddRecurringPost(20), false);
  });

  it("returns true for ENTERPRISE regardless of count", () => {
    const account = makeReconstitutedAccount("ENTERPRISE");
    assert.strictEqual(account.canAddRecurringPost(999_999), true);
  });
});

describe("Account Entity — toJSON includes tenant fields", () => {
  it("includes timezone, locale, maxTeamMembers, maxStorageBytes, maxRecurringPosts", () => {
    const account = makeAccount({ timezone: "Asia/Tokyo", locale: "ja" });
    const json = account.toJSON();

    assert.strictEqual(json.timezone, "Asia/Tokyo");
    assert.strictEqual(json.locale, "ja");
    assert.strictEqual(json.maxTeamMembers, 5);
    assert.strictEqual(json.maxStorageBytes, "5368709120");
    assert.strictEqual(json.maxRecurringPosts, 5);
  });

  it("includes slug when set", () => {
    const account = makeAccount();
    account.setSlug("my-org");
    const json = account.toJSON();
    assert.strictEqual(json.slug, "my-org");
  });

  it("omits slug when not set", () => {
    const account = makeAccount();
    const json = account.toJSON();
    assert.strictEqual("slug" in json, false);
  });

  it("omits phone when not set", () => {
    const account = makeAccount();
    const json = account.toJSON();
    assert.strictEqual("phone" in json, false);
  });

  it("serializes maxStorageBytes as string to avoid bigint JSON issues", () => {
    const account = makeReconstitutedAccount("ENTERPRISE");
    const json = account.toJSON();
    assert.strictEqual(typeof json.maxStorageBytes, "string");
  });
});

describe("Account Entity — trial lifecycle mutations", () => {
  const nextBilling = new Date("2026-07-01T00:00:00Z");
  const lastBilling = new Date("2026-06-01T00:00:00Z");

  describe("startTrial", () => {
    it("starts a trial and records the next billing date when auto-renewal is on", () => {
      const account = makeReconstitutedAccount("PRO", { isOnTrial: false });
      account.startTrial({
        trialDurationDays: 14,
        autoRenewal: true,
        billingCycle: "monthly",
        nextBillingDate: nextBilling,
      });
      assert.strictEqual(account.isOnTrial, true);
      assert.strictEqual(account.autoRenewal, true);
      assert.strictEqual(account.billingCycle, "monthly");
      assert.strictEqual(account.nextBillingDate?.getTime(), nextBilling.getTime());
      const expectedEnd = Date.now() + 14 * 24 * 60 * 60 * 1000;
      assert.ok(Math.abs((account.trialEndDate?.getTime() ?? 0) - expectedEnd) < 5000);
    });

    it("does not record a next billing date when auto-renewal is off", () => {
      const account = makeReconstitutedAccount("PRO", { isOnTrial: false });
      account.startTrial({
        trialDurationDays: 7,
        autoRenewal: false,
        billingCycle: "monthly",
        nextBillingDate: nextBilling,
      });
      assert.strictEqual(account.isOnTrial, true);
      assert.strictEqual(account.autoRenewal, false);
      assert.strictEqual(account.nextBillingDate, undefined);
    });
  });

  describe("endTrial", () => {
    it("ends the trial, disables auto-renewal, and clears the next billing date", () => {
      const account = makeReconstitutedAccount("PRO", {
        isOnTrial: true,
        autoRenewal: true,
        nextBillingDate: nextBilling,
      });
      account.endTrial();
      assert.strictEqual(account.isOnTrial, false);
      assert.strictEqual(account.autoRenewal, false);
      assert.strictEqual(account.nextBillingDate, undefined);
      assert.ok(account.trialEndDate instanceof Date);
    });
  });

  describe("convertTrialToPaid", () => {
    it("converts to paid with auto-renewal and records both billing dates", () => {
      const account = makeReconstitutedAccount("PRO", { isOnTrial: true });
      account.convertTrialToPaid({
        billingCycle: "yearly",
        lastBillingDate: lastBilling,
        nextBillingDate: nextBilling,
      });
      assert.strictEqual(account.isOnTrial, false);
      assert.strictEqual(account.autoRenewal, true);
      assert.strictEqual(account.billingCycle, "yearly");
      assert.strictEqual(account.lastBillingDate?.getTime(), lastBilling.getTime());
      assert.strictEqual(account.nextBillingDate?.getTime(), nextBilling.getTime());
    });
  });

  describe("recordRenewal", () => {
    it("clears the trial flag and advances the billing dates", () => {
      const account = makeReconstitutedAccount("PRO", { isOnTrial: true });
      account.recordRenewal({ lastBillingDate: lastBilling, nextBillingDate: nextBilling });
      assert.strictEqual(account.isOnTrial, false);
      assert.strictEqual(account.lastBillingDate?.getTime(), lastBilling.getTime());
      assert.strictEqual(account.nextBillingDate?.getTime(), nextBilling.getTime());
    });
  });
});
