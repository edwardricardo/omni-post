/**
 * @file generatePlatformVariants.test.ts
 * @description Unit tests for GeneratePlatformVariantsUseCase.
 * @layer test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { GeneratePlatformVariantsUseCase } from "../../../src/application/ai/GeneratePlatformVariantsUseCase.js";
import { PLATFORM_CONTENT_PROFILES } from "../../../src/domain/ai/PlatformContentProfile.js";
import { ok } from "@shared/types";

function makeMockAIPort(content = "Generated content for this platform #awesome") {
  return {
    generateContent: vi.fn().mockResolvedValue({ success: true, value: content }),
  };
}

function makeMockTopPerformers() {
  return {
    execute: vi.fn().mockResolvedValue(
      ok({
        posts: [
          {
            content: "Top post",
            platform: "X",
            engagementRate: 8,
            impressions: 1000,
            publishedAt: new Date(),
          },
        ],
        accountAvgEngagement: 3,
        topPerformingPlatform: "X",
        insights: ["X outperforms other platforms"],
      })
    ),
  };
}

describe("GeneratePlatformVariantsUseCase", () => {
  let aiPort: ReturnType<typeof makeMockAIPort>;
  let topPerformers: ReturnType<typeof makeMockTopPerformers>;
  let useCase: GeneratePlatformVariantsUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    aiPort = makeMockAIPort();
    topPerformers = makeMockTopPerformers();
    useCase = new GeneratePlatformVariantsUseCase(aiPort, topPerformers as never);
  });

  it("generates variant for each requested platform", async () => {
    const result = await useCase.execute({
      accountId: "acc-1",
      brief: "We just launched a new feature",
      platforms: ["INSTAGRAM", "LINKEDIN", "X"],
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.variants.length, 3);
    const platforms = result.value.variants.map((v) => v.platform);
    assert.ok(platforms.includes("INSTAGRAM"));
    assert.ok(platforms.includes("LINKEDIN"));
    assert.ok(platforms.includes("X"));
  });

  it("makes parallel AI calls (one per platform)", async () => {
    await useCase.execute({
      accountId: "acc-1",
      brief: "Test brief",
      platforms: ["X", "INSTAGRAM"],
    });

    expect(aiPort.generateContent).toHaveBeenCalledTimes(2);
  });

  it("respects character limits per platform", async () => {
    const longContent = "A".repeat(500);
    aiPort = makeMockAIPort(longContent);
    useCase = new GeneratePlatformVariantsUseCase(aiPort, topPerformers as never);

    const result = await useCase.execute({
      accountId: "acc-1",
      brief: "Brief",
      platforms: ["X"],
    });

    assert.ok(result.ok);
    const xVariant = result.value.variants[0];
    assert.ok(xVariant);
    assert.ok(xVariant.charCount <= 280);
  });

  it("uses performance context when usePerformanceData=true", async () => {
    await useCase.execute({
      accountId: "acc-1",
      brief: "Test",
      platforms: ["X"],
      usePerformanceData: true,
    });

    expect(topPerformers.execute).toHaveBeenCalledOnce();
  });

  it("skips performance context when usePerformanceData=false", async () => {
    await useCase.execute({
      accountId: "acc-1",
      brief: "Test",
      platforms: ["X"],
      usePerformanceData: false,
    });

    expect(topPerformers.execute).not.toHaveBeenCalled();
  });

  it("extracts hashtags from generated content", async () => {
    aiPort = makeMockAIPort("Check this out #social #media #marketing");
    useCase = new GeneratePlatformVariantsUseCase(aiPort, topPerformers as never);

    const result = await useCase.execute({
      accountId: "acc-1",
      brief: "Test",
      platforms: ["INSTAGRAM"],
    });

    assert.ok(result.ok);
    const variant = result.value.variants[0];
    assert.ok(variant);
    assert.strictEqual(variant.hashtags.length, 3);
  });

  it("includes platform-specific instructions in prompt", async () => {
    await useCase.execute({
      accountId: "acc-1",
      brief: "Test",
      platforms: ["LINKEDIN"],
    });

    const call = aiPort.generateContent.mock.calls[0]?.[0] as Array<{ content: string }>;
    const userMessage = call?.[1]?.content ?? "";
    assert.ok(userMessage.includes("LinkedIn"));
    assert.ok(userMessage.includes("professional"));
  });

  it("returns generationMs timing", async () => {
    const result = await useCase.execute({
      accountId: "acc-1",
      brief: "Test",
      platforms: ["X"],
    });

    assert.ok(result.ok);
    assert.ok(result.value.generationMs >= 0);
  });
});

describe("PlatformContentProfile", () => {
  it("all 10 platforms have profiles defined", () => {
    const platforms = [
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
    ];
    for (const p of platforms) {
      assert.ok(PLATFORM_CONTENT_PROFILES[p], `Profile missing for ${p}`);
    }
  });

  it("all profiles have required fields", () => {
    for (const [name, profile] of Object.entries(PLATFORM_CONTENT_PROFILES)) {
      assert.ok(profile.maxChars > 0, `${name} maxChars must be positive`);
      assert.ok(profile.style.length > 0, `${name} style must not be empty`);
      assert.ok(profile.structure.length > 0, `${name} structure must not be empty`);
    }
  });
});
