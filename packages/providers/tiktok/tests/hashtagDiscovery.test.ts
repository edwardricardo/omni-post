/**
 * @file hashtagDiscovery.test.ts
 * @description Mutation-killing tests for TikTok hashtag discovery and strategy functions.
 * All functions under test are pure (no external dependencies to mock).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  createHashtagStrategy,
  extractKeywords,
  getTotalHashtagCount,
  calculateEstimatedReach,
  calculateDifficultyScore,
  assessCompetitionLevel,
  calculateViralPotential,
} from "../src/hashtagDiscovery.js";
import type { HashtagPerformance, HashtagStrategy } from "../src/hashtagTypes.js";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// createHashtagStrategy
// ---------------------------------------------------------------------------

describe("createHashtagStrategy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty categories when performances is empty", () => {
    const result = createHashtagStrategy([], {});
    expect(result.primary).toEqual([]);
    expect(result.trending).toEqual([]);
    expect(result.niche).toEqual([]);
    expect(result.branded).toEqual([]);
    expect(result.community).toEqual([]);
  });

  // --- Primary: recommendation=use AND difficulty<50 ---

  it("includes hashtags in primary when recommendation is use and difficulty below 50", () => {
    const perf = makePerformance({ hashtag: "#easy", recommendation: "use", difficulty: 49 });
    const result = createHashtagStrategy([perf], {});
    expect(result.primary).toContain("#easy");
  });

  it("excludes from primary when recommendation is use but difficulty is 50", () => {
    const perf = makePerformance({ hashtag: "#mid", recommendation: "use", difficulty: 50 });
    const result = createHashtagStrategy([perf], {});
    expect(result.primary).not.toContain("#mid");
  });

  it("excludes from primary when recommendation is avoid", () => {
    const perf = makePerformance({ hashtag: "#bad", recommendation: "avoid", difficulty: 10 });
    const result = createHashtagStrategy([perf], {});
    expect(result.primary).not.toContain("#bad");
  });

  it("limits primary to 3 hashtags", () => {
    const perfs = Array.from({ length: 5 }, (_, i) =>
      makePerformance({ hashtag: `#p${i}`, recommendation: "use", difficulty: 10 })
    );
    const result = createHashtagStrategy(perfs, {});
    assert.strictEqual(result.primary.length, 3);
  });

  // --- Trending: trend=rising AND recommendation=use ---

  it("includes hashtags in trending when trend is rising and recommendation is use", () => {
    const perf = makePerformance({ hashtag: "#hot", trend: "rising", recommendation: "use" });
    const result = createHashtagStrategy([perf], {});
    expect(result.trending).toContain("#hot");
  });

  it("excludes from trending when trend is stable", () => {
    const perf = makePerformance({ hashtag: "#stable", trend: "stable", recommendation: "use" });
    const result = createHashtagStrategy([perf], {});
    expect(result.trending).not.toContain("#stable");
  });

  it("excludes from trending when trend is declining", () => {
    const perf = makePerformance({ hashtag: "#old", trend: "declining", recommendation: "use" });
    const result = createHashtagStrategy([perf], {});
    expect(result.trending).not.toContain("#old");
  });

  it("excludes from trending when recommendation is avoid even with rising trend", () => {
    const perf = makePerformance({ hashtag: "#avoid", trend: "rising", recommendation: "avoid" });
    const result = createHashtagStrategy([perf], {});
    expect(result.trending).not.toContain("#avoid");
  });

  it("limits trending to 5 hashtags", () => {
    const perfs = Array.from({ length: 8 }, (_, i) =>
      makePerformance({ hashtag: `#t${i}`, trend: "rising", recommendation: "use" })
    );
    const result = createHashtagStrategy(perfs, {});
    assert.strictEqual(result.trending.length, 5);
  });

  // --- Niche: difficulty<30 AND engagement>50 ---

  it("includes hashtags in niche when difficulty below 30 and engagement above 50", () => {
    const perf = makePerformance({ hashtag: "#niche", difficulty: 29, engagement: 51 });
    const result = createHashtagStrategy([perf], {});
    expect(result.niche).toContain("#niche");
  });

  it("excludes from niche when difficulty is exactly 30", () => {
    const perf = makePerformance({ hashtag: "#edge", difficulty: 30, engagement: 80 });
    const result = createHashtagStrategy([perf], {});
    expect(result.niche).not.toContain("#edge");
  });

  it("excludes from niche when engagement is exactly 50", () => {
    const perf = makePerformance({ hashtag: "#low", difficulty: 10, engagement: 50 });
    const result = createHashtagStrategy([perf], {});
    expect(result.niche).not.toContain("#low");
  });

  it("limits niche to 10 hashtags", () => {
    const perfs = Array.from({ length: 15 }, (_, i) =>
      makePerformance({ hashtag: `#n${i}`, difficulty: 10, engagement: 90 })
    );
    const result = createHashtagStrategy(perfs, {});
    assert.strictEqual(result.niche.length, 10);
  });

  // --- Branded: from options ---

  it("uses brandedHashtags from options", () => {
    const result = createHashtagStrategy([], { brandedHashtags: ["#brand1", "#brand2"] });
    expect(result.branded).toEqual(["#brand1", "#brand2"]);
  });

  it("returns empty branded when no brandedHashtags in options", () => {
    const result = createHashtagStrategy([], {});
    expect(result.branded).toEqual([]);
  });

  // --- Community: recommendation=use ---

  it("includes hashtags in community when recommendation is use", () => {
    const perf = makePerformance({ hashtag: "#comm", recommendation: "use" });
    const result = createHashtagStrategy([perf], {});
    expect(result.community).toContain("#comm");
  });

  it("excludes from community when recommendation is avoid", () => {
    const perf = makePerformance({ hashtag: "#bad", recommendation: "avoid" });
    const result = createHashtagStrategy([perf], {});
    expect(result.community).not.toContain("#bad");
  });

  it("excludes from community when recommendation is monitor", () => {
    const perf = makePerformance({ hashtag: "#watch", recommendation: "monitor" });
    const result = createHashtagStrategy([perf], {});
    expect(result.community).not.toContain("#watch");
  });

  it("limits community to 4 hashtags", () => {
    const perfs = Array.from({ length: 7 }, (_, i) =>
      makePerformance({ hashtag: `#c${i}`, recommendation: "use" })
    );
    const result = createHashtagStrategy(perfs, {});
    assert.strictEqual(result.community.length, 4);
  });
});

// ---------------------------------------------------------------------------
// extractKeywords
// ---------------------------------------------------------------------------

describe("extractKeywords", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts words longer than 3 characters", () => {
    const result = extractKeywords("hello world");
    expect(result).toContain("hello");
    expect(result).toContain("world");
  });

  it("excludes words with 3 or fewer characters", () => {
    const result = extractKeywords("the big red fox");
    expect(result).not.toContain("the");
    expect(result).not.toContain("big");
    expect(result).not.toContain("red");
    expect(result).not.toContain("fox");
  });

  it("excludes stop words that are longer than 3 characters", () => {
    // Stop words in the set that are > 3 chars: none (all are 3 chars)
    // So stop-word filtering only removes words of length <= 3
    // Words with length > 3 that are NOT stop words pass through
    const result = extractKeywords("content about something");
    expect(result).toContain("content");
    expect(result).toContain("about");
    expect(result).toContain("something");
  });

  it("excludes 3-letter stop words via length filter", () => {
    // All stop words are 3 chars, so they are excluded by the length > 3 check
    const result = extractKeywords("the and for are but not");
    expect(result).toEqual([]);
  });

  it("converts words to lowercase", () => {
    const result = extractKeywords("HELLO WORLD");
    expect(result).toContain("hello");
    expect(result).toContain("world");
  });

  it("limits results to 10 keywords", () => {
    const words = Array.from({ length: 20 }, (_, i) => `keyword${i}`).join(" ");
    const result = extractKeywords(words);
    assert.strictEqual(result.length, 10);
  });

  it("returns empty array for empty string", () => {
    const result = extractKeywords("");
    expect(result).toEqual([]);
  });

  it("returns empty array when all words are stop words or too short", () => {
    const result = extractKeywords("the and for are but not you all can had");
    expect(result).toEqual([]);
  });

  it("filters out specific stop words: her was one our out", () => {
    const result = extractKeywords("her was one our out extra");
    // All are stop words or <= 3 chars; "extra" has 5 chars and is not a stop word
    expect(result).toEqual(["extra"]);
  });

  it("splits on multiple whitespace characters", () => {
    const result = extractKeywords("hello   world\ttesting");
    expect(result).toContain("hello");
    expect(result).toContain("world");
    expect(result).toContain("testing");
  });

  it("keeps exactly 4-character non-stop words", () => {
    // "book" = 4 chars, not a stop word
    const result = extractKeywords("book test code");
    expect(result).toContain("book");
    expect(result).toContain("test");
    expect(result).toContain("code");
  });
});

// ---------------------------------------------------------------------------
// getTotalHashtagCount
// ---------------------------------------------------------------------------

describe("getTotalHashtagCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 0 for empty strategy", () => {
    assert.strictEqual(getTotalHashtagCount(makeStrategy()), 0);
  });

  it("sums all category lengths", () => {
    const strategy = makeStrategy({
      primary: ["#a", "#b"],
      trending: ["#c"],
      niche: ["#d", "#e", "#f"],
      branded: ["#g"],
      community: ["#h", "#i"],
    });
    assert.strictEqual(getTotalHashtagCount(strategy), 9);
  });

  it("counts only primary when others are empty", () => {
    const strategy = makeStrategy({ primary: ["#a", "#b", "#c"] });
    assert.strictEqual(getTotalHashtagCount(strategy), 3);
  });

  it("counts only branded when others are empty", () => {
    const strategy = makeStrategy({ branded: ["#x"] });
    assert.strictEqual(getTotalHashtagCount(strategy), 1);
  });
});

// ---------------------------------------------------------------------------
// calculateEstimatedReach
// ---------------------------------------------------------------------------

describe("calculateEstimatedReach", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 0 for empty strategy", () => {
    assert.strictEqual(calculateEstimatedReach(makeStrategy()), 0);
  });

  it("returns hashtag count multiplied by 10000", () => {
    const strategy = makeStrategy({
      primary: ["#a"],
      trending: ["#b", "#c"],
    });
    // 3 hashtags * 10000 = 30000
    assert.strictEqual(calculateEstimatedReach(strategy), 30000);
  });

  it("returns 10000 for single hashtag", () => {
    const strategy = makeStrategy({ niche: ["#solo"] });
    assert.strictEqual(calculateEstimatedReach(strategy), 10000);
  });

  it("returns 50000 for 5 hashtags across categories", () => {
    const strategy = makeStrategy({
      primary: ["#a"],
      trending: ["#b"],
      niche: ["#c"],
      branded: ["#d"],
      community: ["#e"],
    });
    assert.strictEqual(calculateEstimatedReach(strategy), 50000);
  });
});

// ---------------------------------------------------------------------------
// calculateDifficultyScore
// ---------------------------------------------------------------------------

describe("calculateDifficultyScore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 0 for empty strategy", () => {
    assert.strictEqual(calculateDifficultyScore(makeStrategy()), 0);
  });

  it("returns 70 when only primary has 1 hashtag", () => {
    // primaryScore = 1*70 = 70, total = 1, score = 70/1 = 70
    const strategy = makeStrategy({ primary: ["#a"] });
    assert.strictEqual(calculateDifficultyScore(strategy), 70);
  });

  it("returns 60 when only trending has 1 hashtag", () => {
    const strategy = makeStrategy({ trending: ["#a"] });
    assert.strictEqual(calculateDifficultyScore(strategy), 60);
  });

  it("returns 30 when only niche has 1 hashtag", () => {
    const strategy = makeStrategy({ niche: ["#a"] });
    assert.strictEqual(calculateDifficultyScore(strategy), 30);
  });

  it("returns 10 when only branded has 1 hashtag", () => {
    const strategy = makeStrategy({ branded: ["#a"] });
    assert.strictEqual(calculateDifficultyScore(strategy), 10);
  });

  it("returns 50 when only community has 1 hashtag", () => {
    const strategy = makeStrategy({ community: ["#a"] });
    assert.strictEqual(calculateDifficultyScore(strategy), 50);
  });

  it("calculates weighted average correctly for mixed strategy", () => {
    const strategy = makeStrategy({
      primary: ["#a", "#b"], // 2*70 = 140
      trending: ["#c"], // 1*60 = 60
      niche: ["#d", "#e", "#f"], // 3*30 = 90
      branded: ["#g"], // 1*10 = 10
      community: ["#h"], // 1*50 = 50
    });
    // total = 8, sum = 140+60+90+10+50 = 350, 350/8 = 43.75
    assert.strictEqual(calculateDifficultyScore(strategy), 43.75);
  });

  it("returns 65 for 1 primary and 1 trending", () => {
    const strategy = makeStrategy({
      primary: ["#a"], // 70
      trending: ["#b"], // 60
    });
    // (70+60)/2 = 65
    assert.strictEqual(calculateDifficultyScore(strategy), 65);
  });
});

// ---------------------------------------------------------------------------
// assessCompetitionLevel
// ---------------------------------------------------------------------------

describe("assessCompetitionLevel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns low when score is 0", () => {
    assert.strictEqual(assessCompetitionLevel(0), "low");
  });

  it("returns low when score is 39", () => {
    assert.strictEqual(assessCompetitionLevel(39), "low");
  });

  it("returns low when score is 39.99", () => {
    assert.strictEqual(assessCompetitionLevel(39.99), "low");
  });

  it("returns medium when score is 40", () => {
    assert.strictEqual(assessCompetitionLevel(40), "medium");
  });

  it("returns medium when score is 69", () => {
    assert.strictEqual(assessCompetitionLevel(69), "medium");
  });

  it("returns medium when score is 69.99", () => {
    assert.strictEqual(assessCompetitionLevel(69.99), "medium");
  });

  it("returns high when score is 70", () => {
    assert.strictEqual(assessCompetitionLevel(70), "high");
  });

  it("returns high when score is 100", () => {
    assert.strictEqual(assessCompetitionLevel(100), "high");
  });
});

// ---------------------------------------------------------------------------
// calculateViralPotential
// ---------------------------------------------------------------------------

describe("calculateViralPotential", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 0 for empty strategy", () => {
    assert.strictEqual(calculateViralPotential(makeStrategy()), 0);
  });

  it("calculates weighted sum times 10 for trending only", () => {
    // 1 trending: 1*0.4 = 0.4, *10 = 4
    const strategy = makeStrategy({ trending: ["#a"] });
    assert.strictEqual(calculateViralPotential(strategy), 4);
  });

  it("calculates weighted sum times 10 for primary only", () => {
    // 1 primary: 1*0.3 = 0.3, *10 = 3
    const strategy = makeStrategy({ primary: ["#a"] });
    assert.strictEqual(calculateViralPotential(strategy), 3);
  });

  it("calculates weighted sum times 10 for niche only", () => {
    // 1 niche: 1*0.2 = 0.2, *10 = 2
    const strategy = makeStrategy({ niche: ["#a"] });
    assert.strictEqual(calculateViralPotential(strategy), 2);
  });

  it("calculates weighted sum times 10 for community only", () => {
    // 1 community: 1*0.1 = 0.1, *10 = 1
    const strategy = makeStrategy({ community: ["#a"] });
    assert.strictEqual(calculateViralPotential(strategy), 1);
  });

  it("does not count branded hashtags", () => {
    const strategy = makeStrategy({ branded: ["#a", "#b", "#c"] });
    assert.strictEqual(calculateViralPotential(strategy), 0);
  });

  it("calculates combined score correctly", () => {
    const strategy = makeStrategy({
      trending: ["#a", "#b"], // 2*0.4 = 0.8
      primary: ["#c"], // 1*0.3 = 0.3
      niche: ["#d", "#e"], // 2*0.2 = 0.4
      community: ["#f"], // 1*0.1 = 0.1
    });
    // sum = 0.8+0.3+0.4+0.1 = 1.6, *10 = 16
    assert.strictEqual(calculateViralPotential(strategy), 16);
  });

  it("caps at 100 when weighted sum exceeds 10", () => {
    const strategy = makeStrategy({
      trending: Array.from({ length: 20 }, (_, i) => `#t${i}`), // 20*0.4 = 8
      primary: Array.from({ length: 10 }, (_, i) => `#p${i}`), // 10*0.3 = 3
    });
    // sum = 8+3 = 11, *10 = 110, capped at 100
    assert.strictEqual(calculateViralPotential(strategy), 100);
  });

  it("returns exactly 100 when weighted sum equals 10", () => {
    // Need: trending*0.4 + primary*0.3 + niche*0.2 + community*0.1 = 10
    // 25 trending: 25*0.4 = 10
    const strategy = makeStrategy({
      trending: Array.from({ length: 25 }, (_, i) => `#t${i}`),
    });
    assert.strictEqual(calculateViralPotential(strategy), 100);
  });
});
