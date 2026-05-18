/**
 * @file providerName.guard.test.ts
 * @description Unit tests for the isProviderName runtime type guard — the
 *   narrowing used by the analytics use cases (GetCrossPlatformAnalyticsUseCase,
 *   CalculateROIUseCase) instead of unsafe `as ProviderType` casts (Step 5 of
 *   the platform-model reconcile).
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { isProviderName, PROVIDER_NAMES, type ProviderName } from "@shared/types";

describe("isProviderName", () => {
  it("accepts every canonical ProviderName", () => {
    for (const name of PROVIDER_NAMES) {
      expect(isProviderName(name)).toBe(true);
    }
  });

  it("accepts the 11 expected platforms including the post-reconcile additions", () => {
    for (const name of [
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
      "THREADS",
    ]) {
      expect(isProviderName(name)).toBe(true);
    }
    expect(PROVIDER_NAMES).toHaveLength(11);
  });

  it("rejects the legacy lowercase / pre-reconcile spelling", () => {
    expect(isProviderName("twitter")).toBe(false);
    expect(isProviderName("x")).toBe(false);
    expect(isProviderName("instagram")).toBe(false);
  });

  it("rejects unknown, empty, and malformed strings", () => {
    expect(isProviderName("")).toBe(false);
    expect(isProviderName("FOO")).toBe(false);
    expect(isProviderName("X ")).toBe(false);
    expect(isProviderName("MASTODON")).toBe(false);
  });

  it("narrows the type so the value is usable as ProviderName without a cast", () => {
    const raw: string = "X";
    let narrowed: ProviderName | undefined;
    if (isProviderName(raw)) {
      narrowed = raw;
    }
    expect(narrowed).toBe("X");
  });
});
