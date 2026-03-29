/**
 * @file conversationNoteRoutes.ts
 * @description Fastify plugin registering Conversation Note endpoints under
 *   /api/inbox/conversations. Extracted from inboxRoutes.ts to keep file size
 *   under 800 lines.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "@packages/api-common";
import { authenticateMiddleware } from "../auth/authMiddleware.js";
import { TOKENS } from "../infrastructure/container/types.js";

import type { AddConversationNoteUseCase } from "../application/inbox/AddConversationNoteUseCase.js";
import type { DeleteConversationNoteUseCase } from "../application/inbox/DeleteConversationNoteUseCase.js";
import type { ListConversationNotesQuery } from "../application/inbox/ListConversationNotesQuery.js";

// ============================================================================
// Zod Validation Schemas
// ============================================================================

const UuidParamsSchema = z.object({
  id: z.string().uuid(),
});

const NoteBodySchema = z.object({
  body: z.string().min(1, { message: "Note body must not be empty" }).max(5000),
});

const ConversationNoteParamsSchema = z.object({
  conversationId: z.string().uuid(),
  noteId: z.string(),
});

// ============================================================================
// Route Handler Implementation
// ============================================================================

/**
 * @class ConversationNoteRouteHandler
 * @description Handles Conversation Note HTTP endpoints.
 */
class ConversationNoteRouteHandler extends BaseRouteHandler {
  protected routeName = "conversation-notes";

  constructor(
    private readonly addConversationNoteUseCase: AddConversationNoteUseCase,
    private readonly deleteConversationNoteUseCase: DeleteConversationNoteUseCase,
    private readonly listConversationNotesQuery: ListConversationNotesQuery
  ) {
    super();
  }

  /**
   * @method mapErrorCode
   * @description Maps UseCaseError.code to an HTTP status code.
   */
  private mapErrorCode(code: string): number {
    const mapping: Record<string, number> = {
      VALIDATION_FAILED: 400,
      NOT_FOUND: 404,
      FORBIDDEN: 403,
      CONFLICT: 409,
      INTERNAL_ERROR: 500,
    };
    return mapping[code] ?? 500;
  }

  /**
   * @method listNotes
   * @description GET /api/inbox/conversations/:id/notes -- Returns all notes
   *   for a conversation.
   */
  async listNotes(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, UuidParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid conversation ID format");
    }

    const user = request.user;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.listConversationNotesQuery.execute({
      conversationId: paramsValidation.value.id,
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  /**
   * @method addNote
   * @description POST /api/inbox/conversations/:id/notes -- Creates a new
   *   internal note on a conversation.
   */
  async addNote(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, UuidParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid conversation ID format");
    }

    const bodyValidation = await this.validateBody(ctx, NoteBodySchema);
    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body: body (1-5000 chars) is required");
    }

    const user = request.user;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const authorId = user.id ?? "system";
    const authorName = user.name ?? "Unknown";
    const accountId = user.accountId ?? "";

    const result = await this.addConversationNoteUseCase.execute({
      conversationId: paramsValidation.value.id,
      authorId,
      authorName,
      accountId,
      body: bodyValidation.value.body,
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, result.value, 201);
  }

  /**
   * @method deleteNote
   * @description DELETE /api/inbox/conversations/:conversationId/notes/:noteId
   *   Soft-deletes a conversation note. Only the author may delete.
   */
  async deleteNote(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, ConversationNoteParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid conversation or note ID format");
    }

    const user = request.user;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const authorId = user.id ?? "system";

    const result = await this.deleteConversationNoteUseCase.execute({
      noteId: paramsValidation.value.noteId,
      authorId,
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, { noteId: paramsValidation.value.noteId, status: "deleted" });
  }
}

// ============================================================================
// Fastify Plugin Export
// ============================================================================

/**
 * Fastify plugin that registers Conversation Note routes under /api/inbox.
 */
const conversationNoteRoutes: FastifyPluginAsync = async (app) => {
  const addConversationNoteUseCase = app.container.resolve<AddConversationNoteUseCase>(
    TOKENS.AddConversationNoteUseCase
  );
  const deleteConversationNoteUseCase = app.container.resolve<DeleteConversationNoteUseCase>(
    TOKENS.DeleteConversationNoteUseCase
  );
  const listConversationNotesQuery = app.container.resolve<ListConversationNotesQuery>(
    TOKENS.ListConversationNotesQuery
  );

  const handler = new ConversationNoteRouteHandler(
    addConversationNoteUseCase,
    deleteConversationNoteUseCase,
    listConversationNotesQuery
  );

  app.get(
    "/api/inbox/conversations/:id/notes",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["Inbox"], summary: "List conversation notes" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.listNotes(request, reply)
  );

  app.post(
    "/api/inbox/conversations/:id/notes",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["Inbox"], summary: "Add conversation note" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.addNote(request, reply)
  );

  app.delete(
    "/api/inbox/conversations/:conversationId/notes/:noteId",
    {
      preHandler: [authenticateMiddleware],
      schema: { tags: ["Inbox"], summary: "Delete conversation note" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.deleteNote(request, reply)
  );
};

export { conversationNoteRoutes };
