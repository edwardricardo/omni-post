/**
 * @file csrfMiddleware.ts
 * @description Validates CSRF token on state-changing admin requests.
 *   Reads X-CSRF-Token header (forwarded by the Next.js proxy from the httpOnly cookie)
 *   and validates against the active AdminSession in DB.
 *   Skips safe methods (GET/HEAD/OPTIONS) and exempt routes (login, refresh, reset).
 * @layer infrastructure
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import type { PrismaClient } from "@infra/prisma";
import { createLogger } from "../lib/logger.js";

const csrfLogger = createLogger("csrf");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const EXEMPT_PATHS = new Set([
  "/admin/auth/login",
  "/admin/auth/refresh",
  "/admin/auth/password/reset",
  "/admin/auth/password/reset/confirm",
  "/admin/auth/password/validate",
]);

/**
 * @function createCsrfMiddleware
 * @description Creates a Fastify preHandler hook that validates CSRF tokens.
 *   The Next.js admin proxy reads the httpOnly admin-csrf cookie and forwards it
 *   as the X-CSRF-Token header — no frontend code changes needed.
 * @param prisma - Prisma client for session lookup
 * @returns Fastify preHandler hook function
 */
export function createCsrfMiddleware(prisma: PrismaClient) {
  return async function csrfHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (SAFE_METHODS.has(request.method)) return;

    const path = request.url.split("?")[0] ?? request.url;
    if (!path.startsWith("/admin/")) return;
    if (EXEMPT_PATHS.has(path)) return;

    const csrfHeader = request.headers["x-csrf-token"];
    if (!csrfHeader || typeof csrfHeader !== "string") {
      csrfLogger.warn({ url: request.url }, "CSRF token missing");
      return reply.status(403).send({
        ok: false,
        error: { code: "CSRF_MISSING", message: "CSRF token required" },
      });
    }

    // Auth middleware runs before this — request.auth should be populated
    const userId = request.auth?.user?.id;
    if (!userId) return; // Auth middleware will handle missing auth

    const session = await prisma.adminSession.findFirst({
      where: { userId, isActive: true },
      select: { csrfToken: true },
      orderBy: { createdAt: "desc" },
    });

    if (!session || session.csrfToken !== csrfHeader) {
      csrfLogger.warn({ url: request.url }, "CSRF token mismatch");
      return reply.status(403).send({
        ok: false,
        error: { code: "CSRF_INVALID", message: "Invalid CSRF token" },
      });
    }
  };
}
