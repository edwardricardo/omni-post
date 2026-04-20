/**
 * @file settingsRoutes.ts
 * @description API endpoints for platform settings and client BYOK management.
 *   Admin endpoints require superadmin auth. Client BYOK endpoints require client auth.
 * @layer infrastructure
 */

import type { FastifyPluginAsync } from "fastify";
import { requireAdminAuth, requireSuperAdmin } from "../admin/auth/adminAuthMiddleware.js";
import { requireClientAuth } from "../auth/customerAuthMiddleware.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { SettingsService } from "./SettingsService.js";
import type { PlatformCredentialService } from "../security/PlatformCredentialService.js";
import type { CredentialGroup } from "@infra/prisma";
import {
  groupParamsSchema,
  groupKeyParamsSchema,
  updateCredentialsSchema,
  rotateEncryptionSchema,
  setByokSchema,
  byokProviderParamsSchema,
  testByokSchema,
} from "./settingsSchemas.js";

export const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  const container = fastify.container;
  if (!container) {
    throw new Error("DI container not available");
  }
  const service = container.resolve<SettingsService>(TOKENS.SettingsService);
  const credentialService = container.resolve<PlatformCredentialService>(
    TOKENS.PlatformCredentialService
  );

  const adminPreHandler = [requireAdminAuth, requireSuperAdmin];
  const clientPreHandler = [requireClientAuth];

  // ─── Admin: Configuration Status ─────────────────────────────────────

  fastify.get(
    "/admin/settings/status",
    { preHandler: adminPreHandler, schema: { tags: ["Settings"] } },
    async (_request, reply) => {
      const result = await service.getConfigurationStatus();
      if (!result.ok) {
        return reply.code(500).send({ ok: false, error: result.error });
      }
      return reply.send({ ok: true, data: result.value });
    }
  );

  // ─── Admin: Get Group Settings (masked) ──────────────────────────────

  fastify.get(
    "/admin/settings/:group",
    { preHandler: adminPreHandler, schema: { tags: ["Settings"] } },
    async (request, reply) => {
      const parsed = groupParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ ok: false, error: "VALIDATION_ERROR", details: parsed.error.issues });
      }

      const result = await service.getGroupSettings(parsed.data.group as CredentialGroup);
      if (!result.ok) {
        return reply.code(500).send({ ok: false, error: result.error });
      }
      return reply.send({ ok: true, data: result.value });
    }
  );

  // ─── Admin: Update Group Settings ────────────────────────────────────

  fastify.put(
    "/admin/settings/:group",
    { preHandler: adminPreHandler, schema: { tags: ["Settings"] } },
    async (request, reply) => {
      const paramsParsed = groupParamsSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return reply
          .code(400)
          .send({ ok: false, error: "VALIDATION_ERROR", details: paramsParsed.error.issues });
      }

      const bodyParsed = updateCredentialsSchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return reply
          .code(400)
          .send({ ok: false, error: "VALIDATION_ERROR", details: bodyParsed.error.issues });
      }

      const adminId = request.auth?.user?.id ?? "system";
      const result = await service.setGroupSettings(
        paramsParsed.data.group as CredentialGroup,
        bodyParsed.data.credentials,
        adminId
      );
      if (!result.ok) {
        return reply.code(400).send({ ok: false, error: result.error });
      }
      return reply.send({ ok: true });
    }
  );

  // ─── Admin: Test Connection ──────────────────────────────────────────

  fastify.post(
    "/admin/settings/:group/test",
    { preHandler: adminPreHandler, schema: { tags: ["Settings"] } },
    async (request, reply) => {
      const parsed = groupParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ ok: false, error: "VALIDATION_ERROR", details: parsed.error.issues });
      }

      const result = await service.testConnection(parsed.data.group as CredentialGroup);
      if (!result.ok) {
        return reply.code(500).send({ ok: false, error: result.error });
      }
      return reply.send({ ok: true, data: result.value });
    }
  );

  // ─── Admin: Delete Credential ────────────────────────────────────────

  fastify.delete(
    "/admin/settings/:group/:key",
    { preHandler: adminPreHandler, schema: { tags: ["Settings"] } },
    async (request, reply) => {
      const parsed = groupKeyParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ ok: false, error: "VALIDATION_ERROR", details: parsed.error.issues });
      }

      const adminId = request.auth?.user?.id ?? "system";
      const result = await credentialService.deleteCredential(
        parsed.data.group as CredentialGroup,
        parsed.data.key,
        adminId
      );
      if (!result.ok) {
        return reply.code(500).send({ ok: false, error: result.error });
      }
      return reply.send({ ok: true });
    }
  );

  // ─── Admin: Encryption Key Rotation ──────────────────────────────────

  fastify.post(
    "/admin/settings/encryption/rotate",
    { preHandler: adminPreHandler, schema: { tags: ["Settings"] } },
    async (request, reply) => {
      const parsed = rotateEncryptionSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ ok: false, error: "VALIDATION_ERROR", details: parsed.error.issues });
      }

      const adminId = request.auth?.user?.id ?? "system";
      const result = await service.logEncryptionKeyRotation(adminId, parsed.data.note);
      if (!result.ok) {
        return reply.code(500).send({ ok: false, error: result.error });
      }
      return reply.send({
        ok: true,
        data: {
          message:
            "Rotation logged. Update PLATFORM_ENCRYPTION_KEY in .env and re-encrypt existing credentials.",
        },
      });
    }
  );

  // ─── Client: AI Rate Limit Status ────────────────────────────────────

  fastify.get(
    "/settings/ai",
    { preHandler: clientPreHandler, schema: { tags: ["Settings"] } },
    async (request, reply) => {
      const accountId = request.customerUser?.accountId;
      if (!accountId) {
        return reply.code(401).send({ ok: false, error: "UNAUTHORIZED" });
      }

      const result = await service.getAiRateLimit(accountId);
      if (!result.ok) {
        return reply.code(500).send({ ok: false, error: result.error });
      }
      return reply.send({ ok: true, data: result.value });
    }
  );

  // ─── Client: Set BYOK Key ───────────────────────────────────────────

  fastify.put(
    "/settings/ai/byok",
    { preHandler: clientPreHandler, schema: { tags: ["Settings"] } },
    async (request, reply) => {
      const accountId = request.customerUser?.accountId;
      if (!accountId) {
        return reply.code(401).send({ ok: false, error: "UNAUTHORIZED" });
      }

      const parsed = setByokSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ ok: false, error: "VALIDATION_ERROR", details: parsed.error.issues });
      }

      const result = await service.setByokKey(accountId, parsed.data.provider, parsed.data.apiKey);
      if (!result.ok) {
        return reply.code(500).send({ ok: false, error: result.error });
      }
      return reply.send({ ok: true });
    }
  );

  // ─── Client: Delete BYOK Key ────────────────────────────────────────

  fastify.delete(
    "/settings/ai/byok/:provider",
    { preHandler: clientPreHandler, schema: { tags: ["Settings"] } },
    async (request, reply) => {
      const accountId = request.customerUser?.accountId;
      if (!accountId) {
        return reply.code(401).send({ ok: false, error: "UNAUTHORIZED" });
      }

      const parsed = byokProviderParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ ok: false, error: "VALIDATION_ERROR", details: parsed.error.issues });
      }

      const result = await service.deleteByokKey(accountId, parsed.data.provider);
      if (!result.ok) {
        return reply.code(500).send({ ok: false, error: result.error });
      }
      return reply.send({ ok: true });
    }
  );

  // ─── Client: Test BYOK Key ──────────────────────────────────────────

  fastify.post(
    "/settings/ai/byok/test",
    { preHandler: clientPreHandler, schema: { tags: ["Settings"] } },
    async (request, reply) => {
      const parsed = testByokSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ ok: false, error: "VALIDATION_ERROR", details: parsed.error.issues });
      }

      const result = await service.testByokKey(parsed.data.provider, parsed.data.apiKey);
      if (!result.ok) {
        return reply.code(500).send({ ok: false, error: result.error });
      }
      return reply.send({ ok: true, data: result.value });
    }
  );

  // ─── Public: Non-secret Platform Settings (no auth) ──────────────────

  fastify.get(
    "/settings/public",
    { schema: { tags: ["Settings"], summary: "Get public platform settings (no auth)" } },
    async (_request, reply) => {
      const result = await service.getPublicPlatformSettings();
      if (!result.ok) {
        return reply.code(500).send({ ok: false, error: "Failed to load platform settings" });
      }
      return reply.send({ ok: true, data: result.value });
    }
  );
};
