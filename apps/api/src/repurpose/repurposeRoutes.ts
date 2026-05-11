/**
 * @file repurposeRoutes.ts
 * @description REST routes for the AI Repurpose pipeline. Audit A.4 Cluster 2:
 *              the underlying use cases (DetectRepurposeCandidates,
 *              GenerateRepurposeVariants, ApproveRepurposeVariant,
 *              RejectRepurposeVariant) + Prisma adapters + BullMQ dispatcher
 *              are fully built and registered in DI, but the pipeline is NOT
 *              wired end-to-end:
 *
 *              - No scheduler invokes DetectRepurposeCandidatesUseCase
 *              - No worker consumes GENERATE_REPURPOSE jobs
 *              - No AI provider configured (OPENAI_API_KEY empty)
 *
 *              Until the full wire-up lands (tracked as PR-Repurpose-AI-Pipeline
 *              in `docs/audits/POST_REMEDIATION_BACKLOG.md`), the endpoints
 *              consumed by `/dashboard/ai/repurpose` respond with 501
 *              NOT_IMPLEMENTED so the frontend surfaces a clear
 *              "feature in development" banner instead of silently rendering
 *              an empty list.
 *
 *              Same pattern as T3-I.7 predictive-analytics scaffolding.
 * @layer infrastructure
 */

import type { FastifyPluginAsync } from "fastify";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";

const NOT_IMPLEMENTED_BODY = {
  ok: false,
  error: "NOT_IMPLEMENTED",
  message:
    "The AI Repurpose pipeline is scaffolded (use cases + adapters + UI) but " +
    "not yet wired end-to-end. Tracked as PR-Repurpose-AI-Pipeline in the " +
    "post-remediation backlog. Requires: DETECT scheduler, GENERATE worker, " +
    "and an AI provider (OpenAI / Perplexity / Gemini) credential.",
} as const;

export const repurposeRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /repurpose/proposals — list AI-detected repurpose proposals for the
   * caller's account. Real implementation will query the
   * `RepurposeProposal` table (rows produced by DetectRepurposeCandidatesUseCase
   * once the scheduler is wired). Currently 501.
   */
  fastify.get(
    "/repurpose/proposals",
    {
      preHandler: [requireClientAuth],
      schema: {
        tags: ["AI", "Repurpose"],
        summary: "List repurpose proposals (scaffolded — pending pipeline wire-up)",
      },
    },
    async (_request, reply) => reply.status(501).send(NOT_IMPLEMENTED_BODY)
  );

  /**
   * POST /admin/ai/detect-repurpose — admin-only manual trigger for the
   * DetectRepurposeCandidatesUseCase. Stub now; will fire the use case
   * (and dispatch GENERATE jobs) when the pipeline is wired. Currently 501.
   */
  fastify.post(
    "/admin/ai/detect-repurpose",
    {
      preHandler: [requireClientAuth],
      schema: {
        tags: ["AI", "Repurpose", "Admin"],
        summary: "Manually trigger repurpose detection (scaffolded — pending pipeline)",
      },
    },
    async (_request, reply) => reply.status(501).send(NOT_IMPLEMENTED_BODY)
  );
};
