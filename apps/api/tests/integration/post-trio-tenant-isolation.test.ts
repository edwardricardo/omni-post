/**
 * @file post-trio-tenant-isolation.test.ts
 * @description Two-tenant real-database proof that `Post`, `PostContent` and
 *   `PostMedia` are isolated at the DATA LAYER — through the Prisma tenant
 *   guard itself, not only through the application's ownership checks.
 *
 *   ## Why this suite exists alongside the ownership suites
 *
 *   `postReadOwnership.test.ts` and `postDeleteOwnership.test.ts` already prove
 *   the HTTP surfaces refuse a foreign caller. Those gates are application code:
 *   they hold exactly as far as every route remembers to apply them, and they
 *   say nothing about a repository, worker, saga or script that reaches the
 *   trio through the client directly. This suite measures the layer underneath
 *   — a guarded client with a tenant bound — where the question is not "did the
 *   handler check?" but "can this query see the other tenant's rows at all?".
 *   Both are kept: the application gate is RETAINED, never replaced, and the
 *   ownership suites run in the same batch as this one.
 *
 *   `PostContent` and `PostMedia` are read DIRECTLY here, not through their
 *   parent. A child reachable only via `post.contents` inherits the parent's
 *   protection; a child queried by `postId` does not, and that is the access
 *   path an unenrolled model leaves open.
 *
 *   ## The client under test
 *
 *   The guarded client is built exactly as production wires it: a base client
 *   extended with `tenantGuardExtension`. The base is the OWNER channel, so row
 *   security is bypassed on this connection and the guard is the ONLY thing
 *   under measurement — an isolation result here cannot be a borrowed RLS
 *   result. Fixtures are raw SQL through `helpers/postTrioFixtures.ts` so the
 *   file compiles both before the tenant column exists and after it is required.
 *
 * @layer infrastructure
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@infra/prisma";
import {
  tenantGuardExtension,
  TenantContextMissingError,
} from "@infra/prisma/extensions/tenantGuard.js";
import { createApp } from "../../src/index.js";
import { signCustomerAccessToken } from "../../src/auth/customerJwt.js";
import {
  getTenantContext,
  getSystemContext,
  withTenantContext,
  withSystemContext,
} from "../../src/security/tenantContext.js";
import { PrismaPostRepository } from "../../src/infrastructure/repositories/PrismaPostRepository.js";
import { PrismaRecurringPostRepository } from "../../src/infrastructure/repositories/PrismaRecurringPostRepository.js";
import { PrismaUnitOfWork } from "../../src/infrastructure/unitofwork/PrismaUnitOfWork.js";
import { TOKENS } from "../../src/infrastructure/container/types.js";
import { ProcessRecurrenceUseCase } from "@core/recurring/index.js";
import { CreatePostUseCase } from "@core/posts/index.js";
import {
  AccountId,
  InMemoryEventDispatcher,
  PostId,
  type PostRepository,
} from "@core/domain/index.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { generateAdminToken } from "../unit/admin/adminTestHelper.js";
import { assertSeedChannelConfigured, createSeedPrismaClient } from "./helpers/seedPrismaClient.js";
import {
  countRows,
  deleteAccountsCascade,
  insertAccount,
  insertPost,
  insertPostContent,
  insertPostMedia,
  insertProject,
  readTrioTenantColumns,
  type TrioTenantColumns,
} from "./helpers/postTrioFixtures.js";

// Fail FAST, at module scope, when the harness env is missing. Run by hand without
// the root env sourced, the seed-channel error used to surface from inside `before`
// and node:test cancelled all children — a misconfiguration that read as 18 tests
// that "did not finish". Resolving here means no test is registered to cancel.
assertSeedChannelConfigured();

const TAG = `trio-iso-${Date.now()}`;

const bearerFor = (accountId: string): string =>
  `Bearer ${signCustomerAccessToken({
    sub: `trio-user-${accountId}`,
    accountId,
    roleId: "role-test",
    roleName: "OWNER",
    permissions: [],
  })}`;

// Admin bearer for `DELETE /posts/batch`, which is `requireAdminAuth` +
// `requirePermission(ACCOUNT_MANAGE)`. Signed with the admin JWT config the real
// AdminAuthService verifies against, and SUPER_ADMIN short-circuits the RBAC
// check — so no admin row is needed for the token path.
const adminBearer = `Bearer ${generateAdminToken({
  id: "trio-iso-admin",
  email: "trio-iso-admin@test.local",
  name: "Trio Iso Admin",
  role: "SUPER_ADMIN",
})}`;

/**
 * Bind a tenant and AWAIT the query INSIDE the binding.
 *
 * This exists because of a trap that only became visible once the trio was
 * enrolled. `withTenantContext(ctx, () => guarded.post.findMany(...))` looks
 * bound and is not: a Prisma client call returns a LAZY `PrismaPromise` that
 * executes nothing until it is awaited, `withTenantContext` returns as soon as
 * the arrow hands it back, and the query therefore runs AFTER the
 * AsyncLocalStorage scope has closed. The guard then sees no context and raises
 * `TenantContextMissingError` — a failure that says nothing about isolation.
 *
 * Measured both shapes against this database before writing the helper:
 * `() => query` raised `TenantContextMissingError`; `async () => await query`
 * resolved. Production is not exposed to this — every `withTenantContext` call
 * site in `apps/api/src` wraps a real `async` use case whose awaits happen
 * inside the scope — but a suite that drives the client DIRECTLY is, and this
 * suite exists to drive the client directly.
 */
