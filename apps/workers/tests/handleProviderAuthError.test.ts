/**
 * @file handleProviderAuthError.test.ts
 * @description Tests for the AUTH-failure helper used by sync workers
 *   when a provider rejects credentials. Records the failure via the
 *   recorder and throws a descriptive error so BullMQ marks the job
 *   failed.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import { handleProviderAuthError } from "../src/lib/handleProviderAuthError.js";
import type { ChannelAuthFailureRecorder } from "../src/services/ChannelAuthFailureRecorder.js";

function createMockRecorder(opts: { recordThrows?: Error } = {}): ChannelAuthFailureRecorder {
  return {
    record: vi.fn(async () => {
      if (opts.recordThrows) throw opts.recordThrows;
    }),
  } as unknown as ChannelAuthFailureRecorder;
}

describe("handleProviderAuthError", () => {
  let recorder: ChannelAuthFailureRecorder;

  beforeEach(() => {
    recorder = createMockRecorder();
  });

  it("calls recorder.record with the channelId/provider/context/accountId, then throws", async () => {
    await expect(
      handleProviderAuthError(
        recorder,
        "ch-1",
        "x",
        "Provider rejected during inbox sync",
        "acct-1"
      )
    ).rejects.toThrow(/AUTH error for channel ch-1 \(x\)/);
    expect((recorder.record as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    const args = (recorder.record as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(args?.[0]).toBe("ch-1");
    expect(args?.[1]).toBe("x");
    expect(args?.[2]).toBe("Provider rejected during inbox sync");
    // Dropping the 4th argument would hand the recorder `accountId: undefined`,
    // which Prisma treats as "not provided" — an UNSCOPED update, i.e. exactly
    // the cross-tenant write this parameter exists to prevent.
    expect(args?.[3]).toBe("acct-1");
  });

  it("includes the context in the thrown error message", async () => {
    await expect(
      handleProviderAuthError(recorder, "ch-2", "instagram", "Token expired", "acct-1")
    ).rejects.toThrow(/Token expired/);
  });

  it("propagates recorder errors without swallowing them", async () => {
    recorder = createMockRecorder({ recordThrows: new Error("DB connection lost") });
    await expect(handleProviderAuthError(recorder, "ch-3", "x", "ctx", "acct-1")).rejects.toThrow(
      "DB connection lost"
    );
  });

  it("never returns normally — the post-condition is always a throw", async () => {
    let returned = false;
    try {
      await handleProviderAuthError(recorder, "ch-4", "x", "ctx", "acct-1");
      returned = true;
    } catch {
      /* expected */
    }
    expect(returned).toBe(false);
  });
});
