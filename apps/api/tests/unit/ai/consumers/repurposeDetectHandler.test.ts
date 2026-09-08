/**
 * @file repurposeDetectHandler.test.ts
 * @description Unit tests for the DETECT_REPURPOSE job handler: delegates
 *              to the detection use case, logs counts on success, throws
 *              on failure to signal a queue retry, and skips a malformed
 *              payload.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import type { DetectRepurposeCandidatesUseCase } from "@core/ai/DetectRepurposeCandidatesUseCase.js";
import { processRepurposeDetectJob } from "../../../../src/ai/consumers/repurposeDetectHandler.js";
import { getTenantContext } from "../../../../src/security/tenantContext.js";

function silentLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

function makeDetect(result: Awaited<ReturnType<DetectRepurposeCandidatesUseCase["execute"]>>): {
  detect: DetectRepurposeCandidatesUseCase;
  calls: unknown[];
} {
  const calls: unknown[] = [];
  const detect = {
    execute: async (input: unknown) => {
      calls.push(input);
      return result;
    },
  } as unknown as DetectRepurposeCandidatesUseCase;
  return { detect, calls };
}

describe("processRepurposeDetectJob", () => {
  it("runs detection for the account and resolves on success", async () => {
    const { detect, calls } = makeDetect(ok({ detected: 2, alreadyProposed: 1 }));

    await processRepurposeDetectJob({ detect, logger: silentLogger() }, { accountId: "acc-1" });

    assert.deepStrictEqual(calls[0], { accountId: "acc-1" });
  });

  it("binds the payload's account as the tenant context for the whole run", async () => {
    // A queue job carries no request, so this handler is the boundary that binds the scope.
    // Detection creates a `repurposeProposal`, a tenant-guard-enrolled model, on the container's
    // guarded client: without the binding that write does not degrade, it throws, and the queue
    // retries the job forever.
    let seen: string | undefined;
    const detect = {
      execute: async () => {
        seen = getTenantContext()?.accountId;
        return ok({ detected: 0, alreadyProposed: 0 });
      },
    } as unknown as DetectRepurposeCandidatesUseCase;

    await processRepurposeDetectJob({ detect, logger: silentLogger() }, { accountId: "acc-1" });

    assert.strictEqual(seen, "acc-1");
    assert.strictEqual(getTenantContext(), undefined, "the binding must not outlive the job");
  });

  it("throws to signal a retry when detection fails", async () => {
    const { detect } = makeDetect(err({ name: "UseCaseError", message: "boom" }) as never);

    await expect(
      processRepurposeDetectJob({ detect, logger: silentLogger() }, { accountId: "acc-1" })
    ).rejects.toThrow(/Repurpose detection failed for account acc-1/);
  });

  it("skips a payload without an accountId without calling the use case", async () => {
    const { detect, calls } = makeDetect(ok({ detected: 0, alreadyProposed: 0 }));

    await processRepurposeDetectJob({ detect, logger: silentLogger() }, { accountId: "" });

    assert.strictEqual(calls.length, 0);
  });
});
