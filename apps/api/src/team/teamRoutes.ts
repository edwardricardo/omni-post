/**
 * @file teamRoutes.ts
 * @description Fastify plugin registering team management endpoints.
 *   Resolves use cases from DI and delegates to handler methods.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { InviteTeamMemberUseCase } from "@core/team/InviteTeamMemberUseCase.js";
import type { GetTeamMembersQuery } from "@core/team/GetTeamMembersQuery.js";
import type { UpdateTeamMemberRoleUseCase } from "@core/team/UpdateTeamMemberRoleUseCase.js";
import type { RemoveTeamMemberUseCase } from "@core/team/RemoveTeamMemberUseCase.js";
import type { SearchTeamMembersQuery } from "@core/team/SearchTeamMembersQuery.js";

// --- Zod Schemas ---

const InviteBodySchema = z.object({
  accountId: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1).max(200),
  role: z.enum(["OWNER", "MANAGER", "MEMBER", "VIEWER"]).optional(),
  invitedBy: z.string().uuid().optional(),
});

const ListQuerySchema = z.object({
  accountId: z.string().uuid(),
});

const MemberIdParamsSchema = z.object({
  id: z.string().uuid(),
});

const UpdateRoleBodySchema = z.object({
  newRole: z.enum(["OWNER", "MANAGER", "MEMBER", "VIEWER"]),
  changerMemberId: z.string().uuid(),
});

const RemoveBodySchema = z.object({
  changerMemberId: z.string().uuid(),
});

const MentionSearchQuerySchema = z.object({
  q: z.string().max(200).default(""),
  accountId: z.string().uuid(),
});

/**
 * @class TeamRouteHandler
 * @description Route handler for team management endpoints.
 *   All operations delegate to application-layer use cases.
 */
class TeamRouteHandler extends BaseRouteHandler {
  protected routeName = "team";

  constructor(
    private readonly inviteUseCase: InviteTeamMemberUseCase,
    private readonly getQuery: GetTeamMembersQuery,
    private readonly updateRoleUseCase: UpdateTeamMemberRoleUseCase,
    private readonly removeUseCase: RemoveTeamMemberUseCase,
    private readonly searchQuery: SearchTeamMembersQuery
  ) {
    super();
  }

