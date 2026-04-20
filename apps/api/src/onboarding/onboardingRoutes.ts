/**
 * @file onboardingRoutes.ts
 * @description Client-facing onboarding endpoints for tracking setup progress.
 *   Creates AccountOnboarding record on first access, allows step completion and dismissal.
 * @layer infrastructure
 */

import type { FastifyPluginAsync } from "fastify";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { PrismaClient } from "@infra/prisma";

const VALID_STEPS = new Set([
  "connectedFirstProvider",
  "createdFirstPost",
  "invitedTeamMember",
  "configuredBilling",
]);

export const onboardingRoutes: FastifyPluginAsync = async (fastify) => {
  const prisma = fastify.container!.resolve<PrismaClient>(TOKENS.PrismaClient);

  /**
   * @method GET /api/onboarding
   * @description Returns onboarding progress for the current account.
   *   Creates record on first access.
   */
  fastify.get(
    "/onboarding",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Onboarding"], summary: "Get onboarding progress" },
    },
    async (request, reply) => {
      const accountId = request.customerUser!.accountId;

      let onboarding = await prisma.accountOnboarding.findUnique({
        where: { accountId },
      });

      if (!onboarding) {
        onboarding = await prisma.accountOnboarding.create({
          data: { accountId },
        });
      }

      const steps = [
        {
          key: "connectedFirstProvider",
          completed: onboarding.connectedFirstProvider,
          label: "Connect first social account",
        },
        {
          key: "createdFirstPost",
          completed: onboarding.createdFirstPost,
          label: "Create your first post",
        },
        {
          key: "invitedTeamMember",
          completed: onboarding.invitedTeamMember,
          label: "Invite a team member",
        },
        {
          key: "configuredBilling",
          completed: onboarding.configuredBilling,
          label: "Set up billing",
        },
      ];

      const completedCount = steps.filter((s) => s.completed).length;

      return reply.send({
        ok: true,
        data: {
          steps,
          completedCount,
          totalSteps: steps.length,
          completedAt: onboarding.completedAt,
          dismissedAt: onboarding.dismissedAt,
        },
      });
    }
  );

  /**
   * @method POST /api/onboarding/step/:stepKey/complete
   * @description Marks a specific onboarding step as completed.
   */
  fastify.post(
    "/onboarding/step/:stepKey/complete",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Onboarding"], summary: "Complete an onboarding step" },
    },
    async (request, reply) => {
      const accountId = request.customerUser!.accountId;
      const { stepKey } = request.params as { stepKey: string };

      if (!VALID_STEPS.has(stepKey)) {
        return reply.code(400).send({ ok: false, error: "Invalid step key" });
      }

      const onboarding = await prisma.accountOnboarding.upsert({
        where: { accountId },
        create: { accountId, [stepKey]: true },
        update: { [stepKey]: true },
      });

      // Check if all steps are now complete
      const allDone =
        onboarding.connectedFirstProvider &&
        onboarding.createdFirstPost &&
        onboarding.invitedTeamMember &&
        onboarding.configuredBilling;

      if (allDone && !onboarding.completedAt) {
        await prisma.accountOnboarding.update({
          where: { accountId },
          data: { completedAt: new Date() },
        });
      }

      return reply.send({ ok: true, data: { step: stepKey, completed: true } });
    }
  );

  /**
   * @method POST /api/onboarding/dismiss
   * @description Dismisses the onboarding checklist permanently.
   */
  fastify.post(
    "/onboarding/dismiss",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Onboarding"], summary: "Dismiss onboarding checklist" },
    },
    async (request, reply) => {
      const accountId = request.customerUser!.accountId;

      await prisma.accountOnboarding.upsert({
        where: { accountId },
        create: { accountId, dismissedAt: new Date() },
        update: { dismissedAt: new Date() },
      });

      return reply.send({ ok: true, data: { dismissed: true } });
    }
  );
};
