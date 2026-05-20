/**
 * @file triageInboxHandler.test.ts
 * @description Unit tests for the TRIAGE_INBOX job handler: delegates to
 *              the triage use case, logs on success, throws on failure to
 *              signal a queue retry, and skips a malformed payload.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import type { TriageInboxMessageUseCase } from "../../../../src/application/inbox/TriageInboxMessageUseCase.js";
import { processTriageInboxJob } from "../../../../src/ai/consumers/triageInboxHandler.js";

function silentLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

function makeTriage(result: Awaited<ReturnType<TriageInboxMessageUseCase["execute"]>>): {
  triage: TriageInboxMessageUseCase;
  calls: unknown[];
} {
  const calls: unknown[] = [];
  const triage = {
    execute: async (input: unknown) => {
      calls.push(input);
      return result;
    },
  } as unknown as TriageInboxMessageUseCase;
  return { triage, calls };
}

describe("processTriageInboxJob", () => {
  it("runs triage for the message and resolves on success", async () => {
    const { triage, calls } = makeTriage(
      ok({
        priority: "URGENT",
        suggestedReplies: ["a", "b", "c"],
        sentimentScore: -0.5,
        crmContactId: null,
      })
    );

    await processTriageInboxJob(
      { triage, logger: silentLogger() },
      { messageId: "msg-1", accountId: "acc-1" }
    );

    assert.deepStrictEqual(calls[0], { messageId: "msg-1", accountId: "acc-1" });
  });

  it("throws to signal a retry when triage fails", async () => {
    const { triage } = makeTriage(err({ name: "UseCaseError", message: "boom" }) as never);

    await expect(
      processTriageInboxJob(
        { triage, logger: silentLogger() },
        { messageId: "msg-1", accountId: "acc-1" }
      )
    ).rejects.toThrow(/Triage inbox failed for message msg-1/);
  });

  it("skips a payload without messageId without calling the use case", async () => {
    const { triage, calls } = makeTriage(
      ok({ priority: "NORMAL", suggestedReplies: [], sentimentScore: 0, crmContactId: null })
    );

    await processTriageInboxJob(
      { triage, logger: silentLogger() },
      { messageId: "", accountId: "acc-1" }
    );

    assert.strictEqual(calls.length, 0);
  });

  it("skips a payload without accountId without calling the use case", async () => {
    const { triage, calls } = makeTriage(
      ok({ priority: "NORMAL", suggestedReplies: [], sentimentScore: 0, crmContactId: null })
    );

    await processTriageInboxJob(
      { triage, logger: silentLogger() },
      { messageId: "msg-1", accountId: "" }
    );

    assert.strictEqual(calls.length, 0);
  });
});
