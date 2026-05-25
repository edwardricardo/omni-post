/**
 * @file GuardrailRegistry.test.ts
 * @description Unit tests for the guardrail composer: cascade order with
 *              fail-fast on first block, metric emission for every
 *              evaluation, and empty-registry edge case.
 * @layer infrastructure
 */
import { describe, it, expect, vi } from "vitest";
import { GuardrailRegistry } from "@core/application/guardrails/GuardrailRegistry.js";
import type { GuardrailPort, GuardrailDecision } from "@core/domain/repositories/GuardrailPort.js";
import type { GuardrailMetrics } from "@core/domain/repositories/GuardrailMetricsPort.js";

function makePort(
  name: string,
  decision: GuardrailDecision
): { port: GuardrailPort; evaluate: ReturnType<typeof vi.fn> } {
  const evaluate = vi.fn().mockResolvedValue(decision);
  return { port: { name, evaluate }, evaluate };
}

function makeMetrics(): {
  metrics: GuardrailMetrics;
  recordEvaluation: ReturnType<typeof vi.fn>;
} {
  const recordEvaluation = vi.fn();
  return { metrics: { recordEvaluation }, recordEvaluation };
}

describe("GuardrailRegistry", () => {
  it("returns allow when no guardrails are registered", async () => {
    const registry = new GuardrailRegistry([]);

    const decision = await registry.evaluate({ action: "send-reply", text: "hi" });

    expect(decision.allow).toBe(true);
  });

  it("runs every guardrail when all allow", async () => {
    const a = makePort("a", { allow: true });
    const b = makePort("b", { allow: true });
    const registry = new GuardrailRegistry([a.port, b.port]);

    const decision = await registry.evaluate({ action: "send-reply", text: "hi" });

    expect(decision.allow).toBe(true);
    expect(a.evaluate).toHaveBeenCalledTimes(1);
    expect(b.evaluate).toHaveBeenCalledTimes(1);
  });

  it("fail-fasts on the first blocking guardrail", async () => {
    const a = makePort("a", {
      allow: false,
      guardrailName: "a",
      reason: "nope",
      severity: "high",
    });
    const b = makePort("b", { allow: true });
    const registry = new GuardrailRegistry([a.port, b.port]);

    const decision = await registry.evaluate({ action: "send-reply", text: "hi" });

    expect(decision.allow).toBe(false);
    if (!decision.allow) {
      expect(decision.guardrailName).toBe("a");
      expect(decision.reason).toBe("nope");
    }
    expect(a.evaluate).toHaveBeenCalledTimes(1);
    expect(b.evaluate).not.toHaveBeenCalled();
  });

  it("emits a metric observation per evaluated guardrail", async () => {
    const a = makePort("a", { allow: true });
    const b = makePort("b", { allow: true });
    const m = makeMetrics();
    const registry = new GuardrailRegistry([a.port, b.port], m.metrics);

    await registry.evaluate({ action: "send-reply", text: "hi" });

    expect(m.recordEvaluation).toHaveBeenCalledTimes(2);
    const calls = m.recordEvaluation.mock.calls;
    expect(calls[0]?.[0]).toMatchObject({
      guardrail: "a",
      action: "send-reply",
      decision: "allow",
    });
    expect(calls[1]?.[0]).toMatchObject({
      guardrail: "b",
      action: "send-reply",
      decision: "allow",
    });
  });

  it("emits a 'block' metric for the blocking guardrail and skips subsequent ones", async () => {
    const a = makePort("a", {
      allow: false,
      guardrailName: "a",
      reason: "nope",
      severity: "low",
    });
    const b = makePort("b", { allow: true });
    const m = makeMetrics();
    const registry = new GuardrailRegistry([a.port, b.port], m.metrics);

    await registry.evaluate({ action: "send-reply", text: "hi" });

    expect(m.recordEvaluation).toHaveBeenCalledTimes(1);
    expect(m.recordEvaluation.mock.calls[0]?.[0]).toMatchObject({
      guardrail: "a",
      decision: "block",
    });
  });
});
