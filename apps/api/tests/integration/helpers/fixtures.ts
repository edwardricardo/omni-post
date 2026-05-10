/**
 * @file fixtures.ts
 * @description Test fixture helpers — instantiate isolated Account /
 *              CustomerUser / AdminUser / Project / Channel / Post graphs
 *              for integration smoke tests. Centralizing the shape ensures
 *              every smoke uses canon-correct credential encryption (no
 *              placeholder ciphertext that fails decrypt) and FK-aware
 *              cleanup (no leftover PostContent rows blocking Account
 *              deletion).
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { signCustomerAccessToken } from "../../../src/auth/customerJwt.js";
import { EncryptionService } from "../../../src/security/EncryptionService.js";
import { ChannelCredentialsCrypto } from "../../../src/security/ChannelCredentialsCrypto.js";

function getCrypto(): ChannelCredentialsCrypto {
  // Build once per process; the encryption key is read from
  // PLATFORM_ENCRYPTION_KEY in the env, so test runs with the same .env
  // get a stable encryption key.
  const sentinel = globalThis as unknown as { __testCrypto?: ChannelCredentialsCrypto };
  if (!sentinel.__testCrypto) {
    sentinel.__testCrypto = new ChannelCredentialsCrypto(new EncryptionService());
  }
  return sentinel.__testCrypto;
}

export interface TestAccountFixture {
  accountId: string;
  customerUserId: string;
  customerEmail: string;
  authHeader: string;
}

export interface TestProjectFixture extends TestAccountFixture {
  projectId: string;
}

/**
 * Create an isolated Account + CustomerUser + JWT. Each call uses a
 * unique tag so tests can run in parallel without colliding on email
 * uniqueness.
 */
export async function createTestAccount(
  prisma: PrismaClient,
  opts: { tagPrefix?: string; role?: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER" } = {}
): Promise<TestAccountFixture> {
  const tag = `${opts.tagPrefix ?? "smk"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const account = await prisma.account.create({
    data: { email: `acct-${tag}@test.local`, name: `Smoke Account ${tag}` },
  });
  const customerEmail = `cust-${tag}@test.local`;
  const customerUser = await prisma.customerUser.create({
    data: {
      accountId: account.id,
      email: customerEmail,
      passwordHash: "ignored-for-test",
      firstName: "Smoke",
      lastName: "Tester",
    },
  });
  const accessToken = signCustomerAccessToken({
    sub: customerUser.id,
    accountId: account.id,
    role: opts.role ?? "OWNER",
  });
  return {
    accountId: account.id,
    customerUserId: customerUser.id,
    customerEmail,
    authHeader: `Bearer ${accessToken}`,
  };
}

/**
 * Create an Account + CustomerUser + Project (the most common base for
 * smoke tests that exercise project-scoped flows).
 */
export async function createTestAccountWithProject(
  prisma: PrismaClient,
  opts: { tagPrefix?: string; role?: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER" } = {}
): Promise<TestProjectFixture> {
  const account = await createTestAccount(prisma, opts);
  const project = await prisma.project.create({
    data: {
      accountId: account.accountId,
      name: `Smoke Project ${Date.now()}`,
    },
  });
  return { ...account, projectId: project.id };
}

/**
 * Create a Channel with REAL encrypted credentials (auth-tag valid).
 * Smoke tests that exercise saga / publishing flows MUST use this helper —
 * placeholder ciphertext fails decrypt and surfaces as 500 from the saga
 * route admission path.
 */
export async function createTestChannel(
  prisma: PrismaClient,
  projectId: string,
  opts: {
    provider?: "X" | "FACEBOOK" | "INSTAGRAM" | "LINKEDIN" | "BLUESKY" | "YOUTUBE";
    handle?: string;
    credentials?: Record<string, unknown>;
  } = {}
): Promise<{ id: string; provider: string; handle: string }> {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const provider = opts.provider ?? "X";
  const handle = opts.handle ?? `smoke-handle-${tag}`;
  // Stub credentials shape covers most providers; real OAuth flows replace
  // this with provider-specific tokens. The decrypt path only validates
  // auth-tag/AAD — content is opaque.
  const plaintextCreds = opts.credentials ?? {
    accessToken: `test-token-${tag}`,
    refreshToken: `test-refresh-${tag}`,
  };

  // Pre-compute a temporary id so we can bind it as AAD before the row exists.
  // Channel uses a generated UUID — we mint our own and pass it both to crypto
  // and to prisma.create.
  const channelId = crypto.randomUUID();
  const envelope = getCrypto().encrypt(plaintextCreds, { recordId: channelId });

  const channel = await prisma.channel.create({
    data: {
      id: channelId,
      projectId,
      provider,
      providerAccountId: `acc-${tag}`,
      handle,
      credentialsCiphertext: envelope.credentialsCiphertext,
      credentialsIv: envelope.credentialsIv,
      credentialsAuthTag: envelope.credentialsAuthTag,
      credentialsKeyVersion: envelope.credentialsKeyVersion,
    },
  });

  return { id: channel.id, provider, handle };
}

/**
 * Create a Post + PostContent in a given status. Defaults to DRAFT — the
 * status that most flows accept as their starting point.
 */
export async function createTestPost(
  prisma: PrismaClient,
  projectId: string,
  opts: {
    status?: "DRAFT" | "SCHEDULED" | "PUBLISHED";
    locale?: string;
    body?: string;
    title?: string;
    scheduledAt?: Date;
  } = {}
): Promise<{ id: string; status: string }> {
  const status = opts.status ?? "DRAFT";
  const post = await prisma.post.create({
    data: {
      projectId,
      status,
      ...(opts.scheduledAt && { scheduledAt: opts.scheduledAt }),
      ...(status === "PUBLISHED" && { publishedAt: new Date() }),
    },
  });
  await prisma.postContent.create({
    data: {
      postId: post.id,
      locale: opts.locale ?? "en",
      revision: 1,
      body: opts.body ?? "smoke test post body",
      title: opts.title ?? null,
    },
  });
  return { id: post.id, status };
}

/**
 * FK-aware cleanup — drops every row a smoke test creates under an
 * Account, in the order the foreign-key constraints require. Must be
 * called from `after()` to keep the test DB clean across runs.
 */
export async function cleanupTestAccount(prisma: PrismaClient, accountId: string): Promise<void> {
  // Find every project under the account so we can cascade
  const projects = await prisma.project.findMany({
    where: { accountId },
    select: { id: true },
  });
  const projectIds = projects.map((p) => p.id);

  if (projectIds.length > 0) {
    // Posts → PostContent + PublishLog must drop first
    const posts = await prisma.post.findMany({
      where: { projectId: { in: projectIds } },
      select: { id: true },
    });
    const postIds = posts.map((p) => p.id);
    if (postIds.length > 0) {
      await prisma.postContent.deleteMany({ where: { postId: { in: postIds } } });
      await prisma.publishLog.deleteMany({ where: { postId: { in: postIds } } });
    }
    await prisma.post.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.channel.deleteMany({ where: { projectId: { in: projectIds } } });
  }

  // Sagas owned by the account's customer user (best-effort filter —
  // sagaInstance.context is JSONB, customerUserId may or may not be present).
  await prisma.sagaInstance.deleteMany({
    where: {
      OR: [{ context: { path: ["accountId"], equals: accountId } as never }, { accountId }],
    },
  });

  await prisma.project.deleteMany({ where: { accountId } });
  await prisma.customerUser.deleteMany({ where: { accountId } });
  await prisma.account.deleteMany({ where: { id: accountId } });
}