  /**
   * @method listMembers
   * @description GET /team — Lists all team members for an account
   */
  async listMembers(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = await this.validateRequest<{
      query: z.infer<typeof ListQuerySchema>;
    }>(ctx, { query: ListQuerySchema });

    if (!validation.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const result = await this.getQuery.execute({
      accountId: validation.value.query.accountId,
    });

    if (!result.ok) {
      return this.sendError(ctx, 500, result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  /**
   * @method invite
   * @description POST /team/invite — Invites a new team member
   */
  async invite(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = await this.validateRequest<{
      body: z.infer<typeof InviteBodySchema>;
    }>(ctx, { body: InviteBodySchema });

    if (!validation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const body = validation.value.body;
    const result = await this.inviteUseCase.execute({
      accountId: body.accountId,
      email: body.email,
      name: body.name,
      ...(body.role !== undefined && { role: body.role }),
      ...(body.invitedBy !== undefined && { invitedBy: body.invitedBy }),
    });

    if (!result.ok) {
      const statusCode = result.error.code === "CONFLICT" ? 409 : 400;
      return this.sendError(ctx, statusCode, result.error.message);
    }

    this.sendSuccess(ctx, { id: result.value }, 201);
  }

  /**
   * @method updateRole
   * @description PATCH /team/:id/role — Updates a team member's role
   */
  async updateRole(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateRequest<{
      params: z.infer<typeof MemberIdParamsSchema>;
    }>(ctx, { params: MemberIdParamsSchema });

    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid member ID");
    }

    const bodyValidation = await this.validateRequest<{
      body: z.infer<typeof UpdateRoleBodySchema>;
    }>(ctx, { body: UpdateRoleBodySchema });

    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const { id } = paramsValidation.value.params;
    const { newRole, changerMemberId } = bodyValidation.value.body;

    const result = await this.updateRoleUseCase.execute({
      memberId: id,
      newRoleName: newRole,
      changerMemberId,
    });

    if (!result.ok) {
      const statusMap: Record<string, number> = {
        NOT_FOUND: 404,
        FORBIDDEN: 403,
        VALIDATION_FAILED: 400,
      };
      const statusCode = statusMap[result.error.code] ?? 500;
      return this.sendError(ctx, statusCode, result.error.message);
    }

    this.sendSuccess(ctx, { updated: true });
  }

  /**
   * @method mentionSearch
   * @description GET /team/mention-search — Searches team members for @mention autocomplete
   */
  async mentionSearch(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const validation = await this.validateRequest<{
      query: z.infer<typeof MentionSearchQuerySchema>;
    }>(ctx, { query: MentionSearchQuerySchema });

    if (!validation.ok) {
      return this.sendError(ctx, 400, "Invalid query parameters");
    }

    const { q, accountId } = validation.value.query;

    const result = await this.searchQuery.execute({
      accountId,
      query: q,
      limit: 10,
    });

    if (!result.ok) {
      return this.sendError(ctx, 500, result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  /**
   * @method remove
   * @description DELETE /team/:id — Deactivates a team member
   */
  async remove(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };

    const paramsValidation = await this.validateRequest<{
      params: z.infer<typeof MemberIdParamsSchema>;
    }>(ctx, { params: MemberIdParamsSchema });

    if (!paramsValidation.ok) {
      return this.sendError(ctx, 400, "Invalid member ID");
    }

    const bodyValidation = await this.validateRequest<{
      body: z.infer<typeof RemoveBodySchema>;
    }>(ctx, { body: RemoveBodySchema });

    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const { id } = paramsValidation.value.params;
    const { changerMemberId } = bodyValidation.value.body;

    const result = await this.removeUseCase.execute({
      memberId: id,
      changerMemberId,
    });

    if (!result.ok) {
      const statusMap: Record<string, number> = {
        NOT_FOUND: 404,
        FORBIDDEN: 403,
        VALIDATION_FAILED: 400,
      };
      const statusCode = statusMap[result.error.code] ?? 500;
      return this.sendError(ctx, statusCode, result.error.message);
    }

    this.sendSuccess(ctx, { removed: true });
  }
}

/**
 * Fastify plugin that registers team management routes under /team
 */
export const teamRoutes: FastifyPluginAsync = async (app) => {
  const inviteUseCase = app.container.resolve<InviteTeamMemberUseCase>(
    TOKENS.InviteTeamMemberUseCase
  );
  const getQuery = app.container.resolve<GetTeamMembersQuery>(TOKENS.GetTeamMembersQuery);
  const updateRoleUseCase = app.container.resolve<UpdateTeamMemberRoleUseCase>(
    TOKENS.UpdateTeamMemberRoleUseCase
  );
  const removeUseCase = app.container.resolve<RemoveTeamMemberUseCase>(
    TOKENS.RemoveTeamMemberUseCase
  );
  const searchQuery = app.container.resolve<SearchTeamMembersQuery>(TOKENS.SearchTeamMembersQuery);

  const handler = new TeamRouteHandler(
    inviteUseCase,
    getQuery,
    updateRoleUseCase,
    removeUseCase,
    searchQuery
  );

  app.get(
    "/team",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Team"], summary: "List all team members for an account" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.listMembers(request, reply)
  );

  app.get(
    "/team/mention-search",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Team"], summary: "Search team members for @mention autocomplete" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.mentionSearch(request, reply)
  );

  app.post(
    "/team/invite",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Team"], summary: "Invite a new team member" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.invite(request, reply)
  );

  app.patch(
    "/team/:id/role",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Team"], summary: "Update a team member role" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.updateRole(request, reply)
  );

  app.delete(
    "/team/:id",
    {
      preHandler: [requireClientAuth],
      schema: { tags: ["Team"], summary: "Remove a team member" },
    },
    (request: FastifyRequest, reply: FastifyReply) => handler.remove(request, reply)
  );
};