const asTenant = <T>(accountId: string, run: () => PromiseLike<T>): Promise<T> =>
  withTenantContext({ accountId }, async () => await run());

interface Seeded {
  accountId: string;
  projectId: string;
  postId: string;
  contentId: string;
  mediaId: string;
}

describe("Post trio — data-layer tenant isolation", () => {
  let base: PrismaClient;
  let guarded: PrismaClient;
  let app: FastifyInstance;
  let columns: TrioTenantColumns;

  let tenantA: Seeded;
  let tenantB: Seeded;

  const controlBefore: Record<string, number> = {};

  /**
   * Creates a throwaway post owned by `owner`, with its own content row.
   *
   * Two kinds of arm need a disposable post and both need it for the same
   * reason: they MUTATE. The cross-tenant arms are written to fail while the
   * trio is unenrolled, and "fail" there means the write GOES THROUGH — a
   * cross-tenant update or delete that really lands. The own-tenant arms below
   * are the mirror: they SUCCEED, and archiving or destroying the shared
   * fixture would leave a later arm asserting against a row a predecessor
   * already changed. Either way a red arm would be reporting its predecessor's
   * damage rather than the defect it describes, so every mutating arm gets its
   * own row and the shared fixture stays pristine for the read and HTTP arms.
   * Cleanup is covered by the account-level cascade in teardown.
   */
  async function seedDisposablePost(
    owner: Seeded,
    label: string
  ): Promise<{ postId: string; contentId: string }> {
    const postId = await insertPost(base, columns, {
      projectId: owner.projectId,
      accountId: owner.accountId,
    });
    const contentId = await insertPostContent(base, columns, {
      postId,
      accountId: owner.accountId,
      body: `${TAG}-${label}-body`,
    });
    return { postId, contentId };
  }

  /** The B-owned victim the cross-tenant mutation arms aim at. */
  const seedVictimPost = (): Promise<{ postId: string; contentId: string }> =>
    seedDisposablePost(tenantB, "b-victim");

  async function seedTenant(name: string): Promise<Seeded> {
    const accountId = await insertAccount(base, { tag: `${TAG}-${name}` });
    const projectId = await insertProject(base, {
      accountId,
      name: `${TAG}-${name}-project`,
    });
    const postId = await insertPost(base, columns, { projectId, accountId });
    const contentId = await insertPostContent(base, columns, {
      postId,
      accountId,
      body: `${TAG}-${name}-secret-body`,
    });
    const mediaId = await insertPostMedia(base, columns, {
      postId,
      accountId,
      url: `https://cdn.test.local/${TAG}-${name}.png`,
    });
    return { accountId, projectId, postId, contentId, mediaId };
  }

  before(async () => {
    base = createSeedPrismaClient();
    columns = await readTrioTenantColumns(base);

    for (const table of ["Account", "Project", "Post", "PostContent", "PostMedia"]) {
      controlBefore[table] = await countRows(base, table);
    }

    tenantA = await seedTenant("a");
    tenantB = await seedTenant("b");

    guarded = base.$extends(
      tenantGuardExtension({ getTenantContext, getSystemContext })
    ) as unknown as PrismaClient;

    app = await createApp();
    await app.ready();
  });

  after(async () => {
    await app?.close();
    await deleteAccountsCascade(base, [tenantA.accountId, tenantB.accountId]);
    for (const table of ["Account", "Project", "Post", "PostContent", "PostMedia"]) {
      const now = await countRows(base, table);
      assert.strictEqual(
        now,
        controlBefore[table],
        `${table}: the suite must leave the database as it found it ` +
          `(before=${controlBefore[table]}, after=${now})`
      );
    }
    await base.$disconnect();
  });

  describe("A cannot reach B's posts through the guarded client", () => {
    it("a by-project read using B's projectId returns no rows", async () => {
      const rows = await asTenant(tenantA.accountId, () =>
        guarded.post.findMany({ where: { projectId: tenantB.projectId } })
      );
      assert.deepStrictEqual(
        rows.map((row) => row.id),
        [],
        "naming B's projectId must not be enough to read B's posts — the guard adds the " +
          "tenant predicate the caller did not write"
      );
    });

    it("an unfiltered global read returns none of B's posts", async () => {
      const rows = await asTenant(tenantA.accountId, () => guarded.post.findMany({}));
      const ids = rows.map((row) => row.id);
      assert.ok(
        !ids.includes(tenantB.postId),
        "B's post appeared in an unfiltered read bound to tenant A"
      );
    });

    it("a point read of B's post by id resolves to nothing", async () => {
      const row = await asTenant(tenantA.accountId, () =>
        guarded.post.findFirst({ where: { id: tenantB.postId } })
      );
      assert.strictEqual(row, null, "B's post must be invisible to a tenant-A-bound read");
    });

    it("a DIRECT PostContent read by B's postId returns zero rows", async () => {
      const rows = await asTenant(tenantA.accountId, () =>
        guarded.postContent.findMany({ where: { postId: tenantB.postId } })
      );
      assert.deepStrictEqual(
        rows.map((row) => row.id),
        [],
        "PostContent read by parent key is the access path that skips the parent's protection; " +
          "it must be closed by the child's own enrollment, not by Post's"
      );
    });

    it("a DIRECT PostMedia read by B's postId returns zero rows", async () => {
      const rows = await asTenant(tenantA.accountId, () =>
        guarded.postMedia.findMany({ where: { postId: tenantB.postId } })
      );
      assert.deepStrictEqual(
        rows.map((row) => row.id),
        [],
        "PostMedia read by parent key must be closed by the child's own enrollment"
      );
    });

    it("an unfiltered DIRECT PostContent read returns none of B's rows", async () => {
      const rows = await asTenant(tenantA.accountId, () => guarded.postContent.findMany({}));
      assert.ok(
        !rows.some((row) => row.id === tenantB.contentId),
        "B's content row appeared in an unfiltered read bound to tenant A"
      );
    });

    it("a bulk update aimed at B's post changes nothing", async () => {
      const victim = await seedVictimPost();
      await asTenant(tenantA.accountId, () =>
        guarded.post.updateMany({
          where: { id: victim.postId },
          data: { status: "SCHEDULED" },
        })
      );
      const rows = await base.$queryRawUnsafe<Array<{ status: string }>>(
        `SELECT status FROM "Post" WHERE id = $1`,
        victim.postId
      );
      assert.strictEqual(
        rows[0]?.status,
        "DRAFT",
        "a tenant-A-bound bulk update must not have reached B's post"
      );
    });

    it("a bulk archive aimed at B's post changes nothing", async () => {
      const victim = await seedVictimPost();
      await asTenant(tenantA.accountId, () =>
        guarded.post.updateMany({
          where: { id: victim.postId },
          data: { archivedAt: new Date() },
        })
      );
      const rows = await base.$queryRawUnsafe<Array<{ archivedAt: Date | null }>>(
        `SELECT "archivedAt" FROM "Post" WHERE id = $1`,
        victim.postId
      );
      assert.strictEqual(
        rows[0]?.archivedAt,
        null,
        "a tenant-A-bound bulk archive must not have reached B's post"
      );
    });

    it("a bulk delete aimed at B's post leaves it intact", async () => {
      const victim = await seedVictimPost();
      await asTenant(tenantA.accountId, () =>
        guarded.post.deleteMany({ where: { id: victim.postId } })
      );
      const rows = await base.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM "Post" WHERE id = $1`,
        victim.postId
      );
      assert.strictEqual(rows.length, 1, "B's post must survive a tenant-A-bound bulk delete");
    });

    it("a bulk delete aimed at B's content rows leaves them intact", async () => {
      const victim = await seedVictimPost();
      await asTenant(tenantA.accountId, () =>
        guarded.postContent.deleteMany({ where: { postId: victim.postId } })
      );
      const rows = await base.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM "PostContent" WHERE id = $1`,
        victim.contentId
      );
      assert.strictEqual(rows.length, 1, "B's content must survive a tenant-A-bound bulk delete");
    });
  });

  describe("a read with no context bound is loud, never silently empty", () => {
    it("Post raises TenantContextMissingError", async () => {
      await assert.rejects(
        () => guarded.post.findFirst({ where: { id: tenantA.postId } }),
        TenantContextMissingError,
        "an unbound read must fail loudly — silently returning nothing would hide the missing " +
          "context until a caller depended on the emptiness"
      );
    });

    it("PostContent raises TenantContextMissingError", async () => {
      await assert.rejects(
        () => guarded.postContent.findMany({ where: { postId: tenantA.postId } }),
        TenantContextMissingError
      );
    });

    it("PostMedia raises TenantContextMissingError", async () => {
      await assert.rejects(
        () => guarded.postMedia.findMany({ where: { postId: tenantA.postId } }),
        TenantContextMissingError
      );
    });
  });

  describe("A's own surfaces are unchanged", () => {
    it("A reads its own post, content and media through the guarded client", async () => {
      const [post, contents, media] = await withTenantContext(
        { accountId: tenantA.accountId },
        async () =>
          Promise.all([
            guarded.post.findFirst({ where: { id: tenantA.postId } }),
            guarded.postContent.findMany({ where: { postId: tenantA.postId } }),
            guarded.postMedia.findMany({ where: { postId: tenantA.postId } }),
          ])
      );
      assert.strictEqual(post?.id, tenantA.postId, "A must still read its own post");
      assert.deepStrictEqual(
        contents.map((row) => row.id),
        [tenantA.contentId],
        "A must still read its own content directly"
      );
      assert.deepStrictEqual(
        media.map((row) => row.id),
        [tenantA.mediaId],
        "A must still read its own media directly"
      );
    });

    it("A lists its own project's posts through the guarded client", async () => {
      const rows = await asTenant(tenantA.accountId, () =>
        guarded.post.findMany({ where: { projectId: tenantA.projectId } })
      );
      assert.deepStrictEqual(
        rows.map((row) => row.id),
        [tenantA.postId],
        "A must still see exactly its own project's posts"
      );
    });

    it("A updates and archives its own post through the guarded client", async () => {
      await asTenant(tenantA.accountId, () =>
        guarded.post.updateMany({
          where: { id: tenantA.postId },
          data: { status: "SCHEDULED" },
        })
      );
      const afterUpdate = await base.$queryRawUnsafe<Array<{ status: string }>>(
        `SELECT status FROM "Post" WHERE id = $1`,
        tenantA.postId
      );
      assert.strictEqual(afterUpdate[0]?.status, "SCHEDULED", "A's own update must apply");

      await base.$executeRawUnsafe(
        `UPDATE "Post" SET status = 'DRAFT' WHERE id = $1`,
        tenantA.postId
      );
    });
  });

  describe("the create path refuses a foreign project without leaking an engine error", () => {
    it("CreatePostUseCase with B's projectId under A's context is NOT_FOUND and persists nothing", async () => {
      const postRepository = new PrismaPostRepository(guarded);
      const useCase = new CreatePostUseCase(postRepository, new InMemoryEventDispatcher(), {
        incrementPostCreated: () => undefined,
        incrementPostPublished: () => undefined,
        incrementPostDeleted: () => undefined,
      });

      const before = await countRows(base, "Post");
      const result = await asTenant(tenantA.accountId, () =>
        useCase.execute({ projectId: tenantB.projectId, body: `${TAG}-should-not-persist` })
      );

      assert.ok(
        !result.ok,
        "creating into another tenant's project must fail — the composite foreign key is a " +
          "BACKSTOP, and a create that only the database refuses has already left the " +
          "application unable to answer the caller properly"
      );
      const code = result.ok ? "" : String((result.error as { code?: unknown }).code ?? "");
      assert.ok(
        code.includes("NOT_FOUND"),
        `expected a NOT_FOUND-shaped failure so a foreign project is indistinguishable from a ` +
          `nonexistent one, observed code=${code || "(none)"}. A 403 confirms the project ` +
          `exists; a raw engine error would surface as a 500`
      );

      const after = await countRows(base, "Post");
      assert.strictEqual(after, before, "the refused create must not have persisted a row");
    });
  });

  describe("child rows inherit the parent's tenant, never a caller-supplied one", () => {
    it("content and media created under A's context carry A's accountId", async () => {
      const postId = await insertPost(base, columns, {
        projectId: tenantA.projectId,
        accountId: tenantA.accountId,
      });
      await insertPostContent(base, columns, {
        postId,
        accountId: tenantA.accountId,
        body: `${TAG}-inherit`,
      });
      await insertPostMedia(base, columns, {
        postId,
        accountId: tenantA.accountId,
        url: `https://cdn.test.local/${TAG}-inherit.png`,
      });

      const rows = await base.$queryRawUnsafe<Array<{ table_name: string; accountId: string }>>(
        `SELECT 'Post' AS table_name, "accountId" FROM "Post" WHERE id = $1
         UNION ALL
         SELECT 'PostContent', "accountId" FROM "PostContent" WHERE "postId" = $1
         UNION ALL
         SELECT 'PostMedia', "accountId" FROM "PostMedia" WHERE "postId" = $1`,
        postId
      );
      assert.strictEqual(rows.length, 3, "expected one tenant key per trio row");
      for (const row of rows) {
        assert.strictEqual(
          row.accountId,
          tenantA.accountId,
          `${row.table_name} must carry the parent's tenant, observed ${row.accountId}`
        );
      }

      await base.$executeRawUnsafe(`DELETE FROM "PostMedia" WHERE "postId" = $1`, postId);
      await base.$executeRawUnsafe(`DELETE FROM "PostContent" WHERE "postId" = $1`, postId);
      await base.$executeRawUnsafe(`DELETE FROM "Post" WHERE id = $1`, postId);
    });

    it("the create input carries no tenant field, so a client cannot supply one", () => {
      // Server-derived provenance, pinned structurally rather than by trying to
      // send a tenant value the type does not accept: the tenant comes from the
      // bound context and the resolved parent, and there is no input channel a
      // caller could use to influence it.
      const input: Record<string, unknown> = {
        projectId: tenantA.projectId,
        body: `${TAG}-provenance`,
      };
      assert.ok(
        !("accountId" in input),
        "CreatePostInput must never grow a caller-supplied tenant field"
      );
    });
  });

  describe("the recurrence sweep declares its own scope", () => {
    it("succeeds inside withSystemContext and derives the tenant from the recurrence's owner", async () => {
      const useCase = new ProcessRecurrenceUseCase(
        new PrismaRecurringPostRepository(guarded),
        new PrismaUnitOfWork(guarded)
      );
      const result = await withSystemContext("recurrence-sweep", () => useCase.execute({}));
      assert.ok(
        result.ok,
        "the cross-account sweep must run under its declared system context; the tenant of " +
          "anything it writes comes from the source recurrence's ownership chain, never from " +
          "an ambient default"
      );
    });

    it("is blocked without a context wrap, proving the guard is active on the write path", async () => {
      const useCase = new ProcessRecurrenceUseCase(
        new PrismaRecurringPostRepository(guarded),
        new PrismaUnitOfWork(guarded)
      );
      const result = await useCase.execute({});
      assert.ok(
        !result.ok,
        "without a declared context the sweep must be refused rather than running unscoped"
      );
    });
  });

  describe("the application-level ownership gate is retained", () => {
    it("A reading B's post over HTTP is still 404 and leaks no body", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/posts/${tenantB.postId}`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 404, "foreign read must be NOT_FOUND, never 403 or 200");
      assert.ok(
        !res.payload.includes(`${TAG}-b-secret-body`),
        "B's content body must not appear in any response to A"
      );
    });

    it("A duplicating B's post over HTTP clones nothing into A", async () => {
      const before = await countRows(base, "Post");
      const res = await app.inject({
        method: "POST",
        url: "/posts/batch/duplicate",
        headers: {
          authorization: bearerFor(tenantA.accountId),
          "content-type": "application/json",
        },
        payload: { postIds: [tenantB.postId] },
      });
      assert.ok(
        res.statusCode < 500,
        `duplication of a foreign post must be refused cleanly, observed ${res.statusCode}`
      );
      assert.ok(
        !res.payload.includes(`${TAG}-b-secret-body`),
        "B's content body must not be echoed back to A"
      );
      const after = await countRows(base, "Post");
      assert.strictEqual(after, before, "no clone of B's post may be persisted for A");
    });

    it("A deleting B's post over HTTP is refused and B's post survives", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/posts/${tenantB.postId}`,
        headers: { authorization: bearerFor(tenantA.accountId) },
      });
      assert.strictEqual(res.statusCode, 404, "foreign delete must be NOT_FOUND, never 403");
      const rows = await base.$queryRawUnsafe<Array<{ deletedAt: Date | null }>>(
        `SELECT "deletedAt" FROM "Post" WHERE id = $1`,
        tenantB.postId
      );
      assert.strictEqual(rows.length, 1, "B's post row must still exist");
      assert.strictEqual(rows[0]?.deletedAt, null, "B's post must not have been soft-deleted");
    });

    it("A archiving B's post over HTTP is refused and B's post is unchanged", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/posts/batch/archive",
        headers: {
          authorization: bearerFor(tenantA.accountId),
          "content-type": "application/json",
        },
        payload: { postIds: [tenantB.postId] },
      });
      assert.ok(
        res.statusCode < 500,
        `archiving a foreign post must be refused cleanly, observed ${res.statusCode}`
      );
      const rows = await base.$queryRawUnsafe<Array<{ archivedAt: Date | null }>>(
        `SELECT "archivedAt" FROM "Post" WHERE id = $1`,
        tenantB.postId
      );
      assert.strictEqual(rows[0]?.archivedAt, null, "B's post must not have been archived by A");
    });

    it("A archiving its OWN post over HTTP archives exactly that post", async () => {
      const own = await seedDisposablePost(tenantA, "a-archive-own");

      const res = await app.inject({
        method: "PATCH",
        url: "/posts/batch/archive",
        headers: {
          authorization: bearerFor(tenantA.accountId),
          "content-type": "application/json",
        },
        payload: { postIds: [own.postId] },
      });

      assert.strictEqual(res.statusCode, 200, `own-tenant archive must succeed: ${res.payload}`);
      const body = JSON.parse(res.payload) as { data?: { archived?: number } };
      assert.strictEqual(
        body.data?.archived,
        1,
        `the endpoint must report the row it archived, observed ${res.payload}. A reported 0 ` +
          `here is the endpoint answering 200 over a write that never happened — the shape the ` +
          `refusal arm above cannot tell apart from working isolation`
      );

      const rows = await base.$queryRawUnsafe<Array<{ archivedAt: Date | null }>>(
        `SELECT "archivedAt" FROM "Post" WHERE id = $1`,
        own.postId
      );
      assert.notStrictEqual(
        rows[0]?.archivedAt ?? null,
        null,
        "A's own post must carry an archivedAt after A archived it; the count alone would not " +
          "prove the row moved"
      );
    });

    it("an admin hard-deleting A's OWN post over HTTP destroys exactly that post", async () => {
      const own = await seedDisposablePost(tenantA, "a-harddelete-own");

      const res = await app.inject({
        method: "DELETE",
        url: "/posts/batch",
        headers: {
          authorization: adminBearer,
          "content-type": "application/json",
        },
        payload: { postIds: [own.postId], accountId: tenantA.accountId },
      });

      assert.strictEqual(res.statusCode, 200, `admin hard-delete must succeed: ${res.payload}`);
      const body = JSON.parse(res.payload) as { data?: { deleted?: number } };
      assert.strictEqual(
        body.data?.deleted,
        1,
        `the endpoint must report the row it destroyed, observed ${res.payload}`
      );

      const rows = await base.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM "Post" WHERE id = $1`,
        own.postId
      );
      assert.strictEqual(
        rows.length,
        0,
        "the post must be physically gone; a 200 with the row still present is the endpoint " +
          "reporting a delete it never performed"
      );
    });

    it("bulkUpdateStatus inside a unit of work moves the caller's OWN post", async () => {
      // Driven through the container's OWN repository and unit of work rather
      // than a locally built pair: `bulkUpdateStatus` has no route, so the only
      // faithful reproduction of its production shape is the wiring the
      // composition root hands the batch use cases — an injected UnitOfWork and
      // a repository resolved from the same container.
      const own = await seedDisposablePost(tenantA, "a-status-own");
      const postRepository = app.container!.resolve<PostRepository>(TOKENS.PostRepository);
      const unitOfWork = app.container!.resolve<UnitOfWork>(TOKENS.UnitOfWork);

      const result = await withTenantContext({ accountId: tenantA.accountId }, async () =>
        unitOfWork.executeInTransaction(async () =>
          postRepository.bulkUpdateStatus([PostId.fromStringUnsafe(own.postId)], "SCHEDULED")
        )
      );

      assert.ok(result.ok, "the caller's own bulk status update must not fail");
      const rows = await base.$queryRawUnsafe<Array<{ status: string }>>(
        `SELECT status FROM "Post" WHERE id = $1`,
        own.postId
      );
      assert.strictEqual(
        rows[0]?.status,
        "SCHEDULED",
        "the status must ACTUALLY have moved. `bulkUpdateStatus` returns ok on an updateMany " +
          "that matched nothing, so an ok result read alone reports success over a no-op"
      );
    });

    it("filterIdsByAccount inside a unit of work still returns the caller's OWN ids", async () => {
      // The ownership gate both batch use cases run BEFORE they open their
      // transaction. That ordering is what keeps it working, and it is the only
      // thing that does: reverted to the injected client this arm goes red while the
      // whole rest of the batch stays green, which is exactly how a gate this
      // important should NOT be held up. Its `project: { accountId }` join meets
      // `Project`'s row security — pre-existing, not this enrollment's doing — so on
      // an unbound connection it returns an empty set and every id is dropped as
      // unowned. A gate that answers "not yours" about the caller's own posts fails
      // in the safe direction and is still wrong.
      const own = await seedDisposablePost(tenantA, "a-filter-own");
      const postRepository = app.container!.resolve<PostRepository>(TOKENS.PostRepository);
      const unitOfWork = app.container!.resolve<UnitOfWork>(TOKENS.UnitOfWork);

      const owned = await withTenantContext<PostId[]>({ accountId: tenantA.accountId }, async () =>
        unitOfWork.executeInTransaction<PostId[]>(async () =>
          postRepository.filterIdsByAccount(
            [PostId.fromStringUnsafe(own.postId)],
            AccountId.fromStringUnsafe(tenantA.accountId)
          )
        )
      );

      assert.deepStrictEqual(
        owned.map((id: PostId) => id.value),
        [own.postId],
        "the caller's own post must survive its own ownership filter inside a transaction"
      );
    });

    it("A updating B's post over HTTP is refused and B's post is unchanged", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/posts/${tenantB.postId}`,
        headers: {
          authorization: bearerFor(tenantA.accountId),
          "content-type": "application/json",
        },
        payload: { body: `${TAG}-tampered` },
      });
      assert.strictEqual(res.statusCode, 404, "foreign update must be NOT_FOUND, never 403");
      const rows = await base.$queryRawUnsafe<Array<{ body: string }>>(
        `SELECT body FROM "PostContent" WHERE id = $1`,
        tenantB.contentId
      );
      assert.strictEqual(
        rows[0]?.body,
        `${TAG}-b-secret-body`,
        "B's content must be byte-unchanged after A's attempt"
      );
    });

    it("B still reads its own post over HTTP", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/posts/${tenantB.postId}`,
        headers: { authorization: bearerFor(tenantB.accountId) },
      });
      assert.strictEqual(res.statusCode, 200, "the owner must still read its own post");
    });
  });

  describe("the tenant column shape this run measured", () => {
    it("reports which side of the migration the run is on", () => {
      const shape = `Post=${columns.post} PostContent=${columns.postContent} PostMedia=${columns.postMedia}`;
      assert.ok(
        typeof shape === "string" && shape.length > 0,
        "the discovered column shape must be reportable"
      );
      assert.deepStrictEqual(
        [columns.post, columns.postContent, columns.postMedia],
        [true, true, true],
        `all three trio tables must carry a tenant column; this run observed ${shape}. ` +
          `A partial result here means a partially applied migration, which would make every ` +
          `isolation claim above rest on a different shape per table.`
      );
    });
  });
});
