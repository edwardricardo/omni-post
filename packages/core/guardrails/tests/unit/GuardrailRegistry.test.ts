/**
 * @file GuardrailRegistry.test.ts
 * @description Unit tests for GuardrailRegistry — all-allow pass, first-block
 *   short-circuits, and metrics are recorded per evaluation.
 * @layer infrastructure
 */
import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { GuardrailRegistry } from "../../src/GuardrailRegistry.js";
import type {
  GuardrailPort,
  GuardrailInput,
  GuardrailDecision,
} from "@core/domain/repositories/GuardrailPort.js";
import type { GuardrailMetrics } from "@core/domain/repositories/GuardrailMetricsPort.js";

function makeInput(overrides: Partial<GuardrailInput> = {}): GuardrailInput {
  return {
    action: "post.publish",
    accountId: "acc-001",
    content: "Hello world!",
    ...overrides,
  } as GuardrailInput;
}

function makeGuardrail(decision: GuardrailDecision, name = "test-guardrail"): GuardrailPort {
  return {
    name,
    evaluate: vi.fn(async () => decision),
  } as unknown as GuardrailPort;
}

function makeMockMetrics(): GuardrailMetrics {
  return {
    recordEvaluation: vi.fn(),
  } as unknown as GuardrailMetrics;
}

describe("GuardrailRegistry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns allow: true when all guardrails pass", async () => {
    const registry = new GuardrailRegistry([
      makeGuardrail({ allow: true }),
      makeGuardrail({ allow: true }),
    ]);
    const decision = await registry.evaluate(makeInput());
    assert.strictEqual(decision.allow, true);
  });

  it("returns the first block decision and short-circuits remaining guardrails", async () => {
    const second = makeGuardrail({ allow: true }, "second");
    const registry = new GuardrailRegistry([
      makeGuardrail({ allow: false, reason: "content-policy" }, "first"),
      second,
    ]);
    const decision = await registry.evaluate(makeInput());
    assert.strictEqual(decision.allow, false);
    // second guardrail must NOT be called after the first blocks
    assert.strictEqual((second.evaluate as ReturnType<typeof vi.fn>).mock.calls.length, 0);
  });

  it("records one metrics observation per guardrail that was evaluated", async () => {
    const metrics = makeMockMetrics();
    const registry = new GuardrailRegistry(
      [makeGuardrail({ allow: true }, "g1"), makeGuardrail({ allow: true }, "g2")],
      metrics
    );
    await registry.evaluate(makeInput());
    assert.strictEqual((metrics.recordEvaluation as ReturnType<typeof vi.fn>).mock.calls.length, 2);
  });

  it("returns allow: true when the guardrail list is empty", async () => {
    const registry = new GuardrailRegistry([]);
    const decision = await registry.evaluate(makeInput());
    assert.strictEqual(decision.allow, true);
  });
});
