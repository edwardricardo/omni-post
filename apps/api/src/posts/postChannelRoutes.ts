/**
 * @file postChannelRoutes.ts
 * @description The per-channel acts a customer performs on one post: today the
 *              confirmation that they removed, by hand, fragments no provider can take
 *              down for them. Every route here is addressed by `postId` AND `channelId`,
 *              which is why they live apart from `postRoutes.ts` — that file is about a
 *              post as a whole, and a channel-scoped act answers a different set of
 *              refusals (a channel outside the recorded set is a 404 even though the post
 *              exists).
 *
 *              It is deliberately the seam the per-channel retry route lands in next.
 *              Both routes are small translations over a use case, so both fit here while
 *              the file stays well inside the size band the canon expects; a second act
 *              that needed its own state or its own schema family would be the signal to
 *              split rather than to grow this one.
 * @layer infrastructure
 */
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { IdSchema } from "@packages/api-common";
import { AppError, ErrorCode } from "@shared/types";
import { USE_CASE_ERRORS, type UseCaseError } from "@core/application/UseCase.js";
import type { ConfirmManualRetractionUseCase } from "@core/posts/ConfirmManualRetractionUseCase.js";
import {
  RETRACTION_REFUSALS,
  refusalOf,
  type RetractionRefusal,
} from "@core/posts/retractionRefusals.js";
import { TOKENS } from "../infrastructure/container/types.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";

/** Both identifiers are path segments; neither act carries a body. */
const PostChannelParamsSchema = z.object({
  postId: IdSchema,
  channelId: IdSchema,
});

type PostChannelParams = z.infer<typeof PostChannelParamsSchema>;

/**
 * The wire code each declared refusal travels as. A TOTAL `Record` over the refusal
 * union on purpose: a member added to `RETRACTION_REFUSALS` that nobody maps here stops
 * this file compiling, whereas a `switch` with a default — or the single `if` this
 * started as — would quietly answer the coarse conflict and lose the discriminator,
 * which is precisely the defect the discriminator exists to remove. Only one of the two
 * is reachable from `ConfirmManualRetractionUseCase` today; the mapping is stated for
 * the set, not for today's caller.
 */
const REFUSAL_WIRE_CODES: Record<RetractionRefusal, ErrorCode> = {
  [RETRACTION_REFUSALS.NOTHING_PENDING]: ErrorCode.NOTHING_PENDING,
  [RETRACTION_REFUSALS.CHANNEL_HAS_LIVE_FRAGMENTS]: ErrorCode.CHANNEL_HAS_LIVE_FRAGMENTS,
};

/**
 * @function toAppError
 * @description Translates a retraction use-case failure into the error the single global
 *              handler serializes. The retraction discriminator is read by VALUE through
 *              `refusalOf` rather than matched against the message, and it travels as the
 *              response `code` — the one field the handler puts on the wire in every
 *              environment — BESIDE the coarse conflict rather than replacing it, so every
 *              caller that only knows "409" keeps working and one that knows the refusal
 *              can act on it. The mapping is EXHAUSTIVE over the declared refusals rather
 *              than a test for the one this route's use case emits today: an unmapped
 *              member would fall through to the flat conflict with nothing to notice it.
 *
 *              The parameter says `UseCaseError` because that is what the use case's
 *              `err` arm returns on EVERY path, and the discriminator is then read
 *              unconditionally. The two used to disagree: the parameter declared a plain
 *              `{ code, message }` while the body gated `refusalOf` behind `instanceof
 *              Error`, so a refusal matching the DECLARED shape skipped the read and left
 *              through the coarse conflict — a 409 either way, with only the field a
 *              caller branches on missing. Reading by value is also what `refusalOf`
 *              promises: it compares a string precisely so a refusal that crossed a realm
 *              or came from a duplicate module instance is still recognised.
 * @param error - What the use case refused with.
 * @param params - The post and channel the request named, carried into the payload.
 * @returns The error to throw.
 */
function toAppError(error: UseCaseError, params: PostChannelParams): AppError {
  const refusal = refusalOf(error);
  if (refusal !== undefined) {
    return new AppError(REFUSAL_WIRE_CODES[refusal], 409, error.message, true, { ...params });
  }

  switch (error.code) {
    case USE_CASE_ERRORS.NOT_FOUND:
      return AppError.notFound(error.message);
    case USE_CASE_ERRORS.VALIDATION_FAILED:
      return AppError.badRequest(error.message);
    case USE_CASE_ERRORS.FORBIDDEN:
      return new AppError(ErrorCode.FORBIDDEN, 403, error.message, true);
    case USE_CASE_ERRORS.CONFLICT:
      return AppError.conflict(error.message);
    default:
      return AppError.internal("Failed to confirm the manual retraction");
  }
}

/**
 * Post Channel Routes Plugin
 *
 * Resolves its use cases from the DI container; it holds no repository and no Prisma
 * client. Tenant scope comes from `requireClientAuth`, which binds the request's account
 * before the handler runs — the repository behind the use case refuses an unscoped load
 * outright, so a post belonging to another account is never reachable from here.
 *
 * Routes:
 * - POST /posts/:postId/channels/:channelId/retraction/confirm-removed
 *   The customer states they removed the live fragments themselves. Idempotent against
 *   their OWN confirmation (`applied: false`, 200); 404 for a channel outside the post's
 *   recorded set; 409 `NOTHING_PENDING` when that channel is holding nothing.
 */
export const postChannelRoutes: FastifyPluginAsync = async (fastify) => {
  const container = fastify.container;
  if (!container) {
    throw new Error("DI container not available");
  }

  fastify.post(
    "/posts/:postId/channels/:channelId/retraction/confirm-removed",
    {
      preHandler: [requireClientAuth],
      schema: {
        tags: ["Posts"],
        summary: "Confirm the customer removed a channel's live fragments by hand",
      },
    },
    async (request) => {
      const parsed = PostChannelParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        throw AppError.badRequest("Invalid post or channel identifier", {
          issues: parsed.error.issues,
        });
      }

      // The ownership gate needs the authenticated principal. `requireClientAuth`
      // guarantees one, so its absence is a defensive 401 rather than a load that
      // would reach the repository with no tenant scope at all.
      if (!request.customerUser) {
        throw AppError.unauthorized("Customer authentication required");
      }

      const useCase = container.resolve<ConfirmManualRetractionUseCase>(
        TOKENS.ConfirmManualRetractionUseCase
      );
      const result = await useCase.execute({
        postId: parsed.data.postId,
        channelId: parsed.data.channelId,
      });

      if (!result.ok) {
        throw toAppError(result.error, parsed.data);
      }

      return { ok: true, data: result.value };
    }
  );
};
