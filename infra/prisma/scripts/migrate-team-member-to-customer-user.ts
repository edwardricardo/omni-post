/**
 * @file migrate-team-member-to-customer-user.ts
 * @description Backfill script for workstream/customer-unification-rbac-v1 (Sub-fase 1.2).
 *              Unifies the parallel TeamMember and CustomerUser models. For each
 *              TeamMember row, ensures a corresponding CustomerUser exists
 *              (match by accountId+email, or create stub for pending invitations),
 *              copies invitation fields, resolves roleId from the TeamRole enum
 *              to CustomerRole.id, and back-fills the 14 customerUserId FKs across
 *              13 tables that previously referenced TeamMember.id.
 *
 *              Run AFTER Sub-fase 1.1 (schema columns exist) and Sub-fase 1.5
 *              (CustomerRole seed). Run BEFORE Sub-fase 1.3 (drop TeamMember).
 *
 *              Idempotent: re-running over already-populated rows is a no-op.
 *
 * @layer infrastructure
 */
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(import.meta.dirname, "../../../.env") });

import { PrismaClient } from "../generated/prisma/client/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { createLogger } from "@observability/logger";

const logger = createLogger("migrate-team-member-to-customer-user");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

interface RoleMap {
  OWNER: string;
  MANAGER: string;
  MEMBER: string;
  VIEWER: string;
}

async function buildRoleMap(): Promise<RoleMap> {
  const roles = await prisma.customerRole.findMany({
    where: { name: { in: ["OWNER", "MANAGER", "MEMBER", "VIEWER"] } },
  });
  const byName = new Map(roles.map((r) => [r.name, r.id]));
  for (const name of ["OWNER", "MANAGER", "MEMBER", "VIEWER"] as const) {
    if (!byName.has(name)) {
      throw new Error(`CustomerRole "${name}" not found. Run \`pnpm db:seed\` before this script.`);
    }
  }
  return {
    OWNER: byName.get("OWNER")!,
    MANAGER: byName.get("MANAGER")!,
    MEMBER: byName.get("MEMBER")!,
    VIEWER: byName.get("VIEWER")!,
  };
}

/**
 * For a TeamMember, return its corresponding CustomerUser.id, creating one if
 * none exists for the (accountId, email) pair. Also updates the CustomerUser
 * with invitation fields + roleId on every call so the data converges.
 */
async function resolveCustomerUserId(
  teamMember: {
    id: string;
    accountId: string;
    email: string;
    name: string;
    role: "OWNER" | "MANAGER" | "MEMBER" | "VIEWER";
    invitedBy: string | null;
    inviteToken: string | null;
    inviteTokenExpiry: Date | null;
    joinedAt: Date;
    isActive: boolean;
  },
  roleMap: RoleMap
): Promise<string> {
  // Match existing CustomerUser by (accountId, email)
  let customerUser = await prisma.customerUser.findUnique({
    where: { accountId_email: { accountId: teamMember.accountId, email: teamMember.email } },
  });

  const targetRoleId = roleMap[teamMember.role];

  if (customerUser === null) {
    // No CustomerUser exists — create a stub. This is the "invitation pending"
    // case: TeamMember was invited but never completed signup with a password.
    // The user completes the stub when they accept the invitation.
    const [firstName, ...rest] = teamMember.name.trim().split(/\s+/);
    const lastName = rest.join(" ") || "—";

    customerUser = await prisma.customerUser.create({
      data: {
        accountId: teamMember.accountId,
        email: teamMember.email,
        passwordHash: "", // empty placeholder; user sets a real one on invitation acceptance
        firstName: firstName || teamMember.email.split("@")[0]!,
        lastName,
        roleId: targetRoleId,
        role: teamMember.role, // legacy enum kept in sync; dropped in Sub-fase 1.3
        isActive: teamMember.isActive,
        isEmailVerified: false,
        invitedBy: teamMember.invitedBy,
        inviteToken: teamMember.inviteToken,
        inviteTokenExpiry: teamMember.inviteTokenExpiry,
        joinedAt: teamMember.joinedAt,
      },
    });
    logger.info(
      {
        teamMemberId: teamMember.id,
        customerUserId: customerUser.id,
        email: teamMember.email,
      },
      "Created CustomerUser stub for pending invitation"
    );
  } else {
    // Update with invitation fields + roleId (idempotent: only overwrites
    // when the source row carries data).
    const updates: Record<string, unknown> = {};
    if (customerUser.roleId === null) updates.roleId = targetRoleId;
    if (customerUser.invitedBy === null && teamMember.invitedBy !== null) {
      updates.invitedBy = teamMember.invitedBy;
    }
    if (customerUser.inviteToken === null && teamMember.inviteToken !== null) {
      updates.inviteToken = teamMember.inviteToken;
    }
    if (customerUser.inviteTokenExpiry === null && teamMember.inviteTokenExpiry !== null) {
      updates.inviteTokenExpiry = teamMember.inviteTokenExpiry;
    }
    // joinedAt: TeamMember has a default of now() at the row's creation. If
    // the CustomerUser pre-dates the TeamMember, prefer the CustomerUser's
    // (createdAt). If the TeamMember pre-dates, prefer the TeamMember's
    // joinedAt. Use the earlier of the two.
    if (teamMember.joinedAt < customerUser.joinedAt) {
      updates.joinedAt = teamMember.joinedAt;
    }
    if (Object.keys(updates).length > 0) {
      await prisma.customerUser.update({
        where: { id: customerUser.id },
        data: updates,
      });
    }
  }

  return customerUser.id;
}

