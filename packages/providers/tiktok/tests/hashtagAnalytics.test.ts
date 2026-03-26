/**
 * @file hashtagAnalytics.test.ts
 * @description Mutation-killing tests for TikTok hashtag analytics functions.
 * All functions under test are pure (no external dependencies to mock).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  generateStrategyRecommendations,
  generateStrategyWarnings,
  generateRecommendationsForGoal,
  generateOptimalMix,
  generateAlternatives,
  generateAvoidList,
  generateTimingRecommendations,
  generateReasons,
} from "../src/hashtagAnalytics.js";
import type { HashtagPerformance, HashtagStrategy } from "../src/hashtagTypes.js";
import type { TikTokTrendingHashtag } from "../src/researchApiClient.js";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeStrategy(overrides?: Partial<HashtagStrategy>): HashtagStrategy {
  return {
    primary: [],
    trending: [],
    niche: [],
    branded: [],
    community: [],
    ...overrides,
  };
}

function makePerformance(overrides?: Partial<HashtagPerformance>): HashtagPerformance {
  return {
    hashtag: "#test",
    usage: 1000,
    reach: 50000,
    engagement: 60,
    difficulty: 40,
    trend: "stable",
    competitiveness: 50,
    recommendation: "use",
    optimalTiming: ["12:00 PM"],
    relatedHashtags: ["#related"],
    ...overrides,
  };
}

function makeTrending(overrides?: Partial<TikTokTrendingHashtag>): TikTokTrendingHashtag {
  return {
    hashtag: "#trending",
    volume: 200000,
    growth: 60,
    difficulty: 50,
    engagement: 80,
    category: "entertainment",
    relatedHashtags: [],
    trendingScore: 90,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// generateStrategyRecommendations
// ---------------------------------------------------------------------------

describe("generateStrategyRecommendations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when all conditions are satisfied", () => {
    const strategy = makeStrategy({
      trending: ["#a", "#b", "#c"],
      niche: ["#1", "#2", "#3", "#4", "#5"],
      branded: ["#brand"],
    });
    const perfs = [makePerformance({ difficulty: 30 })];
    const result = generateStrategyRecommendations(strategy, perfs);
    expect(result).toEqual([]);
  });

  it("recommends more trending when trending count is below 3", () => {
    const strategy = makeStrategy({
      trending: ["#a", "#b"],
      branded: ["#b"],
      niche: Array(5).fill("#n"),
    });
    const result = generateStrategyRecommendations(strategy, []);
    expect(result).toContain("Add more trending hashtags to increase visibility");
  });

  it("does not recommend more trending when trending count is exactly 3", () => {
    const strategy = makeStrategy({
      trending: ["#a", "#b", "#c"],
      branded: ["#b"],
      niche: Array(5).fill("#n"),
    });
    const result = generateStrategyRecommendations(strategy, []);
    expect(result).not.toContain("Add more trending hashtags to increase visibility");
  });

  it("recommends more niche when niche count is below 5", () => {
    const strategy = makeStrategy({
      niche: ["#a", "#b", "#c", "#d"],
      trending: Array(3).fill("#t"),
      branded: ["#b"],
    });
    const result = generateStrategyRecommendations(strategy, []);
    expect(result).toContain("Include more niche hashtags to reach targeted audience");
  });

  it("does not recommend more niche when niche count is exactly 5", () => {
    const strategy = makeStrategy({
      niche: Array(5).fill("#n"),
      trending: Array(3).fill("#t"),
      branded: ["#b"],
    });
    const result = generateStrategyRecommendations(strategy, []);
    expect(result).not.toContain("Include more niche hashtags to reach targeted audience");
  });

  it("recommends branded when branded is empty", () => {
    const strategy = makeStrategy({
      branded: [],
      trending: Array(3).fill("#t"),
      niche: Array(5).fill("#n"),
    });
    const result = generateStrategyRecommendations(strategy, []);
    expect(result).toContain("Consider adding branded hashtags for brand recognition");
  });

  it("does not recommend branded when branded has at least 1", () => {
    const strategy = makeStrategy({
      branded: ["#brand"],
      trending: Array(3).fill("#t"),
      niche: Array(5).fill("#n"),
    });
    const result = generateStrategyRecommendations(strategy, []);
    expect(result).not.toContain("Consider adding branded hashtags for brand recognition");
  });

  it("warns about high-competition when more than 3 performances have difficulty above 70", () => {
    const perfs = [
      makePerformance({ difficulty: 71 }),
      makePerformance({ difficulty: 80 }),
      makePerformance({ difficulty: 90 }),
      makePerformance({ difficulty: 75 }),
    ];
    const strategy = makeStrategy({
      trending: Array(3).fill("#t"),
      niche: Array(5).fill("#n"),
      branded: ["#b"],
    });
    const result = generateStrategyRecommendations(strategy, perfs);
    expect(result).toContain("Too many high-competition hashtags, consider alternatives");
  });

  it("does not warn about high-competition when exactly 3 performances have difficulty above 70", () => {
    const perfs = [
      makePerformance({ difficulty: 71 }),
      makePerformance({ difficulty: 80 }),
      makePerformance({ difficulty: 90 }),
    ];
    const strategy = makeStrategy({
      trending: Array(3).fill("#t"),
      niche: Array(5).fill("#n"),
      branded: ["#b"],
    });
    const result = generateStrategyRecommendations(strategy, perfs);
    expect(result).not.toContain("Too many high-competition hashtags, consider alternatives");
  });

  it("does not count performance with difficulty exactly 70 as high-competition", () => {
    const perfs = [
      makePerformance({ difficulty: 70 }),
      makePerformance({ difficulty: 70 }),
      makePerformance({ difficulty: 70 }),
      makePerformance({ difficulty: 70 }),
    ];
    const strategy = makeStrategy({
      trending: Array(3).fill("#t"),
      niche: Array(5).fill("#n"),
      branded: ["#b"],
    });
    const result = generateStrategyRecommendations(strategy, perfs);
    expect(result).not.toContain("Too many high-competition hashtags, consider alternatives");
  });

  it("returns all 4 recommendations when all conditions fail", () => {
    const strategy = makeStrategy({
      trending: [],
      niche: [],
      branded: [],
    });
    const perfs = Array.from({ length: 5 }, () => makePerformance({ difficulty: 80 }));
    const result = generateStrategyRecommendations(strategy, perfs);
    assert.strictEqual(result.length, 4);
  });
});

// ---------------------------------------------------------------------------
// generateStrategyWarnings
// ---------------------------------------------------------------------------

describe("generateStrategyWarnings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when no warning conditions met", () => {
    const result = generateStrategyWarnings(makeStrategy(), [], 10);
    expect(result).toEqual([]);
  });

  it("warns when totalHashtags exceeds 20", () => {
    const result = generateStrategyWarnings(makeStrategy(), [], 21);
    expect(result).toContain("Too many hashtags may reduce effectiveness");
  });

  it("does not warn when totalHashtags is exactly 20", () => {
    const result = generateStrategyWarnings(makeStrategy(), [], 20);
    expect(result).not.toContain("Too many hashtags may reduce effectiveness");
  });

  it("warns about avoid hashtags when performances contain recommendation avoid", () => {
    const perfs = [
      makePerformance({ hashtag: "#spam", recommendation: "avoid" }),
      makePerformance({ hashtag: "#bad", recommendation: "avoid" }),
    ];
    const result = generateStrategyWarnings(makeStrategy(), perfs, 5);
    const avoidWarning = result.find((w) => w.startsWith("Avoid these hashtags:"));
    assert.ok(avoidWarning, "Expected avoid warning");
    expect(avoidWarning).toContain("#spam");
    expect(avoidWarning).toContain("#bad");
  });

  it("does not warn about avoid when no performances have avoid recommendation", () => {
    const perfs = [makePerformance({ recommendation: "use" })];
    const result = generateStrategyWarnings(makeStrategy(), perfs, 5);
    const avoidWarning = result.find((w) => w.startsWith("Avoid these hashtags:"));
    assert.strictEqual(avoidWarning, undefined);
  });

  it("returns both warnings when both conditions are met", () => {
    const perfs = [makePerformance({ hashtag: "#bad", recommendation: "avoid" })];
    const result = generateStrategyWarnings(makeStrategy(), perfs, 25);
    assert.strictEqual(result.length, 2);
  });
});

// ---------------------------------------------------------------------------
// generateRecommendationsForGoal
// ---------------------------------------------------------------------------

describe("generateRecommendationsForGoal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const keywordTrends: any[] = [];

  // --- reach: volume > 100000 ---

  it("returns hashtags with volume above 100000 for reach goal", () => {
    const trending = [
      makeTrending({ hashtag: "#big", volume: 100001 }),
      makeTrending({ hashtag: "#small", volume: 100000 }),
    ];
    const result = generateRecommendationsForGoal("reach", keywordTrends, trending, [], []);
    expect(result).toContain("#big");
    expect(result).not.toContain("#small");
  });

  it("returns empty for reach when no hashtag exceeds volume threshold", () => {
    const trending = [makeTrending({ hashtag: "#low", volume: 50000 })];
    const result = generateRecommendationsForGoal("reach", keywordTrends, trending, [], []);
    expect(result).toEqual([]);
  });

  // --- engagement: engagement > 70 ---

  it("returns hashtags with engagement above 70 for engagement goal", () => {
    const trending = [
      makeTrending({ hashtag: "#engaged", engagement: 71 }),
      makeTrending({ hashtag: "#low", engagement: 70 }),
    ];
    const result = generateRecommendationsForGoal("engagement", keywordTrends, trending, [], []);
    expect(result).toContain("#engaged");
    expect(result).not.toContain("#low");
  });

  // --- viral: growth > 50 ---

  it("returns hashtags with growth above 50 for viral goal", () => {
    const trending = [
      makeTrending({ hashtag: "#viral", growth: 51 }),
      makeTrending({ hashtag: "#stale", growth: 50 }),
    ];
    const result = generateRecommendationsForGoal("viral", keywordTrends, trending, [], []);
    expect(result).toContain("#viral");
    expect(result).not.toContain("#stale");
  });

  // --- niche: difficulty < 40 ---

  it("returns hashtags with difficulty below 40 for niche goal", () => {
    const trending = [
      makeTrending({ hashtag: "#easy", difficulty: 39 }),
      makeTrending({ hashtag: "#hard", difficulty: 40 }),
    ];
    const result = generateRecommendationsForGoal("niche", keywordTrends, trending, [], []);
    expect(result).toContain("#easy");
    expect(result).not.toContain("#hard");
  });

  // --- unknown goal ---

  it("returns empty for unknown goal", () => {
    const trending = [makeTrending({ hashtag: "#any", volume: 999999 })];
    const result = generateRecommendationsForGoal("unknown", keywordTrends, trending, [], []);
    expect(result).toEqual([]);
  });

  // --- filtering currentHashtags ---

  it("excludes hashtags that are in currentHashtags", () => {
    const trending = [makeTrending({ hashtag: "#existing", volume: 200000 })];
    const result = generateRecommendationsForGoal(
      "reach",
      keywordTrends,
      trending,
      ["#existing"],
      []
    );
    expect(result).not.toContain("#existing");
  });

  // --- filtering avoidHashtags ---

  it("excludes hashtags that are in avoidHashtags", () => {
    const trending = [makeTrending({ hashtag: "#banned", volume: 200000 })];
    const result = generateRecommendationsForGoal(
      "reach",
      keywordTrends,
      trending,
      [],
      ["#banned"]
    );
    expect(result).not.toContain("#banned");
  });

  it("excludes both currentHashtags and avoidHashtags", () => {
    const trending = [
      makeTrending({ hashtag: "#current", volume: 200000 }),
      makeTrending({ hashtag: "#avoid", volume: 200000 }),
      makeTrending({ hashtag: "#good", volume: 200000 }),
    ];
    const result = generateRecommendationsForGoal(
      "reach",
      keywordTrends,
      trending,
      ["#current"],
      ["#avoid"]
    );
    expect(result).toEqual(["#good"]);
  });

  it("returns matching hashtags that pass all filters", () => {
    const trending = [
      makeTrending({ hashtag: "#keep", volume: 150000 }),
      makeTrending({ hashtag: "#drop", volume: 50000 }),
    ];
    const result = generateRecommendationsForGoal("reach", keywordTrends, trending, [], []);
    expect(result).toEqual(["#keep"]);
  });
});

// ---------------------------------------------------------------------------
// generateOptimalMix
// ---------------------------------------------------------------------------

describe("generateOptimalMix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("slices recommended to max 12 items", () => {
    const recommended = Array.from({ length: 15 }, (_, i) => `#h${i}`);
    const result = generateOptimalMix(recommended, "reach");
    assert.strictEqual(result.mix.length, 12);
  });

  it("returns all items when fewer than 12", () => {
    const recommended = ["#a", "#b", "#c"];
    const result = generateOptimalMix(recommended, "reach");
    expect(result.mix).toEqual(["#a", "#b", "#c"]);
  });

  it("returns empty mix for empty recommended", () => {
    const result = generateOptimalMix([], "reach");
    expect(result.mix).toEqual([]);
  });

  it("calculates expectedReach as length times 15000", () => {
    const recommended = ["#a", "#b", "#c"];
    const result = generateOptimalMix(recommended, "reach");
    assert.strictEqual(result.expectedReach, 45000);
  });

  it("calculates expectedReach from full recommended length not sliced length", () => {
    const recommended = Array.from({ length: 20 }, (_, i) => `#h${i}`);
    const result = generateOptimalMix(recommended, "reach");
    // expectedReach = 20 * 15000 = 300000 (based on recommended.length, not mix.length)
    assert.strictEqual(result.expectedReach, 300000);
  });

  it("includes goal in reasoning string", () => {
    const result = generateOptimalMix(["#a"], "engagement");
    expect(result.reasoning).toContain("engagement");
  });

  it("returns competitionLevel as medium", () => {
    const result = generateOptimalMix(["#a"], "reach");
    assert.strictEqual(result.competitionLevel, "medium");
  });

  it("returns expectedReach 0 for empty recommended", () => {
    const result = generateOptimalMix([], "viral");
    assert.strictEqual(result.expectedReach, 0);
  });
});

// ---------------------------------------------------------------------------
// generateAlternatives
// ---------------------------------------------------------------------------

describe("generateAlternatives", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty object for empty recommended", () => {
    const result = generateAlternatives([]);
    expect(result).toEqual({});
  });

  it("generates 3 alternatives per hashtag with correct suffixes", () => {
    const result = generateAlternatives(["#dance"]);
    expect(result["#dance"]).toEqual(["#dance2024", "#dancetrend", "#danceviral"]);
  });

  it("generates alternatives for multiple hashtags", () => {
    const result = generateAlternatives(["#cook", "#food"]);
    assert.strictEqual(Object.keys(result).length, 2);
    expect(result["#cook"]).toEqual(["#cook2024", "#cooktrend", "#cookviral"]);
    expect(result["#food"]).toEqual(["#food2024", "#foodtrend", "#foodviral"]);
  });

  it("appends 2024 as first alternative", () => {
    const result = generateAlternatives(["#test"]);
    assert.strictEqual(result["#test"]![0], "#test2024");
  });

  it("appends trend as second alternative", () => {
    const result = generateAlternatives(["#test"]);
    assert.strictEqual(result["#test"]![1], "#testtrend");
  });

  it("appends viral as third alternative", () => {
    const result = generateAlternatives(["#test"]);
    assert.strictEqual(result["#test"]![2], "#testviral");
  });
});

// ---------------------------------------------------------------------------
// generateAvoidList
// ---------------------------------------------------------------------------

describe("generateAvoidList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when no high difficulty and no user avoid list", () => {
    const trending = [makeTrending({ difficulty: 90 })];
    const result = generateAvoidList(trending, []);
    // difficulty 90 is NOT > 90, so empty
    expect(result).toEqual([]);
  });

  it("includes trending hashtags with difficulty above 90", () => {
    const trending = [makeTrending({ hashtag: "#hard", difficulty: 91 })];
    const result = generateAvoidList(trending, []);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]!.hashtag, "#hard");
    assert.strictEqual(result[0]!.reason, "Extremely high competition");
    assert.strictEqual(result[0]!.severity, "high");
  });

  it("does not include trending hashtags with difficulty exactly 90", () => {
    const trending = [makeTrending({ hashtag: "#borderline", difficulty: 90 })];
    const result = generateAvoidList(trending, []);
    expect(result).toEqual([]);
  });

  it("includes user avoid list items with medium severity", () => {
    const result = generateAvoidList([], ["#personal"]);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]!.hashtag, "#personal");
    assert.strictEqual(result[0]!.reason, "User specified");
    assert.strictEqual(result[0]!.severity, "medium");
  });

  it("combines high-difficulty trending and user avoid list", () => {
    const trending = [makeTrending({ hashtag: "#comp", difficulty: 95 })];
    const result = generateAvoidList(trending, ["#mine"]);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0]!.hashtag, "#comp");
    assert.strictEqual(result[0]!.severity, "high");
    assert.strictEqual(result[1]!.hashtag, "#mine");
    assert.strictEqual(result[1]!.severity, "medium");
  });

  it("includes multiple high-difficulty trending hashtags", () => {
    const trending = [
      makeTrending({ hashtag: "#a", difficulty: 91 }),
      makeTrending({ hashtag: "#b", difficulty: 95 }),
      makeTrending({ hashtag: "#c", difficulty: 50 }),
    ];
    const result = generateAvoidList(trending, []);
    assert.strictEqual(result.length, 2);
    expect(result.map((r) => r.hashtag)).toEqual(["#a", "#b"]);
  });
});

// ---------------------------------------------------------------------------
// generateTimingRecommendations
// ---------------------------------------------------------------------------

describe("generateTimingRecommendations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns bestTimes array with 3 entries", () => {
    const result = generateTimingRecommendations(["#any"]);
    assert.strictEqual(result.bestTimes.length, 3);
  });

  it("returns correct bestTimes values", () => {
    const result = generateTimingRecommendations([]);
    expect(result.bestTimes).toEqual(["12:00 PM", "6:00 PM", "9:00 PM"]);
  });

  it("returns avoid array with 3 entries", () => {
    const result = generateTimingRecommendations([]);
    assert.strictEqual(result.avoid.length, 3);
  });

  it("returns correct avoid values", () => {
    const result = generateTimingRecommendations([]);
    expect(result.avoid).toEqual(["3:00 AM", "4:00 AM", "5:00 AM"]);
  });

  it("returns seasonal array with 1 entry", () => {
    const result = generateTimingRecommendations([]);
    assert.strictEqual(result.seasonal.length, 1);
  });

  it("returns correct seasonal value", () => {
    const result = generateTimingRecommendations([]);
    expect(result.seasonal).toEqual(["Spring content performs better in March-May"]);
  });

  it("returns same result regardless of input", () => {
    const result1 = generateTimingRecommendations([]);
    const result2 = generateTimingRecommendations(["#a", "#b", "#c"]);
    expect(result1).toEqual(result2);
  });
});

// ---------------------------------------------------------------------------
// generateReasons
// ---------------------------------------------------------------------------

describe("generateReasons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty object for empty recommended", () => {
    const result = generateReasons([]);
    expect(result).toEqual({});
  });

  it("returns 4 reasons per hashtag", () => {
    const result = generateReasons(["#test"]);
    assert.strictEqual(result["#test"]!.length, 4);
  });

  it("returns correct reason strings", () => {
    const result = generateReasons(["#dance"]);
    expect(result["#dance"]).toEqual([
      "High engagement rate",
      "Growing trend",
      "Low competition",
      "Relevant to content",
    ]);
  });

  it("generates reasons for multiple hashtags", () => {
    const result = generateReasons(["#a", "#b"]);
    assert.strictEqual(Object.keys(result).length, 2);
    assert.ok(result["#a"]);
    assert.ok(result["#b"]);
  });

  it("returns same 4 reasons for every hashtag", () => {
    const result = generateReasons(["#x", "#y"]);
    expect(result["#x"]).toEqual(result["#y"]);
  });

  it("first reason is High engagement rate", () => {
    const result = generateReasons(["#test"]);
    assert.strictEqual(result["#test"]![0], "High engagement rate");
  });

  it("second reason is Growing trend", () => {
    const result = generateReasons(["#test"]);
    assert.strictEqual(result["#test"]![1], "Growing trend");
  });

  it("third reason is Low competition", () => {
    const result = generateReasons(["#test"]);
    assert.strictEqual(result["#test"]![2], "Low competition");
  });

  it("fourth reason is Relevant to content", () => {
    const result = generateReasons(["#test"]);
    assert.strictEqual(result["#test"]![3], "Relevant to content");
  });
});
