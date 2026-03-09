/**
 * @file inboxRoutes.ts
 * @description Fastify plugin registering Social Inbox management endpoints.
 *   Resolves use cases and queries from DI and delegates to InboxRouteHandler
 *   methods. Supports cursor-based pagination, message lifecycle management,
 *   conversation resolution, and provider comment synchronization.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "@packages/api-common";
import { authenticateMiddleware } from "../auth/authMiddleware.js";
import { TOKENS } from "../infrastructure/container/types.js";

// Use case / query types (type-only imports)
import type { IngestSocialMessageUseCase } from "../application/inbox/IngestSocialMessageUseCase.js";
import type { MarkMessageReadUseCase } from "../application/inbox/MarkMessageReadUseCase.js";
import type { MarkMessageArchivedUseCase } from "../application/inbox/MarkMessageArchivedUseCase.js";
import type { AssignMessageUseCase } from "../application/inbox/AssignMessageUseCase.js";
import type { SendReplyUseCase } from "../application/inbox/SendReplyUseCase.js";
import type { ResolveConversationUseCase } from "../application/inbox/ResolveConversationUseCase.js";
import type { ReopenConversationUseCase } from "../application/inbox/ReopenConversationUseCase.js";
import type { SyncProviderCommentsUseCase } from "../application/inbox/SyncProviderCommentsUseCase.js";
import type { GetInboxQuery } from "../application/inbox/GetInboxQuery.js";
import type { GetMentionsQuery } from "../application/inbox/GetMentionsQuery.js";
import type { GetConversationQuery } from "../application/inbox/GetConversationQuery.js";
import type { GetConversationMessagesQuery } from "../application/inbox/GetConversationMessagesQuery.js";
import type { GetUnreadInboxCountQuery } from "../application/inbox/GetUnreadInboxCountQuery.js";

// ============================================================================
// Zod Validation Schemas
// ============================================================================

const UuidParamsSchema = z.object({
  id: z.string().uuid(),
});

const ChannelIdParamsSchema = z.object({
  channelId: z.string().uuid(),
});

const InboxQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  provider: z.string().optional(),
  channelId: z.string().uuid().optional(),
  messageType: z.string().optional(),
  status: z.string().optional(),
  assigneeId: z.string().uuid().optional(),
});

const UnreadCountQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
});

const MentionsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  projectId: z.string().uuid().optional(),
});

const ConversationMessagesQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const AssignBodySchema = z.object({
  assigneeId: z.string().uuid(),
});

const ReplyBodySchema = z.object({
  body: z.string().min(1, { message: "Reply body must not be empty" }),
});

const ResolveBodySchema = z.object({
  resolvedById: z.string().uuid(),
});

// ============================================================================
// Route Handler Implementation
// ============================================================================

/**
 * @class InboxRouteHandler
 * @description Handles all Social Inbox HTTP endpoints, delegating business
 *   logic to the respective use cases and queries resolved from DI.
 */
class InboxRouteHandler extends BaseRouteHandler {
  protected routeName = "inbox";