/**
 * Backfill every FK that references TeamMember.id by populating the parallel
 * customerUserId column on each table.
 */
async function backfillFks(
  teamMemberToCustomerUser: Map<string, string>
): Promise<{ table: string; updated: number }[]> {
  const results: { table: string; updated: number }[] = [];

  // Helper: idempotent update — only set the new column when it's null
  async function backfillOne(
    tableName: string,
    fkFrom: string,
    fkTo: string,
    fetch: () => Promise<{ id: string; from: string | null; to: string | null }[]>,
    update: (id: string, customerUserId: string) => Promise<void>
  ): Promise<void> {
    const rows = await fetch();
    let updated = 0;
    for (const row of rows) {
      if (row.from === null) continue;
      if (row.to !== null) continue; // already backfilled
      const customerUserId = teamMemberToCustomerUser.get(row.from);
      if (customerUserId === undefined) {
        logger.warn(
          { table: tableName, rowId: row.id, [fkFrom]: row.from },
          "Orphan FK row — TeamMember.id not in mapping; leaving customerUserId null"
        );
        continue;
      }
      await update(row.id, customerUserId);
      updated++;
    }
    results.push({ table: `${tableName}.${fkTo}`, updated });
    logger.info({ table: tableName, fkTo, updated, total: rows.length }, "Backfilled FK column");
  }

  await backfillOne(
    "ProjectMember",
    "memberId",
    "customerUserId",
    () =>
      prisma.projectMember
        .findMany({ select: { id: true, memberId: true, customerUserId: true } })
        .then((rs) => rs.map((r) => ({ id: r.id, from: r.memberId, to: r.customerUserId }))),
    (id, customerUserId) =>
      prisma.projectMember.update({ where: { id }, data: { customerUserId } }).then(() => {})
  );

  await backfillOne(
    "Notification",
    "recipientId",
    "recipientCustomerUserId",
    () =>
      prisma.notification
        .findMany({ select: { id: true, recipientId: true, recipientCustomerUserId: true } })
        .then((rs) =>
          rs.map((r) => ({ id: r.id, from: r.recipientId, to: r.recipientCustomerUserId }))
        ),
    (id, customerUserId) =>
      prisma.notification
        .update({ where: { id }, data: { recipientCustomerUserId: customerUserId } })
        .then(() => {})
  );

  await backfillOne(
    "NotificationPreference",
    "memberId",
    "customerUserId",
    () =>
      prisma.notificationPreference
        .findMany({ select: { id: true, memberId: true, customerUserId: true } })
        .then((rs) => rs.map((r) => ({ id: r.id, from: r.memberId, to: r.customerUserId }))),
    (id, customerUserId) =>
      prisma.notificationPreference
        .update({ where: { id }, data: { customerUserId } })
        .then(() => {})
  );

  await backfillOne(
    "ApprovalWorkflowLevel",
    "assigneeId",
    "assigneeCustomerUserId",
    () =>
      prisma.approvalWorkflowLevel
        .findMany({ select: { id: true, assigneeId: true, assigneeCustomerUserId: true } })
        .then((rs) =>
          rs.map((r) => ({ id: r.id, from: r.assigneeId, to: r.assigneeCustomerUserId }))
        ),
    (id, customerUserId) =>
      prisma.approvalWorkflowLevel
        .update({ where: { id }, data: { assigneeCustomerUserId: customerUserId } })
        .then(() => {})
  );

  await backfillOne(
    "ApprovalRequest",
    "submitterId",
    "submitterCustomerUserId",
    () =>
      prisma.approvalRequest
        .findMany({ select: { id: true, submitterId: true, submitterCustomerUserId: true } })
        .then((rs) =>
          rs.map((r) => ({ id: r.id, from: r.submitterId, to: r.submitterCustomerUserId }))
        ),
    (id, customerUserId) =>
      prisma.approvalRequest
        .update({ where: { id }, data: { submitterCustomerUserId: customerUserId } })
        .then(() => {})
  );

  await backfillOne(
    "ApprovalReview",
    "reviewerId",
    "reviewerCustomerUserId",
    () =>
      prisma.approvalReview
        .findMany({ select: { id: true, reviewerId: true, reviewerCustomerUserId: true } })
        .then((rs) =>
          rs.map((r) => ({ id: r.id, from: r.reviewerId, to: r.reviewerCustomerUserId }))
        ),
    (id, customerUserId) =>
      prisma.approvalReview
        .update({ where: { id }, data: { reviewerCustomerUserId: customerUserId } })
        .then(() => {})
  );

  // Task has 2 FKs to TeamMember (assignee + createdBy)
  await backfillOne(
    "Task (assignee)",
    "assigneeId",
    "assigneeCustomerUserId",
    () =>
      prisma.task
        .findMany({ select: { id: true, assigneeId: true, assigneeCustomerUserId: true } })
        .then((rs) =>
          rs.map((r) => ({ id: r.id, from: r.assigneeId, to: r.assigneeCustomerUserId }))
        ),
    (id, customerUserId) =>
      prisma.task
        .update({ where: { id }, data: { assigneeCustomerUserId: customerUserId } })
        .then(() => {})
  );

  await backfillOne(
    "Task (createdBy)",
    "createdById",
    "createdByCustomerUserId",
    () =>
      prisma.task
        .findMany({ select: { id: true, createdById: true, createdByCustomerUserId: true } })
        .then((rs) =>
          rs.map((r) => ({ id: r.id, from: r.createdById, to: r.createdByCustomerUserId }))
        ),
    (id, customerUserId) =>
      prisma.task
        .update({ where: { id }, data: { createdByCustomerUserId: customerUserId } })
        .then(() => {})
  );

  await backfillOne(
    "PostComment",
    "authorId",
    "authorCustomerUserId",
    () =>
      prisma.postComment
        .findMany({ select: { id: true, authorId: true, authorCustomerUserId: true } })
        .then((rs) => rs.map((r) => ({ id: r.id, from: r.authorId, to: r.authorCustomerUserId }))),
    (id, customerUserId) =>
      prisma.postComment
        .update({ where: { id }, data: { authorCustomerUserId: customerUserId } })
        .then(() => {})
  );

  await backfillOne(
    "SocialMessage",
    "assigneeId",
    "assigneeCustomerUserId",
    () =>
      prisma.socialMessage
        .findMany({ select: { id: true, assigneeId: true, assigneeCustomerUserId: true } })
        .then((rs) =>
          rs.map((r) => ({ id: r.id, from: r.assigneeId, to: r.assigneeCustomerUserId }))
        ),
    (id, customerUserId) =>
      prisma.socialMessage
        .update({ where: { id }, data: { assigneeCustomerUserId: customerUserId } })
        .then(() => {})
  );

  await backfillOne(
    "SocialConversation",
    "resolvedById",
    "resolvedByCustomerUserId",
    () =>
      prisma.socialConversation
        .findMany({ select: { id: true, resolvedById: true, resolvedByCustomerUserId: true } })
        .then((rs) =>
          rs.map((r) => ({ id: r.id, from: r.resolvedById, to: r.resolvedByCustomerUserId }))
        ),
    (id, customerUserId) =>
      prisma.socialConversation
        .update({ where: { id }, data: { resolvedByCustomerUserId: customerUserId } })
        .then(() => {})
  );

  await backfillOne(
    "ConversationNote",
    "authorId",
    "authorCustomerUserId",
    () =>
      prisma.conversationNote
        .findMany({ select: { id: true, authorId: true, authorCustomerUserId: true } })
        .then((rs) => rs.map((r) => ({ id: r.id, from: r.authorId, to: r.authorCustomerUserId }))),
    (id, customerUserId) =>
      prisma.conversationNote
        .update({ where: { id }, data: { authorCustomerUserId: customerUserId } })
        .then(() => {})
  );

  await backfillOne(
    "SocialOutboundReply",
    "authorId",
    "authorCustomerUserId",
    () =>
      prisma.socialOutboundReply
        .findMany({ select: { id: true, authorId: true, authorCustomerUserId: true } })
        .then((rs) => rs.map((r) => ({ id: r.id, from: r.authorId, to: r.authorCustomerUserId }))),
    (id, customerUserId) =>
      prisma.socialOutboundReply
        .update({ where: { id }, data: { authorCustomerUserId: customerUserId } })
        .then(() => {})
  );

  await backfillOne(
    "CustomReport",
    "createdById",
    "createdByCustomerUserId",
    () =>
      prisma.customReport
        .findMany({ select: { id: true, createdById: true, createdByCustomerUserId: true } })
        .then((rs) =>
          rs.map((r) => ({ id: r.id, from: r.createdById, to: r.createdByCustomerUserId }))
        ),
    (id, customerUserId) =>
      prisma.customReport
        .update({ where: { id }, data: { createdByCustomerUserId: customerUserId } })
        .then(() => {})
  );

  return results;
}

