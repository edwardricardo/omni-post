/**
 * @file complianceRoutes.ts
 * @description API endpoints for compliance management (GDPR, DSAR, breaches).
 *   Admin endpoints require authentication. Public DSAR submission does not.
 * @layer infrastructure
 */

import type { FastifyPluginAsync } from "fastify";
import { requireAdminAuth } from "../admin/auth/adminAuthMiddleware.js";
import { requirePermission } from "../auth/rbacMiddleware.js";
import { Permission } from "../auth/rbacService.js";
import { TOKENS } from "../infrastructure/container/types.js";
import type { ComplianceService } from "@core/application/compliance/ComplianceService.js";
import {
  updateGdprSettingsSchema,
  updateSecuritySettingsSchema,
  dsarFiltersSchema,
  submitDsarSchema,
  createBreachSchema,
  breachFiltersSchema,
  rejectDsarSchema,
  completeDsarSchema,
} from "./complianceSchemas.js";

export const complianceRoutes: FastifyPluginAsync = async (fastify) => {
  const container = fastify.container;
  if (!container) {
    throw new Error("DI container not available");
  }
  const service = container.resolve<ComplianceService>(TOKENS.ComplianceService);

  const preHandler = [requireAdminAuth, requirePermission(Permission.AUDIT_READ)];

  // ─── GDPR Settings ─────────────────────────────────────────────────────

  fastify.get(
    "/admin/compliance/settings/gdpr",
    { preHandler, schema: { tags: ["Compliance"] } },
    async (_request, reply) => {
      const settings = await service.getGdprSettings();
      return reply.send({ ok: true, data: settings });
    }
  );

  fastify.put(
    "/admin/compliance/settings/gdpr",
    { preHandler, schema: { tags: ["Compliance"] } },
    async (request, reply) => {
      const parsed = updateGdprSettingsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", details: parsed.error.issues });
      }
      const adminId = request.auth?.user?.id ?? "system";
      const result = await service.updateGdprSettings(parsed.data, adminId);
      if (!result.ok) {
        return reply.code(400).send({ error: result.error });
      }
      return reply.send({ ok: true, data: result.value });
    }
  );

  // ─── Security Settings ──────────────────────────────────────────────────

  fastify.get(
    "/admin/compliance/settings/security",
    { preHandler, schema: { tags: ["Compliance"] } },
    async (_request, reply) => {
      const settings = await service.getSecuritySettings();
      return reply.send({ ok: true, data: settings });
    }
  );

  fastify.put(
    "/admin/compliance/settings/security",
    { preHandler, schema: { tags: ["Compliance"] } },
    async (request, reply) => {
      const parsed = updateSecuritySettingsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", details: parsed.error.issues });
      }
      const adminId = request.auth?.user?.id ?? "system";
      const result = await service.updateSecuritySettings(parsed.data, adminId);
      if (!result.ok) {
        return reply.code(400).send({ error: result.error });
      }
      return reply.send({ ok: true, data: result.value });
    }
  );

  // ─── Compliance Score ───────────────────────────────────────────────────

  fastify.get(
    "/admin/compliance/score",
    { preHandler, schema: { tags: ["Compliance"] } },
    async (_request, reply) => {
      const scoreResult = await service.getComplianceScore();
      return reply.send({ ok: true, data: scoreResult });
    }
  );

  // ─── DSAR Requests (Admin) ──────────────────────────────────────────────

  fastify.get(
    "/admin/compliance/dsar",
    { preHandler, schema: { tags: ["Compliance"] } },
    async (request, reply) => {
      const parsed = dsarFiltersSchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", details: parsed.error.issues });
      }
      const result = await service.getDsarRequests(parsed.data);
      return reply.send({ ok: true, data: result });
    }
  );

  fastify.get(
    "/admin/compliance/dsar/:id",
    { preHandler, schema: { tags: ["Compliance"] } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const dsar = await service.getDsarById(id);
      if (!dsar) {
        return reply.code(404).send({ error: "NOT_FOUND" });
      }
      return reply.send({ ok: true, data: dsar });
    }
  );

  fastify.post(
    "/admin/compliance/dsar/:id/acknowledge",
    { preHandler, schema: { tags: ["Compliance"] } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const adminId = request.auth?.user?.id ?? "system";
      const result = await service.acknowledgeDsar(id, adminId);
      if (!result.ok) {
        return reply.code(404).send({ error: result.error });
      }
      return reply.send({ ok: true, data: result.value });
    }
  );

  fastify.post(
    "/admin/compliance/dsar/:id/complete",
    { preHandler, schema: { tags: ["Compliance"] } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = completeDsarSchema.safeParse(request.body ?? {});
      const adminId = request.auth?.user?.id ?? "system";
      const result = await service.completeDsar(
        id,
        adminId,
        parsed.success ? parsed.data.exportUrl : undefined
      );
      if (!result.ok) {
        return reply.code(404).send({ error: result.error });
      }
      return reply.send({ ok: true, data: result.value });
    }
  );

  fastify.post(
    "/admin/compliance/dsar/:id/reject",
    { preHandler, schema: { tags: ["Compliance"] } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = rejectDsarSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", details: parsed.error.issues });
      }
      const adminId = request.auth?.user?.id ?? "system";
      const result = await service.rejectDsar(id, adminId, parsed.data.reason);
      if (!result.ok) {
        return reply.code(404).send({ error: result.error });
      }
      return reply.send({ ok: true, data: result.value });
    }
  );

  // ─── Breach Reports (Admin) ─────────────────────────────────────────────

  fastify.get(
    "/admin/compliance/breaches",
    { preHandler, schema: { tags: ["Compliance"] } },
    async (request, reply) => {
      const parsed = breachFiltersSchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", details: parsed.error.issues });
      }
      const result = await service.getBreachReports(parsed.data);
      return reply.send({ ok: true, data: result });
    }
  );

  fastify.post(
    "/admin/compliance/breaches",
    { preHandler, schema: { tags: ["Compliance"] } },
    async (request, reply) => {
      const parsed = createBreachSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "VALIDATION_ERROR", details: parsed.error.issues });
      }
      const adminId = request.auth?.user?.id ?? "system";
      const result = await service.createBreachReport(parsed.data, adminId);
      if (!result.ok) {
        return reply.code(500).send({ error: result.error });
      }
      return reply.send({ ok: true, data: result.value });
    }
  );

  fastify.post(
    "/admin/compliance/breaches/:id/notify",
    { preHandler, schema: { tags: ["Compliance"] } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const adminId = request.auth?.user?.id ?? "system";
      const result = await service.sendBreachNotifications(id, adminId);
      if (!result.ok) {
        return reply.code(404).send({ error: result.error });
      }
      return reply.send({ ok: true, data: result.value });
    }
  );

  // ─── Public DSAR Submission (no auth) ───────────────────────────────────

  fastify.post("/compliance/dsar", { schema: { tags: ["Compliance"] } }, async (request, reply) => {
    const parsed = submitDsarSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "VALIDATION_ERROR", details: parsed.error.issues });
    }

    const result = await service.submitDsarRequest({
      requestorEmail: parsed.data.email,
      ...(parsed.data.name !== undefined && {
        requestorName: parsed.data.name,
      }),
      type: parsed.data.type,
      ...(parsed.data.jurisdiction !== undefined && {
        jurisdiction: parsed.data.jurisdiction,
      }),
      ...(parsed.data.accountId !== undefined && {
        accountId: parsed.data.accountId,
      }),
      ipAddress: request.ip,
    });

    if (!result.ok) {
      const statusMap: Record<string, number> = {
        RATE_LIMITED: 429,
        VALIDATION_ERROR: 400,
      };
      return reply.code(statusMap[result.error] ?? 500).send({ error: result.error });
    }

    return reply.code(201).send({ ok: true, data: result.value });
  });
};
