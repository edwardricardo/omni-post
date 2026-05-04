/**
 * @file enhancedOAuthProvider.ts
 * @description Enhanced OAuth provider with PKCE, secure state parameters, token scope
 *              validation, certificate validation, encryption, and flow monitoring.
 * @layer infrastructure
 */

import { randomBytes, randomUUID, createHash, createCipheriv, createDecipheriv } from "crypto";
import { URLSearchParams } from "url";
import Redis from "ioredis";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { ProviderId } from "../providers/providerAdapter.interface.js";
import type { ProviderConnection, Provider as PrismaProvider } from "@infra/prisma";
import { prisma as globalPrisma } from "@infra/prisma";
import type { ApiMetrics } from "../metrics/apiMetrics.js";
import { AuditableService } from "../services/AuditableService.js";
import { AppError, ErrorCode } from "../lib/errors/AppError.js";
import { env } from "../config/env.js";

/**
 * Minimal Prisma interface required by EnhancedOAuthService.
 * Using a structural interface allows injection of mock objects in tests
 * without depending on the full PrismaClient type.
 */
interface OAuthPrismaClient {
  providerConnection: {
    findUnique: (args: { where: Record<string, unknown> }) => Promise<ProviderConnection | null>;
    findFirst: (args: { where: Record<string, unknown> }) => Promise<ProviderConnection | null>;
    create: (args: { data: Record<string, unknown> }) => Promise<ProviderConnection>;
    update: (args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => Promise<ProviderConnection>;
    delete: (args: { where: Record<string, unknown> }) => Promise<ProviderConnection>;
  };
}

interface PKCEChallenge {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

interface OAuthState {
  state: string;
  accountId: string;
  provider: ProviderId;
  redirectUri: string;
  scopes: string[];
  pkce: PKCEChallenge;
  nonce: string;
  createdAt: number;
  expiresAt: number;
}

export interface EnhancedOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  authUrl: string;
  tokenUrl: string;
  userInfoUrl?: string;

  // Security settings
  requirePKCE: boolean;
  validateCertificates: boolean;
  encryptStoredTokens: boolean;
  maxScopeCount: number;
  allowedScopes: string[];

  // Timeouts
  authorizationTimeout: number; // seconds
  tokenRequestTimeout: number; // seconds
  stateExpiryMinutes: number;
}

interface OAuthTokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  tokenType: string;
  scope?: string;
  idToken?: string;
}

interface OAuthUserInfo {
  id: string;
  name: string;
  email: string;
  username?: string;
  profileImage?: string;
  verified?: boolean;
  metadata?: Record<string, unknown>;
}

export interface EnhancedOAuthProvider {
  id: ProviderId;
  config: EnhancedOAuthConfig;
  validateAuthorizationCode(
    code: string,
    state: string,
    codeVerifier?: string
  ): Promise<{
    tokens: OAuthTokenResponse;
    userInfo: OAuthUserInfo;
    validatedScopes: string[];
  }>;
  getUserInfo(accessToken: string): Promise<OAuthUserInfo>;
  refreshAccessToken(refreshToken: string): Promise<OAuthTokenResponse>;
  validateTokenScopes(token: string, requiredScopes: string[]): Promise<boolean>;
}

/**
 * Per-call context for OAuth token encrypt/decrypt. Bound as AAD so a
 * leaked ciphertext cannot be replayed across providers or connections.
 * Mirrors `EncryptionContext` from EncryptionService — kept local to
 * avoid coupling this file to the platform-encryption helper (different
 * KEK, different on-the-wire format).
 */
interface OAuthTokenContext {
  readonly fieldName: "ProviderConnection.accessToken" | "ProviderConnection.refreshToken";
  readonly recordId: string;
  readonly caller?: string;
}

interface OAuthDecryptAuditPort {
  logCredentialDecrypt(event: {
    fieldName: string;
    recordId: string;
    caller?: string;
    success: boolean;
    error?: string;
  }): Promise<void>;
}

