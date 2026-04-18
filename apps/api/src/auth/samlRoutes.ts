/**
 * @file samlRoutes.ts
 * @description REST API routes for SAML 2.0 SSO.
 *
 *   Public (IdP-facing):
 *     GET  /auth/saml/:accountId/metadata  -> SP metadata XML
 *     GET  /auth/saml/:accountId/login     -> Redirect to IdP with AuthnRequest
 *     POST /auth/saml/:accountId/callback  -> Receive SAML Response, create session
 *
 *   Admin (authenticated):
 *     GET  /api/saml/config   -> GetSamlConfigurationQuery
 *     PUT  /api/saml/config   -> ConfigureSamlUseCase
 *     POST /api/saml/enable   -> EnableSsoUseCase
 *     POST /api/saml/disable  -> DisableSsoUseCase
 *
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { SAML } from "@node-saml/node-saml";
import { BaseRouteHandler, type RouteContext } from "@packages/api-common";
import { TOKENS } from "../infrastructure/container/types.js";
import { requireAdminAuth } from "../admin/auth/adminAuthMiddleware.js";
import type { ConfigureSamlUseCase } from "../application/auth/ConfigureSamlUseCase.js";
import type { EnableSsoUseCase } from "../application/auth/EnableSsoUseCase.js";
import type { DisableSsoUseCase } from "../application/auth/DisableSsoUseCase.js";
import type { GetSamlConfigurationQuery } from "../application/auth/GetSamlConfigurationQuery.js";
import type { SamlConfigurationRepository } from "../domain/repositories/SamlConfigurationRepository.js";
import type { AuthService } from "./authService.js";

// ============================================================================
// Schemas
// ============================================================================

const AccountIdParamSchema = z.object({
  accountId: z.string().min(1),
});

const ConfigureBodySchema = z.object({
  idpEntityId: z.string().min(1, "IdP Entity ID is required"),
  idpSsoUrl: z.string().url().startsWith("https://", "Must use HTTPS"),
  idpCertificate: z.string().min(1, "IdP certificate is required"),
  attributeMapping: z
    .object({
      email: z.string().min(1, "email mapping is required"),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      displayName: z.string().optional(),
    })
    .passthrough(),
});

// ============================================================================
// Admin Handler
// ============================================================================

class SamlAdminHandler extends BaseRouteHandler {
  protected routeName = "saml";

  constructor(
    private readonly configureUseCase: ConfigureSamlUseCase,
    private readonly enableSsoUseCase: EnableSsoUseCase,
    private readonly disableSsoUseCase: DisableSsoUseCase,
    private readonly getConfigQuery: GetSamlConfigurationQuery
  ) {
    super();
  }

  async getConfig(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = request.auth?.user?.id;

    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.getConfigQuery.execute({ accountId });
    if (!result.ok) {
      return this.sendError(ctx, 400, result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  async configure(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = request.auth?.user?.id;

    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const bodyValidation = await this.validateBody(ctx, ConfigureBodySchema);
    if (!bodyValidation.ok) {
      return this.sendError(ctx, 400, "Invalid request body");
    }

    const body = bodyValidation.value;
    const result = await this.configureUseCase.execute({
      accountId,
      idpEntityId: body.idpEntityId,
      idpSsoUrl: body.idpSsoUrl,
      idpCertificate: body.idpCertificate,
      attributeMapping: body.attributeMapping as {
        email: string;
        [key: string]: string | undefined;
      },
    });

    if (!result.ok) {
      const statusCode = result.error.code === "VALIDATION_FAILED" ? 400 : 500;
      return this.sendError(ctx, statusCode, result.error.message);
    }

    this.sendSuccess(ctx, result.value);
  }

  async enableSso(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = request.auth?.user?.id;

    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.enableSsoUseCase.execute({ accountId });
    if (!result.ok) {
      const statusCode = result.error.code === "VALIDATION_FAILED" ? 400 : 500;
      return this.sendError(ctx, statusCode, result.error.message);
    }

    this.sendSuccess(ctx, { ssoEnabled: true });
  }

  async disableSso(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = request.auth?.user?.id;

    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.disableSsoUseCase.execute({ accountId });
    if (!result.ok) {
      return this.sendError(ctx, 500, result.error.message);
    }

    this.sendSuccess(ctx, { ssoEnabled: false });
  }
}

// ============================================================================
// SAML Flow Helpers
// ============================================================================

const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://omnipost.app";

function buildSamlInstance(config: {
  entityId: string;
  idpEntityId: string;
  idpSsoUrl: string;
  idpCertificate: string;
  accountId: string;
}): SAML {
  return new SAML({
    callbackUrl: `${APP_BASE_URL}/auth/saml/${config.accountId}/callback`,
    issuer: config.entityId,
    idpIssuer: config.idpEntityId,
    entryPoint: config.idpSsoUrl,
    idpCert: config.idpCertificate,
    wantAssertionsSigned: true,
  });
}

// ============================================================================
// Plugin
// ============================================================================

export const samlRoutes: FastifyPluginAsync = async (app) => {
  const configureUseCase = app.container!.resolve<ConfigureSamlUseCase>(
    TOKENS.ConfigureSamlUseCase
  );
  const enableSsoUseCase = app.container!.resolve<EnableSsoUseCase>(TOKENS.EnableSsoUseCase);
  const disableSsoUseCase = app.container!.resolve<DisableSsoUseCase>(TOKENS.DisableSsoUseCase);
  const getConfigQuery = app.container!.resolve<GetSamlConfigurationQuery>(
    TOKENS.GetSamlConfigurationQuery
  );
  const samlRepo = app.container!.resolve<SamlConfigurationRepository>(
    TOKENS.SamlConfigurationRepository
  );
  const authService = app.container!.resolve<AuthService>(TOKENS.AuthService);

  const adminHandler = new SamlAdminHandler(
    configureUseCase,
    enableSsoUseCase,
    disableSsoUseCase,
    getConfigQuery
  );

  // ── Admin endpoints ─────────────────────────────────────────────────────

  app.get(
    "/saml/config",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["SSO"], summary: "Get SAML configuration" },
    },
    (request: FastifyRequest, reply: FastifyReply) => adminHandler.getConfig(request, reply)
  );

  app.put(
    "/saml/config",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["SSO"], summary: "Configure IdP settings" },
    },
    (request: FastifyRequest, reply: FastifyReply) => adminHandler.configure(request, reply)
  );

  app.post(
    "/saml/enable",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["SSO"], summary: "Enable SSO for account" },
    },
    (request: FastifyRequest, reply: FastifyReply) => adminHandler.enableSso(request, reply)
  );

  app.post(
    "/saml/disable",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["SSO"], summary: "Disable SSO for account" },
    },
    (request: FastifyRequest, reply: FastifyReply) => adminHandler.disableSso(request, reply)
  );

  // ── Public SAML flow endpoints ──────────────────────────────────────────

  app.get(
    "/auth/saml/:accountId/metadata",
    {
      schema: { tags: ["SSO"], summary: "SP metadata XML" },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = AccountIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid accountId" });
      }

      const config = await samlRepo.findByAccountId(params.data.accountId);
      if (!config || !config.isActive) {
        return reply.code(404).send({ error: "SAML configuration not found" });
      }

      const saml = buildSamlInstance({ ...config, accountId: params.data.accountId });
      const metadata = saml.generateServiceProviderMetadata(null, config.idpCertificate);

      reply.header("Content-Type", "application/xml").send(metadata);
    }
  );

  app.get(
    "/auth/saml/:accountId/login",
    {
      schema: { tags: ["SSO"], summary: "Initiate SAML login redirect" },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = AccountIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid accountId" });
      }

      const config = await samlRepo.findByAccountId(params.data.accountId);
      if (!config || !config.isActive) {
        return reply.code(404).send({ error: "SAML configuration not found or inactive" });
      }

      const saml = buildSamlInstance({ ...config, accountId: params.data.accountId });

      const loginUrl = await saml.getAuthorizeUrlAsync("", request.hostname, {});
      return reply.code(302).redirect(loginUrl);
    }
  );

  app.post(
    "/auth/saml/:accountId/callback",
    {
      schema: { tags: ["SSO"], summary: "SAML Response callback" },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = AccountIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid accountId" });
      }

      const config = await samlRepo.findByAccountId(params.data.accountId);
      if (!config || !config.isActive) {
        return reply.code(404).send({ error: "SAML configuration not found" });
      }

      const saml = buildSamlInstance({ ...config, accountId: params.data.accountId });

      try {
        const body = request.body as Record<string, string>;
        const { profile } = await saml.validatePostResponseAsync(body);

        if (!profile) {
          return reply.code(401).send({ error: "SAML validation failed: no profile" });
        }

        // Extract email from SAML attributes using the configured mapping
        const emailAttr = config.attributeMapping.email ?? "email";
        const email =
          ((profile as Record<string, unknown>)[emailAttr] as string | undefined) ?? profile.nameID;

        if (!email) {
          return reply.code(401).send({ error: "No email found in SAML assertion" });
        }

        // Find or create user session via AuthService
        // The SSO callback creates a login session for the matched user
        const loginResult = await authService.login(
          { email, password: "__saml_sso__" },
          request.ip,
          request.headers["user-agent"]
        );

        // If login fails with invalid credentials, the user may need to be provisioned
        // For now, return the SAML profile so the client can handle provisioning
        if (!loginResult.ok) {
          const firstName = profile["firstName"] as string | undefined;
          const lastName = profile["lastName"] as string | undefined;
          return reply.code(200).send({
            ssoAuthenticated: true,
            email,
            nameID: profile.nameID,
            ...(firstName ? { firstName } : {}),
            ...(lastName ? { lastName } : {}),
            requiresProvisioning: true,
          });
        }

        const loginData = loginResult.value;
        if ("mfaRequired" in loginData) {
          return reply.code(200).send({
            ssoAuthenticated: true,
            mfaRequired: true,
            userId: loginData.userId,
          });
        }

        reply.setCookie("refreshToken", loginData.tokens.refreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "strict",
          maxAge: 7 * 24 * 60 * 60 * 1000,
          path: "/auth",
        });

        return reply.code(200).send({
          ssoAuthenticated: true,
          user: loginData.user,
          accessToken: loginData.tokens.accessToken,
          expiresAt: loginData.tokens.expiresAt,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "SAML validation failed";
        return reply.code(401).send({ error: message });
      }
    }
  );
};
