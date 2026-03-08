/**
 * Tests for AI route input validation schemas.
 * Imports the real Zod schemas from routes.ts — if the schema changes, these tests catch the drift.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
    assert.equal(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.role, "user");
      assert.strictEqual(result.data.content, "Hello, AI!");
    }
  });

  it("should accept system role", () => {
    const result = MessageSchema.safeParse({ role: "system", content: "System prompt" });
    assert.strictEqual(result.success, true);
  });

  it("should accept assistant role", () => {
    const result = MessageSchema.safeParse({ role: "assistant", content: "Assistant response" });
    assert.strictEqual(result.success, true);
  });

  it("should reject message without role", () => {
    const result = MessageSchema.safeParse({ content: "Hello" });
    assert.strictEqual(result.success, false);
  });

  it("should reject message without content", () => {
    const result = MessageSchema.safeParse({ role: "user" });
    assert.strictEqual(result.success, false);
  });

  it("should accept empty content string (MessageSchema has no min(1))", () => {
    const result = MessageSchema.safeParse({ role: "user", content: "" });
    assert.strictEqual(result.success, true);
  });

  it("should reject null content", () => {
    const result = MessageSchema.safeParse({ role: "user", content: null });
    assert.strictEqual(result.success, false);
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
    assert.strictEqual(result.success, true);
  });

  it("should accept undefined (field is optional)", () => {
    const result = GenerateOptionsSchema.safeParse(undefined);
    assert.strictEqual(result.success, true);
  });

  it("should accept empty object", () => {
    const result = GenerateOptionsSchema.safeParse({});
    assert.strictEqual(result.success, true);
  });

  it("should accept partial options", () => {
    const result = GenerateOptionsSchema.safeParse({ model: "gpt-4", temperature: 0.5 });
    assert.strictEqual(result.success, true);
  });

  it("should reject model as number", () => {
    const result = GenerateOptionsSchema.safeParse({ model: 123 });
    assert.strictEqual(result.success, false);
  });

  it("should reject maxTokens as string", () => {
    const result = GenerateOptionsSchema.safeParse({ maxTokens: "1000" });
    assert.strictEqual(result.success, false);
  });

  it("should reject temperature as string", () => {
    const result = GenerateOptionsSchema.safeParse({ temperature: "0.7" });
    assert.strictEqual(result.success, false);
  });

  it("should reject topP as string", () => {
    const result = GenerateOptionsSchema.safeParse({ topP: "0.9" });
    assert.strictEqual(result.success, false);
  });
});

describe("AI Schemas - GenerateContentBodySchema", () => {
  it("should validate a complete request body", () => {
    const result = GenerateContentBodySchema.safeParse({
      messages: [{ role: "user", content: "Hello" }],
      options: { model: "gpt-4" },
      provider: "openai",
    });
    assert.strictEqual(result.success, true);
  });

  it("should accept body without options", () => {
    const result = GenerateContentBodySchema.safeParse({
      messages: [{ role: "user", content: "Hello" }],
    });
    assert.strictEqual(result.success, true);
  });

  it("should accept body without provider", () => {
    const result = GenerateContentBodySchema.safeParse({
      messages: [{ role: "user", content: "Hello" }],
      options: undefined,
    });
    assert.strictEqual(result.success, true);
  });

  it("should reject empty messages array", () => {
    const result = GenerateContentBodySchema.safeParse({ messages: [] });
    assert.strictEqual(result.success, false);
  });

  it("should reject missing messages", () => {
    const result = GenerateContentBodySchema.safeParse({ options: { model: "gpt-4" } });
    assert.strictEqual(result.success, false);
  });

  it("should accept multiple messages in a conversation", () => {
    const result = GenerateContentBodySchema.safeParse({
      messages: [
        { role: "system", content: "System prompt" },
        { role: "user", content: "User message" },
        { role: "assistant", content: "Assistant response" },
      ],
    });
    assert.strictEqual(result.success, true);
  });
});

describe("AI Schemas - AnalysisTypeSchema", () => {
  it("should accept sentiment", () => {
    assert.strictEqual(AnalysisTypeSchema.safeParse("sentiment").success, true);
  });

  it("should accept tone", () => {
    assert.strictEqual(AnalysisTypeSchema.safeParse("tone").success, true);
  });

  it("should accept readability", () => {
    assert.strictEqual(AnalysisTypeSchema.safeParse("readability").success, true);
  });

  it("should accept engagement", () => {
    assert.strictEqual(AnalysisTypeSchema.safeParse("engagement").success, true);
  });

  it("should reject an unknown analysis type", () => {
    assert.strictEqual(AnalysisTypeSchema.safeParse("invalid").success, false);
  });

  it("should reject empty string", () => {
    assert.strictEqual(AnalysisTypeSchema.safeParse("").success, false);
  });

  it("should reject null", () => {
    assert.strictEqual(AnalysisTypeSchema.safeParse(null).success, false);
  });

  it("should reject undefined", () => {
    assert.strictEqual(AnalysisTypeSchema.safeParse(undefined).success, false);
  });
});

describe("AI Schemas - AnalyzeContentBodySchema", () => {
  it("should validate a correct analyze request", () => {
    const result = AnalyzeContentBodySchema.safeParse({
      content: "This is test content",
      analysisType: "sentiment",
      provider: "openai",
    });
    assert.strictEqual(result.success, true);
  });

  it("should accept body without provider", () => {
    const result = AnalyzeContentBodySchema.safeParse({
      content: "Test content",
      analysisType: "tone",
    });
    assert.strictEqual(result.success, true);
  });

  it("should reject empty content", () => {
    const result = AnalyzeContentBodySchema.safeParse({
      content: "",
      analysisType: "sentiment",
    });
    assert.strictEqual(result.success, false);
  });

  it("should reject missing content", () => {
    const result = AnalyzeContentBodySchema.safeParse({ analysisType: "sentiment" });
    assert.strictEqual(result.success, false);
  });

  it("should reject missing analysisType", () => {
    const result = AnalyzeContentBodySchema.safeParse({ content: "Test content" });
    assert.strictEqual(result.success, false);
  });

  it("should reject invalid analysisType", () => {
    const result = AnalyzeContentBodySchema.safeParse({
      content: "Test content",
      analysisType: "invalid",
    });
    assert.strictEqual(result.success, false);
  });
});
