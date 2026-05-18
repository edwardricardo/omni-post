/**
 * @file repurposeGraph.test.ts
 * @description Deterministic tests for the repurpose plan→act→reflect graph:
 *              node sequence, conditional reflect→act loop guard, and the
 *              per-run trajectory recorder. The injected AIServicePort is a
 *              fake returning fixed schema-valid objects, so the graph runs
 *              are reproducible (no network, no real LLM).
 * @layer infrastructure
 */
import { describe, it, beforeEach, expect } from "vitest";
import { MemorySaver, Command, isGraphInterrupt } from "@langchain/langgraph";
import type { AIServicePort } from "../../../../src/domain/repositories/AIServicePort.js";
import type { StructuredOutputSpec } from "../../../../src/ai/types.js";
import { buildRepurposeGraph } from "../../../../src/ai/agent/repurposeGraph.js";
import { TrajectoryRecorder } from "../../../../src/ai/agent/types.js";

interface FakeOpts {
  /** When false, the critique node reports the draft unacceptable (loops). */
  acceptable?: boolean;
}

const makeFakeAI = (opts: FakeOpts = {}): AIServicePort => {
  const acceptable = opts.acceptable ?? true;
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

describe("repurposeGraph", () => {
  let recorder: TrajectoryRecorder;

  beforeEach(() => {
    recorder = new TrajectoryRecorder();
  });

  it("runs plan→act→reflect then pauses at the human-approval interrupt", async () => {
    const graph = buildRepurposeGraph({
      ai: makeFakeAI({ acceptable: true }),
      recorder,
      maxAttempts: 3,
    });
    const compiled = graph.compile({ checkpointer: new MemorySaver() });
    const config = { configurable: { thread_id: "t1" }, recursionLimit: 25 };

    try {
      await compiled.invoke(initialState, config);
    } catch (e) {
      if (!isGraphInterrupt(e)) throw e;
    }

    const snap = recorder.snapshot();
    const nodes = snap.steps.map((s) => s.node);
    expect(nodes).toEqual(["plan", "act", "reflect"]);
    expect(snap.totalSteps).toBe(3);
    expect(snap.totalTokenCost).toBeGreaterThan(0);
    for (const step of snap.steps) {
      expect(step.toolCalls.length).toBe(1);
    }

    const state = await compiled.getState(config);
    expect(state.next.length).toBeGreaterThan(0);
  });

  it("resuming the interrupt with approval completes the graph", async () => {
    const graph = buildRepurposeGraph({
      ai: makeFakeAI({ acceptable: true }),
      recorder,
      maxAttempts: 3,
    });
    const compiled = graph.compile({ checkpointer: new MemorySaver() });
    const config = { configurable: { thread_id: "t2" }, recursionLimit: 25 };

    try {
      await compiled.invoke(initialState, config);
    } catch (e) {
      if (!isGraphInterrupt(e)) throw e;
    }
    await compiled.invoke(new Command({ resume: { approved: true } }), config);

    const finalState = await compiled.getState(config);
    expect(finalState.values.approved).toBe(true);
    expect(finalState.values.draft).toBe("REWRITTEN");
    expect(finalState.next.length).toBe(0);
  });

  it("loops act↔reflect bounded by maxAttempts when the critique is unacceptable", async () => {
    const graph = buildRepurposeGraph({
      ai: makeFakeAI({ acceptable: false }),
      recorder,
      maxAttempts: 2,
    });
    const compiled = graph.compile({ checkpointer: new MemorySaver() });
    const config = { configurable: { thread_id: "t3" }, recursionLimit: 25 };

    try {
      await compiled.invoke(initialState, config);
    } catch (e) {
      if (!isGraphInterrupt(e)) throw e;
    }

    const nodes = recorder.snapshot().steps.map((s) => s.node);
    const actCount = nodes.filter((n) => n === "act").length;
    const reflectCount = nodes.filter((n) => n === "reflect").length;
    expect(actCount).toBe(2);
    expect(reflectCount).toBe(2);
    expect(nodes[0]).toBe("plan");
  });
});