  constructor(
    private readonly getInboxQuery: GetInboxQuery,
    private readonly getUnreadInboxCountQuery: GetUnreadInboxCountQuery,
    private readonly getMentionsQuery: GetMentionsQuery,
    private readonly getConversationQuery: GetConversationQuery,
    private readonly getConversationMessagesQuery: GetConversationMessagesQuery,
    private readonly markMessageReadUseCase: MarkMessageReadUseCase,
    private readonly markMessageArchivedUseCase: MarkMessageArchivedUseCase,
    private readonly assignMessageUseCase: AssignMessageUseCase,
    private readonly sendReplyUseCase: SendReplyUseCase,
    private readonly resolveConversationUseCase: ResolveConversationUseCase,
    private readonly reopenConversationUseCase: ReopenConversationUseCase,
    private readonly syncProviderCommentsUseCase: SyncProviderCommentsUseCase
  ) {
    super();
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * @method mapErrorCode
   * @description Maps UseCaseError.code to an HTTP status code.
   * @param code - The UseCaseError code string
   * @returns The corresponding HTTP status code
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
   * @method extractAccountId
   * @description Extracts the accountId from the authenticated request user.
   * @param request - The Fastify request object
   * @returns The accountId string, or an empty string if unavailable
   */
  private extractAccountId(request: FastifyRequest): string {
    return request.user?.accountId ?? "";
  }

  // --------------------------------------------------------------------------
  // Query endpoints
  // --------------------------------------------------------------------------

  /**
   * @method listInbox
   * @description GET /api/inbox -- Returns cursor-paginated inbox messages
   *   with optional filters for provider, channelId, messageType, status, and assigneeId.
   */
  async listInbox(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validation = await this.validateQuery(ctx, InboxQuerySchema);
    if (!validation.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const user = request.user;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const accountId = this.extractAccountId(request);
    const q = validation.value;

    const result = await this.getInboxQuery.execute({
      accountId,
      ...(q.cursor !== undefined && { cursor: q.cursor }),
      ...(q.limit !== undefined && { limit: q.limit }),
      ...(q.provider !== undefined && { provider: q.provider }),
      ...(q.channelId !== undefined && { channelId: q.channelId }),
      ...(q.messageType !== undefined && { messageType: q.messageType }),
      ...(q.status !== undefined && { status: q.status }),
      ...(q.assigneeId !== undefined && { assigneeId: q.assigneeId }),
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  /**
   * @method getUnreadCount
   * @description GET /api/inbox/unread-count -- Returns unread message count
   *   for the authenticated account, optionally filtered by project.
   */
  async getUnreadCount(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validation = await this.validateQuery(ctx, UnreadCountQuerySchema);
    if (!validation.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const user = request.user;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const accountId = this.extractAccountId(request);

    const result = await this.getUnreadInboxCountQuery.execute({
      accountId,
      ...(validation.value.projectId !== undefined && {
        projectId: validation.value.projectId,
      }),
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  /**
   * @method listMentions
   * @description GET /api/inbox/mentions -- Returns cursor-paginated mention
   *   messages for the authenticated account.
   */
  async listMentions(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const validation = await this.validateQuery(ctx, MentionsQuerySchema);
    if (!validation.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const user = request.user;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const accountId = this.extractAccountId(request);
    const q = validation.value;

    const result = await this.getMentionsQuery.execute({
      accountId,
      ...(q.cursor !== undefined && { cursor: q.cursor }),
      ...(q.limit !== undefined && { limit: q.limit }),
      ...(q.projectId !== undefined && { projectId: q.projectId }),
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  /**
   * @method getConversation
   * @description GET /api/inbox/conversations/:id -- Returns a single
   *   conversation by its ID.
   */
  async getConversation(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, UuidParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid conversation ID format");
    }

    const user = request.user;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.getConversationQuery.execute({
      conversationId: paramsValidation.value.id,
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  /**
   * @method getConversationMessages
   * @description GET /api/inbox/conversations/:id/messages -- Returns
   *   cursor-paginated messages within a conversation.
   */
  async getConversationMessages(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, UuidParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid conversation ID format");
    }

    const queryValidation = await this.validateQuery(ctx, ConversationMessagesQuerySchema);
    if (!queryValidation.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const user = request.user;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const q = queryValidation.value;

    const result = await this.getConversationMessagesQuery.execute({
      conversationId: paramsValidation.value.id,
      ...(q.cursor !== undefined && { cursor: q.cursor }),
      ...(q.limit !== undefined && { limit: q.limit }),
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  // --------------------------------------------------------------------------
  // Command endpoints (message lifecycle)
  // --------------------------------------------------------------------------

  /**
   * @method markRead
   * @description PATCH /api/inbox/messages/:id/read -- Marks a message as read.
   */
  async markRead(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, UuidParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid message ID format");
    }

    const user = request.user;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.markMessageReadUseCase.execute({
      messageId: paramsValidation.value.id,
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, { messageId: paramsValidation.value.id, status: "read" });
  }

  /**
   * @method markArchived
   * @description PATCH /api/inbox/messages/:id/archive -- Archives a message.
   */
  async markArchived(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, UuidParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid message ID format");
    }

    const user = request.user;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.markMessageArchivedUseCase.execute({
      messageId: paramsValidation.value.id,
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, { messageId: paramsValidation.value.id, status: "archived" });
  }

  /**
   * @method assignMessage
   * @description PATCH /api/inbox/messages/:id/assign -- Assigns a message
   *   to a team member.
   */
  async assignMessage(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, UuidParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid message ID format");
    }

    const bodyValidation = await this.validateBody(ctx, AssignBodySchema);
    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body: assigneeId (UUID) is required");
    }

    const user = request.user;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.assignMessageUseCase.execute({
      messageId: paramsValidation.value.id,
      assigneeId: bodyValidation.value.assigneeId,
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, {
      messageId: paramsValidation.value.id,
      assigneeId: bodyValidation.value.assigneeId,
    });
  }

  /**
   * @method sendReply
   * @description POST /api/inbox/messages/:id/reply -- Sends a reply to a
   *   social message. The authorId is derived from the authenticated user.
   */
  async sendReply(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, UuidParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid message ID format");
    }

    const bodyValidation = await this.validateBody(ctx, ReplyBodySchema);
    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body: body (non-empty string) is required");
    }

    const user = request.user;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const authorId = user.id ?? "system";

    const result = await this.sendReplyUseCase.execute({
      messageId: paramsValidation.value.id,
      authorId,
      body: bodyValidation.value.body,
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, result.value, 201);
  }

  // --------------------------------------------------------------------------
  // Command endpoints (conversation lifecycle)
  // --------------------------------------------------------------------------

  /**
   * @method resolveConversation
   * @description PATCH /api/inbox/conversations/:id/resolve -- Marks a
   *   conversation as resolved.
   */
  async resolveConversation(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, UuidParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid conversation ID format");
    }

    const bodyValidation = await this.validateBody(ctx, ResolveBodySchema);
    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body: resolvedById (UUID) is required");
    }

    const user = request.user;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.resolveConversationUseCase.execute({
      conversationId: paramsValidation.value.id,
      resolvedById: bodyValidation.value.resolvedById,
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, {
      conversationId: paramsValidation.value.id,
      status: "resolved",
    });
  }

  /**
   * @method reopenConversation
   * @description PATCH /api/inbox/conversations/:id/reopen -- Reopens a
   *   previously resolved conversation.
   */
  async reopenConversation(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, UuidParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid conversation ID format");
    }

    const user = request.user;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.reopenConversationUseCase.execute({
      conversationId: paramsValidation.value.id,
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, {
      conversationId: paramsValidation.value.id,
      status: "reopened",
    });
  }

  // --------------------------------------------------------------------------
  // Provider sync endpoint
  // --------------------------------------------------------------------------

  /**
   * @method syncProviderComments
   * @description POST /api/inbox/sync/:channelId -- Triggers a synchronization
   *   of comments from the provider for the specified channel.
   */
  async syncProviderComments(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateParams(ctx, ChannelIdParamsSchema);
    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid channel ID format");
    }

    const user = request.user;
    if (!user) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.syncProviderCommentsUseCase.execute({
      channelId: paramsValidation.value.channelId,
    });

    if (!result.ok) {
      return this.sendError(ctx, this.mapErrorCode(result.error.code), result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }
}

// ============================================================================
// Fastify Plugin Export
// ============================================================================

/**
 * Fastify plugin that registers Social Inbox routes under /api/inbox.
 */
const inboxRoutes: FastifyPluginAsync = async (app) => {
  // Resolve use cases and queries from DI container
  const getInboxQuery = app.container.resolve<GetInboxQuery>(TOKENS.GetInboxQuery);
  const getUnreadInboxCountQuery = app.container.resolve<GetUnreadInboxCountQuery>(
    TOKENS.GetUnreadInboxCountQuery
  );
  const getMentionsQuery = app.container.resolve<GetMentionsQuery>(TOKENS.GetMentionsQuery);
  const getConversationQuery = app.container.resolve<GetConversationQuery>(
    TOKENS.GetConversationQuery
  );
  const getConversationMessagesQuery = app.container.resolve<GetConversationMessagesQuery>(
    TOKENS.GetConversationMessagesQuery
  );
  const markMessageReadUseCase = app.container.resolve<MarkMessageReadUseCase>(
    TOKENS.MarkMessageReadUseCase
  );
  const markMessageArchivedUseCase = app.container.resolve<MarkMessageArchivedUseCase>(
    TOKENS.MarkMessageArchivedUseCase
  );
  const assignMessageUseCase = app.container.resolve<AssignMessageUseCase>(
    TOKENS.AssignMessageUseCase
  );
  const sendReplyUseCase = app.container.resolve<SendReplyUseCase>(TOKENS.SendReplyUseCase);
  const resolveConversationUseCase = app.container.resolve<ResolveConversationUseCase>(
    TOKENS.ResolveConversationUseCase
  );
  const reopenConversationUseCase = app.container.resolve<ReopenConversationUseCase>(
    TOKENS.ReopenConversationUseCase
  );
  const syncProviderCommentsUseCase = app.container.resolve<SyncProviderCommentsUseCase>(
    TOKENS.SyncProviderCommentsUseCase
  );

  const handler = new InboxRouteHandler(
    getInboxQuery,
    getUnreadInboxCountQuery,
    getMentionsQuery,
    getConversationQuery,
    getConversationMessagesQuery,
    markMessageReadUseCase,
    markMessageArchivedUseCase,
    assignMessageUseCase,
    sendReplyUseCase,
    resolveConversationUseCase,
    reopenConversationUseCase,
    syncProviderCommentsUseCase
  );

  // -- Query routes --

  app.get(
    "/api/inbox",
    { preHandler: [authenticateMiddleware] },
    (request: FastifyRequest, reply: FastifyReply) => handler.listInbox(request, reply)
  );

  app.get(
    "/api/inbox/unread-count",
    { preHandler: [authenticateMiddleware] },
    (request: FastifyRequest, reply: FastifyReply) => handler.getUnreadCount(request, reply)
  );

  app.get(
    "/api/inbox/mentions",
    { preHandler: [authenticateMiddleware] },
    (request: FastifyRequest, reply: FastifyReply) => handler.listMentions(request, reply)
  );

  app.get(
    "/api/inbox/conversations/:id",
    { preHandler: [authenticateMiddleware] },
    (request: FastifyRequest, reply: FastifyReply) => handler.getConversation(request, reply)
  );

  app.get(
    "/api/inbox/conversations/:id/messages",
    { preHandler: [authenticateMiddleware] },
    (request: FastifyRequest, reply: FastifyReply) =>
      handler.getConversationMessages(request, reply)
  );

  // -- Message lifecycle commands --

  app.patch(
    "/api/inbox/messages/:id/read",
    { preHandler: [authenticateMiddleware] },
    (request: FastifyRequest, reply: FastifyReply) => handler.markRead(request, reply)
  );

  app.patch(
    "/api/inbox/messages/:id/archive",
    { preHandler: [authenticateMiddleware] },
    (request: FastifyRequest, reply: FastifyReply) => handler.markArchived(request, reply)
  );

  app.patch(
    "/api/inbox/messages/:id/assign",
    { preHandler: [authenticateMiddleware] },
    (request: FastifyRequest, reply: FastifyReply) => handler.assignMessage(request, reply)
  );

  app.post(
    "/api/inbox/messages/:id/reply",
    { preHandler: [authenticateMiddleware] },
    (request: FastifyRequest, reply: FastifyReply) => handler.sendReply(request, reply)
  );

  // -- Conversation lifecycle commands --

  app.patch(
    "/api/inbox/conversations/:id/resolve",
    { preHandler: [authenticateMiddleware] },
    (request: FastifyRequest, reply: FastifyReply) => handler.resolveConversation(request, reply)
  );

  app.patch(
    "/api/inbox/conversations/:id/reopen",
    { preHandler: [authenticateMiddleware] },
    (request: FastifyRequest, reply: FastifyReply) => handler.reopenConversation(request, reply)
  );

  // -- Provider sync --

  app.post(
    "/api/inbox/sync/:channelId",
    { preHandler: [authenticateMiddleware] },
    (request: FastifyRequest, reply: FastifyReply) => handler.syncProviderComments(request, reply)
  );
};

export { inboxRoutes };
