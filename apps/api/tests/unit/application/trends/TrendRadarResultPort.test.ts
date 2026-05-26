/**
 * @file TrendRadarResultPort.test.ts
 * @description Unit tests for the trend-radar result port's static mapping
 *              tables: provider whitelist (string-literal canon, matches
 *              Prisma `Provider` enum) and source kebab→SCREAMING_SNAKE
 *              translation. These tables are the only contract between the
 *              application layer's plain TypeScript types and the Prisma
 *              `$Enums` values used by the adapter — drift breaks
 *              persistence silently, so they get explicit coverage.
 * @layer infrastructure
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  TREND_RADAR_PROVIDERS,
  TREND_SOURCE_TO_ENUM,
  type TrendRadarProvider,
  type TrendRadarSourceEnum,
} from "@core/application/trends/TrendRadarResultPort.js";
import type { TrendSource } from "@core/application/trends/FetchTrendingTopicsUseCase.js";

describe("TrendRadarResultPort — TREND_RADAR_PROVIDERS", () => {
  it("contains exactly the 11 canonical providers in SCREAMING_SNAKE form", () => {
    const expected: TrendRadarProvider[] = [
      "X",
      "INSTAGRAM",
      "FACEBOOK",
      "YOUTUBE",
      "TIKTOK",
      "SNAPCHAT",
      "TELEGRAM",
      "PINTEREST",
      "LINKEDIN",
      "BLUESKY",
      "THREADS",
    ];
    assert.strictEqual(TREND_RADAR_PROVIDERS.size, expected.length);
    for (const provider of expected) {
      assert.ok(TREND_RADAR_PROVIDERS.has(provider), `expected provider ${provider}`);
    }
  });

  it("rejects unknown providers (set semantics, not array)", () => {
    assert.strictEqual(TREND_RADAR_PROVIDERS.has("MYSPACE" as TrendRadarProvider), false);
    assert.strictEqual(TREND_RADAR_PROVIDERS.has("tiktok" as TrendRadarProvider), false);
  });
});

describe("TrendRadarResultPort — TREND_SOURCE_TO_ENUM", () => {
  it("maps every kebab-case TrendSource to its SCREAMING_SNAKE enum value", () => {
    const mapping: Array<[TrendSource, TrendRadarSourceEnum]> = [
      ["perplexity-web", "PERPLEXITY_WEB"],
      ["account-analytics", "ACCOUNT_ANALYTICS"],
      ["inbox-mentions", "INBOX_MENTIONS"],
    ];
    for (const [source, expected] of mapping) {
      assert.strictEqual(TREND_SOURCE_TO_ENUM[source], expected);
    }
  });

  it("covers all three sources without extras", () => {
    const keys = Object.keys(TREND_SOURCE_TO_ENUM).sort();
    assert.deepStrictEqual(keys, ["account-analytics", "inbox-mentions", "perplexity-web"]);
  });
});
