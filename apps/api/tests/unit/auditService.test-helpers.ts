import { prisma } from "@infra/prisma";

export let testUserId: string;
export let testUser2Id: string;

export async function setupAuditTestUsers(): Promise<void> {
  await prisma.adminUser.deleteMany({
    where: {
      email: { in: ["audit-test-user@example.com", "audit-test-user2@example.com"] },
    },
  });

  const user1 = await prisma.adminUser.create({
    data: {
      email: "audit-test-user@example.com",
      name: "Audit Test User",
      passwordHash: "hashed_password",
      role: "ADMIN",
    },
  });
  testUserId = user1.id;

  const user2 = await prisma.adminUser.create({
    data: {
      email: "audit-test-user2@example.com",
      name: "Audit Test User 2",
      passwordHash: "hashed_password",
      role: "SUPPORT",
    },
  });
  testUser2Id = user2.id;
}

export async function teardownAuditTestUsers(): Promise<void> {
  try {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { userId: testUserId },
          { userId: testUser2Id },
          { action: { startsWith: "TEST_" } },
          { resource: "TEST_RESOURCE" },
        ],
      },
    });
    await prisma.adminUser.deleteMany({
      where: { id: { in: [testUserId, testUser2Id] } },
    });
  } catch (err) {
    console.warn("Teardown warning:", err);
  }

  try {
    await prisma.$disconnect();
  } catch (err) {
    console.warn("Prisma disconnect warning:", err);
  }
}
