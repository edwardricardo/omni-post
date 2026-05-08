/**
 * Tests for AI route input validation schemas.
 * Imports the real Zod schemas from routes.ts — if the schema changes, these tests catch the drift.
 *
 * @file aiTypes.schemas.test.ts
 * @description Tests for AI Schemas - MessageSchema
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import {
  MessageSchema,
  GenerateOptionsSchema,
  GenerateContentBodySchema,
  AnalysisTypeSchema,
  AnalyzeContentBodySchema,
} from "../../src/ai/routes.js";

describe("AI Schemas - MessageSchema", () => {
  it("should validate a user message", () => {
    const result = MessageSchema.safeParse({ role: "user", content: "Hello, AI!" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe("user");
      expect(result.data.content).toBe("Hello, AI!");
    }
  });

  it("should accept system role", () => {
    const result = MessageSchema.safeParse({ role: "system", content: "System prompt" });
    expect(result.success).toBe(true);
  });

  it("should accept assistant role", () => {
    const result = MessageSchema.safeParse({ role: "assistant", content: "Assistant response" });
    expect(result.success).toBe(true);
  });

  it("should reject message without role", () => {
    const result = MessageSchema.safeParse({ content: "Hello" });
    expect(result.success).toBe(false);
  });

  it("should reject message without content", () => {
    const result = MessageSchema.safeParse({ role: "user" });
    expect(result.success).toBe(false);
  });

  it("should accept empty content string (MessageSchema has no min(1))", () => {
    const result = MessageSchema.safeParse({ role: "user", content: "" });
    expect(result.success).toBe(true);
  });

  it("should reject null content", () => {
    const result = MessageSchema.safeParse({ role: "user", content: null });
    expect(result.success).toBe(false);
  });
});

describe("AI Schemas - GenerateOptionsSchema", () => {
  it("should validate complete options object", () => {
    const result = GenerateOptionsSchema.safeParse({
      model: "gpt-4",
      maxTokens: 1000,
      temperature: 0.7,
      topP: 0.9,
    });
    expect(result.success).toBe(true);
  });

  it("should accept undefined (field is optional)", () => {
    const result = GenerateOptionsSchema.safeParse(undefined);
    expect(result.success).toBe(true);
  });

  it("should accept empty object", () => {
    const result = GenerateOptionsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("should accept partial options", () => {
    const result = GenerateOptionsSchema.safeParse({ model: "gpt-4", temperature: 0.5 });
    expect(result.success).toBe(true);
  });

  it("should reject model as number", () => {
    const result = GenerateOptionsSchema.safeParse({ model: 123 });
    expect(result.success).toBe(false);
  });

  it("should reject maxTokens as string", () => {
    const result = GenerateOptionsSchema.safeParse({ maxTokens: "1000" });
    expect(result.success).toBe(false);
  });

  it("should reject temperature as string", () => {
    const result = GenerateOptionsSchema.safeParse({ temperature: "0.7" });
    expect(result.success).toBe(false);
  });

  it("should reject topP as string", () => {
    const result = GenerateOptionsSchema.safeParse({ topP: "0.9" });
    expect(result.success).toBe(false);
  });
});

describe("AI Schemas - GenerateContentBodySchema", () => {
  it("should validate a complete request body", () => {
    const result = GenerateContentBodySchema.safeParse({
      messages: [{ role: "user", content: "Hello" }],
      options: { model: "gpt-4" },
      provider: "openai",
    });
    expect(result.success).toBe(true);
  });

  it("should accept body without options", () => {
    const result = GenerateContentBodySchema.safeParse({
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(result.success).toBe(true);
  });

  it("should accept body without provider", () => {
    const result = GenerateContentBodySchema.safeParse({
      messages: [{ role: "user", content: "Hello" }],
      options: undefined,
    });
    expect(result.success).toBe(true);
  });

  it("should reject empty messages array", () => {
    const result = GenerateContentBodySchema.safeParse({ messages: [] });
    expect(result.success).toBe(false);
  });

  it("should reject missing messages", () => {
    const result = GenerateContentBodySchema.safeParse({ options: { model: "gpt-4" } });
    expect(result.success).toBe(false);
  });

  it("should accept multiple messages in a conversation", () => {
    const result = GenerateContentBodySchema.safeParse({
      messages: [
        { role: "system", content: "System prompt" },
        { role: "user", content: "User message" },
        { role: "assistant", content: "Assistant response" },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("AI Schemas - AnalysisTypeSchema", () => {
  it("should accept sentiment", () => {
    expect(AnalysisTypeSchema.safeParse("sentiment").success).toBe(true);
  });

  it("should accept tone", () => {
    expect(AnalysisTypeSchema.safeParse("tone").success).toBe(true);
  });

  it("should accept readability", () => {
    expect(AnalysisTypeSchema.safeParse("readability").success).toBe(true);
  });

  it("should accept engagement", () => {
    expect(AnalysisTypeSchema.safeParse("engagement").success).toBe(true);
  });

  it("should reject an unknown analysis type", () => {
    expect(AnalysisTypeSchema.safeParse("invalid").success).toBe(false);
  });

  it("should reject empty string", () => {
    expect(AnalysisTypeSchema.safeParse("").success).toBe(false);
  });

  it("should reject null", () => {
    expect(AnalysisTypeSchema.safeParse(null).success).toBe(false);
  });

  it("should reject undefined", () => {
    expect(AnalysisTypeSchema.safeParse(undefined).success).toBe(false);
  });
});

describe("AI Schemas - AnalyzeContentBodySchema", () => {
  it("should validate a correct analyze request", () => {
    const result = AnalyzeContentBodySchema.safeParse({
      content: "This is test content",
      analysisType: "sentiment",
      provider: "openai",
    });
    expect(result.success).toBe(true);
  });

  it("should accept body without provider", () => {
    const result = AnalyzeContentBodySchema.safeParse({
      content: "Test content",
      analysisType: "tone",
    });
    expect(result.success).toBe(true);
  });

  it("should reject empty content", () => {
    const result = AnalyzeContentBodySchema.safeParse({
      content: "",
      analysisType: "sentiment",
    });
    expect(result.success).toBe(false);
  });

  it("should reject missing content", () => {
    const result = AnalyzeContentBodySchema.safeParse({ analysisType: "sentiment" });
    expect(result.success).toBe(false);
  });

  it("should reject missing analysisType", () => {
    const result = AnalyzeContentBodySchema.safeParse({ content: "Test content" });
    expect(result.success).toBe(false);
  });

  it("should reject invalid analysisType", () => {
    const result = AnalyzeContentBodySchema.safeParse({
      content: "Test content",
      analysisType: "invalid",
    });
    expect(result.success).toBe(false);
  });
});
