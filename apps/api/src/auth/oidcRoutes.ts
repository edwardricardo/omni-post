/**
 * @file oidcRoutes.ts
 * @description REST API routes for OpenID Connect SSO.
 *
 *   Public (OIDC flow):
 *     GET  /auth/oidc/:accountId/login    -> Generate authorization URL with PKCE, redirect
 *     GET  /auth/oidc/:accountId/callback -> Exchange code for tokens, fetch UserInfo, create session
 *
 *   Admin (authenticated):
 *     GET  /api/oidc/config   -> GetOidcConfigurationQuery
 *     PUT  /api/oidc/config   -> ConfigureOidcUseCase
 *     POST /api/oidc/enable   -> EnableOidcSsoUseCase
 *     POST /api/oidc/disable  -> DisableOidcSsoUseCase
 *
 * @layer infrastructure
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import * as openidClient from "openid-client";
import { randomBytes } from "crypto";
import { BaseRouteHandler, type RouteContext } from "../lib/route-handler/index.js";
import { TOKENS } from "../infrastructure/container/types.js";
import { requireAdminAuth } from "../admin/auth/adminAuthMiddleware.js";
import type { ConfigureOidcUseCase } from "@core/application/auth/ConfigureOidcUseCase.js";
import type { EnableOidcSsoUseCase } from "@core/application/auth/EnableOidcSsoUseCase.js";
import type { DisableOidcSsoUseCase } from "@core/application/auth/DisableOidcSsoUseCase.js";
import type { GetOidcConfigurationQuery } from "@core/application/auth/GetOidcConfigurationQuery.js";
import type { OidcConfigurationRepository } from "../domain/repositories/OidcConfigurationRepository.js";
import type { AuthService } from "./authService.js";
import { env } from "../config/env.js";

// ============================================================================
// Schemas
// ============================================================================

const AccountIdParamSchema = z.object({
  accountId: z.string().min(1),
});

const ConfigureBodySchema = z.object({
  issuerUrl: z.string().url().startsWith("https://", "Must use HTTPS"),
  clientId: z.string().min(1, "Client ID is required"),
  clientSecret: z.string().min(1, "Client secret is required"),
  scopes: z.array(z.string()).optional(),
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
// In-memory PKCE state store (per-request, short-lived)
// In production, use Redis or encrypted cookies.
// ============================================================================

const pkceStore = new Map<
  string,
  {
    codeVerifier: string;
    accountId: string;
    expiresAt: number;
  }
>();

const PKCE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function cleanExpiredPkce(): void {
  const now = Date.now();
  for (const [key, value] of pkceStore) {
    if (value.expiresAt < now) {
      pkceStore.delete(key);
    }
  }
}

// ============================================================================
// Admin Handler
// ============================================================================

class OidcAdminHandler extends BaseRouteHandler {
  protected routeName = "oidc";

  constructor(
    private readonly configureUseCase: ConfigureOidcUseCase,
    private readonly enableOidcSsoUseCase: EnableOidcSsoUseCase,
    private readonly disableOidcSsoUseCase: DisableOidcSsoUseCase,
    private readonly getConfigQuery: GetOidcConfigurationQuery
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

    // Mask clientSecret in response
    const data = result.value;
    if (data) {
      const maskedData = {
        ...data,
        clientSecret: "***MASKED***",
      };
      this.sendSuccess(ctx, maskedData);
    } else {
      this.sendSuccess(ctx, data);
    }
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
      issuerUrl: body.issuerUrl,
      clientId: body.clientId,
      clientSecret: body.clientSecret,
      ...(body.scopes !== undefined && { scopes: body.scopes }),
      attributeMapping: body.attributeMapping as {
        email: string;
        [key: string]: string | undefined;
      },
    });

    if (!result.ok) {
      const statusCode = result.error.code === "VALIDATION_FAILED" ? 400 : 500;
      return this.sendError(ctx, statusCode, result.error.message);
    }

    // Mask clientSecret in response
    const maskedData = {
      ...result.value,
      clientSecret: "***MASKED***",
    };
    this.sendSuccess(ctx, maskedData);
  }

  async enableSso(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = request.auth?.user?.id;

    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.enableOidcSsoUseCase.execute({ accountId });
    if (!result.ok) {
      const statusCode = result.error.code === "VALIDATION_FAILED" ? 400 : 500;
      return this.sendError(ctx, statusCode, result.error.message);
    }

    this.sendSuccess(ctx, { ssoEnabled: true, ssoProvider: "OIDC" });
  }

  async disableSso(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const ctx: RouteContext = { request, reply };
    const accountId = request.auth?.user?.id;

    if (!accountId) {
      return this.sendError(ctx, 401, "Authentication required");
    }

    const result = await this.disableOidcSsoUseCase.execute({ accountId });
    if (!result.ok) {
      return this.sendError(ctx, 500, result.error.message);
    }

    this.sendSuccess(ctx, { ssoEnabled: false, ssoProvider: "NONE" });
  }
}

// ============================================================================
// Helpers
// ============================================================================

const APP_BASE_URL = env.APP_BASE_URL ?? "https://omnipost.app";

// ============================================================================
// Plugin
// ============================================================================

export const oidcRoutes: FastifyPluginAsync = async (app) => {
  const configureUseCase = app.container!.resolve<ConfigureOidcUseCase>(
    TOKENS.ConfigureOidcUseCase
  );
  const enableOidcSsoUseCase = app.container!.resolve<EnableOidcSsoUseCase>(
    TOKENS.EnableOidcSsoUseCase
  );
  const disableOidcSsoUseCase = app.container!.resolve<DisableOidcSsoUseCase>(
    TOKENS.DisableOidcSsoUseCase
  );
  const getConfigQuery = app.container!.resolve<GetOidcConfigurationQuery>(
    TOKENS.GetOidcConfigurationQuery
  );
  const oidcRepo = app.container!.resolve<OidcConfigurationRepository>(
    TOKENS.OidcConfigurationRepository
  );
  const authService = app.container!.resolve<AuthService>(TOKENS.AuthService);

  const adminHandler = new OidcAdminHandler(
    configureUseCase,
    enableOidcSsoUseCase,
    disableOidcSsoUseCase,
    getConfigQuery
  );

  // ── Admin endpoints ─────────────────────────────────────────────────────

  app.get(
    "/oidc/config",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["SSO"], summary: "Get OIDC configuration" },
    },
    (request: FastifyRequest, reply: FastifyReply) => adminHandler.getConfig(request, reply)
  );

  app.put(
    "/oidc/config",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["SSO"], summary: "Configure OIDC IdP settings" },
    },
    (request: FastifyRequest, reply: FastifyReply) => adminHandler.configure(request, reply)
  );

  app.post(
    "/oidc/enable",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["SSO"], summary: "Enable OIDC SSO for account" },
    },
    (request: FastifyRequest, reply: FastifyReply) => adminHandler.enableSso(request, reply)
  );

  app.post(
    "/oidc/disable",
    {
      preHandler: [requireAdminAuth],
      schema: { tags: ["SSO"], summary: "Disable OIDC SSO for account" },
    },
    (request: FastifyRequest, reply: FastifyReply) => adminHandler.disableSso(request, reply)
  );

  // ── Public OIDC flow endpoints ──────────────────────────────────────────

  app.get(
    "/auth/oidc/:accountId/login",
    {
      schema: { tags: ["SSO"], summary: "Initiate OIDC login redirect with PKCE" },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = AccountIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid accountId" });
      }

      const config = await oidcRepo.findByAccountId(params.data.accountId);
      if (!config || !config.isActive) {
        return reply.code(404).send({ error: "OIDC configuration not found or inactive" });
      }

      try {
        // Discover OIDC provider configuration
        const oidcConfig = await openidClient.discovery(
          new URL(config.issuerUrl),
          config.clientId,
          config.clientSecret
        );

        // Generate PKCE code verifier and challenge
        const codeVerifier = openidClient.randomPKCECodeVerifier();
        const codeChallenge = await openidClient.calculatePKCECodeChallenge(codeVerifier);

        // Generate state for CSRF protection
        const state = randomBytes(32).toString("hex");

        // Store PKCE verifier for callback
        cleanExpiredPkce();
        pkceStore.set(state, {
          codeVerifier,
          accountId: params.data.accountId,
          expiresAt: Date.now() + PKCE_TTL_MS,
        });

        const redirectUri = `${APP_BASE_URL}/auth/oidc/${params.data.accountId}/callback`;

        // Build authorization URL
        const authUrl = openidClient.buildAuthorizationUrl(oidcConfig, {
          redirect_uri: redirectUri,
          scope: config.scopes.join(" "),
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
          state,
        });

        return reply.code(302).redirect(authUrl.href);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to initiate OIDC login";
        return reply.code(500).send({ error: message });
      }
    }
  );

  app.get(
    "/auth/oidc/:accountId/callback",
    {
      schema: { tags: ["SSO"], summary: "OIDC authorization code callback" },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = AccountIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid accountId" });
      }

      const config = await oidcRepo.findByAccountId(params.data.accountId);
      if (!config || !config.isActive) {
        return reply.code(404).send({ error: "OIDC configuration not found" });
      }

      try {
        const query = request.query as Record<string, string>;
        const state = query.state;

        if (!state) {
          return reply.code(400).send({ error: "Missing state parameter" });
        }

        // Retrieve PKCE verifier
        const pkceEntry = pkceStore.get(state);
        if (!pkceEntry || pkceEntry.expiresAt < Date.now()) {
          pkceStore.delete(state);
          return reply.code(400).send({ error: "Invalid or expired state parameter" });
        }

        // Verify accountId matches
        if (pkceEntry.accountId !== params.data.accountId) {
          pkceStore.delete(state);
          return reply.code(400).send({ error: "Account ID mismatch" });
        }

        // Clean up PKCE entry
        pkceStore.delete(state);

        // Discover OIDC provider configuration
        const oidcConfig = await openidClient.discovery(
          new URL(config.issuerUrl),
          config.clientId,
          config.clientSecret
        );

        const redirectUri = `${APP_BASE_URL}/auth/oidc/${params.data.accountId}/callback`;

        // Build the current URL for token exchange
        const currentUrl = new URL(`${redirectUri}?${new URLSearchParams(query).toString()}`);

        // Exchange authorization code for tokens
        const tokens = await openidClient.authorizationCodeGrant(oidcConfig, currentUrl, {
          pkceCodeVerifier: pkceEntry.codeVerifier,
          expectedState: state,
        });

        // Fetch UserInfo claims
        const sub = tokens.claims()?.sub;
        const userInfo = await openidClient.fetchUserInfo(
          oidcConfig,
          tokens.access_token,
          sub ?? openidClient.skipSubjectCheck
        );

        // Extract email using the configured attribute mapping
        const emailAttr = config.attributeMapping.email ?? "email";
        const email = (userInfo as Record<string, unknown>)[emailAttr] as string | undefined;

        if (!email) {
          return reply.code(401).send({ error: "No email found in OIDC UserInfo" });
        }

        // Find or create user session via AuthService
        const loginResult = await authService.login(
          { email, password: "__oidc_sso__" },
          request.ip,
          request.headers["user-agent"]
        );

        // If login fails, the user may need to be provisioned
        if (!loginResult.ok) {
          const firstName = (userInfo as Record<string, unknown>).given_name as string | undefined;
          const lastName = (userInfo as Record<string, unknown>).family_name as string | undefined;
          return reply.code(200).send({
            ssoAuthenticated: true,
            email,
            sub: userInfo.sub,
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
          secure: env.NODE_ENV === "production",
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
        const message = error instanceof Error ? error.message : "OIDC authentication failed";
        return reply.code(401).send({ error: message });
      }
    }
  );
};
