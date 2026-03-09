/**
 * @file teamRoutes.ts
 * @description Fastify plugin registering team management endpoints.
 *   Resolves use cases from DI and delegates to handler methods.
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { BaseRouteHandler, type RouteContext } from "@packages/api-common";
import { authenticateMiddleware } from "../auth/authMiddleware.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { InviteTeamMemberUseCase } from "../application/team/InviteTeamMemberUseCase.js";
import type { GetTeamMembersQuery } from "../application/team/GetTeamMembersQuery.js";
import type { UpdateTeamMemberRoleUseCase } from "../application/team/UpdateTeamMemberRoleUseCase.js";
import type { RemoveTeamMemberUseCase } from "../application/team/RemoveTeamMemberUseCase.js";

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
    private readonly removeUseCase: RemoveTeamMemberUseCase
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
      newRole,
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

  const handler = new TeamRouteHandler(inviteUseCase, getQuery, updateRoleUseCase, removeUseCase);

  app.get(
    "/team",
    { preHandler: [authenticateMiddleware] },
    (request: FastifyRequest, reply: FastifyReply) => handler.listMembers(request, reply)
  );

  app.post(
    "/team/invite",
    { preHandler: [authenticateMiddleware] },
    (request: FastifyRequest, reply: FastifyReply) => handler.invite(request, reply)
  );

  app.patch(
    "/team/:id/role",
    { preHandler: [authenticateMiddleware] },
    (request: FastifyRequest, reply: FastifyReply) => handler.updateRole(request, reply)
  );

  app.delete(
    "/team/:id",
    { preHandler: [authenticateMiddleware] },
    (request: FastifyRequest, reply: FastifyReply) => handler.remove(request, reply)
  );
};
