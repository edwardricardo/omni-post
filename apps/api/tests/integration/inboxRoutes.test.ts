/**
 * Integration Tests — Client Inbox Routes (Triage Exposure)
 *
 * Exercises the inbox read endpoints to confirm the triage fields
 * persisted on `SocialMessage` are surfaced through `SocialMessageDTO`.
 * Coverage:
 *   - GET /inbox returns the seeded message with priority/sentimentScore/
 *     suggestedReplies/aiProcessedAt/crmContactId populated.
 *   - GET /inbox/mentions returns the MENTION-type seeded message.
 *   - GET /inbox/conversations/:id/messages returns conversation messages.
 *   - Cross-tenant: account B never sees account A's messages.
 *   - Missing token → 401 on the inbox listing.
 *
 * The dev environment (`pnpm dev`) MUST be up — API on 3000. Tests fail
 * loud if the API is unreachable.
 *
 * @file inboxRoutes.test.ts
 * @description Tests for the client-facing inbox routes (triage data exposure)
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
  otherAccountId: string;
  projectId: string;
  otherProjectId: string;
  channelId: string;
  conversationId: string;
  commentMessageId: string;
  mentionMessageId: string;
  authHeader: string;
  otherAuthHeader: string;
}

const tokenFor = (sub: string, accountId: string): string =>
  `Bearer ${signCustomerAccessToken({
    sub,
    accountId,
    roleId: "role-test",
    roleName: "OWNER",
    permissions: [],
  })}`;

async function getJson(path: string, authHeader?: string) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: authHeader ? { Authorization: authHeader } : {},
  });
  const body: unknown = await response.json().catch(() => null);
  return { status: response.status, body };
}

describe("Client inbox routes integration (triage exposure)", () => {
  let prisma: PrismaClient;
  let fixture: Fixture;

  before(async () => {
    const apiAvailable = await checkApiAvailable();
    assert.ok(
      apiAvailable,
      `API not reachable at ${API_URL} — start the dev environment with 'pnpm dev' before running this suite`
    );

    prisma = createTestPrismaClient();
    const tag = `inbox-int-${Date.now()}`;

    const account = await prisma.account.create({
      data: { email: `${tag}@test.com`, name: "Inbox Integration Account" },
    });
    const customerUser = await prisma.customerUser.create({
      data: {
        accountId: account.id,
        email: `customer-${tag}@test.com`,
        passwordHash: "ignored-for-test",
        firstName: "Inbox",
        lastName: "Tester",
      },
    });
    const project = await prisma.project.create({
      data: { accountId: account.id, name: `Inbox Project ${tag}` },
    });
    const channel = await prisma.channel.create({
      data: {
        projectId: project.id,
        accountId: account.id,
        provider: "INSTAGRAM",
        providerAccountId: `provider-acct-${tag}`,
        handle: "test-handle",
        credentialsCiphertext: "test-ciphertext",
        credentialsIv: "test-iv",
        credentialsAuthTag: "test-auth-tag",
      },
    });

    const triageFields = {
      priority: "URGENT" as const,
      sentimentScore: -0.8,
      suggestedReplies: [
        "We are sorry to hear about your experience.",
        "Could you share more so we can help?",
        "Apologies — reply with your order id and we will resolve this.",
      ],
      aiProcessedAt: new Date(),
      crmContactId: null,
    };

    const conversation = await prisma.socialConversation.create({
      data: {
        accountId: account.id,
        projectId: project.id,
        channelId: channel.id,
        provider: "INSTAGRAM",
        lastMessageAt: new Date(),
        rootProviderMessageId: `root-msg-${tag}`,
      },
    });

    const commentMessage = await prisma.socialMessage.create({
      data: {
        accountId: account.id,
        projectId: project.id,
        channelId: channel.id,
        conversationId: conversation.id,
        provider: "INSTAGRAM",
        providerMessageId: `provider-msg-c-${tag}`,
        messageType: "COMMENT",
        authorName: "Angry Customer",
        authorProviderId: `author-c-${tag}`,
        body: "This product is terrible, I want a refund!",
        providerCreatedAt: new Date(),
        ...triageFields,
      },
    });

    const mentionMessage = await prisma.socialMessage.create({
      data: {
        accountId: account.id,
        projectId: project.id,
        channelId: channel.id,
        provider: "INSTAGRAM",
        providerMessageId: `provider-msg-m-${tag}`,
        messageType: "MENTION",
        authorName: "Happy Customer",
        authorProviderId: `author-m-${tag}`,
        body: "Love the new launch, great work!",
        providerCreatedAt: new Date(),
        ...triageFields,
        priority: "NORMAL",
        sentimentScore: 0.9,
      },
    });

    const otherAccount = await prisma.account.create({
      data: { email: `other-${tag}@test.com`, name: "Cross-tenant Account" },
    });
    const otherCustomerUser = await prisma.customerUser.create({
      data: {
        accountId: otherAccount.id,
        email: `other-customer-${tag}@test.com`,
        passwordHash: "ignored-for-test",
        firstName: "Other",
        lastName: "Tester",
      },
    });
    const otherProject = await prisma.project.create({
      data: { accountId: otherAccount.id, name: `Other Inbox Project ${tag}` },
    });

    fixture = {
      accountId: account.id,
      otherAccountId: otherAccount.id,
      projectId: project.id,
      otherProjectId: otherProject.id,
      channelId: channel.id,
      conversationId: conversation.id,
      commentMessageId: commentMessage.id,
      mentionMessageId: mentionMessage.id,
      authHeader: tokenFor(customerUser.id, account.id),
      otherAuthHeader: tokenFor(otherCustomerUser.id, otherAccount.id),
    };
  });

  after(async () => {
    if (!fixture) return;
    const accountIds = [fixture.accountId, fixture.otherAccountId];
    const projectIds = [fixture.projectId, fixture.otherProjectId];
    await prisma.socialMessage.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.socialConversation.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.channel.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.project.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.customerUser.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  it("GET /inbox surfaces triage fields with numeric sentimentScore", async () => {
    const { status, body } = await getJson("/inbox", fixture.authHeader);

    assert.strictEqual(status, 200);
    const data = (body as { ok: boolean; data: { items: Array<{ id: string }> } }).data;
    const seeded = data.items.find((m) => m.id === fixture.commentMessageId);
    assert.ok(seeded, "seeded comment message should be listed");
    const typed = seeded as unknown as {
      priority: string;
      sentimentScore: number;
      suggestedReplies: string[];
      aiProcessedAt: string | null;
      crmContactId: string | null;
    };
    assert.strictEqual(typed.priority, "URGENT");
    assert.strictEqual(typeof typed.sentimentScore, "number");
    assert.ok(typed.sentimentScore <= 0, "sentimentScore should be negative for URGENT complaint");
    assert.strictEqual(typed.suggestedReplies.length, 3);
    assert.ok(typed.aiProcessedAt, "aiProcessedAt should be populated");
    assert.strictEqual(typed.crmContactId, null);
  });

  it("GET /inbox/mentions surfaces triage fields on a mention", async () => {
    const { status, body } = await getJson("/inbox/mentions", fixture.authHeader);

    assert.strictEqual(status, 200);
    const data = (body as { ok: boolean; data: { items: Array<{ id: string }> } }).data;
    const seeded = data.items.find((m) => m.id === fixture.mentionMessageId);
    assert.ok(seeded, "seeded mention message should be listed");
    const typed = seeded as unknown as {
      priority: string;
      sentimentScore: number;
      suggestedReplies: string[];
    };
    assert.strictEqual(typed.priority, "NORMAL");
    assert.strictEqual(typeof typed.sentimentScore, "number");
    assert.strictEqual(typed.suggestedReplies.length, 3);
  });

  it("GET /inbox/conversations/:id/messages surfaces triage on conversation messages", async () => {
    const { status, body } = await getJson(
      `/inbox/conversations/${fixture.conversationId}/messages`,
      fixture.authHeader
    );

    assert.strictEqual(status, 200);
    const data = (body as { ok: boolean; data: { items: Array<{ id: string }> } }).data;
    const seeded = data.items.find((m) => m.id === fixture.commentMessageId);
    assert.ok(seeded, "comment message should be returned by the conversation endpoint");
    const typed = seeded as unknown as { priority: string; sentimentScore: number };
    assert.strictEqual(typed.priority, "URGENT");
    assert.strictEqual(typeof typed.sentimentScore, "number");
  });

  it("does not leak inbox messages across tenants", async () => {
    const { status, body } = await getJson("/inbox", fixture.otherAuthHeader);

    assert.strictEqual(status, 200);
    const data = (body as { data: { items: Array<{ id: string }> } }).data;
    const leaked = data.items.some(
      (m) => m.id === fixture.commentMessageId || m.id === fixture.mentionMessageId
    );
    assert.strictEqual(leaked, false, "account B must not see account A's messages");
  });

  it("rejects an unauthenticated inbox request with 401", async () => {
    const { status } = await getJson("/inbox");
    assert.strictEqual(status, 401);
  });
});