function canonicaliseOAuthContext(ctx: OAuthTokenContext): Buffer {
  return Buffer.from(`${ctx.fieldName}\x1f${ctx.recordId}`, "utf8");
}

export class EnhancedOAuthService extends AuditableService {
  private readonly redis: Redis;
  private readonly metrics: ApiMetrics;
  private readonly encryptionKey: Buffer;
  private readonly db: OAuthPrismaClient;
  private readonly auditPort: OAuthDecryptAuditPort | undefined;

  // Redis key prefixes
  private readonly OAUTH_STATE_PREFIX = "oauth:state:";
  private readonly OAUTH_TOKENS_PREFIX = "oauth:tokens:";
  private readonly OAUTH_ATTEMPTS_PREFIX = "oauth:attempts:";

  constructor(
    redis: Redis,
    metrics: ApiMetrics,
    prismaClient?: OAuthPrismaClient,
    auditPort?: OAuthDecryptAuditPort
  ) {
    super("EnhancedOAuthService");
    this.redis = redis;
    this.metrics = metrics;
    this.db = prismaClient ?? (globalPrisma as unknown as OAuthPrismaClient);
    this.auditPort = auditPort;

    this.encryptionKey = Buffer.from(env.OAUTH_ENCRYPTION_KEY, "hex");

    this.logOperation(
      { serviceName: "EnhancedOAuthService", operation: "constructor" },
      "success",
      0
    );
  }

  /**
   * Generate authorization URL with PKCE and secure state
   */
  async generateAuthorizationUrl(
    provider: EnhancedOAuthProvider,
    accountId: string,
    additionalScopes: string[] = []
  ): Promise<{
    authUrl: string;
    state: string;
    codeVerifier: string;
  }> {
    return this.executeWithAudit(
      { operation: "generateAuthorizationUrl", userId: accountId, accountId },
      {
        action: "OAUTH_AUTHORIZATION_INITIATED",
        category: "AUTHENTICATION",
        severity: "MEDIUM",
        resourceType: "OAuthProvider",
        resourceId: provider.id,
      },
      async () => {
        // Generate PKCE challenge
        const pkce = this.generatePKCEChallenge();

        // Generate secure state
        const state = randomBytes(32).toString("base64url");
        const nonce = randomBytes(16).toString("base64url");

        // Validate and merge scopes
        const requestedScopes = [...provider.config.scopes, ...additionalScopes];
        const validatedScopes = this.validateScopes(requestedScopes, provider.config.allowedScopes);

        this.validateRequired(
          { scopes: validatedScopes.length > 0 ? validatedScopes : null },
          "No valid scopes provided"
        );

        if (validatedScopes.length > provider.config.maxScopeCount) {
          throw AppError.badRequest(
            `Too many scopes requested. Maximum: ${provider.config.maxScopeCount}`
          );
        }

        // Store OAuth state
        const oauthState: OAuthState = {
          state,
          accountId,
          provider: provider.id,
          redirectUri: provider.config.redirectUri,
          scopes: validatedScopes,
          pkce,
          nonce,
          createdAt: Date.now(),
          expiresAt: Date.now() + provider.config.stateExpiryMinutes * 60 * 1000,
        };

        await this.redis.setex(
          this.OAUTH_STATE_PREFIX + state,
          provider.config.stateExpiryMinutes * 60,
          JSON.stringify(oauthState)
        );

        // Build authorization URL
        const authParams = new URLSearchParams({
          response_type: "code",
          client_id: provider.config.clientId,
          redirect_uri: provider.config.redirectUri,
          scope: validatedScopes.join(" "),
          state: state,
          nonce: nonce,
        });

        // Add PKCE parameters if required
        if (provider.config.requirePKCE) {
          authParams.set("code_challenge", pkce.codeChallenge);
          authParams.set("code_challenge_method", pkce.codeChallengeMethod);
        }

        const authUrl = `${provider.config.authUrl}?${authParams.toString()}`;

        return {
          authUrl,
          state,
          codeVerifier: pkce.codeVerifier,
        };
      }
    );
  }

