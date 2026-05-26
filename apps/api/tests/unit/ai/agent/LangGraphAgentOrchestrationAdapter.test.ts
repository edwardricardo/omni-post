/**
 * @file LangGraphAgentOrchestrationAdapter.test.ts
 * @description Port-contract + trajectory-eval for the LangGraph agent
 *              adapter. Drives the real engine with an in-memory checkpointer
 *              and a deterministic fake AIServicePort, asserting: the
 *              run→interrupt→resume lifecycle, the recorded trajectory (node
 *              sequence, step count, cost ceiling — fails on regression), and
 *              the typed error mapping (unknown graph, recursion guard,
 *              invalid resume token).
 * @layer infrastructure
 */
import { describe, it, beforeEach, expect } from "vitest";
import type { AIServicePort } from "@core/domain/repositories/AIServicePort.js";
import type { StructuredOutputSpec } from "../../../../src/ai/types.js";
import { LangGraphAgentOrchestrationAdapter } from "../../../../src/ai/agent/LangGraphAgentOrchestrationAdapter.js";

const makeFakeAI = (acceptable = true): AIServicePort => {
  const generateStructured = async <T>(
    _m: unknown,
    spec: StructuredOutputSpec<T>
  ): Promise<{ ok: true; value: T } | { ok: false; error: "AI_ERROR" }> => {
    switch (spec.name) {
      case "repurpose_plan":
        return { ok: true, value: { strategy: "thread", angles: ["a"] } as T };
      case "repurpose_draft":
        return { ok: true, value: { content: "REWRITTEN" } as T };
      case "repurpose_critique":
        return { ok: true, value: { acceptable, feedback: "" } as T };
      default:
        return { ok: false, error: "AI_ERROR" };
    }
  };
  return {
    generateStructured,
    optimizeContent: async () => ({ success: false }),
    analyzeContent: async () => ({ success: false }),
    generateVariations: async () => ({ success: false }),
    generateContent: async () => ({ success: false }),
  } as unknown as AIServicePort;
};

const seed = {
  sourceContent: "Original.",
  sourcePlatform: "linkedin",
  targetPlatform: "x",
  attempts: 0,
};

describe("LangGraphAgentOrchestrationAdapter", () => {
  let adapter: LangGraphAgentOrchestrationAdapter;

  beforeEach(() => {
    adapter = new LangGraphAgentOrchestrationAdapter(makeFakeAI(true));
  });

  it("returns GRAPH_NOT_FOUND for an unregistered graph id", async () => {
    const res = await adapter.run("does-not-exist", seed, { maxSteps: 25, threadId: "g0" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("GRAPH_NOT_FOUND");
  });

  it("runs to the HITL interrupt with a deterministic trajectory", async () => {
    const res = await adapter.run("repurpose", seed, { maxSteps: 25, threadId: "g1" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.kind).toBe("interrupted");
    if (res.value.kind !== "interrupted") return;
    expect(res.value.interrupt.resumeToken).toBe("g1");
    const nodes = res.value.trajectory.steps.map((s) => s.node);
    expect(nodes).toEqual(["plan", "act", "reflect"]);
    expect(res.value.trajectory.totalSteps).toBe(3);
    expect(res.value.trajectory.totalTokenCost).toBeGreaterThan(0);
    // Cost ceiling: deterministic fake output is small; guards against
    // accidental prompt/state bloat regressions.
    expect(res.value.trajectory.totalTokenCost).toBeLessThan(500);
  });

  it("resumes the interrupt with approval and completes", async () => {
    const run = await adapter.run("repurpose", seed, { maxSteps: 25, threadId: "g2" });
    expect(run.ok).toBe(true);
    if (!run.ok || run.value.kind !== "interrupted") return;

    const resumed = await adapter.resume(
      "g2",
      { approved: true },
      { maxSteps: 25, threadId: "g2" }
    );
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.value.kind).toBe("completed");
    if (resumed.value.kind !== "completed") return;
    expect((resumed.value.state as { approved?: boolean }).approved).toBe(true);
  });

  it("maps a recursion-limit breach to MAX_STEPS_EXCEEDED", async () => {
    const res = await adapter.run("repurpose", seed, { maxSteps: 2, threadId: "g3" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("MAX_STEPS_EXCEEDED");
  });

  it("returns RESUME_TOKEN_INVALID for an unknown thread", async () => {
    const res = await adapter.resume(
      "never-ran",
      { approved: true },
      { maxSteps: 25, threadId: "never-ran" }
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("RESUME_TOKEN_INVALID");
  });
});
