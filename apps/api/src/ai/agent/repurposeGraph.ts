/**
 * @file repurposeGraph.ts
 * @description The repurpose plan→act→reflect agent graph. Built on
 *              LangGraph `StateGraph`; the plan/act/reflect nodes use the
 *              schema-validated `AIServicePort.generateStructured`. A
 *              human-in-the-loop `interrupt` gates the result before any
 *              downstream irreversible publish (the publish is performed by
 *              the worker, not this graph). Fully deterministic when the
 *              injected `AIServicePort` is a stub, so trajectory assertions
 *              are reproducible.
 * @layer infrastructure
 */

import { StateGraph, Annotation, START, END, interrupt } from "@langchain/langgraph";
import { z } from "zod";
import type { AIServicePort } from "@core/domain/repositories/AIServicePort.js";
import type { StructuredOutputSpec } from "../types.js";
import { TrajectoryRecorder, type RepurposeHumanDecision } from "./types.js";

const PlanSchema = z.object({
  strategy: z.string(),
  angles: z.array(z.string()),
});
const DraftSchema = z.object({ content: z.string() });
const CritiqueSchema = z.object({
  acceptable: z.boolean(),
  feedback: z.string(),
});

/** Builds a technology-free `StructuredOutputSpec` from a zod schema. */
function specOf<T>(name: string, schema: z.ZodType<T>): StructuredOutputSpec<T> {
  return {
    name,
    jsonSchema: z.toJSONSchema(schema) as Record<string, unknown>,
    parse: (raw: unknown): T => schema.parse(raw),
  };
}

/** Deterministic cost proxy so the trajectory-eval has a stable cost signal. */
function costOf(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4);
}

const RepurposeState = Annotation.Root({
  sourceContent: Annotation<string>(),
  sourcePlatform: Annotation<string>(),
  targetPlatform: Annotation<string>(),
  plan: Annotation<{ strategy: string; angles: string[] } | undefined>(),
  draft: Annotation<string | undefined>(),
  critique: Annotation<{ acceptable: boolean; feedback: string } | undefined>(),
  attempts: Annotation<number>({ reducer: (_x, y) => y, default: () => 0 }),
  approved: Annotation<boolean | undefined>(),
});

export interface BuildRepurposeGraphDeps {
  /** Schema-validated structured generation used by every node. */
  readonly ai: AIServicePort;
  /** Per-run trajectory recorder (one instance per run, never shared). */
  readonly recorder: TrajectoryRecorder;
  /** Max act↔reflect passes before forcing the HITL gate (loop guard). */
  readonly maxAttempts: number;
}

/**
 * @function buildRepurposeGraph
 * @description Builds the plan→act→reflect→approve graph. The caller
 *   compiles it with an injected checkpointer (the checkpointer choice is
 *   the caller's; this builder is engine-state-only).
 * @param deps - AI port, trajectory recorder, loop guard.
 * @returns An uncompiled `StateGraph` (the caller compiles with a checkpointer).
 */
export function buildRepurposeGraph(deps: BuildRepurposeGraphDeps) {
  const { ai, recorder, maxAttempts } = deps;

  const plan = async (s: typeof RepurposeState.State) =>
    recorder.record("plan", async () => {
      const spec = specOf("repurpose_plan", PlanSchema);
      const res = await ai.generateStructured(
        [
          {
            role: "system",
            content: "You plan how to repurpose a social post for another platform.",
          },
          {
            role: "user",
            content: `From ${s.sourcePlatform} to ${s.targetPlatform}. Content: ${s.sourceContent}`,
          },
        ],
        spec
      );
      const plan = res.ok ? res.value : { strategy: "verbatim", angles: ["as-is"] };
      return { delta: { plan }, tokenCost: costOf(plan), toolCalls: [spec.name] };
    });

  const act = async (s: typeof RepurposeState.State) =>
    recorder.record("act", async () => {
      const spec = specOf("repurpose_draft", DraftSchema);
      const feedback = s.critique?.feedback ? ` Address feedback: ${s.critique.feedback}` : "";
      const res = await ai.generateStructured(
        [
          { role: "system", content: "You rewrite content for the target platform." },
          {
            role: "user",
            content: `Strategy: ${s.plan?.strategy ?? "verbatim"}. Rewrite for ${s.targetPlatform}.${feedback} Source: ${s.sourceContent}`,
          },
        ],
        spec
      );
      const draft = res.ok ? res.value.content : s.sourceContent;
      return {
        delta: { draft, attempts: s.attempts + 1 },
        tokenCost: costOf(draft),
        toolCalls: [spec.name],
      };
    });

  const reflect = async (s: typeof RepurposeState.State) =>
    recorder.record("reflect", async () => {
      const spec = specOf("repurpose_critique", CritiqueSchema);
      const res = await ai.generateStructured(
        [
          { role: "system", content: "You critique a repurposed draft against the plan." },
          {
            role: "user",
            content: `Plan: ${JSON.stringify(s.plan)}. Draft: ${s.draft ?? ""}`,
          },
        ],
        spec
      );
      const critique = res.ok ? res.value : { acceptable: true, feedback: "" };
      return { delta: { critique }, tokenCost: costOf(critique), toolCalls: [spec.name] };
    });

  const approve = async (s: typeof RepurposeState.State) =>
    recorder.record("approve", async () => {
      const decision = interrupt({
        reason: "Human approval required before the repurposed draft is published downstream.",
        draft: s.draft,
        targetPlatform: s.targetPlatform,
      }) as RepurposeHumanDecision;
      return { delta: { approved: decision.approved === true }, tokenCost: 0, toolCalls: [] };
    });

  const routeAfterReflect = (s: typeof RepurposeState.State): "act" | "approve" => {
    if (s.critique?.acceptable === true) return "approve";
    if (s.attempts >= maxAttempts) return "approve";
    return "act";
  };

  // A node id must not collide with a state channel name, so the planning
  // node is "planning" (the `plan` channel holds its output). Trajectory step
  // labels are independent of node ids — see each node's recorder label.
  return new StateGraph(RepurposeState)
    .addNode("planning", plan)
    .addNode("act", act)
    .addNode("reflect", reflect)
    .addNode("approve", approve)
    .addEdge(START, "planning")
    .addEdge("planning", "act")
    .addEdge("act", "reflect")
    .addConditionalEdges("reflect", routeAfterReflect, {
      act: "act",
      approve: "approve",
    })
    .addEdge("approve", END);
}

export { RepurposeState };
