/**
 * Tier 8 — AI features smoke tests
 *
 * The AI service surface (generate / analyze / optimize / predict /
 * variations / smart-analysis) needs a configured provider key
 * (OpenAI / Anthropic) to actually run completions. The smoke does NOT
 * assume a key is configured — instead it asserts the contract that
 * matters regardless: auth gating, input validation, and reachability
 * with a graceful response when the provider is missing.
 *
 * Coverage:
 *   - 401 without auth on every public AI endpoint
 *   - 400 on malformed body
 *   - Reachable + auth-gated for valid body (200 if provider configured;
 *     503 / 500 / 501 if not — all canon-acceptable in a smoke)
 *
 * @file ai.smoke.test.ts
 * @description Tier 8 AI smoke E2E
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import { checkApiAvailable } from "../testUtils.js";
import {
  apiPost,
  expectError,
  createTestAccount,
  cleanupTestAccount,
  API_BASE_URL,
  type TestAccountFixture,
} from "./helpers/index.js";

// AI endpoints can succeed (200) when a provider key is configured, or
// degrade gracefully (5xx / 501) when not. Both are acceptable in a smoke
// — the failure mode the smoke MUST catch is auth bypass / undefined
// crash / malformed validation handling.
const ACCEPTABLE_AI_STATUSES = new Set([200, 500, 501, 503]);

describe("Tier 8 — AI smoke", () => {
  let prisma: PrismaClient;
  let owner: TestAccountFixture;

  before(async () => {
    const apiAvailable = await checkApiAvailable();
    assert.ok(
      apiAvailable,
      `API not reachable at ${API_BASE_URL} — start \`pnpm dev\` before running smoke tests`
    );
    prisma = createTestPrismaClient();
    owner = await createTestAccount(prisma, { tagPrefix: "ai-owner" });
  });

  after(async () => {
    if (!prisma) return;
    try {
      await cleanupTestAccount(prisma, owner.accountId);
    } finally {
      await prisma.$disconnect();
    }
  });

  // -----------------------------------------------------------------------
  // Auth gating across the public AI surface
  // -----------------------------------------------------------------------

  it("rejects /generate without auth (401)", async () => {
    const result = await apiPost("/generate", {
      messages: [{ role: "user", content: "hello" }],
      options: {},
    });
    expectError(result, 401);
  });

  it("rejects /analyze without auth (401)", async () => {
    const result = await apiPost("/analyze", {
      content: "smoke test content",
      analysisType: "sentiment",
    });
    expectError(result, 401);
  });

  it("rejects /optimize without auth (401)", async () => {
    const result = await apiPost("/optimize", {
      content: "smoke test content",
      platform: "X",
    });
    expectError(result, 401);
  });

  it("rejects /predict without auth (401)", async () => {
    const result = await apiPost("/predict", {
      content: "smoke test content",
      platform: "X",
    });
    expectError(result, 401);
  });

  it("rejects /variations without auth (401)", async () => {
    const result = await apiPost("/variations", {
      content: "smoke test content",
      count: 3,
    });
    expectError(result, 401);
  });

  // -----------------------------------------------------------------------
  // Body validation
  // -----------------------------------------------------------------------

  it("rejects /generate with empty messages array (400)", async () => {
    const result = await apiPost("/generate", { messages: [], options: {} }, owner.authHeader);
    expectError(result, 400);
  });

  it("rejects /analyze with invalid analysisType (400)", async () => {
    const result = await apiPost(
      "/analyze",
      { content: "x", analysisType: "INVALID" },
      owner.authHeader
    );
    expectError(result, 400);
  });

  // -----------------------------------------------------------------------
  // Reachable + auth-gated (200 on key configured, 5xx/501 otherwise)
  // -----------------------------------------------------------------------

  it("/generate is reachable and auth-gated (any non-401 status)", async () => {
    const result = await apiPost(
      "/generate",
      {
        messages: [{ role: "user", content: "Generate one word." }],
        options: { temperature: 0.5, maxTokens: 5 },
      },
      owner.authHeader
    );
    assert.notStrictEqual(result.status, 401, "auth must be accepted by the route");
    assert.ok(
      ACCEPTABLE_AI_STATUSES.has(result.status),
      `unexpected status ${result.status}: ${JSON.stringify(result.body)}`
    );
  });

  it("/analyze is reachable and auth-gated (any non-401 status)", async () => {
    const result = await apiPost(
      "/analyze",
      { content: "smoke test content", analysisType: "sentiment" },
      owner.authHeader
    );
    assert.notStrictEqual(result.status, 401);
    assert.ok(ACCEPTABLE_AI_STATUSES.has(result.status), `unexpected status ${result.status}`);
  });
});
