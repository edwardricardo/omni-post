/**
 * @file teamInviteDuplicateEmail.integration.test.ts
 * @description Real-database proof that POST /team/invite answers its documented conflict, 409,
 *   when the invited e-mail collides with a member the account already holds, including one the
 *   pre-flight lookup cannot see.
 *
 *   The lookup reads live rows only, while `CustomerUser_accountId_email_key` is a TOTAL unique:
 *   an e-mail held by a SOFT-DELETED member of the same account passes the lookup and collides
 *   at the insert. Prisma 7 reports that collision through `@prisma/adapter-pg` at
 *   `meta.driverAdapterError.cause.constraint` and never fills `meta.target`, so a repository
 *   that read `meta.target` turned it into an internal failure and the route answered 400
 *   "Failed to save team member". Only the real client, the real adapter and the real index can
 *   show which of the two the route answers; a double reproduces whatever shape it was given.
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@infra/prisma";
import { createSeedPrismaClient } from "./helpers/seedPrismaClient.js";
import { createApp } from "../../src/index.js";
import { signCustomerAccessToken } from "../../src/auth/customerJwt.js";

const TAG = `team-invite-duplicate-${Date.now()}`;
const RETURNING_EMAIL = `${TAG}@example.test`;

describe("POST /team/invite with an e-mail the account already holds", () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;
  let accountId: string;
  let bearer: string;
  let memberRoleId: string;
  let createdMemberRole = false;

  before(async () => {
    prisma = createSeedPrismaClient();

    const existingRole = await prisma.customerRole.findUnique({ where: { name: "MEMBER" } });
    if (existingRole) {
      memberRoleId = existingRole.id;
    } else {
      const created = await prisma.customerRole.create({
        data: { name: "MEMBER", description: `${TAG} member role`, level: 10 },
      });
      memberRoleId = created.id;
      createdMemberRole = true;
    }

    const account = await prisma.account.create({
      data: { email: `${TAG}-owner@example.test`, name: TAG },
    });
    accountId = account.id;
    bearer = `Bearer ${signCustomerAccessToken({
      sub: `${TAG}-owner`,
      accountId,
      roleId: memberRoleId,
      roleName: "OWNER",
      permissions: [],
    })}`;

    // The member who left: soft-deleted, so invisible to the invite's live-row lookup, while
    // the account and e-mail pair still holds its slot in the total unique index.
    await prisma.customerUser.create({
      data: {
        accountId,
        email: RETURNING_EMAIL,
        passwordHash: "",
        firstName: "Former",
        lastName: "Member",
        roleId: memberRoleId,
        deletedAt: new Date("2026-10-01T00:00:00.000Z"),
      },
    });

    app = await createApp();
    await app.ready();
  });

  after(async () => {
    await app?.close();
    if (prisma) {
      await prisma.customerUser
        .deleteMany({ where: { email: { startsWith: TAG } } })
        .catch(() => undefined);
      await prisma.account.deleteMany({ where: { name: TAG } }).catch(() => undefined);
      if (createdMemberRole) {
        await prisma.customerRole.delete({ where: { id: memberRoleId } }).catch(() => undefined);
      }
      await prisma.$disconnect();
    }
  });

  it("answers 409 for an e-mail held by a soft-deleted member, and writes no second row", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/team/invite",
      headers: { authorization: bearer },
      payload: { accountId, email: RETURNING_EMAIL, name: "Returning Member" },
    });

    assert.equal(res.statusCode, 409, `expected the documented conflict, got ${res.body}`);
    const body = res.json() as { ok: boolean; error: string };
    assert.equal(body.ok, false);
    assert.equal(
      body.error,
      `Member with email "${RETURNING_EMAIL}" already exists in this account`
    );

    const rows = await prisma.customerUser.findMany({
      where: { accountId, email: RETURNING_EMAIL },
      select: { firstName: true, deletedAt: true },
    });
    assert.equal(rows.length, 1, "the refused invitation must not add a row");
    assert.equal(rows[0]?.firstName, "Former", "the soft-deleted member must stay as it was");
    assert.notEqual(rows[0]?.deletedAt, null, "the soft-deleted member must stay soft-deleted");
  });
});