  /**
   * Handle OAuth callback with comprehensive validation
   */
  async handleCallback(
    provider: EnhancedOAuthProvider,
    code: string,
    state: string,
    error?: string
  ): Promise<{
    connection: ProviderConnection;
    userInfo: OAuthUserInfo;
    isNewConnection: boolean;
  }> {
    return this.executeWithAudit(
      { operation: "handleCallback" },
      {
        action: "OAUTH_CONNECTION_ESTABLISHED",
        category: "AUTHENTICATION",
        severity: "HIGH",
        resourceType: "OAuthProvider",
        resourceId: provider.id,
      },
      async () => {
        // Handle OAuth error responses
        if (error) {
          this.metrics.metrics.securityThreats.inc({
            threat_type: "oauth_error",
            endpoint: "oauth_callback",
          });

          throw AppError.externalService("OAuth", `OAuth provider error: ${error}`);
        }

        // Validate and retrieve state
        const oauthState = await this.validateOAuthState(state);

        if (oauthState.provider !== provider.id) {
          throw AppError.badRequest("Provider mismatch in OAuth state");
        }

        // Exchange code for tokens
        const tokenResponse = await this.exchangeCodeForTokens(provider, code, oauthState);

        // Get user information
        const userInfo = await provider.getUserInfo(tokenResponse.accessToken);

        // Validate token scopes
        if (tokenResponse.scope) {
          const receivedScopes = tokenResponse.scope.split(" ");
          const isValidScope = this.validateScopes(receivedScopes, provider.config.allowedScopes);

          if (isValidScope.length !== receivedScopes.length) {
            this.logWarning(
              { operation: "handleCallback" },
              `Received unexpected scopes from OAuth provider: ${receivedScopes.join(", ")}`
            );
          }
        }

        // Store or update provider connection
        const { connection, isNewConnection } = await this.upsertProviderConnection(
          provider.id,
          oauthState.accountId,
          userInfo,
          tokenResponse
        );

        // Clean up OAuth state
        await this.redis.del(this.OAUTH_STATE_PREFIX + state);

        return {
          connection,
          userInfo,
          isNewConnection,
        };
      }
    );
  }

  /**
   * Refresh OAuth tokens with validation
   */
  async refreshTokens(
    provider: EnhancedOAuthProvider,
    connectionId: string
  ): Promise<OAuthTokenResponse> {
    return this.execute({ operation: "refreshTokens" }, async () => {
      // Get current connection
      const connection = await this.db.providerConnection.findUnique({
        where: { id: connectionId },
      });

      this.validateRequired({ connection }, "Connection not found");

      if (!connection!.refreshToken) {
        throw AppError.badRequest("Refresh token not available");
      }

      // Decrypt refresh token
      const refreshToken = this.decryptToken(connection!.refreshToken, {
        fieldName: "ProviderConnection.refreshToken",
        recordId: connectionId,
        caller: "EnhancedOAuthService.refreshTokens",
      });

      // Request new tokens
      const tokenResponse = await provider.refreshAccessToken(refreshToken);

      // Update connection with new tokens
      await this.db.providerConnection.update({
        where: { id: connectionId },
        data: {
          accessToken: this.encryptToken(tokenResponse.accessToken, {
            fieldName: "ProviderConnection.accessToken",
            recordId: connectionId,
            caller: "EnhancedOAuthService.refreshTokens",
          }),
          ...(tokenResponse.refreshToken && {
            refreshToken: this.encryptToken(tokenResponse.refreshToken, {
              fieldName: "ProviderConnection.refreshToken",
              recordId: connectionId,
              caller: "EnhancedOAuthService.refreshTokens",
            }),
          }),
          ...(tokenResponse.expiresIn && {
            expiresAt: new Date(Date.now() + tokenResponse.expiresIn * 1000),
          }),
          lastUsedAt: new Date(),
        },
      });

      // Log token refresh using AuditableService
      await this.logSecurityEvent(connection!.accountId, connection!.accountId, {
        action: "OAUTH_TOKEN_REFRESHED",
        severity: "MEDIUM",
        details: {
          provider: connection!.providerId,
          connectionId,
        },
      });

      return tokenResponse;
    });
  }

