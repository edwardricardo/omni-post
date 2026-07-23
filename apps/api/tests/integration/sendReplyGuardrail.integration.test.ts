/**
 * Integration Tests — Send Reply Guardrail
 *
 * Exercises `POST /api/inbox/messages/:id/reply` end-to-end to confirm:
 *   - A body containing a banned term (ContentPolicyGuardrail) is
 *     rejected with HTTP 422 and `GUARDRAIL_REJECTED` semantics.
 *   - The `omnipost_guardrail_evaluations_total` metric on `/metrics`
 *     shows `decision="block"` increments after the rejection.
 *   - Empty body returns 400 (input validation precedes guardrail).
 *
 * The dev environment (`pnpm dev`) MUST be up — API on 3000. Tests fail
 * loud if the API is unreachable.
 *
 * @file sendReplyGuardrail.integration.test.ts
 * @description Tests for the pre-action guardrail on send reply
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import { checkApiAvailable, getBaseUrl } from "../testUtils.js";
import { signCustomerAccessToken } from "../../src/auth/customerJwt.js";

const API_URL = getBaseUrl();

interface Fixture {
  accountId: string;
  messageId: string;
  authHeader: string;
}

const tokenFor = (sub: string, accountId: string): string =>
  `Bearer ${signCustomerAccessToken({
    sub,
    accountId,
    roleId: "role-test",
    roleName: "OWNER",
    permissions: [],
  })}`;

async function postJson(
  path: string,
  body: unknown,
  authHeader?: string
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  return { status: response.status, body: payload };
}

async function getMetricsText(): Promise<string> {
  const response = await fetch(`${API_URL}/metrics`);
  return response.text();
}

function counterValue(metrics: string, line: string): number {
  const re = new RegExp(`^${line}\\s+(\\d+(?:\\.\\d+)?)$`, "m");
  const match = metrics.match(re);
  return match ? Number(match[1]) : 0;
}

describe("Send reply guardrail integration", () => {
  let prisma: PrismaClient;
  let fixture: Fixture;

  before(async () => {
    const apiAvailable = await checkApiAvailable();
    assert.ok(
      apiAvailable,
      `API not reachable at ${API_URL} — start the dev environment with 'pnpm dev' before running this suite`
    );

    prisma = createTestPrismaClient();
    const tag = `guardrail-int-${Date.now()}`;

    const account = await prisma.account.create({
      data: { email: `${tag}@test.com`, name: "Guardrail Integration Account" },
    });
    const customerUser = await prisma.customerUser.create({
      data: {
        accountId: account.id,
        email: `customer-${tag}@test.com`,
        passwordHash: "ignored-for-test",
        firstName: "Guardrail",
        lastName: "Tester",
      },
    });
    const project = await prisma.project.create({
      data: { accountId: account.id, name: `Guardrail Project ${tag}` },
    });
    const channel = await prisma.channel.create({
      data: {
        projectId: project.id,
        accountId: account.id,
        provider: "X",
        handle: `@channel-${tag}`,
        credentialsCiphertext: "test-fixture-credentials",
        credentialsIv: "test-fixture-iv",
        credentialsAuthTag: "test-fixture-tag",
      },
    });
    const conversation = await prisma.socialConversation.create({
      data: {
        accountId: account.id,
        projectId: project.id,
        channelId: channel.id,
        provider: "X",
        lastMessageAt: new Date(),
      },
    });
    const message = await prisma.socialMessage.create({
      data: {
        accountId: account.id,
        projectId: project.id,
        channelId: channel.id,
        conversationId: conversation.id,
        provider: "X",
        providerMessageId: `ext-msg-${tag}`,
        messageType: "COMMENT",
        authorName: "Inbound Author",
        authorProviderId: "inbound-author",
        body: "Inbound message under triage",
        providerCreatedAt: new Date(),
      },
    });

    fixture = {
      accountId: account.id,
      messageId: message.id,
      authHeader: tokenFor(customerUser.id, account.id),
    };
  });

  after(async () => {
    if (!fixture) return;
    await prisma.socialMessage.deleteMany({ where: { accountId: fixture.accountId } });
    await prisma.socialConversation.deleteMany({ where: { accountId: fixture.accountId } });
    await prisma.channel.deleteMany({ where: { project: { accountId: fixture.accountId } } });
    await prisma.project.deleteMany({ where: { accountId: fixture.accountId } });
    await prisma.customerUser.deleteMany({ where: { accountId: fixture.accountId } });
    await prisma.account.deleteMany({ where: { id: fixture.accountId } });
    await prisma.$disconnect();
  });

  it("rejects a reply with a banned term and exposes the failure metric", async () => {
    const before = counterValue(
      await getMetricsText(),
      'omnipost_guardrail_evaluations_total{guardrail="content-policy",action="send-reply",decision="block"}'
    );

    const { status, body } = await postJson(
      `/inbox/messages/${fixture.messageId}/reply`,
      { body: "Click HERE to get free money fast!" },
      fixture.authHeader
    );

    assert.strictEqual(status, 422);
    const error = (body as { ok: boolean; error: string }).error;
    assert.match(error, /content-policy/);

    const after = counterValue(
      await getMetricsText(),
      'omnipost_guardrail_evaluations_total{guardrail="content-policy",action="send-reply",decision="block"}'
    );
    assert.strictEqual(after, before + 1, "block counter must increment by 1 after the rejection");
  });

  it("returns 400 for an empty body (validation precedes guardrail)", async () => {
    const { status } = await postJson(
      `/inbox/messages/${fixture.messageId}/reply`,
      { body: "" },
      fixture.authHeader
    );
    assert.strictEqual(status, 400);
  });
});
