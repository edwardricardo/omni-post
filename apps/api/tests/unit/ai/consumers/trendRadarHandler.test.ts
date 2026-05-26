/**
 * @file trendRadarHandler.test.ts
 * @description Unit tests for the TREND_RADAR job handler: delegates to the
 *              detect-trends use case, logs counts on success, throws on
 *              failure to signal a queue retry, and skips a malformed payload.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import type { DetectTrendsUseCase } from "@core/application/trends/DetectTrendsUseCase.js";
import { processTrendRadarJob } from "../../../../src/ai/consumers/trendRadarHandler.js";

function silentLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

function makeDetect(result: Awaited<ReturnType<DetectTrendsUseCase["execute"]>>): {
  detect: DetectTrendsUseCase;
  calls: unknown[];
} {
  const calls: unknown[] = [];
  const detect = {
    execute: async (input: unknown) => {
      calls.push(input);
      return result;
    },
  } as unknown as DetectTrendsUseCase;
  return { detect, calls };
}

describe("processTrendRadarJob", () => {
  it("runs detection for the account and resolves on success", async () => {
    const { detect, calls } = makeDetect(ok({ fetched: 5, scored: 3, persisted: 2, updated: 1 }));

    await processTrendRadarJob({ detect, logger: silentLogger() }, { accountId: "acc-1" });

    assert.deepStrictEqual(calls[0], { accountId: "acc-1" });
  });

  it("throws to signal a retry when detection fails", async () => {
    const { detect } = makeDetect(err({ name: "UseCaseError", message: "boom" }) as never);

    await expect(
      processTrendRadarJob({ detect, logger: silentLogger() }, { accountId: "acc-1" })
    ).rejects.toThrow(/Trend radar detection failed for account acc-1/);
  });

  it("skips a payload without an accountId without calling the use case", async () => {
    const { detect, calls } = makeDetect(ok({ fetched: 0, scored: 0, persisted: 0, updated: 0 }));

    await processTrendRadarJob({ detect, logger: silentLogger() }, { accountId: "" });

    assert.strictEqual(calls.length, 0);
  });
});