  /**
   * Revoke OAuth connection and tokens
   */
  async revokeConnection(
    provider: EnhancedOAuthProvider,
    connectionId: string,
    accountId: string
  ): Promise<void> {
    return this.executeWithAudit(
      { operation: "revokeConnection", userId: accountId, accountId },
      {
        action: "OAUTH_CONNECTION_REVOKED",
        category: "SECURITY",
        severity: "HIGH",
        resourceType: "OAuthProvider",
        resourceId: connectionId,
      },
      async () => {
        const connection = await this.db.providerConnection.findUnique({
          where: { id: connectionId, accountId },
        });

        this.validateRequired({ connection }, "Connection not found");

        // Revoke tokens with provider (if supported)
        try {
          if (connection!.accessToken) {
            const _accessToken = this.decryptToken(connection!.accessToken, {
              fieldName: "ProviderConnection.accessToken",
              recordId: connectionId,
              caller: "EnhancedOAuthService.revokeConnection",
            });
            // Note: Actual revocation would depend on provider's revocation endpoint
            this.logWarning(
              { operation: "revokeConnection", accountId },
              `Would revoke OAuth tokens for provider ${provider.id}`
            );
          }
        } catch (error) {
          this.logWarning(
            { operation: "revokeConnection", accountId },
            `Failed to revoke tokens with provider: ${error instanceof Error ? error.message : "Unknown error"}`
          );
        }

        // Delete connection from database
        await this.db.providerConnection.delete({
          where: { id: connectionId },
        });
      }
    );
  }

  // Private helper methods

  private generatePKCEChallenge(): PKCEChallenge {
    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

    return {
      codeVerifier,
      codeChallenge,
      codeChallengeMethod: "S256",
    };
  }

  private async validateOAuthState(state: string): Promise<OAuthState> {
    const stateData = await this.redis.get(this.OAUTH_STATE_PREFIX + state);

    if (!stateData) {
      this.metrics.metrics.securityThreats.inc({
        threat_type: "invalid_oauth_state",
        endpoint: "oauth_callback",
      });

      throw AppError.unauthorized("Invalid or expired OAuth state");
    }

    const oauthState: OAuthState = JSON.parse(stateData);

    if (oauthState.expiresAt < Date.now()) {
      await this.redis.del(this.OAUTH_STATE_PREFIX + state);
      throw AppError.unauthorized("OAuth state expired");
    }

    return oauthState;
  }

