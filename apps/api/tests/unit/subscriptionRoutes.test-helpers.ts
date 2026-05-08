/**
 * @file subscriptionRoutes.test-helpers.ts
 * @description Test helpers for subscription routes test helpers
 * @layer infrastructure
 */
import Fastify, { FastifyInstance } from "fastify";
import { ZodTypeProvider, serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { subscriptionRoutes } from "../../src/billing/subscriptionRoutes.js";
import type { AuthService } from "../../src/auth/authService.js";
import { prisma } from "@infra/prisma";
import { setupContainer } from "../../src/infrastructure/container/setup.js";
import { TOKENS } from "../../src/infrastructure/container/types.js";

// Module-level reference to the container's AuthService instance.
// Populated by createTestApp() so that createTestUsers() uses the same
// JWT secrets as the middleware (both resolve the same singleton).
let containerAuthService: AuthService;

export async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  typedApp.setValidatorCompiler(validatorCompiler);
  typedApp.setSerializerCompiler(serializerCompiler);

  const container = setupContainer({ prisma });
  // Resolve the AuthService BEFORE registering routes so createTestUsers()
  // can call it with the same JWT secret that the middleware will use.
  containerAuthService = container.resolve<AuthService>(TOKENS.AuthService);

  typedApp.decorate("container", container);

  await typedApp.register(subscriptionRoutes);

  return typedApp;
}

export async function createTestUsers(timestamp: number): Promise<{
  adminToken: string;
  superAdminToken: string;
  supportToken: string;
  testAccountId: string;
}> {
  const adminEmail = `admin-sub-${timestamp}@example.com`;
  const superAdminEmail = `superadmin-sub-${timestamp}@example.com`;
  const supportEmail = `support-sub-${timestamp}@example.com`;
  const testPassword = "TestPassword123!";

  await containerAuthService.registerAdmin(adminEmail, testPassword, "Admin User", "ADMIN");
  await containerAuthService.registerAdmin(
    superAdminEmail,
    testPassword,
    "Super Admin User",
    "SUPER_ADMIN"
  );
  await containerAuthService.registerAdmin(supportEmail, testPassword, "Support User", "SUPPORT");

  let adminToken = "";
  let superAdminToken = "";
  let supportToken = "";

  const adminLogin = await containerAuthService.login(
    { email: adminEmail, password: testPassword },
    "127.0.0.1",
    "test-agent"
  );
  if (adminLogin.ok && "tokens" in adminLogin.value) {
    adminToken = adminLogin.value.tokens.accessToken;
  }

  const superAdminLogin = await containerAuthService.login(
    { email: superAdminEmail, password: testPassword },
    "127.0.0.1",
    "test-agent"
  );
  if (superAdminLogin.ok && "tokens" in superAdminLogin.value) {
    superAdminToken = superAdminLogin.value.tokens.accessToken;
  }

  const supportLogin = await containerAuthService.login(
    { email: supportEmail, password: testPassword },
    "127.0.0.1",
    "test-agent"
  );
  if (supportLogin.ok && "tokens" in supportLogin.value) {
    supportToken = supportLogin.value.tokens.accessToken;
  }

  const account = await prisma.account.create({
    data: {
      email: `account-${timestamp}@example.com`,
      name: "Test Account",
    },
  });

  return { adminToken, superAdminToken, supportToken, testAccountId: account.id };
}

export async function cleanupTestUsers(timestamp: number, testAccountId: string): Promise<void> {
  try {
    if (testAccountId) {
      await prisma.project.deleteMany({ where: { accountId: testAccountId } });
      await prisma.account.delete({ where: { id: testAccountId } }).catch(() => {
        /* may already be deleted */
      });
    }

    const testUsers = await prisma.adminUser.findMany({
      where: { email: { contains: `-sub-${timestamp}` } },
    });

    for (const user of testUsers) {
      await prisma.auditLog.deleteMany({ where: { userId: user.id } });
      await prisma.adminSession.deleteMany({ where: { userId: user.id } });
      await prisma.adminUser.delete({ where: { id: user.id } });
    }
  } catch (err) {
    console.warn("Cleanup warning:", err);
  }
}

export { prisma };
