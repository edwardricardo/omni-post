/**
 * @file postChannelPublicationTenantIsolation.test.ts
 * @description Real-database proof that the per-channel publication record
 *   cannot carry an `accountId` that disagrees with its post's.
 *
 *   ## What this file measures today, and what it does not
 *
 *   This is the SKELETON of the record's tenant-isolation suite. It asserts the
 *   two properties the table's own definition has to carry before any writer
 *   exists: the table is there, and the composite `(postId, accountId)` foreign
 *   key to `Post(id, accountId)` refuses a row whose account is not the post's.
 *   The cross-tenant READ proofs — a foreign channel, a foreign post, and the
 *   worker-path write — need a writer to exist first and land with the read
 *   model, in the same batch as this file.
 *
 *   ## Why the composite FK is the thing under test
 *
 *   The Prisma tenant guard injects `accountId` from the bound context; it does
 *   NOT check that the parent belongs to that account. So the guard alone would
 *   happily persist a row carrying the caller's OWN account and a FOREIGN
 *   `postId` — an inconsistent row, and a read path into another tenant's post.
 *   The trio pattern (`Post.@@unique([id, accountId])` referenced by a composite
 *   FK) makes that row unrepresentable in the database rather than merely
 *   unwritten by the current code, which is why it is asserted here at the data
 *   layer instead of at a route.
 *
 *   Fixtures are raw SQL on the OWNER channel: they build the two-tenant world
 *   the constraint is then measured against, and raw SQL additionally bypasses
 *   the `$extends` guard, so a pass here cannot be a borrowed guard result.
 *
 * @layer infrastructure
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@infra/prisma";
import { assertSeedChannelConfigured, createSeedPrismaClient } from "./helpers/seedPrismaClient.js";
import {
  deleteAccountsCascade,
  describeError,
  insertAccount,
  insertProject,
  sqlStateOf,
} from "./helpers/postTrioFixtures.js";

// Fail FAST, at module scope, when the harness env is missing: a throwing
// `before` hook makes node:test CANCEL every child, which reads as a hang
// rather than as the one missing variable that caused it.
assertSeedChannelConfigured();

const TAG = `pcp-iso-${Date.now()}`;

/** PostgreSQL SQLSTATE for a foreign-key violation. */
const FOREIGN_KEY_VIOLATION = "23503";

let prisma: PrismaClient;
let accountA = "";
let accountB = "";
let postA = "";
let channelA = "";

/**
 * Inserts a post on the owner channel, naming `accountId` unconditionally.
 * The shared trio helper takes a DISCOVERED column shape because its own suites
 * straddle the migration that added the trio's tenant column; this file lands
 * after it, so threading that flag here would add a branch that can never be
 * false — inert protection reading as a real one.
 */
async function insertPost(
  client: PrismaClient,
  options: { projectId: string; accountId: string }
): Promise<string> {
  const id = randomUUID();
  await client.$executeRawUnsafe(
    `INSERT INTO "Post" (id, "projectId", "accountId", status, "updatedAt")
     VALUES ($1, $2, $3, 'DRAFT', NOW())`,
    id,
    options.projectId,
    options.accountId
  );
  return id;
}

/**
 * Inserts a channel on the owner channel. Written here rather than in the
 * shared trio fixtures because the trio predates the record and its helpers are
 * shaped by a migration this file does not straddle.
 */
async function insertChannel(
  client: PrismaClient,
  options: { accountId: string; projectId: string }
): Promise<string> {
  const id = randomUUID();
  await client.$executeRawUnsafe(
    `INSERT INTO "Channel" (
       id, "accountId", "projectId", provider, handle,
       "credentialsCiphertext", "credentialsIv", "credentialsAuthTag", "updatedAt")
     VALUES ($1, $2, $3, 'X'::"Provider", $4, 'x', 'x', 'x', NOW())`,
    id,
    options.accountId,
    options.projectId,
    `${TAG}-handle`
  );
  return id;
}

/**
 * Inserts a publication record for `(postId, channelId)` under `accountId`.
 * Every column named here is one the record's definition requires; the rest
 * carry their declared defaults, so a missing default surfaces as a not-null
 * violation naming its column instead of as a silent fixture divergence.
 */
async function insertPublication(
  client: PrismaClient,
  options: { postId: string; accountId: string; channelId: string }
): Promise<string> {
  const id = randomUUID();
  await client.$executeRawUnsafe(
    `INSERT INTO "PostChannelPublication" (id, "postId", "accountId", "channelId", "updatedAt")
     VALUES ($1, $2, $3, $4, NOW())`,
    id,
    options.postId,
    options.accountId,
    options.channelId
  );
  return id;
}

describe("PostChannelPublication tenant isolation", () => {
  before(async () => {
    prisma = createSeedPrismaClient();
    accountA = await insertAccount(prisma, { tag: `${TAG}-a` });
    accountB = await insertAccount(prisma, { tag: `${TAG}-b` });
    const projectA = await insertProject(prisma, {
      accountId: accountA,
      name: `${TAG}-project-a`,
    });
    postA = await insertPost(prisma, { projectId: projectA, accountId: accountA });
    channelA = await insertChannel(prisma, { accountId: accountA, projectId: projectA });
  });

  after(async () => {
    await deleteAccountsCascade(prisma, [accountA, accountB]);
    await prisma.$disconnect();
  });

  it("refuses a record whose accountId is not its post's", async () => {
    // The mismatched row goes FIRST, against a (post, channel) pair that holds no
    // record yet. Ordering is load-bearing: PostgreSQL evaluates unique indexes
    // before foreign-key triggers, so seeding the pair first would make the
    // duplicate-key refusal arrive before the tenant one and the suite would
    // report the wrong constraint as the thing protecting the tenant.
    let thrown: unknown;
    try {
      await insertPublication(prisma, {
        postId: postA,
        accountId: accountB,
        channelId: channelA,
      });
    } catch (error: unknown) {
      thrown = error;
    }

    assert.notEqual(
      thrown,
      undefined,
      "a record naming another tenant's account against this post is refused"
    );
    assert.equal(
      sqlStateOf(thrown),
      FOREIGN_KEY_VIOLATION,
      `the refusal is the composite (postId, accountId) foreign key, not another error: ${describeError(thrown)}`
    );

    const foreign = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM "PostChannelPublication" WHERE "accountId" = $1`,
      accountB
    );
    assert.equal(Number(foreign[0]?.count ?? 0n), 0, "no row was persisted for the other tenant");

    // Control on the SAME pair: the only thing that changes is the account, so a
    // constraint that simply refused everything cannot pass this test.
    const ownId = await insertPublication(prisma, {
      postId: postA,
      accountId: accountA,
      channelId: channelA,
    });
    const admitted = await prisma.$queryRawUnsafe<Array<{ accountId: string }>>(
      `SELECT "accountId" FROM "PostChannelPublication" WHERE id = $1`,
      ownId
    );
    assert.equal(admitted.length, 1, "a record whose account matches its post is admitted");
    assert.equal(admitted[0]?.accountId, accountA, "the admitted row carries its post's account");
  });
});