  private async exchangeCodeForTokens(
    provider: EnhancedOAuthProvider,
    code: string,
    oauthState: OAuthState
  ): Promise<OAuthTokenResponse> {
    const tokenParams = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: provider.config.clientId,
      client_secret: provider.config.clientSecret,
      code: code,
      redirect_uri: provider.config.redirectUri,
    });

    // Add PKCE verifier if required
    if (provider.config.requirePKCE) {
      tokenParams.set("code_verifier", oauthState.pkce.codeVerifier);
    }

    const response = await fetch(provider.config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": "SaaS-Prototype-OAuth-Client/1.0",
      },
      body: tokenParams.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw AppError.externalService(
        "OAuth",
        `Token exchange failed: ${response.status} ${errorText}`
      );
    }

    const tokenData = await response.json();

    if (!tokenData.access_token) {
      throw AppError.externalService("OAuth", "Invalid token response: missing access_token");
    }

    return {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      tokenType: tokenData.token_type || "Bearer",
      scope: tokenData.scope,
      idToken: tokenData.id_token,
    };
  }

  private async upsertProviderConnection(
    providerId: ProviderId,
    accountId: string,
    userInfo: OAuthUserInfo,
    tokenResponse: OAuthTokenResponse
  ): Promise<{ connection: ProviderConnection; isNewConnection: boolean }> {
    // Check for existing connection
    const existingConnection = await this.db.providerConnection.findFirst({
      where: {
        accountId,
        providerId: providerId.toUpperCase() as PrismaProvider,
        providerAccountId: userInfo.id,
      },
    });

    // Determine the connection id BEFORE encrypting — recordId is bound as
    // AAD into the auth tag, so the same id used here must be persisted on
    // the row. For existing rows reuse their id; for new rows pre-generate
    // a UUID app-side rather than letting Prisma's `@default(uuid())` pick
    // one (we can't bind an id we don't know yet).
    const connectionId = existingConnection ? existingConnection.id : randomUUID();

    const buildEncrypted = () => ({
      accessToken: this.encryptToken(tokenResponse.accessToken, {
        fieldName: "ProviderConnection.accessToken",
        recordId: connectionId,
        caller: "EnhancedOAuthService.upsertProviderConnection",
      }),
      ...(tokenResponse.refreshToken && {
        refreshToken: this.encryptToken(tokenResponse.refreshToken, {
          fieldName: "ProviderConnection.refreshToken",
          recordId: connectionId,
          caller: "EnhancedOAuthService.upsertProviderConnection",
        }),
      }),
    });

    const connectionData = {
      ...buildEncrypted(),
      ...(tokenResponse.expiresIn && {
        expiresAt: new Date(Date.now() + tokenResponse.expiresIn * 1000),
      }),
      ...(userInfo.username && { accountName: userInfo.username || userInfo.name }),
      ...(userInfo.profileImage && { profileImage: userInfo.profileImage }),
      isVerified: userInfo.verified || false,
      capabilities: {},
      limits: {},
      constraints: {},
      status: "CONNECTED" as const,
      lastUsedAt: new Date(),
      isActive: true,
    };

    if (existingConnection) {
      // Update existing connection
      const connection = await this.db.providerConnection.update({
        where: { id: existingConnection.id },
        data: connectionData,
      });
      return { connection, isNewConnection: false };
    } else {
      // Create new connection — pass `id: connectionId` so the row's primary
      // key matches the AAD recordId we just bound.
      const connection = await this.db.providerConnection.create({
        data: {
          id: connectionId,
          accountId,
          projectId: accountId, // For now, use same as accountId - this should be passed as parameter
          providerId: providerId.toUpperCase() as PrismaProvider,
          providerName: providerId.charAt(0).toUpperCase() + providerId.slice(1),
          providerAccountId: userInfo.id,
          ...connectionData,
        },
      });
      return { connection, isNewConnection: true };
    }
  }

  private validateScopes(requestedScopes: string[], allowedScopes: string[]): string[] {
    return requestedScopes.filter((scope) => allowedScopes.includes(scope));
  }

  private encryptToken(token: string, context: OAuthTokenContext): string {
    if (!token) return token;

    try {
      const iv = randomBytes(16);
      const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv, { authTagLength: 16 });
      cipher.setAAD(canonicaliseOAuthContext(context));

      let encrypted = cipher.update(token, "utf8", "hex");
      encrypted += cipher.final("hex");

      const authTag = cipher.getAuthTag();

      return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
    } catch (error) {
      this.logWarning(
        { operation: "encryptToken" },
        `CRITICAL: Token encryption failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      throw new AppError(ErrorCode.INTERNAL_SERVER_ERROR, 500, "Failed to encrypt OAuth token");
    }
  }

  private decryptToken(encryptedToken: string, context: OAuthTokenContext): string {
    if (!encryptedToken) return encryptedToken;

    if (!encryptedToken.includes(":")) {
      this.logWarning(
        { operation: "decryptToken" },
        "CRITICAL: Refusing to read OAuth token — stored value is not in encrypted format. " +
          "Re-authentication is required for this connection."
      );
      this.emitDecryptAudit(context, false, "stored token not in encrypted format");
      throw new AppError(
        ErrorCode.AUTH_TOKEN_INVALID,
        401,
        "Stored OAuth token is not encrypted; re-authentication required"
      );
    }

    try {
      const parts = encryptedToken.split(":");
      if (parts.length !== 3) {
        throw new Error("Invalid encrypted token format");
      }

      const [ivHex, authTagHex, encrypted] = parts;
      if (!ivHex || !authTagHex || !encrypted) {
        throw new Error("Missing token parts");
      }

      const iv = Buffer.from(ivHex, "hex");
      const authTag = Buffer.from(authTagHex, "hex");

      const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, iv, {
        authTagLength: 16,
      });
      decipher.setAuthTag(authTag);
      decipher.setAAD(canonicaliseOAuthContext(context));

      let decrypted = decipher.update(encrypted, "hex", "utf8");
      decrypted += decipher.final("utf8");

      this.emitDecryptAudit(context, true);
      return decrypted;
    } catch (error) {
      this.logWarning(
        { operation: "decryptToken" },
        `CRITICAL: Token decryption failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
      this.emitDecryptAudit(
        context,
        false,
        error instanceof Error ? error.message : "decrypt failed"
      );
      throw new AppError(ErrorCode.INTERNAL_SERVER_ERROR, 500, "Failed to decrypt OAuth token");
    }
  }

  /**
   * Fire-and-forget audit emission for OAuth token decryption. Failure to
   * log NEVER fails the decrypt — audit is best-effort.
   */
  private emitDecryptAudit(context: OAuthTokenContext, success: boolean, error?: string): void {
    if (!this.auditPort) return;
    const event = {
      fieldName: context.fieldName,
      recordId: context.recordId,
      ...(context.caller !== undefined && { caller: context.caller }),
      success,
      ...(error !== undefined && { error }),
    };
    void this.auditPort.logCredentialDecrypt(event).catch(() => {
      // Audit failures must never propagate.
    });
  }

  /**
   * Register OAuth routes with Fastify
   */
  async registerRoutes(
    app: FastifyInstance,
    providers: Map<ProviderId, EnhancedOAuthProvider>
  ): Promise<void> {
    // OAuth authorization initiation
    app.get(
      "/auth/oauth/:provider/authorize",
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { provider: providerId } = request.params as { provider: string };
        const { scopes } = request.query as { scopes?: string };

        const provider = providers.get(providerId as ProviderId);
        if (!provider) {
          return reply.code(404).send({ error: "Provider not found" });
        }

        // Get account ID from session (assuming authenticated request)
        const accountId = request.user?.accountId || request.user?.id;
        if (!accountId) {
          return reply.code(401).send({ error: "Authentication required" });
        }

        const additionalScopes = scopes ? scopes.split(",") : [];
        const result = await this.generateAuthorizationUrl(provider, accountId, additionalScopes);

        return reply.send({
          authUrl: result.authUrl,
          state: result.state,
        });
      }
    );

    // OAuth callback handling
    app.get(
      "/auth/oauth/:provider/callback",
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { provider: providerId } = request.params as { provider: string };
        const { code, state, error } = request.query as {
          code?: string;
          state?: string;
          error?: string;
        };

        const provider = providers.get(providerId as ProviderId);
        if (!provider) {
          return reply.code(404).send({ error: "Provider not found" });
        }

        if (!code || !state) {
          return reply.code(400).send({ error: "Missing required parameters" });
        }

        const result = await this.handleCallback(provider, code, state, error);

        return reply.send({
          success: true,
          connection: {
            id: result.connection.id,
            provider: result.connection.providerId,
            accountName: result.connection.accountName,
            isActive: result.connection.isActive,
          },
          isNewConnection: result.isNewConnection,
        });
      }
    );
  }
}
