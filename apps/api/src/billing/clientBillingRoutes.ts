/**
 * @file clientBillingRoutes.ts
 * @description Client-facing billing endpoints for gateway switching.
 *   Uses requireClientAuth middleware (customer JWT tokens).
 * @layer infrastructure
 */

import type { FastifyPluginAsync } from "fastify";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { GatewayBillingService } from "./GatewayBillingService.js";
import { initiateGatewaySwitchSchema } from "./gatewaySwitchSchemas.js";

export const clientBillingRoutes: FastifyPluginAsync = async (fastify) => {
  const container = fastify.container;
  if (!container) {
    throw new Error("DI container not available");
  }
  const gatewayService = container.resolve<GatewayBillingService>(TOKENS.GatewayBillingService);

  // GET /api/billing/gateway/status — current gateway + pending switch info
  fastify.get(
    "/api/billing/gateway/status",
    {
      preHandler: [requireClientAuth],
      schema: {
        tags: ["Billing"],
        summary: "Get gateway switch status for the current account",
      },
    },
    async (request, reply) => {
      const accountId = request.customerUser!.accountId;
      const result = await gatewayService.getAccountSwitchStatus(accountId);

      if (!result.ok) {
        return reply.code(404).send({ error: result.error });
      }
      return reply.send({ ok: true, data: result.value });
    }
  );

  // POST /api/billing/gateway/switch — initiate a gateway switch
  fastify.post(
    "/api/billing/gateway/switch",
    {
      preHandler: [requireClientAuth],
      schema: {
        tags: ["Billing"],
        summary: "Initiate a payment gateway switch",
      },
    },
    async (request, reply) => {
      const parsed = initiateGatewaySwitchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "VALIDATION_ERROR",
          details: parsed.error.issues,
        });
      }

      const accountId = request.customerUser!.accountId;
      const userId = request.customerUser!.id;
      const result = await gatewayService.initiateGatewaySwitch(
        accountId,
        parsed.data.newProvider,
        userId
      );

      if (!result.ok) {
        const statusMap: Record<string, number> = {
          ACCOUNT_NOT_FOUND: 404,
          SAME_GATEWAY: 400,
          SWITCH_ALREADY_PENDING: 409,
          NO_ACTIVE_SUBSCRIPTION: 400,
          OPEN_INVOICE: 400,
        };
        const status = statusMap[result.error] ?? 500;
        return reply.code(status).send({ error: result.error });
      }

      return reply.code(201).send({ ok: true, data: result.value });
    }
  );

  // DELETE /api/billing/gateway/switch — cancel a pending gateway switch
  fastify.delete(
    "/api/billing/gateway/switch",
    {
      preHandler: [requireClientAuth],
      schema: {
        tags: ["Billing"],
        summary: "Cancel a pending gateway switch",
      },
    },
    async (request, reply) => {
      const accountId = request.customerUser!.accountId;
      const result = await gatewayService.cancelPendingSwitch(accountId);

      if (!result.ok) {
        const statusMap: Record<string, number> = {
          ACCOUNT_NOT_FOUND: 404,
          SWITCH_NOT_FOUND: 404,
        };
        const status = statusMap[result.error] ?? 500;
        return reply.code(status).send({ error: result.error });
      }

      return reply.send({ ok: true, data: result.value });
    }
  );

  // GET /api/billing/plans — public, no auth required
  fastify.get(
    "/api/billing/plans",
    {
      schema: {
        tags: ["Billing"],
        summary: "Get available billing plans (public)",
      },
    },
    async (_request, reply) => {
      const plans = await gatewayService.getAvailablePlans();
      return reply.send({ ok: true, data: { plans } });
    }
  );

  // POST /api/billing/checkout — create checkout session
  fastify.post(
    "/api/billing/checkout",
    {
      preHandler: [requireClientAuth],
      schema: {
        tags: ["Billing"],
        summary: "Create a checkout session on the selected gateway",
      },
    },
    async (request, reply) => {
      const body = request.body as {
        gatewayProvider?: string;
      };
      const gatewayProvider = body.gatewayProvider;
      if (gatewayProvider !== "stripe" && gatewayProvider !== "paddle") {
        return reply.code(400).send({
          error: "VALIDATION_ERROR",
          message: "gatewayProvider must be 'stripe' or 'paddle'",
        });
      }

      const accountId = request.customerUser!.accountId;
      const clientUrl = process.env.CLIENT_APP_URL ?? "http://localhost:3001";
      const successUrl = `${clientUrl}/dashboard/settings/billing?success=true`;
      const cancelUrl = `${clientUrl}/dashboard/settings/billing?canceled=true`;

      const result = await gatewayService.createCheckoutSession(
        accountId,
        gatewayProvider,
        successUrl,
        cancelUrl
      );

      if (!result.ok) {
        const statusMap: Record<string, number> = {
          ACCOUNT_NOT_FOUND: 404,
          GATEWAY_ERROR: 502,
        };
        return reply.code(statusMap[result.error] ?? 500).send({ error: result.error });
      }

      return reply.send({ ok: true, data: result.value });
    }
  );

  // GET /api/billing/portal — redirect to gateway billing portal
  fastify.get(
    "/api/billing/portal",
    {
      preHandler: [requireClientAuth],
      schema: {
        tags: ["Billing"],
        summary: "Get billing portal URL",
      },
    },
    async (request, reply) => {
      const accountId = request.customerUser!.accountId;
      const clientUrl = process.env.CLIENT_APP_URL ?? "http://localhost:3001";
      const returnUrl = `${clientUrl}/dashboard/settings/billing`;

      const result = await gatewayService.getBillingPortalUrl(accountId, returnUrl);

      if (!result.ok) {
        const statusMap: Record<string, number> = {
          ACCOUNT_NOT_FOUND: 404,
          NO_ACTIVE_SUBSCRIPTION: 400,
          GATEWAY_ERROR: 502,
        };
        return reply.code(statusMap[result.error] ?? 500).send({ error: result.error });
      }

      return reply.send({ ok: true, data: result.value });
    }
  );
};