async function verifyIntegrity(): Promise<void> {
  // For each table, count rows where the legacy FK is set but the new
  // customerUserId is still null. If non-zero, something didn't map.
  const checks = [
    {
      name: "ProjectMember",
      fn: () =>
        prisma.projectMember.count({
          where: { memberId: { not: undefined }, customerUserId: null },
        }),
    },
    {
      name: "Notification",
      fn: () =>
        prisma.notification.count({
          where: { recipientId: { not: undefined }, recipientCustomerUserId: null },
        }),
    },
    {
      name: "NotificationPreference",
      fn: () =>
        prisma.notificationPreference.count({
          where: { memberId: { not: undefined }, customerUserId: null },
        }),
    },
    {
      name: "ApprovalRequest",
      fn: () =>
        prisma.approvalRequest.count({
          where: { submitterId: { not: undefined }, submitterCustomerUserId: null },
        }),
    },
    {
      name: "ApprovalReview",
      fn: () =>
        prisma.approvalReview.count({
          where: { reviewerId: { not: undefined }, reviewerCustomerUserId: null },
        }),
    },
    {
      name: "Task (createdBy)",
      fn: () =>
        prisma.task.count({
          where: { createdById: { not: undefined }, createdByCustomerUserId: null },
        }),
    },
    {
      name: "PostComment",
      fn: () =>
        prisma.postComment.count({
          where: { authorId: { not: undefined }, authorCustomerUserId: null },
        }),
    },
    {
      name: "ConversationNote",
      fn: () =>
        prisma.conversationNote.count({
          where: { authorId: { not: undefined }, authorCustomerUserId: null },
        }),
    },
    {
      name: "SocialOutboundReply",
      fn: () =>
        prisma.socialOutboundReply.count({
          where: { authorId: { not: undefined }, authorCustomerUserId: null },
        }),
    },
    {
      name: "CustomReport",
      fn: () =>
        prisma.customReport.count({
          where: { createdById: { not: undefined }, createdByCustomerUserId: null },
        }),
    },
  ];

  let allClean = true;
  for (const check of checks) {
    const orphans = await check.fn();
    if (orphans > 0) {
      logger.error({ table: check.name, orphans }, "Orphan rows detected — FK not backfilled");
      allClean = false;
    }
  }

  if (!allClean) {
    throw new Error(
      "Backfill verification failed — orphan rows detected. Inspect logs and fix before Sub-fase 1.3."
    );
  }

  logger.info("Backfill verification passed — 0 orphans across all required (NOT NULL) tables");
}

async function main() {
  logger.info("Starting TeamMember → CustomerUser backfill");

  const roleMap = await buildRoleMap();
  logger.info({ roleMap }, "Resolved CustomerRole IDs by name");

  const teamMembers = await prisma.teamMember.findMany();
  logger.info({ count: teamMembers.length }, "Loaded TeamMember rows");

  const teamMemberToCustomerUser = new Map<string, string>();
  for (const tm of teamMembers) {
    const customerUserId = await resolveCustomerUserId(tm, roleMap);
    teamMemberToCustomerUser.set(tm.id, customerUserId);
  }
  logger.info(
    { mapped: teamMemberToCustomerUser.size },
    "Resolved CustomerUser for each TeamMember"
  );

  const backfillResults = await backfillFks(teamMemberToCustomerUser);
  const totalUpdated = backfillResults.reduce((sum, r) => sum + r.updated, 0);
  logger.info({ tables: backfillResults.length, totalUpdated }, "Backfill complete");

  await verifyIntegrity();

  logger.info("TeamMember → CustomerUser backfill OK");
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "Backfill failed");
    await prisma.$disconnect();
    process.exit(1);
  });
