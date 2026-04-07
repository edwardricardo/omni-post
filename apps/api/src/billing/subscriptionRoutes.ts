// ✅ Phase 6.2: Migrated to BaseRouteHandler Pattern
import { FastifyPluginAsync } from "fastify";
import type { SubscriptionService } from "./subscription/index.js";
import type { ChangeAccountSubscriptionUseCase } from "../application/billing/ChangeAccountSubscriptionUseCase.js";
import { requireAdminAuth, requireSuperAdmin } from "../admin/auth/adminAuthMiddleware.js";
import {
  SubscriptionPlanHandler,
  SubscriptionAccountHandler,
  SubscriptionTrialHandler,
  SubscriptionAnalyticsHandler,
} from "./handlers/index.js";
import { TOKENS } from "../infrastructure/container/types.js";

// ✅ PROPER Fastify v5.6.1 Plugin Implementation
const subscriptionRoutes: FastifyPluginAsync = async (fastify) => {
  const subscriptionService = fastify.container!.resolve<SubscriptionService>(
    TOKENS.SubscriptionService
  );
  const changeUseCase = fastify.container!.resolve<ChangeAccountSubscriptionUseCase>(
    TOKENS.ChangeAccountSubscriptionUseCase
  );
  const planHandler = new SubscriptionPlanHandler(subscriptionService);
  const accountHandler = new SubscriptionAccountHandler(subscriptionService, changeUseCase);
  const trialHandler = new SubscriptionTrialHandler(subscriptionService);
  const analyticsHandler = new SubscriptionAnalyticsHandler(subscriptionService);

  // ✅ Get all available subscription plans
  fastify.get(
    "/admin/billing/plans",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["Billing"], summary: "Get all available subscription plans" },
    },
    async (request, reply) => planHandler.getAllPlans(request, reply)
  );

  // ✅ Get specific subscription plan
  fastify.get(
    "/admin/billing/plans/:tier",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["Billing"], summary: "Get specific subscription plan" },
    },
    async (request, reply) => planHandler.getSpecificPlan(request, reply)
  );

  // ✅ Get account subscription details
  fastify.get(
    "/admin/billing/accounts/:accountId/subscription",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["Billing"], summary: "Get account subscription details" },
    },
    async (request, reply) => accountHandler.getAccountSubscription(request, reply)
  );

  // ✅ Update account subscription
  fastify.put(
    "/admin/billing/accounts/:accountId/subscription",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["Billing"], summary: "Update account subscription" },
    },
    async (request, reply) => accountHandler.updateAccountSubscription(request, reply)
  );

  // ✅ List all account subscriptions
  fastify.get(
    "/admin/billing/subscriptions",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["Billing"], summary: "List all account subscriptions" },
    },
    async (request, reply) => accountHandler.listSubscriptions(request, reply)
  );

  // ✅ Get subscription statistics
  fastify.get(
    "/admin/billing/stats",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["Billing"], summary: "Get subscription statistics" },
    },
    async (request, reply) => analyticsHandler.getSubscriptionStats(request, reply)
  );

  // ✅ Validate subscription limits for an account
  fastify.post(
    "/admin/billing/accounts/:accountId/validate-limits",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["Billing"], summary: "Validate subscription limits for an account" },
    },
    async (request, reply) => accountHandler.validateLimits(request, reply)
  );

  // ✅ Suspend account subscription
  fastify.post(
    "/admin/billing/accounts/:accountId/suspend",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["Billing"], summary: "Suspend account subscription" },
    },
    async (request, reply) => accountHandler.suspendSubscription(request, reply)
  );

  // ✅ Bulk upgrade subscriptions (Super Admin only)
  fastify.post(
    "/admin/billing/bulk/upgrade",
    {
      preHandler: [requireAdminAuth, requireSuperAdmin],
      schema: { tags: ["Billing"], summary: "Bulk upgrade subscriptions" },
    },
    async (request, reply) => accountHandler.bulkUpgrade(request, reply)
  );

  // Future: Revenue analytics endpoint — requires payment provider integration

  // ✅ Subscription health endpoint
  fastify.get(
    "/admin/billing/health",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["Billing"], summary: "Subscription health check" },
    },
    async (request, reply) => analyticsHandler.getSubscriptionHealth(request, reply)
  );

  // ✅ Export subscription data (CRITICAL FIX: CSV injection prevention)
  fastify.get(
    "/admin/billing/export",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["Billing"], summary: "Export subscription data" },
    },
    async (request, reply) => analyticsHandler.exportSubscriptions(request, reply)
  );

  // ✅ Start trial for an account
  fastify.post(
    "/admin/billing/accounts/:accountId/trial/start",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["Billing"], summary: "Start trial for an account" },
    },
    async (request, reply) => trialHandler.startTrial(request, reply)
  );

  // ✅ End trial for an account
  fastify.post(
    "/admin/billing/accounts/:accountId/trial/end",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["Billing"], summary: "End trial for an account" },
    },
    async (request, reply) => trialHandler.endTrial(request, reply)
  );

  // ✅ Convert trial to paid subscription
  fastify.post(
    "/admin/billing/accounts/:accountId/trial/convert",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["Billing"], summary: "Convert trial to paid subscription" },
    },
    async (request, reply) => trialHandler.convertTrial(request, reply)
  );

  // ✅ Get expiring trials
  fastify.get(
    "/admin/billing/trials/expiring",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["Billing"], summary: "Get expiring trials" },
    },
    async (request, reply) => trialHandler.getExpiringTrials(request, reply)
  );

  // ✅ Process auto-renewals (manual trigger for admin)
  fastify.post(
    "/admin/billing/auto-renewals/process",
    {
      preHandler: [requireAdminAuth, requireSuperAdmin],
      schema: { tags: ["Billing"], summary: "Process auto-renewals" },
    },
    async (request, reply) => trialHandler.processAutoRenewals(request, reply)
  );

  // ✅ Get trial statistics
  fastify.get(
    "/admin/billing/trials/stats",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["Billing"], summary: "Get trial statistics" },
    },
    async (request, reply) => trialHandler.getTrialStats(request, reply)
  );
};

export { subscriptionRoutes };
