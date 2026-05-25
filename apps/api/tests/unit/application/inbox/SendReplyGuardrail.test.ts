/**
 * @file SendReplyGuardrail.test.ts
 * @description Unit tests for the guardrail wire in `SendReplyUseCase`:
 *              when the registry blocks the body, the use case returns a
 *              `GUARDRAIL_REJECTED` error without persisting the outbound
 *              reply or invoking the provider adapter. When the registry
 *              allows, the flow proceeds and the outbound reply repo is
 *              called. When no registry is wired, the guardrail step is
 *              skipped entirely.
 * @layer infrastructure
 */
import { describe, it, expect, vi } from "vitest";
import { ok } from "@shared/types";
import { SendReplyUseCase } from "@core/application/inbox/SendReplyUseCase.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { GuardrailRegistry } from "@core/application/guardrails/GuardrailRegistry.js";
import type {
  GuardrailPort,
  GuardrailDecision,
} from "../../../../src/domain/repositories/GuardrailPort.js";

// Aggregate stub mirrors the surface the use case touches. `isReplied`
// is set so the transition steps short-circuit — we only need the
// pre-persistence flow (validation + guardrail + repo.save call).
function makeAggregate() {
  return {
    accountId: "acc-1",
    provider: "X" as const,
    channelId: "chan-1",
    providerMessageId: "ext-1",
    isUnread: false,
    isReplied: true,
    domainEvents: [] as unknown[],
    clearDomainEvents: vi.fn(),
  };
}

function makeRepos() {
  const findById = vi.fn(async () => ok(makeAggregate()));
  const save = vi.fn(async () => ok({ id: "reply-1", body: "ignored" }));
  const updateStatus = vi.fn(async () => ok(undefined));
  const saveSocialMessage = vi.fn(async () => ok(undefined));

  return {
    socialMessageRepository: { findById, save: saveSocialMessage } as never,
    outboundReplyRepository: { save, updateStatus } as never,
    eventDispatcher: { dispatch: vi.fn(async () => undefined) } as never,
    findById,
    save,
    updateStatus,
  };
}

function makeGuardrail(decision: GuardrailDecision): GuardrailRegistry {
  const port: GuardrailPort = {
    name: "test-guardrail",
    evaluate: async () => decision,
  };
  return new GuardrailRegistry([port]);
}

describe("SendReplyUseCase — guardrail wire", () => {
  it("returns GUARDRAIL_REJECTED when the registry blocks the body", async () => {
    const r = makeRepos();
    const blocking = makeGuardrail({
      allow: false,
      guardrailName: "content-policy",
      reason: "banned term",
      severity: "medium",
    });

    const uc = new SendReplyUseCase(
      r.socialMessageRepository,
      r.outboundReplyRepository,
      r.eventDispatcher,
      undefined,
      undefined,
      undefined,
      blocking
    );

    const result = await uc.execute({
      messageId: "01234567-89ab-4def-8123-456789abcdef",
      authorId: "author-1",
      body: "click here to win free money",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(USE_CASE_ERRORS.GUARDRAIL_REJECTED);
      expect(result.error.message).toMatch(/content-policy/);
      expect(result.error.message).toMatch(/banned term/);
    }
    // No persistence happened.
    expect(r.save).not.toHaveBeenCalled();
  });

  it("proceeds to the existing flow when the registry allows", async () => {
    const r = makeRepos();
    const allowing = makeGuardrail({ allow: true });

    const uc = new SendReplyUseCase(
      r.socialMessageRepository,
      r.outboundReplyRepository,
      r.eventDispatcher,
      undefined,
      undefined,
      undefined,
      allowing
    );

    const result = await uc.execute({
      messageId: "01234567-89ab-4def-8123-456789abcdef",
      authorId: "author-1",
      body: "Thanks for reaching out — we'll take a look.",
    });

    // Without channel/provider adapter, the existing flow short-circuits
    // after creating the reply record but BEFORE calling the provider —
    // critical: persistence happened, guardrail did not block.
    expect(r.save).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });

  it("falls back to the previous behaviour when no guardrail is wired", async () => {
    const r = makeRepos();

    const uc = new SendReplyUseCase(
      r.socialMessageRepository,
      r.outboundReplyRepository,
      r.eventDispatcher
    );

    const result = await uc.execute({
      messageId: "01234567-89ab-4def-8123-456789abcdef",
      authorId: "author-1",
      body: "click here to win free money",
    });

    // Without a registry, the use case skips the guardrail check entirely.
    expect(result.ok).toBe(true);
    expect(r.save).toHaveBeenCalled();
  });

  it("rejects an empty body BEFORE invoking the guardrail (validation-first)", async () => {
    const r = makeRepos();
    const allowing = makeGuardrail({ allow: true });
    const evaluateSpy = vi.spyOn(allowing, "evaluate");

    const uc = new SendReplyUseCase(
      r.socialMessageRepository,
      r.outboundReplyRepository,
      r.eventDispatcher,
      undefined,
      undefined,
      undefined,
      allowing
    );

    const result = await uc.execute({
      messageId: "01234567-89ab-4def-8123-456789abcdef",
      authorId: "author-1",
      body: "   ",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
    expect(evaluateSpy).not.toHaveBeenCalled();
  });
});
