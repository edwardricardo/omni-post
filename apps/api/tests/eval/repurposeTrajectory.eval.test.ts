/**
 * @file repurposeTrajectory.eval.test.ts
 * @description Trajectory eval for the repurpose plan→act→reflect graph.
 *              Asserts the exact node sequence, the per-run token-cost
 *              upper bound, and the human-in-the-loop interrupt position.
 *              Mocks are fully deterministic (no network, no real LLM)
 *              so the run is reproducible across machines and CI.
 *
 *              Failure of any assertion below blocks merge: a drift in
 *              graph shape, an unbounded cost regression, or an HITL
 *              gate placed before the reflect step are all release-
 *              blocking.
 * @layer infrastructure
 */

import { describe, it, beforeEach, expect } from "vitest";
import { MemorySaver, Command, isGraphInterrupt } from "@langchain/langgraph";
import type { AIServicePort } from "@core/domain/repositories/AIServicePort.js";
import type { StructuredOutputSpec } from "../../src/ai/types.js";
import { buildRepurposeGraph } from "../../src/ai/agent/repurposeGraph.js";
import { TrajectoryRecorder } from "../../src/ai/agent/types.js";

/**
 * Per-run token-cost ceiling for the repurpose slice. Derived from the
 * deterministic mock baseline plus ~20 % headroom — anything beyond
 * that signals a regression in node fan-out, tool calls, or prompt
 * length.
 */
const MAX_REPURPOSE_TOKEN_BUDGET = 90;

/** Exact canonical node order for the happy path. */
const EXPECTED_NODE_ORDER: readonly string[] = ["plan", "act", "reflect"];

const fakeAI = (acceptable: boolean): AIServicePort => {
  const generateStructured = async <T>(
    _messages: unknown,
    spec: StructuredOutputSpec<T>
  ): Promise<{ ok: true; value: T } | { ok: false; error: "AI_ERROR" }> => {
    switch (spec.name) {
      case "repurpose_plan":
        return { ok: true, value: { strategy: "thread", angles: ["hook", "cta"] } as T };
      case "repurpose_draft":
        return { ok: true, value: { content: "REWRITTEN" } as T };
      case "repurpose_critique":
        return { ok: true, value: { acceptable, feedback: acceptable ? "" : "tighten" } as T };
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

const initialState = {
  sourceContent: "Original long-form post.",
  sourcePlatform: "linkedin",
  targetPlatform: "x",
  attempts: 0,
};

describe("trajectory eval — repurpose slice", () => {
  let recorder: TrajectoryRecorder;

  beforeEach(() => {
    recorder = new TrajectoryRecorder();
  });

  it("runs the canonical plan→act→reflect sequence and pauses at the HITL interrupt", async () => {
    const graph = buildRepurposeGraph({ ai: fakeAI(true), recorder, maxAttempts: 3 });
    const compiled = graph.compile({ checkpointer: new MemorySaver() });
    const config = { configurable: { thread_id: "eval-happy" }, recursionLimit: 25 };

    try {
      await compiled.invoke(initialState, config);
    } catch (e) {
      if (!isGraphInterrupt(e)) throw e;
    }

    const snap = recorder.snapshot();
    expect(snap.steps.map((s) => s.node)).toEqual(EXPECTED_NODE_ORDER);
    expect(snap.totalSteps).toBe(EXPECTED_NODE_ORDER.length);

    const state = await compiled.getState(config);
    expect(state.next.length).toBeGreaterThan(0);
  });

  it("keeps the per-run token cost under the canonical budget", async () => {
    const graph = buildRepurposeGraph({ ai: fakeAI(true), recorder, maxAttempts: 3 });
    const compiled = graph.compile({ checkpointer: new MemorySaver() });
    const config = { configurable: { thread_id: "eval-cost" }, recursionLimit: 25 };

    try {
      await compiled.invoke(initialState, config);
    } catch (e) {
      if (!isGraphInterrupt(e)) throw e;
    }

    const snap = recorder.snapshot();
    expect(snap.totalTokenCost).toBeGreaterThan(0);
    expect(
      snap.totalTokenCost,
      `repurpose trajectory cost regression: ${snap.totalTokenCost} > ${MAX_REPURPOSE_TOKEN_BUDGET}`
    ).toBeLessThanOrEqual(MAX_REPURPOSE_TOKEN_BUDGET);
  });

  it("the HITL interrupt is positioned after the reflect step (never before)", async () => {
    const graph = buildRepurposeGraph({ ai: fakeAI(true), recorder, maxAttempts: 3 });
    const compiled = graph.compile({ checkpointer: new MemorySaver() });
    const config = { configurable: { thread_id: "eval-hitl" }, recursionLimit: 25 };

    try {
      await compiled.invoke(initialState, config);
    } catch (e) {
      if (!isGraphInterrupt(e)) throw e;
    }

    const snap = recorder.snapshot();
    const reflectIdx = snap.steps.findIndex((s) => s.node === "reflect");
    expect(reflectIdx).toBeGreaterThanOrEqual(0);
    // The trajectory ends at reflect — the HITL interrupt fires immediately
    // after reflect and is the suspension point before any irreversible
    // downstream publish.
    expect(snap.steps.at(-1)?.node).toBe("reflect");
  });

  it("HITL approval resumes the graph to terminal state", async () => {
    const graph = buildRepurposeGraph({ ai: fakeAI(true), recorder, maxAttempts: 3 });
    const compiled = graph.compile({ checkpointer: new MemorySaver() });
    const config = { configurable: { thread_id: "eval-resume" }, recursionLimit: 25 };

    try {
      await compiled.invoke(initialState, config);
    } catch (e) {
      if (!isGraphInterrupt(e)) throw e;
    }
    await compiled.invoke(new Command({ resume: { approved: true } }), config);

    const finalState = await compiled.getState(config);
    expect(finalState.values.approved).toBe(true);
    expect(finalState.next.length).toBe(0);
  });
});
