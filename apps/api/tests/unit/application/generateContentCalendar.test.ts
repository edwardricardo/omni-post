/**
 * @file generateContentCalendar.test.ts
 * @description Unit tests for GenerateContentCalendarUseCase.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { GenerateContentCalendarUseCase } from "@core/application/ai/GenerateContentCalendarUseCase.js";
import { ok } from "@shared/types";

const MOCK_CALENDAR_JSON = JSON.stringify({
  summary:
    "This month focuses on building awareness through educational content and community engagement.",
  items: [
    {
      date: "2026-05-05",
      platform: "INSTAGRAM",
      contentType: "educational",
      title: "5 Tips for Better Photos",
      brief: "Share quick photography tips for product shots.",
      hashtags: ["photography", "tips"],
    },
    {
      date: "2026-05-07",
      platform: "LINKEDIN",
      contentType: "engagement",
      title: "Industry Poll",
      brief: "Ask your audience about their biggest challenge.",
      hashtags: ["poll", "industry"],
    },
    {
      date: "2026-05-10",
      platform: "INSTAGRAM",
      contentType: "promotional",
      title: "Spring Sale Teaser",
      brief: "Announce the upcoming spring collection.",
      hashtags: ["spring", "sale"],
    },
    {
      date: "2026-05-12",
      platform: "X",
      contentType: "behind_scenes",
      title: "Team Monday",
      brief: "Show the team preparing for the week.",
      hashtags: ["teamwork"],
    },
    {
      date: "2026-05-14",
      platform: "LINKEDIN",
      contentType: "educational",
      title: "How We Build",
      brief: "Share the process behind your product development.",
      hashtags: ["process", "building"],
    },
  ],
});

function makeMockAIPort(response = MOCK_CALENDAR_JSON) {
  return {
    generateContent: vi.fn().mockResolvedValue({ success: true, value: response }),
  };
}

function makeMockTopPerformers() {
  return {
    execute: vi.fn().mockResolvedValue(
      ok({
        posts: [],
        accountAvgEngagement: 3,
        topPerformingPlatform: "INSTAGRAM",
        insights: ["Posts on Tuesday perform better"],
      })
    ),
  };
}

const baseInput = {
  accountId: "acc-1",
  month: "2026-05",
  goal: "Drive product awareness",
  industry: "SaaS",
  platforms: ["INSTAGRAM", "LINKEDIN"],
  postsPerWeek: 3,
};

describe("GenerateContentCalendarUseCase", () => {
  let aiPort: ReturnType<typeof makeMockAIPort>;
  let topPerformers: ReturnType<typeof makeMockTopPerformers>;
  let useCase: GenerateContentCalendarUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    aiPort = makeMockAIPort();
    topPerformers = makeMockTopPerformers();
    useCase = new GenerateContentCalendarUseCase(aiPort, topPerformers as never);
  });

  it("generates calendar items for a month", async () => {
    const result = await useCase.execute(baseInput);

    assert.ok(result.ok);
    assert.ok(result.value.calendarItems.length > 0);
    assert.strictEqual(result.value.month, "2026-05");
  });

  it("includes a strategy summary", async () => {
    const result = await useCase.execute(baseInput);

    assert.ok(result.ok);
    assert.ok(result.value.summary.length > 0);
    assert.ok(result.value.summary.includes("awareness"));
  });

  it("assigns suggested dates within the requested month", async () => {
    const result = await useCase.execute(baseInput);

    assert.ok(result.ok);
    for (const item of result.value.calendarItems) {
      assert.ok(
        item.suggestedDate.startsWith("2026-05"),
        `Date ${item.suggestedDate} not in May 2026`
      );
    }
  });

  it("uses brand voice in prompt construction", async () => {
    await useCase.execute({ ...baseInput, brandVoice: "Be playful and fun" });

    const call = aiPort.generateContent.mock.calls[0]?.[0] as Array<{ content: string }>;
    const systemMsg = call?.[0]?.content ?? "";
    assert.ok(systemMsg.includes("playful"));
  });

  it("includes performance insights when available", async () => {
    await useCase.execute(baseInput);

    expect(topPerformers.execute).toHaveBeenCalledOnce();
    const call = aiPort.generateContent.mock.calls[0]?.[0] as Array<{ content: string }>;
    const userMsg = call?.[1]?.content ?? "";
    assert.ok(userMsg.includes("Tuesday"));
  });

  it("returns empty calendar gracefully when LLM fails", async () => {
    aiPort = makeMockAIPort("");
    aiPort.generateContent.mockResolvedValue({ success: false });
    useCase = new GenerateContentCalendarUseCase(aiPort, topPerformers as never);

    const result = await useCase.execute(baseInput);

    assert.ok(result.ok);
    assert.strictEqual(result.value.calendarItems.length, 0);
  });

  it("caps total posts at 60", async () => {
    const result = await useCase.execute({
      ...baseInput,
      platforms: ["X", "INSTAGRAM", "LINKEDIN", "TIKTOK", "FACEBOOK"],
      postsPerWeek: 7,
    });

    assert.ok(result.ok);
    const call = aiPort.generateContent.mock.calls[0]?.[0] as Array<{ content: string }>;
    const userMsg = call?.[1]?.content ?? "";
    assert.ok(userMsg.includes("60"));
  });

  it("handles malformed JSON gracefully", async () => {
    aiPort = makeMockAIPort("This is not JSON at all");
    useCase = new GenerateContentCalendarUseCase(aiPort, topPerformers as never);

    const result = await useCase.execute(baseInput);

    assert.ok(result.ok);
    assert.strictEqual(result.value.calendarItems.length, 0);
  });

  it("validates content types in response", async () => {
    const badJson = JSON.stringify({
      summary: "Test",
      items: [
        {
          date: "2026-05-01",
          platform: "X",
          contentType: "INVALID_TYPE",
          title: "Test",
          brief: "Test",
        },
        {
          date: "2026-05-02",
          platform: "X",
          contentType: "educational",
          title: "Valid",
          brief: "Valid",
        },
      ],
    });
    aiPort = makeMockAIPort(badJson);
    useCase = new GenerateContentCalendarUseCase(aiPort, topPerformers as never);

    const result = await useCase.execute(baseInput);

    assert.ok(result.ok);
    assert.strictEqual(result.value.calendarItems.length, 2);
    assert.strictEqual(result.value.calendarItems[0]?.contentType, "educational");
  });
});
